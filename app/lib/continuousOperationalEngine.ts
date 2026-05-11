import { supabaseAdmin } from "@/app/lib/admin";
import {
  decisionToAuditMeta,
  evaluateAutonomousDecision,
  resolveAutonomousExecutionMode,
  type AutonomousExecutionMode,
} from "@/app/lib/autonomousDecisionEngine";
import { evaluateAutoRelease } from "@/app/lib/autoReleaseEngine";
import { shouldSilent, type AutopilotMode } from "@/app/lib/autopilotMode";
import {
  buildCommunicationClimate,
  orchestrateRecoveryCommunication,
} from "@/app/lib/communicationOrchestrationEngine";
import { createContinuousLearningEntry } from "@/app/lib/continuousLearningLedger";
import {
  enrichOrderWithIntelligence,
  mapAndEnrichOrderFromDb,
  mapOrderToDb,
} from "@/app/lib/domain/orderMapper";
import type { RestaurantOrder } from "@/app/lib/domain/restaurant";
import { getEventKeySet, persistOperationalEvent } from "@/app/lib/intelligence/operationalEventModel";
import { buildMultiLocationIntelligenceSnapshot } from "@/app/lib/intelligence/multiLocationIntelligenceEngine";
import { buildOperationalDigitalTwin } from "@/app/lib/operationalDigitalTwinEngine";
import { simulateOperationalDecision } from "@/app/lib/operationalSimulationEngine";
import {
  createOperationalMemorySnapshot,
  getAdaptiveDecisionContext,
  type OperationalMemorySnapshot,
} from "@/app/lib/operationalMemoryEngine";
import { resolveOperationalPolicy } from "@/app/lib/policyEngine";
import { executeRecoveryCommunication } from "@/app/lib/providers/communication/communicationExecutionService";
import { getWhatsAppProviderStatus } from "@/app/lib/providers/communication/whatsappProvider";
import { buildReliabilityProfileFromOrders } from "@/app/lib/reliabilityEngine";
import { runWaitlistCascade } from "@/app/lib/waitlistCascadeService";

type ContinuousRunResult = {
  mode: AutopilotMode;
  executionMode: AutonomousExecutionMode;
  evaluatedOrders: number;
  decisionsEvaluated: number;
  eventsWritten: number;
  communicationsAttempted: number;
  communicationsSent: number;
  communicationsSuppressed: number;
  releasesExecuted: number;
  recoveriesAttempted: number;
  skippedDuplicates: number;
  logs: string[];
};

function hourBucket(date = new Date()) {
  return date.toISOString().slice(0, 13);
}

function isClosed(order: RestaurantOrder) {
  return order.status === "CANCELLED" || order.status === "NO_SHOW";
}

function isVerified(order: RestaurantOrder) {
  return order.status === "PAID" || order.paymentState === "VERIFIED" || Boolean(order.paymentVerified);
}

function minutesUntil(value?: string | null) {
  if (!value) return null;
  const diff = new Date(value).getTime() - Date.now();
  if (!Number.isFinite(diff)) return null;
  return Math.round(diff / 60000);
}

function buildIntelligenceMeta(order: RestaurantOrder) {
  return {
    collapseProbability: order.collapseProbability,
    collapseRiskTier: order.collapseRiskTier,
    recommendedIntervention: order.recommendedIntervention,
    instabilityFactors: order.instabilityFactors,
    collapseExplanation: order.collapseExplanation,
    ghostPingShouldSend: order.ghostPingShouldSend,
    ghostPingUrgency: order.ghostPingUrgency,
    ghostPingMessageType: order.ghostPingMessageType,
    ghostPingEscalationStage: order.ghostPingEscalationStage,
    ghostPingRecommendedDelayMinutes: order.ghostPingRecommendedDelayMinutes,
    ghostPingReasoning: order.ghostPingReasoning,
    paymentState: order.paymentState,
    paymentStage: order.paymentStage,
    terminalMismatch: order.terminalMismatch,
    orderAmount: order.amount,
    organizationId: order.organizationId,
    locationId: order.locationId,
    locationName: order.locationName,
  };
}

function buildDecisionContext({
  memory,
  order,
  action,
  waitlistAvailability,
  digitalTwin,
}: {
  memory: OperationalMemorySnapshot;
  order: RestaurantOrder;
  action: string;
  waitlistAvailability: number;
  digitalTwin?: ReturnType<typeof buildOperationalDigitalTwin>;
}) {
  const learningContext = getAdaptiveDecisionContext({
    snapshot: memory,
    action,
    locationId: order.locationId,
    customerKey: order.phone || order.customerName,
  });
  const policy = resolveOperationalPolicy({
    organizationId: order.organizationId,
    locationId: order.locationId,
    memory,
    learningContext,
    digitalTwin,
  });
  const simulation = simulateOperationalDecision({
    order,
    waitlistAvailability,
    policy,
    learningContext,
    digitalTwin,
  });

  return { learningContext, policy, simulation };
}

async function getAutopilotMode(): Promise<AutopilotMode> {
  const { data, error } = await supabaseAdmin
    .from("restaurant_settings")
    .select("autopilot_mode")
    .eq("id", 1)
    .single();

  if (error) return "SEMI_AUTO";

  const mode = data?.autopilot_mode;
  if (mode === "MANUAL" || mode === "SEMI_AUTO" || mode === "FULL_AUTO") {
    return mode;
  }

  return "SEMI_AUTO";
}

async function writeOnce(
  eventKeys: Set<string>,
  input: Parameters<typeof persistOperationalEvent>[0]
) {
  // The continuous loop runs every minute. Event keys deliberately collapse repeated
  // monitoring signals into hourly buckets, while executed recovery/release outcomes use
  // stable keys so they are not replayed by later passes.
  if (eventKeys.has(input.eventKey)) {
    return { written: false, duplicate: true, error: undefined as string | undefined };
  }

  const result = await persistOperationalEvent(input);
  if (result.ok) {
    eventKeys.add(input.eventKey);
    return { written: true, duplicate: false, error: undefined };
  }

  return { written: false, duplicate: false, error: result.error };
}

export async function runContinuousOperationalPass(): Promise<ContinuousRunResult> {
  const [
    { data: ordersRaw, error: ordersError },
    { data: auditRaw, error: auditError },
    { data: waitlistRaw, error: waitlistError },
  ] = await Promise.all([
    supabaseAdmin.from("orders").select("*").order("created_at", { ascending: false }),
    supabaseAdmin
      .from("audit_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500),
    supabaseAdmin.from("waitlist_leads").select("id").limit(200),
  ]);

  if (ordersError) throw new Error(ordersError.message);
  if (auditError) throw new Error(auditError.message);
  if (waitlistError) throw new Error(waitlistError.message);

  const mode = await getAutopilotMode();
  const executionMode = resolveAutonomousExecutionMode(mode);
  const eventKeys = getEventKeySet(auditRaw ?? []);
  const orders = (ordersRaw ?? []).map(mapAndEnrichOrderFromDb);
  const memory = createOperationalMemorySnapshot({
    orders,
    auditRows: auditRaw ?? [],
  });
  const waitlistAvailability = waitlistRaw?.length ?? 0;
  const organizationSnapshot = buildMultiLocationIntelligenceSnapshot({
    orders,
    auditRows: auditRaw ?? [],
  });
  const digitalTwin = buildOperationalDigitalTwin({
    orders,
    auditRows: auditRaw ?? [],
    memory,
    organization: organizationSnapshot,
    waitlistCount: waitlistAvailability,
  });
  const communicationClimate = buildCommunicationClimate({
    orders,
    auditRows: auditRaw ?? [],
    memory,
    digitalTwin,
  });
  const bucket = hourBucket();
  const logs: string[] = [];
  let eventsWritten = 0;
  let communicationsAttempted = 0;
  let communicationsSent = 0;
  let communicationsSuppressed = 0;
  let skippedDuplicates = 0;
  let releasesExecuted = 0;
  let recoveriesAttempted = 0;
  let decisionsEvaluated = 0;
  const canExecuteCommunication =
    executionMode === "SAFE_AUTONOMOUS" || executionMode === "FULL_AUTONOMOUS";

  const activeOrders = orders.filter((order) => !isClosed(order));
  const unresolvedOrders = activeOrders.filter((order) => !isVerified(order));
  const criticalOrders = unresolvedOrders.filter(
    (order) =>
      Number(order.collapseProbability ?? 0) >= 80 ||
      order.ghostPingUrgency === "CRITICAL" ||
      order.terminalMismatch ||
      order.paymentState === "BLOCKED" ||
      order.paymentState === "FAILED"
  );

  if (!shouldSilent(mode) && criticalOrders.length > 0) {
    const event = await writeOnce(eventKeys, {
      eventKey: `pressure:${bucket}:${criticalOrders.length}`,
      category: "AUTONOMOUS_ACTION",
      severity: criticalOrders.length >= 3 ? "CRITICAL" : "WARNING",
      action: `Continuous engine detected ${criticalOrders.length} critical operational pressure signal${criticalOrders.length === 1 ? "" : "s"}.`,
      orderId: criticalOrders[0].id,
      title: "Operational pressure changed",
      summary: `${criticalOrders.length} unresolved order${criticalOrders.length === 1 ? "" : "s"} crossed critical pressure thresholds.`,
      reasoning: criticalOrders
        .slice(0, 5)
        .map((order) => `${order.id}: collapse ${order.collapseProbability ?? 0}%, payment ${order.paymentState}.`),
      recommendedAction: "Keep autonomous recovery armed and review critical orders.",
      confidence: Math.min(95, 70 + criticalOrders.length * 6),
      meta: {
        operationalPressureLevel: criticalOrders.length >= 3 ? "CRITICAL" : "ELEVATED",
        criticalOrderCount: criticalOrders.length,
      },
    });
    if (event.written) eventsWritten += 1;
    if (event.duplicate) skippedDuplicates += 1;
  }

  for (const order of unresolvedOrders) {
    const intelligenceMeta = buildIntelligenceMeta(order);
    const minutesLeft = minutesUntil(order.slotHoldExpiresAt);
    const orderAuditRows = (auditRaw ?? []).filter(
      (row) => String(row.order_id ?? row.orderId ?? "") === order.id
    );
    const baseCommunicationContext = buildDecisionContext({
      memory,
      order,
      action: "SEND_REMINDER",
      waitlistAvailability,
      digitalTwin,
    });
    const communicationDecision = orchestrateRecoveryCommunication({
      order,
      auditRows: orderAuditRows,
      memory,
      digitalTwin,
      policy: baseCommunicationContext.policy,
      waitlistAvailability,
    });
    const communicationDiagnostics = {
      eligibleForCommunicationExecution: canExecuteCommunication,
      executionMode,
      autopilotMode: mode,
      selectedStep: communicationDecision.step,
      selectedChannel: communicationDecision.channel,
      customerFacing: communicationDecision.priorityDiagnostics.customerFacing,
      internalOnly: communicationDecision.priorityDiagnostics.internalOnly,
      selectedReason: communicationDecision.priorityDiagnostics.selectedReason,
      reminderSkippedReason: communicationDecision.priorityDiagnostics.reminderSkippedReason,
      lastReminderSentAt: communicationDecision.priorityDiagnostics.lastReminderSentAt,
      minutesSinceLastReminder: communicationDecision.priorityDiagnostics.minutesSinceLastReminder,
      cooldownRemainingMinutes: communicationDecision.priorityDiagnostics.cooldownRemainingMinutes,
      slotUnrecoverable: communicationDecision.priorityDiagnostics.slotUnrecoverable,
      quietHoursSuppressed: communicationDecision.priorityDiagnostics.quietHoursSuppressed,
      quietHoursOverrideUsed: communicationDecision.priorityDiagnostics.quietHoursOverrideUsed,
      shouldPrepareMessage: communicationDecision.shouldPrepareMessage,
      suppressed: communicationDecision.suppressed,
      suppressionReasons: communicationDecision.suppressionReasons,
      attemptCount: communicationDecision.attemptCount,
      escalationStage: communicationDecision.escalationStage,
      cooldownMinutes: communicationDecision.cooldownMinutes,
      nextEligibleAt: communicationDecision.nextEligibleAt,
      communicationFatigue: communicationDecision.communicationFatigue,
      trustRisk: communicationDecision.trustRisk,
      reservationTime: order.reservationTime ?? null,
      slotHoldExpiresAt: order.slotHoldExpiresAt ?? null,
      hasRecipient: Boolean(order.phone),
      providerStatus: getWhatsAppProviderStatus(),
    };

    if (canExecuteCommunication && communicationDecision.shouldPrepareMessage) {
      const communicationEventKey = `communication-execution:${order.id}:${communicationDecision.step}:${communicationDecision.escalationStage}:${bucket}`;

      if (eventKeys.has(communicationEventKey)) {
        skippedDuplicates += 1;
      } else {
        const execution = await executeRecoveryCommunication({
          decision: communicationDecision,
          orderId: order.id,
          customerName: order.customerName,
          eventKey: communicationEventKey,
        });
        communicationsAttempted += 1;
        if (execution.realMessageSent) communicationsSent += 1;

        if (execution.realMessageSent && communicationDecision.channel === "WHATSAPP") {
          const { error: reminderUpdateError } = await supabaseAdmin
            .from("orders")
            .update(
              mapOrderToDb({
                lastReminderSentAt: execution.attemptedAt,
              })
            )
            .eq("id", order.id);

          if (reminderUpdateError) {
            logs.push(`${order.id}: last reminder timestamp update failed (${reminderUpdateError.message})`);
          }
        }

        const communicationSeverity =
          execution.ok && execution.realMessageSent
            ? "INFO"
            : !execution.ok
              ? "WARNING"
              : communicationDecision.trustRisk >= 70
                ? "WARNING"
                : communicationDecision.recoveryConfidence >= 70
                  ? "INFO"
                  : "WATCH";

        const event = await writeOnce(eventKeys, {
          eventKey: communicationEventKey,
          category: "AUTONOMOUS_ACTION",
          severity: communicationSeverity,
          action: execution.realMessageSent
            ? `Autonomous WhatsApp communication sent for ${order.id}.`
            : `Autonomous communication recorded for ${order.id}.`,
          orderId: order.id,
          title: execution.realMessageSent
            ? "Autonomous WhatsApp recovery message sent"
            : "Autonomous recovery communication recorded",
          summary: execution.realMessageSent
            ? `${communicationDecision.step.toLowerCase().replaceAll("_", " ")} sent through ${execution.provider}.`
            : `${communicationDecision.channel} ${communicationDecision.step.toLowerCase().replaceAll("_", " ")} recorded through ${execution.provider}; no live WhatsApp send occurred.`,
          reasoning: communicationDecision.explainability,
          recommendedAction: execution.ok
            ? "Continue monitoring response and payment truth."
            : "Review provider configuration or route to staff manually.",
          confidence: communicationDecision.recoveryConfidence,
          meta: {
            ...intelligenceMeta,
            communicationOrchestration: communicationDecision,
            communicationClimate,
            communicationOutcome: execution.realMessageSent ? "SENT" : "RECORDED",
            communicationExecution: {
              attempted: execution.attempted,
              provider: execution.provider,
              providerMode: execution.mode,
              status: execution.status,
              ok: execution.ok,
              messageId: execution.messageId ?? null,
              error: execution.error ?? null,
              realMessageSent: execution.realMessageSent,
              maskedRecipient: execution.maskedRecipient,
              attemptedAt: execution.attemptedAt,
              eventKey: communicationEventKey,
              providerStatus: execution.providerStatus,
            },
            communicationDiagnostics,
            deliveryAttempt: {
              channel: communicationDecision.channel,
              step: communicationDecision.step,
              attemptCount: communicationDecision.attemptCount,
              escalationStage: communicationDecision.escalationStage,
              cooldownMinutes: communicationDecision.cooldownMinutes,
              nextEligibleAt: communicationDecision.nextEligibleAt,
              recoveryConfidence: communicationDecision.recoveryConfidence,
              trustRisk: communicationDecision.trustRisk,
              communicationFatigue: communicationDecision.communicationFatigue,
            },
          },
        });
        if (event.written) eventsWritten += 1;
        if (event.duplicate) skippedDuplicates += 1;
      }
    }

    if (canExecuteCommunication && communicationDecision.suppressed) {
      communicationsSuppressed += 1;
      const event = await writeOnce(eventKeys, {
        eventKey: `communication-suppressed:${order.id}:${communicationDecision.step}:${bucket}`,
        category: "AUTONOMOUS_ACTION",
        severity: "WATCH",
        action: `Communication orchestration suppressed ${communicationDecision.step} for ${order.id}.`,
        orderId: order.id,
        title: "Recovery communication suppressed by trust protection",
        summary: communicationDecision.suppressionReasons[0] ?? "Trust protection suppressed outreach.",
        reasoning: communicationDecision.explainability,
        recommendedAction: "Wait for cooldown or use internal review if urgency rises.",
        confidence: Math.max(50, 100 - communicationDecision.trustRisk),
        meta: {
          ...intelligenceMeta,
          communicationOrchestration: communicationDecision,
          communicationClimate,
          communicationOutcome: "SUPPRESSED",
          communicationDiagnostics,
          communicationSuppression: {
            step: communicationDecision.step,
            attemptCount: communicationDecision.attemptCount,
            escalationStage: communicationDecision.escalationStage,
            reasons: communicationDecision.suppressionReasons,
            cooldownMinutes: communicationDecision.cooldownMinutes,
            nextEligibleAt: communicationDecision.nextEligibleAt,
            trustRisk: communicationDecision.trustRisk,
            communicationFatigue: communicationDecision.communicationFatigue,
          },
        },
      });
      if (event.written) eventsWritten += 1;
      if (event.duplicate) skippedDuplicates += 1;
    }

    if (!shouldSilent(mode) && order.depositRequired && !order.depositPaid) {
      const decisionContext = buildDecisionContext({
        memory,
        order,
        action: "REQUIRE_DEPOSIT",
        waitlistAvailability,
        digitalTwin,
      });
      const decision = evaluateAutonomousDecision({
        order,
        action: "REQUIRE_DEPOSIT",
        executionMode,
        waitlistAvailability,
        ...decisionContext,
      });
      decisionsEvaluated += 1;
      const event = await writeOnce(eventKeys, {
        eventKey: `deposit:${order.id}:${bucket}`,
        category: "PAYMENT",
        severity: Number(order.amount ?? 0) >= 200 ? "WARNING" : "WATCH",
        action: `Continuous engine escalated unpaid deposit for ${order.id}.`,
        orderId: order.id,
        title: "Deposit protection escalated",
        summary: `${order.customerName} still has an unpaid required deposit.`,
        reasoning: [
          "Deposit is required but unpaid.",
          `Payment state is ${order.paymentState ?? "UNPAID"}.`,
          `Collapse probability is ${order.collapseProbability ?? 0}%.`,
        ],
        recommendedAction: "Escalate payment collection before the slot becomes unrecoverable.",
        confidence: decision.automationConfidence,
        meta: {
          ...intelligenceMeta,
          ...decisionToAuditMeta(decision),
        },
      });
      if (event.written) eventsWritten += 1;
      if (event.duplicate) skippedDuplicates += 1;
    }

    if (!shouldSilent(mode) && order.ghostPingShouldSend) {
      const decisionContext = buildDecisionContext({
        memory,
        order,
        action: "SEND_REMINDER",
        waitlistAvailability,
        digitalTwin,
      });
      const decision = evaluateAutonomousDecision({
        order,
        action: "SEND_REMINDER",
        executionMode,
        waitlistAvailability,
        ...decisionContext,
      });
      decisionsEvaluated += 1;
      const event = await writeOnce(eventKeys, {
        eventKey: `ghost:${order.id}:${order.ghostPingUrgency}:${bucket}`,
        category: "GHOST_PING",
        severity:
          order.ghostPingUrgency === "CRITICAL"
            ? "CRITICAL"
            : order.ghostPingUrgency === "HIGH"
              ? "WARNING"
              : "WATCH",
        action: `Continuous engine triggered Ghost Ping escalation for ${order.id}.`,
        orderId: order.id,
        title: "Ghost Ping escalation triggered",
        summary: `${order.customerName} requires Ghost Ping intervention based on live payment and collapse signals.`,
        reasoning: [
          order.ghostPingReasoning ?? "Ghost Ping threshold crossed.",
          `Recommended message type: ${order.ghostPingMessageType ?? "REMINDER"}.`,
          `Reservation hold expires in ${minutesLeft ?? "unknown"} minutes.`,
        ],
        recommendedAction: "Send the next Ghost Ping reminder path.",
        confidence: decision.automationConfidence,
        meta: {
          ...intelligenceMeta,
          ...decisionToAuditMeta(decision),
        },
      });
      if (event.written) eventsWritten += 1;
      if (event.duplicate) skippedDuplicates += 1;
    }

    if (!shouldSilent(mode) && Number(order.collapseProbability ?? 0) >= 70) {
      const collapseAction = waitlistAvailability > 0 ? "OFFER_WAITLIST" : "REQUEST_OWNER_REVIEW";
      const decisionContext = buildDecisionContext({
        memory,
        order,
        action: collapseAction,
        waitlistAvailability,
        digitalTwin,
      });
      const decision = evaluateAutonomousDecision({
        order,
        action: collapseAction,
        executionMode,
        waitlistAvailability,
        ...decisionContext,
      });
      decisionsEvaluated += 1;
      const event = await writeOnce(eventKeys, {
        eventKey: `collapse:${order.id}:${order.collapseRiskTier}:${bucket}`,
        category: "COLLAPSE",
        severity: Number(order.collapseProbability ?? 0) >= 90 ? "CRITICAL" : "WARNING",
        action: `Continuous engine detected collapse escalation for ${order.id}.`,
        orderId: order.id,
        title: "Collapse probability escalated",
        summary: `${order.id} reached ${order.collapseProbability}% collapse probability.`,
        reasoning: order.instabilityFactors ?? ["Collapse risk threshold crossed."],
        recommendedAction:
          waitlistAvailability > 0
            ? "Prepare waitlist recovery while payment intervention continues."
            : "Escalate to owner review because waitlist capacity is unavailable.",
        confidence: decision.automationConfidence,
        meta: {
          ...intelligenceMeta,
          ...decisionToAuditMeta(decision),
          waitlistAvailability,
          minutesUntilSlotExpiry: minutesLeft,
        },
      });
      if (event.written) eventsWritten += 1;
      if (event.duplicate) skippedDuplicates += 1;
    }

    if (
      !shouldSilent(mode) &&
      (order.terminalMismatch || order.paymentState === "BLOCKED" || order.paymentState === "FAILED")
    ) {
      const decisionContext = buildDecisionContext({
        memory,
        order,
        action: "FREEZE_ORDER",
        waitlistAvailability,
        digitalTwin,
      });
      const decision = evaluateAutonomousDecision({
        order,
        action: "FREEZE_ORDER",
        executionMode,
        waitlistAvailability,
        ...decisionContext,
      });
      decisionsEvaluated += 1;
      const event = await writeOnce(eventKeys, {
        eventKey: `fraud:${order.id}:${order.paymentState}:${bucket}`,
        category: "FRAUD",
        severity: "CRITICAL",
        action: `Continuous engine contained payment risk for ${order.id}.`,
        orderId: order.id,
        title: "Fraud containment active",
        summary: `${order.id} is blocked from release because payment verification is unsafe.`,
        reasoning: [
          `Payment state is ${order.paymentState}.`,
          order.terminalMismatch
            ? "Terminal mismatch detected."
            : "Payment risk state crossed containment threshold.",
        ],
        recommendedAction: "Do not release this order without verified payment review.",
        confidence: decision.automationConfidence,
        meta: {
          ...intelligenceMeta,
          ...decisionToAuditMeta(decision),
        },
      });
      if (event.written) eventsWritten += 1;
      if (event.duplicate) skippedDuplicates += 1;
    }

    const customerOrders = orders.filter((candidate) => {
      if (order.phone && candidate.phone) return candidate.phone === order.phone;
      return candidate.customerName === order.customerName;
    });
    const customerProfile = buildReliabilityProfileFromOrders(customerOrders);
    const releaseDecision = evaluateAutoRelease({
      ...order,
      customerProfile,
    });

    if (!releaseDecision.shouldRelease) {
      if (!shouldSilent(mode) && releaseDecision.requiresHumanAction) {
        const decisionContext = buildDecisionContext({
          memory,
          order,
          action: "REQUEST_OWNER_REVIEW",
          waitlistAvailability,
          digitalTwin,
        });
        const autonomousDecision = evaluateAutonomousDecision({
          order,
          action: "REQUEST_OWNER_REVIEW",
          executionMode,
          waitlistAvailability,
          autoReleaseDecision: releaseDecision,
          ...decisionContext,
        });
        decisionsEvaluated += 1;
        const event = await writeOnce(eventKeys, {
          eventKey: `release-review:${order.id}:${releaseDecision.rule}:${bucket}`,
          category: "AUTONOMOUS_ACTION",
          severity: "WARNING",
          action: `Continuous engine requested owner review for ${order.id}.`,
          orderId: order.id,
          title: "Owner review required before release",
          summary: releaseDecision.explanation,
          reasoning: [releaseDecision.reason],
          recommendedAction: "Review before releasing this slot.",
          confidence: autonomousDecision.automationConfidence,
          meta: {
            ...intelligenceMeta,
            ...decisionToAuditMeta(autonomousDecision),
            rule: releaseDecision.rule,
            requiresHumanAction: true,
            humanActionReason: releaseDecision.reason,
          },
        });
        if (event.written) eventsWritten += 1;
        if (event.duplicate) skippedDuplicates += 1;
      }
      continue;
    }

    const releaseDecisionContext = buildDecisionContext({
      memory,
      order,
      action: "RELEASE_SLOT",
      waitlistAvailability,
      digitalTwin,
    });
    const autonomousReleaseDecision = evaluateAutonomousDecision({
      order,
      action: "RELEASE_SLOT",
      executionMode,
      waitlistAvailability,
      autoReleaseDecision: releaseDecision,
      organizationPolicy: {
        requireOwnerReviewAbove: 750,
        minimumConfidenceOverride: 0,
      },
      branchPolicy: {
        maxAutonomousReleaseValue: 600,
      },
      ...releaseDecisionContext,
    });
    decisionsEvaluated += 1;

    if (!autonomousReleaseDecision.shouldExecute) {
      if (!shouldSilent(mode)) {
        const event = await writeOnce(eventKeys, {
          eventKey: `release-suggested:${order.id}:${releaseDecision.rule}:${bucket}:${autonomousReleaseDecision.executionMode}`,
          category: "AUTONOMOUS_ACTION",
          severity: "WARNING",
          action: `Autonomous decision engine recommended release review for ${order.id}.`,
          orderId: order.id,
          title: "Autonomous release blocked by guardrails",
          summary: releaseDecision.explanation,
          reasoning: [
            ...autonomousReleaseDecision.reasoning,
            ...autonomousReleaseDecision.guardrails
              .filter((guardrail) => guardrail.blocking)
              .map((guardrail) => guardrail.message),
          ],
          recommendedAction: "Owner review required before releasing this slot.",
          confidence: autonomousReleaseDecision.automationConfidence,
          meta: {
            ...intelligenceMeta,
            ...decisionToAuditMeta(autonomousReleaseDecision),
            mode,
            executionMode,
            rule: releaseDecision.rule,
            requiresHumanAction: true,
            humanActionReason:
              autonomousReleaseDecision.guardrails.find((guardrail) => guardrail.blocking)?.message ??
              "Autonomous guardrails prevent execution.",
          },
        });
        if (event.written) eventsWritten += 1;
        if (event.duplicate) skippedDuplicates += 1;
      }
      continue;
    }

    const releasedNotes = `${order.notes || ""} | ${releaseDecision.reason}`.trim();
    const { error: updateError } = await supabaseAdmin
      .from("orders")
      .update(
        mapOrderToDb({
          status: "CANCELLED",
          autoReleaseEligible: false,
          notes: releasedNotes,
        })
      )
      .eq("id", order.id);

    if (updateError) {
      logs.push(`${order.id}: release failed (${updateError.message})`);
      continue;
    }

    releasesExecuted += 1;

    const releasedOrder = enrichOrderWithIntelligence({
      ...order,
      status: "CANCELLED",
      autoReleaseEligible: false,
      notes: releasedNotes,
    });

    const releaseLearningEntry = createContinuousLearningEntry({
      orderId: releasedOrder.id,
      customerName: releasedOrder.customerName,
      phone: releasedOrder.phone,
      eventType: "AUTO_RELEASED",
      outcome: "NEGATIVE",
      collapseProbability: releasedOrder.collapseProbability,
      collapseRiskTier: releasedOrder.collapseRiskTier,
      recommendedIntervention: releasedOrder.recommendedIntervention,
      ghostPingUrgency: releasedOrder.ghostPingUrgency,
      ghostPingMessageType: releasedOrder.ghostPingMessageType,
      reliabilityScore: releasedOrder.reliabilityScore,
      amount: releasedOrder.amount,
      orderType: releasedOrder.orderType,
      notes: releaseDecision.reason,
    });

    const releaseEvent = await writeOnce(eventKeys, {
      eventKey: `release-executed:${order.id}:${releaseDecision.rule}`,
      category: "AUTONOMOUS_ACTION",
      severity: "CRITICAL",
      action: `Autonomous decision engine auto-released ${order.id}.`,
      orderId: order.id,
      title: "Slot auto-released",
      summary: releaseDecision.explanation,
      reasoning: [releaseDecision.reason],
      recommendedAction: "Recover revenue through waitlist if capacity exists.",
      confidence: autonomousReleaseDecision.automationConfidence,
      meta: {
        ...buildIntelligenceMeta(releasedOrder),
        ...decisionToAuditMeta(autonomousReleaseDecision),
        mode,
        executionMode,
        rule: releaseDecision.rule,
        learningEntry: releaseLearningEntry,
        requiresHumanAction: false,
      },
    });
    if (releaseEvent.written) eventsWritten += 1;
    if (releaseEvent.duplicate) skippedDuplicates += 1;

    const waitlistDecisionContext = buildDecisionContext({
      memory,
      order,
      action: "OFFER_WAITLIST",
      waitlistAvailability,
      digitalTwin,
    });
    const waitlistDecision = evaluateAutonomousDecision({
      order,
      action: "OFFER_WAITLIST",
      executionMode,
      waitlistAvailability,
      ...waitlistDecisionContext,
    });
    decisionsEvaluated += 1;

    if (waitlistDecision.shouldExecute && waitlistAvailability > 0) {
      recoveriesAttempted += 1;
      const cascade = await runWaitlistCascade({
        orderId: order.id,
        staffName: "Valsentra Continuous Engine",
      });

      const waitlistEvent = await writeOnce(eventKeys, {
        eventKey: `waitlist-attempt:${order.id}:${cascade.ok ? "success" : "failed"}`,
        category: "WAITLIST",
        severity: cascade.ok ? "INFO" : "WARNING",
        action: cascade.ok
          ? `Continuous engine recovered ${order.id} through waitlist.`
          : `Continuous engine could not recover ${order.id} through waitlist.`,
        orderId: order.id,
        title: cascade.ok ? "Waitlist recovery activated" : "Waitlist recovery failed",
        summary: cascade.ok
          ? `Recovered slot with ${cascade.lead?.customerName}.`
          : cascade.error ?? "No suitable waitlist replacement was available.",
        reasoning: [
          cascade.ok ? "Waitlist candidate was available." : "No suitable waitlist candidate matched.",
          `Autopilot mode is ${mode}.`,
        ],
        recommendedAction: cascade.ok
          ? "Complete recovered order details before payment action."
          : "Owner review required for unrecovered revenue.",
        confidence: waitlistDecision.automationConfidence,
        meta: {
          ...decisionToAuditMeta(waitlistDecision),
          originalOrderId: order.id,
          cascade,
          recoverableRevenue: order.amount,
        },
      });
      if (waitlistEvent.written) eventsWritten += 1;
      if (waitlistEvent.duplicate) skippedDuplicates += 1;
    }
  }

  return {
    mode,
    executionMode,
    evaluatedOrders: orders.length,
    decisionsEvaluated,
    eventsWritten,
    communicationsAttempted,
    communicationsSent,
    communicationsSuppressed,
    releasesExecuted,
    recoveriesAttempted,
    skippedDuplicates,
    logs,
  };
}
