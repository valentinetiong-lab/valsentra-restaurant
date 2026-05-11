import {
  buildCommunicationClimate,
  orchestrateRecoveryCommunication,
} from "@/app/lib/communicationOrchestrationEngine";
import { mapAndEnrichOrderFromDb } from "@/app/lib/domain/orderMapper";
import { buildMultiLocationIntelligenceSnapshot } from "@/app/lib/intelligence/multiLocationIntelligenceEngine";
import { buildOperationalDigitalTwin } from "@/app/lib/operationalDigitalTwinEngine";
import { simulateOperationalDecision } from "@/app/lib/operationalSimulationEngine";
import {
  createOperationalMemorySnapshot,
  getAdaptiveDecisionContext,
} from "@/app/lib/operationalMemoryEngine";
import { resolveOperationalPolicy } from "@/app/lib/policyEngine";

import type { BrainCategory, BrainInsight, BrainOrder, BrainSeverity, LiveOperationalEvent } from "@/app/lib/intelligence/operationalBrainTypes";

function clampConfidence(value: number) {
  return Math.max(0, Math.min(Math.round(value), 100));
}

function minutesUntil(value?: string | null) {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  if (Number.isNaN(parsed)) return null;
  return Math.ceil((parsed - Date.now()) / 60000);
}

function getEscalationUrgency(
  severity: BrainSeverity,
  collapseProbability = 0,
  ghostUrgency?: string
): BrainInsight["escalationUrgency"] {
  if (severity === "CRITICAL" || collapseProbability >= 85 || ghostUrgency === "CRITICAL") {
    return "CRITICAL";
  }
  if (severity === "WARNING" || collapseProbability >= 60 || ghostUrgency === "HIGH") {
    return "HIGH";
  }
  if (severity === "WATCH" || collapseProbability >= 35 || ghostUrgency === "MEDIUM") {
    return "MEDIUM";
  }
  return "LOW";
}

function getDecisionMode(
  severity: BrainSeverity,
  requiresHumanAction?: boolean,
  category?: BrainCategory
): BrainInsight["decisionMode"] {
  if (requiresHumanAction || severity === "CRITICAL" || severity === "WARNING") {
    return "INTERVENTION_REQUIRED";
  }
  if (category === "AUTOPILOT" || category === "RECOVERY") {
    return "AUTONOMOUS_ACTION_SAFE";
  }
  if (severity === "WATCH") return "MONITORING";
  return "INFORMATIONAL";
}

function getRecoveryLikelihood(order?: Pick<BrainOrder, "collapseProbability" | "reliabilityScore" | "paymentVerified" | "depositPaid">) {
  if (!order) return 55;

  const stability = 100 - Number(order.collapseProbability ?? 0);
  const reliability = Number(order.reliabilityScore ?? 70);
  const paymentBoost = order.paymentVerified ? 12 : order.depositPaid ? 7 : 0;

  return clampConfidence(stability * 0.45 + reliability * 0.45 + paymentBoost);
}

function getAutomationConfidence(confidence: number, severity: BrainSeverity, requiresHumanAction?: boolean) {
  if (requiresHumanAction) return clampConfidence(confidence - 25);
  if (severity === "CRITICAL") return clampConfidence(confidence - 8);
  if (severity === "WARNING") return clampConfidence(confidence - 4);
  return clampConfidence(confidence + 6);
}

function getWhyThisMatters(order: BrainOrder, category: BrainCategory) {
  const minutesLeft = minutesUntil(order.slotHoldExpiresAt);
  const amount = Number(order.amount ?? 0);

  if (category === "FRAUD_CONTAINMENT") {
    return `This protection contains RM ${amount} in potential payment exposure until the payment truth is resolved.`;
  }

  if (category === "PAYMENT_TRUTH") {
    if (minutesLeft !== null && minutesLeft <= 20) {
      return `If unresolved, this slot may become unrecoverable within ${Math.max(minutesLeft, 0)} minutes.`;
    }
    return `Unverified payment keeps RM ${amount} exposed and delays safe capacity release.`;
  }

  if (category === "COLLAPSE_PREVENTION") {
    return `Collapse probability is ${order.collapseProbability}%, so Valsentra is protecting the slot before recovery value decays.`;
  }

  if (category === "LEARNING") {
    return "This signal changes future protection rules for similar customers and booking patterns.";
  }

  return "This signal affects how safely Valsentra can automate the next operational step.";
}

function getPaymentDelayMinutes(order: BrainOrder) {
  if (order.paymentVerified || order.paymentState === "VERIFIED") return 0;
  const created = new Date(order.createdAt).getTime();
  if (Number.isNaN(created)) return 0;
  return Math.max(0, Math.floor((Date.now() - created) / 60000));
}

function getTimeToCollapseMinutes(order: BrainOrder) {
  const holdMinutes = minutesUntil(order.slotHoldExpiresAt);
  const reservationMinutes = minutesUntil(order.reservationTime);

  const candidates = [holdMinutes, reservationMinutes]
    .filter((value): value is number => value !== null)
    .map((value) => Math.max(value, 0));

  if (candidates.length === 0) {
    return order.collapseProbability >= 80 ? 15 : null;
  }

  const nearest = Math.min(...candidates);
  if (order.collapseProbability >= 85) return Math.min(nearest, 10);
  if (order.collapseProbability >= 65) return Math.min(nearest, 30);
  return nearest;
}

function getForecast(
  order: BrainOrder | undefined,
  waitlistAvailability: number
): BrainInsight["forecast"] | undefined {
  if (!order) return undefined;

  const paymentDelay = getPaymentDelayMinutes(order);
  const urgencyPenalty =
    order.ghostPingUrgency === "CRITICAL"
      ? 22
      : order.ghostPingUrgency === "HIGH"
        ? 14
        : order.ghostPingUrgency === "MEDIUM"
          ? 8
          : 0;
  const reservationMinutes = minutesUntil(order.reservationTime);
  const timePressure =
    reservationMinutes !== null && reservationMinutes <= 60
      ? 18
      : reservationMinutes !== null && reservationMinutes <= 180
        ? 9
        : 0;
  const waitlistBoost = waitlistAvailability > 0 ? Math.min(waitlistAvailability * 4, 18) : -12;
  const recoverySuccessLikelihood = clampConfidence(
    100 -
      order.collapseProbability * 0.45 +
      order.reliabilityScore * 0.3 +
      waitlistBoost -
      urgencyPenalty
  );
  const unrecoverableLikelihood = clampConfidence(
    order.collapseProbability * 0.65 +
      paymentDelay * 0.08 +
      urgencyPenalty +
      timePressure -
      waitlistBoost
  );
  const projectedRevenueExposureGrowth = Math.round(
    Number(order.amount ?? 0) * (unrecoverableLikelihood / 100) * 0.35
  );

  return {
    unrecoverableLikelihood,
    timeToCollapseMinutes: getTimeToCollapseMinutes(order),
    recoverySuccessLikelihood,
    projectedRevenueExposureGrowth,
    trend:
      unrecoverableLikelihood >= order.collapseProbability + 8
        ? "RISING"
        : unrecoverableLikelihood + 8 < order.collapseProbability
          ? "FALLING"
          : "STABLE",
  };
}

function getAutonomousRecommendation(
  insight: Pick<BrainInsight, "severity" | "category" | "confidence">,
  order?: BrainOrder,
  requiresHumanAction?: boolean
): BrainInsight["autonomousRecommendation"] {
  if (requiresHumanAction || insight.severity === "CRITICAL") return "ESCALATE_TO_OWNER";
  if (insight.category === "FRAUD_CONTAINMENT" || insight.category === "PAYMENT_TRUTH") {
    return "REQUIRE_VERIFICATION";
  }
  if (order?.recommendedIntervention === "RELEASE_AND_RECOVER") {
    return "TRIGGER_RECOVERY_FLOW";
  }
  if (insight.severity === "WARNING") return "INTERVENE_NOW";
  if (insight.confidence >= 80 && (insight.category === "AUTOPILOT" || insight.category === "RECOVERY")) {
    return "SAFE_TO_AUTOMATE";
  }
  return "WAIT_AND_MONITOR";
}

function calculateSystemPressure(
  orders: BrainOrder[],
  auditRows: Record<string, any>[],
  waitlistAvailability: number
) {
  const activeOrders = orders.filter(
    (order) => order.status !== "CANCELLED" && order.status !== "NO_SHOW"
  );
  const exposedRevenue = activeOrders
    .filter((order) => order.paymentState !== "VERIFIED" && !order.paymentVerified)
    .reduce((sum, order) => sum + Number(order.amount ?? 0), 0);
  const blockedOrders = activeOrders.filter(
    (order) => order.paymentState === "BLOCKED" || order.paymentState === "FAILED" || order.terminalMismatch
  ).length;
  const activeEscalations = activeOrders.filter(
    (order) => order.collapseProbability >= 60 || order.ghostPingUrgency === "HIGH" || order.ghostPingUrgency === "CRITICAL"
  ).length;
  const recoveryBacklog = Math.max(activeEscalations - waitlistAvailability, 0);
  const recentAuditRows = auditRows.filter((row) => {
    const created = new Date(row.created_at ?? 0).getTime();
    return Date.now() - created <= 24 * 60 * 60 * 1000;
  });
  const messageLoad = recentAuditRows.filter((row) =>
    String(row.action ?? "").toLowerCase().includes("reminder") ||
    String(row.action ?? "").toLowerCase().includes("ghost")
  ).length;
  const collapseVelocity = activeOrders.filter(
    (order) => order.collapseProbability >= 75
  ).length;

  let score = 0;
  const reasons: string[] = [];

  score += Math.min(exposedRevenue / 25, 28);
  if (exposedRevenue > 0) reasons.push(`RM ${Math.round(exposedRevenue)} exposed revenue.`);

  score += blockedOrders * 12;
  if (blockedOrders > 0) reasons.push(`${blockedOrders} blocked or failed payment order${blockedOrders === 1 ? "" : "s"}.`);

  score += recoveryBacklog * 10;
  if (recoveryBacklog > 0) reasons.push(`${recoveryBacklog} escalation${recoveryBacklog === 1 ? "" : "s"} without enough waitlist coverage.`);

  score += messageLoad * 4;
  if (messageLoad > 0) reasons.push(`${messageLoad} recent reminder or Ghost Ping event${messageLoad === 1 ? "" : "s"}.`);

  score += activeEscalations * 8 + collapseVelocity * 8;
  if (activeEscalations > 0) reasons.push(`${activeEscalations} active escalation${activeEscalations === 1 ? "" : "s"}.`);

  const finalScore = clampConfidence(score);
  const level: NonNullable<BrainInsight["systemPressure"]>["level"] =
    finalScore >= 80 ? "CRITICAL" : finalScore >= 55 ? "ELEVATED" : finalScore >= 30 ? "WATCH" : "LOW";

  return {
    level,
    score: finalScore,
    reasons: reasons.length > 0 ? reasons : ["Operational pressure is currently low."],
  };
}

function enrichInsight(
  insight: Omit<
    BrainInsight,
    | "escalationUrgency"
    | "recoveryLikelihood"
    | "automationConfidence"
    | "whyThisMatters"
    | "decisionMode"
    | "autonomousRecommendation"
    | "forecast"
    | "systemPressure"
    | "drift"
    | "scope"
    | "cluster"
    | "operationalZone"
    | "revenueStability"
    | "loadDistribution"
    | "systemNarrative"
    | "recoveryRecommendation"
    | "operationalMemory"
    | "memoryPattern"
    | "adaptiveExplanation"
    | "liveEvents"
    | "operationalPulse"
    | "organizationPulse"
    | "locationProfile"
    | "autonomousDecision"
  >,
  options: {
    order?: BrainOrder;
    whyThisMatters?: string;
    requiresHumanAction?: boolean;
    transition?: BrainInsight["transition"];
    riskPrevented?: number;
    humanReviewBypassedSafely?: boolean;
    waitlistAvailability?: number;
    systemPressure?: BrainInsight["systemPressure"];
    drift?: BrainInsight["drift"];
    forecast?: BrainInsight["forecast"];
    scope?: BrainInsight["scope"];
    cluster?: BrainInsight["cluster"];
    operationalZone?: BrainInsight["operationalZone"];
    revenueStability?: BrainInsight["revenueStability"];
    loadDistribution?: BrainInsight["loadDistribution"];
    systemNarrative?: string;
    recoveryRecommendation?: BrainInsight["recoveryRecommendation"];
    operationalMemory?: BrainInsight["operationalMemory"];
    memoryPattern?: BrainInsight["memoryPattern"];
    adaptiveExplanation?: string;
    liveEvents?: LiveOperationalEvent[];
    operationalPulse?: BrainInsight["operationalPulse"];
    organizationPulse?: BrainInsight["organizationPulse"];
    locationProfile?: BrainInsight["locationProfile"];
    autonomousDecision?: BrainInsight["autonomousDecision"];
  } = {}
): BrainInsight {
  return {
    ...insight,
    escalationUrgency: getEscalationUrgency(
      insight.severity,
      options.order?.collapseProbability,
      options.order?.ghostPingUrgency
    ),
    recoveryLikelihood: getRecoveryLikelihood(options.order),
    automationConfidence: getAutomationConfidence(
      insight.confidence,
      insight.severity,
      options.requiresHumanAction
    ),
    whyThisMatters:
      options.whyThisMatters ??
      (options.order
        ? getWhyThisMatters(options.order, insight.category)
        : "This audit-backed signal changes the operational risk posture."),
    decisionMode: getDecisionMode(
      insight.severity,
      options.requiresHumanAction,
      insight.category
    ),
    transition: options.transition,
    riskPrevented: options.riskPrevented,
    humanReviewBypassedSafely: options.humanReviewBypassedSafely,
    autonomousRecommendation: getAutonomousRecommendation(
      insight,
      options.order,
      options.requiresHumanAction
    ),
    forecast:
      options.forecast ??
      getForecast(options.order, Number(options.waitlistAvailability ?? 0)),
    systemPressure: options.systemPressure,
    drift: options.drift,
    scope: options.scope ?? (options.order ? "ORDER" : "SYSTEM"),
    cluster: options.cluster,
    operationalZone: options.operationalZone,
    revenueStability: options.revenueStability,
    loadDistribution: options.loadDistribution,
    systemNarrative: options.systemNarrative,
    recoveryRecommendation: options.recoveryRecommendation,
    operationalMemory: options.operationalMemory,
    memoryPattern: options.memoryPattern,
    adaptiveExplanation: options.adaptiveExplanation,
    liveEvents: options.liveEvents,
    operationalPulse: options.operationalPulse,
    organizationPulse: options.organizationPulse,
    locationProfile: options.locationProfile,
    autonomousDecision: options.autonomousDecision,
  };
}

function mapOrderFromDb(row: Record<string, any>): BrainOrder {
  const order = mapAndEnrichOrderFromDb(row);

  return {
    id: order.id,
    customerName: order.customerName || "Unknown customer",
    organizationId: order.organizationId ?? "org-valsentra",
    locationId: order.locationId ?? "loc-primary",
    locationName: order.locationName ?? "Primary Location",
    orderType: order.orderType,
    amount: order.amount,
    guests: order.guests,
    reservationTime: order.reservationTime || null,
    status: order.status,
    paymentState: order.paymentState ?? "UNPAID",
    paymentVerified: Boolean(order.paymentVerified),
    depositRequired: order.depositRequired,
    depositPaid: order.depositPaid,
    reliabilityScore: order.reliabilityScore,
    terminalMismatch: order.terminalMismatch,
    riskLevel: order.riskLevel ?? "LOW",
    slotHoldExpiresAt: order.slotHoldExpiresAt ?? null,
    lastReminderSentAt: order.lastReminderSentAt ?? null,
    awaitingDetails: Boolean(order.awaitingDetails),
    createdAt: order.createdAt ?? new Date().toISOString(),
    collapseProbability: order.collapseProbability ?? 0,
    collapseRiskTier: order.collapseRiskTier ?? "STABLE",
    recommendedIntervention: order.recommendedIntervention ?? "MONITOR",
    instabilityFactors: order.instabilityFactors ?? [],
    collapseExplanation: order.collapseExplanation ?? "No collapse instability detected.",
    ghostPingShouldSend: Boolean(order.ghostPingShouldSend),
    ghostPingUrgency: order.ghostPingUrgency ?? "LOW",
    ghostPingReasoning: order.ghostPingReasoning ?? "Ghost Ping not required.",
  };
}

function getPaymentSeverity(order: BrainOrder): BrainSeverity {
  if (order.terminalMismatch || order.paymentState === "BLOCKED" || order.paymentState === "FAILED") {
    return "CRITICAL";
  }
  if (order.depositRequired && !order.depositPaid) return "WARNING";
  if (!order.paymentVerified && order.status !== "PAID") return "WATCH";
  return "INFO";
}

function getCollapseSeverity(order: BrainOrder): BrainSeverity {
  if (order.collapseProbability >= 85 || order.collapseRiskTier === "CRITICAL") return "CRITICAL";
  if (order.collapseProbability >= 60 || order.collapseRiskTier === "AT_RISK") return "WARNING";
  if (order.collapseProbability >= 35 || order.collapseRiskTier === "WATCH") return "WATCH";
  return "INFO";
}

function getInterventionAction(intervention: string) {
  if (intervention === "GHOST_PING") return "Send or schedule a Ghost Ping.";
  if (intervention === "DEPOSIT_ESCALATION") return "Escalate deposit collection.";
  if (intervention === "PAYMENT_REMINDER") return "Send payment reminder.";
  if (intervention === "PREPARE_WAITLIST") return "Prepare waitlist recovery.";
  if (intervention === "RELEASE_AND_RECOVER") return "Release and recover if owner settings allow it.";
  return "Monitor without intervention.";
}

function buildOrderInsights(order: BrainOrder, waitlistAvailability: number): BrainInsight[] {
  const insights: BrainInsight[] = [];
  const isClosed = order.status === "CANCELLED" || order.status === "NO_SHOW";
  const isPaid = order.status === "PAID" || order.paymentState === "VERIFIED" || order.paymentVerified;

  const paymentReasoning: string[] = [];
  if (!isPaid) paymentReasoning.push("Payment is not verified.");
  if (order.depositRequired && !order.depositPaid) paymentReasoning.push("Deposit is required but unpaid.");
  if (order.paymentState === "PENDING") paymentReasoning.push("Payment is still pending.");
  if (order.paymentState === "FAILED") paymentReasoning.push("Payment failed.");
  if (order.paymentState === "BLOCKED") paymentReasoning.push("Payment is blocked.");

  if (!isClosed && paymentReasoning.length > 0) {
    insights.push(enrichInsight({
      id: `payment-${order.id}`,
      title: "Payment truth requires attention",
      summary: `${order.customerName} has unresolved payment protection on ${order.id}.`,
      severity: getPaymentSeverity(order),
      category: "PAYMENT_TRUTH",
      orderId: order.id,
      customerName: order.customerName,
      confidence: clampConfidence(72 + paymentReasoning.length * 6),
      recommendedAction: order.depositRequired && !order.depositPaid
        ? "Collect or verify deposit before releasing capacity."
        : "Verify payment before confirming operational release.",
      reasoning: paymentReasoning,
      createdAt: order.createdAt,
    }, { order, waitlistAvailability }));
  }

  if (order.terminalMismatch || order.paymentState === "FAILED" || order.paymentState === "BLOCKED") {
    insights.push(enrichInsight({
      id: `fraud-${order.id}`,
      title: "Fraud containment signal detected",
      summary: `${order.id} has payment integrity signals that should stay contained.`,
      severity: "CRITICAL",
      category: "FRAUD_CONTAINMENT",
      orderId: order.id,
      customerName: order.customerName,
      confidence: order.terminalMismatch ? 96 : 88,
      recommendedAction: "Keep the order blocked until the payment truth is resolved.",
      reasoning: [
        order.terminalMismatch ? "Terminal mismatch detected." : "Payment state indicates failure or block.",
        `Payment state is ${order.paymentState}.`,
        `Customer reliability score is ${order.reliabilityScore}.`,
      ],
      createdAt: order.createdAt,
    }, {
      order,
      waitlistAvailability,
      riskPrevented: order.amount,
      whyThisMatters: `This blocked order prevented RM ${order.amount} potential fraud or payment exposure from reaching confirmed capacity.`,
    }));
  }

  if (!isClosed && order.collapseProbability >= 35) {
    insights.push(enrichInsight({
      id: `collapse-${order.id}`,
      title: "Collapse prevention is active",
      summary: `${order.id} has ${order.collapseProbability}% collapse probability with ${order.recommendedIntervention.toLowerCase().replaceAll("_", " ")} recommended.`,
      severity: getCollapseSeverity(order),
      category: "COLLAPSE_PREVENTION",
      orderId: order.id,
      customerName: order.customerName,
      confidence: clampConfidence(order.collapseProbability),
      recommendedAction: getInterventionAction(order.recommendedIntervention),
      reasoning: [
        ...order.instabilityFactors,
        order.ghostPingShouldSend ? `Ghost Ping urgency is ${order.ghostPingUrgency}.` : "Ghost Ping not required yet.",
        order.collapseExplanation,
      ].filter(Boolean),
      createdAt: order.createdAt,
    }, { order, waitlistAvailability }));
  }

  if (order.reliabilityScore <= 40 && !isClosed) {
    insights.push(enrichInsight({
      id: `learning-${order.id}`,
      title: "Reliability model is applying caution",
      summary: `${order.customerName} has low reliability and should receive stronger protection rules.`,
      severity: order.reliabilityScore <= 20 ? "WARNING" : "WATCH",
      category: "LEARNING",
      orderId: order.id,
      customerName: order.customerName,
      confidence: clampConfidence(100 - order.reliabilityScore),
      recommendedAction: "Require verified payment protection before committing capacity.",
      reasoning: [
        `Customer reliability score is ${order.reliabilityScore}.`,
        `Risk level is ${order.riskLevel}.`,
        "Reliability signal is based on real order history and payment state.",
      ],
      createdAt: order.createdAt,
    }, {
      order,
      waitlistAvailability,
      whyThisMatters:
        "Low reliability reduces safe automation confidence and increases the need for verified payment protection.",
    }));
  }

  if (order.status === "NO_SHOW") {
    insights.push(enrichInsight({
      id: `noshow-${order.id}`,
      title: "No-show converted into learning signal",
      summary: `${order.id} is marked no-show and should influence future protection decisions.`,
      severity: "WARNING",
      category: "LEARNING",
      orderId: order.id,
      customerName: order.customerName,
      confidence: 90,
      recommendedAction: "Lower future trust and require payment protection for similar bookings.",
      reasoning: [
        "Order status is NO_SHOW.",
        `Customer reliability score is ${order.reliabilityScore}.`,
        `Order value was RM ${order.amount}.`,
      ],
      createdAt: order.createdAt,
    }, {
      order,
      waitlistAvailability,
      transition: {
        label: "Customer reliability",
        from: "ACTIVE",
        to: "DEGRADED",
        direction: "DOWN",
      },
      whyThisMatters:
        "A no-show converts into a negative learning signal that tightens future deposit and payment requirements.",
    }));
  }

  return insights;
}

function buildAuditInsight(row: Record<string, any>, orderById: Map<string, BrainOrder>): BrainInsight | null {
  const action = String(row.action ?? "");
  const lower = action.toLowerCase();
  const meta = row.meta ?? {};
  const orderId = row.order_id ? String(row.order_id) : undefined;
  const order = orderId ? orderById.get(orderId) : undefined;
  const createdAt = String(row.created_at ?? new Date().toISOString());

  if (meta?.autonomousDecision) {
    const decision = meta.autonomousDecision;
    const blockingGuardrails = Array.isArray(decision.guardrails)
      ? decision.guardrails.filter((guardrail: Record<string, any>) => guardrail.blocking)
      : [];

    return enrichInsight({
      id: `audit-autonomous-decision-${row.id}`,
      title: decision.shouldExecute
        ? "Autonomous decision executed"
        : "Autonomous decision blocked by guardrails",
      summary: String(meta.summary ?? action),
      severity:
        decision.shouldExecute
          ? "INFO"
          : blockingGuardrails.length > 0
            ? "WARNING"
            : "WATCH",
      category: "AUTOPILOT",
      orderId,
      customerName: order?.customerName,
      confidence: clampConfidence(Number(decision.automationConfidence ?? meta.confidence ?? 75)),
      recommendedAction: String(
        meta.recommendedAction ??
          (decision.shouldExecute
            ? "Monitor the expected outcome and recovery path."
            : "Review blocking guardrails before executing this action.")
      ),
      reasoning: [
        `Action: ${decision.action ?? "UNKNOWN"}.`,
        `Execution mode: ${decision.executionMode ?? "UNKNOWN"}.`,
        `Reversibility: ${decision.reversibility ?? "UNKNOWN"}.`,
        `Historical success rate: ${decision.historicalSuccessRate ?? 50}%.`,
        `Memory confidence adjustment: ${decision.learningConfidenceAdjustment ?? 0}.`,
        decision.simulation
          ? `Simulation selected ${decision.simulation.bestProjectedAction} as best projected path at ${decision.simulation.simulationConfidence}% confidence.`
          : "No simulation context was attached.",
        ...(decision.adaptiveExplanations ?? []).slice(0, 3),
        ...(decision.simulation?.recommendedPolicyAdjustments ?? []).slice(0, 2),
        ...blockingGuardrails.map((guardrail: Record<string, any>) =>
          `Guardrail: ${guardrail.message ?? guardrail.code}.`
        ),
      ],
      createdAt,
    }, {
      order,
      requiresHumanAction: Boolean(decision.humanReviewRequired),
      riskPrevented: Number(decision.preventedRisk ?? meta.orderAmount ?? order?.amount ?? 0),
      humanReviewBypassedSafely: Boolean(decision.humanReviewBypassedSafely),
      autonomousDecision: decision,
      whyThisMatters:
        "Valsentra simulates operational futures before execution, then combines policy, memory, and guardrails before acting or stopping.",
    });
  }

  if (meta?.learningEntry) {
    return enrichInsight({
      id: `audit-learning-${row.id}`,
      title: "Continuous learning signal recorded",
      summary: String(meta.learningEntry.learningSummary ?? action),
      severity: meta.learningEntry.outcome === "NEGATIVE" ? "WARNING" : "INFO",
      category: "LEARNING",
      orderId,
      customerName: order?.customerName ?? meta.learningEntry.customerName,
      confidence: clampConfidence(65 + Math.abs(Number(meta.learningEntry.signalWeight ?? 0))),
      recommendedAction: "Use this signal to tune future protection decisions.",
      reasoning: [
        `Learning event: ${meta.learningEntry.eventType ?? "UNKNOWN"}.`,
        `Outcome: ${meta.learningEntry.outcome ?? "UNKNOWN"}.`,
        `Signal weight: ${meta.learningEntry.signalWeight ?? 0}.`,
      ],
      createdAt,
    }, {
      order,
      whyThisMatters:
        "Continuous learning improves future automation by feeding real outcomes back into protection decisions.",
    });
  }

  if (lower.includes("waitlist") || lower.includes("recovered")) {
    const succeeded = lower.includes("succeeded") || lower.includes("recovered");
    return enrichInsight({
      id: `audit-recovery-${row.id}`,
      title: succeeded ? "Waitlist recovery succeeded" : "Waitlist recovery needs review",
      summary: action,
      severity: succeeded ? "INFO" : "WATCH",
      category: "RECOVERY",
      orderId,
      customerName: order?.customerName,
      confidence: succeeded ? 84 : 72,
      recommendedAction: succeeded
        ? "Keep recovery path visible in the audit trail."
        : "Review waitlist candidates or recovery eligibility.",
      reasoning: [
        succeeded ? "Audit log contains recovered/succeeded recovery language." : "Audit log indicates recovery attempt did not fully complete.",
        meta?.recoverableRevenue ? `Recoverable revenue: RM ${meta.recoverableRevenue}.` : "Recovery signal came from audit history.",
      ],
      createdAt,
    }, {
      order,
      riskPrevented: Number(meta?.recoverableRevenue ?? order?.amount ?? 0),
      whyThisMatters: succeeded
        ? `Waitlist recovery protected RM ${Number(meta?.recoverableRevenue ?? order?.amount ?? 0)} of slot value.`
        : "Recovery probability may be falling because the audit stream shows an incomplete waitlist recovery path.",
      humanReviewBypassedSafely: succeeded,
    });
  }

  if (lower.includes("auto release") || lower.includes("auto-release") || lower.includes("suggested release")) {
    const suggested = lower.includes("suggested");
    return enrichInsight({
      id: `audit-autopilot-${row.id}`,
      title: suggested ? "Autopilot suggested release" : "Autopilot release executed",
      summary: action,
      severity: suggested ? "WATCH" : "WARNING",
      category: "AUTOPILOT",
      orderId,
      customerName: order?.customerName,
      confidence: clampConfidence(Number(meta?.confidence ?? 78)),
      recommendedAction: suggested
        ? "Review release recommendation before capacity is lost."
        : "Confirm waitlist recovery and payment protection follow-up.",
      reasoning: [
        meta?.rule ? `Rule: ${meta.rule}.` : "Autopilot release signal came from audit history.",
        meta?.reason ? `Reason: ${meta.reason}.` : "No detailed reason was attached.",
        meta?.requiresHumanAction ? "Human review is required." : "Autopilot action was allowed by current mode.",
      ],
      createdAt,
    }, {
      order,
      requiresHumanAction: Boolean(meta?.requiresHumanAction),
      riskPrevented: Number(meta?.orderAmount ?? order?.amount ?? 0),
      whyThisMatters: suggested
        ? "Autopilot identified release risk, but owner settings require review before capacity changes."
        : `Autopilot protected RM ${Number(meta?.orderAmount ?? order?.amount ?? 0)} of operational exposure by executing the release path.`,
      humanReviewBypassedSafely: !meta?.requiresHumanAction,
    });
  }

  if (lower.includes("human review")) {
    return enrichInsight({
      id: `audit-human-review-${row.id}`,
      title: "Human review required",
      summary: action,
      severity: "WARNING",
      category: "AUTOPILOT",
      orderId,
      customerName: order?.customerName,
      confidence: clampConfidence(Number(meta?.confidence ?? 75)),
      recommendedAction: "Owner or staff should review before autonomous action continues.",
      reasoning: [
        meta?.reason ? `Reason: ${meta.reason}.` : "Autopilot requested human review.",
        meta?.humanActionReason ? String(meta.humanActionReason) : "Manual confirmation is required.",
      ],
      createdAt,
    }, {
      order,
      requiresHumanAction: true,
      whyThisMatters:
        "Human review prevents unsafe automation when Valsentra detects ambiguity or owner-controlled release conditions.",
    });
  }

  return null;
}

function findPreviousMetaValue<T>(
  rows: Record<string, any>[],
  key: string,
  latestIndex: number,
  latestValue: T
) {
  for (let index = latestIndex + 1; index < rows.length; index += 1) {
    const value = rows[index]?.meta?.[key];
    if (value !== undefined && value !== latestValue) return value;
  }

  return undefined;
}

function buildTransitionInsights(
  order: BrainOrder,
  auditRows: Record<string, any>[],
  waitlistAvailability: number
): BrainInsight[] {
  const rows = auditRows
    .filter((row) => String(row.order_id ?? "") === order.id)
    .sort(
      (a, b) =>
        new Date(b.created_at ?? 0).getTime() -
        new Date(a.created_at ?? 0).getTime()
    );
  const insights: BrainInsight[] = [];

  rows.forEach((row, index) => {
    const meta = row.meta ?? {};
    const createdAt = String(row.created_at ?? new Date().toISOString());

    if (typeof meta.collapseProbability === "number") {
      const previous = findPreviousMetaValue<number>(
        rows,
        "collapseProbability",
        index,
        meta.collapseProbability
      );

      if (typeof previous === "number" && Math.abs(meta.collapseProbability - previous) >= 15) {
        const rose = meta.collapseProbability > previous;
        insights.push(enrichInsight({
          id: `transition-collapse-${row.id}`,
          title: rose ? "Collapse probability escalated" : "Collapse probability improved",
          summary: `${order.id} moved from ${previous}% to ${meta.collapseProbability}% collapse probability.`,
          severity: rose && meta.collapseProbability >= 75 ? "WARNING" : rose ? "WATCH" : "INFO",
          category: "COLLAPSE_PREVENTION",
          orderId: order.id,
          customerName: order.customerName,
          confidence: clampConfidence(Math.max(meta.collapseProbability, Math.abs(meta.collapseProbability - previous) * 3)),
          recommendedAction: rose
            ? getInterventionAction(order.recommendedIntervention)
            : "Continue monitoring until payment and attendance signals stay stable.",
          reasoning: [
            `Collapse probability changed from ${previous}% to ${meta.collapseProbability}%.`,
            meta.reason ? `Audit reason: ${meta.reason}.` : "Change came from audit intelligence metadata.",
            order.ghostPingUrgency ? `Ghost Ping urgency is ${order.ghostPingUrgency}.` : "Ghost Ping urgency is not elevated.",
          ],
          createdAt,
        }, {
          order,
          waitlistAvailability,
          transition: {
            label: "Collapse probability",
            from: `${previous}%`,
            to: `${meta.collapseProbability}%`,
            direction: rose ? "UP" : "DOWN",
          },
          whyThisMatters: rose
            ? "Rising collapse probability means recovery value may decay if the slot is not protected quickly."
            : "Improving collapse probability means the current intervention path is restoring operational stability.",
        }));
      }
    }

    if (meta.collapseRiskTier) {
      const previous = findPreviousMetaValue<string>(
        rows,
        "collapseRiskTier",
        index,
        meta.collapseRiskTier
      );

      if (previous && previous !== meta.collapseRiskTier) {
        insights.push(enrichInsight({
          id: `transition-risk-${row.id}`,
          title: "Risk tier changed",
          summary: `${order.id} moved ${previous} -> ${meta.collapseRiskTier}.`,
          severity: meta.collapseRiskTier === "CRITICAL" ? "CRITICAL" : "WATCH",
          category: "COLLAPSE_PREVENTION",
          orderId: order.id,
          customerName: order.customerName,
          confidence: 82,
          recommendedAction: getInterventionAction(order.recommendedIntervention),
          reasoning: [
            `Risk tier changed from ${previous} to ${meta.collapseRiskTier}.`,
            `Recommended intervention is ${order.recommendedIntervention}.`,
          ],
          createdAt,
        }, {
          order,
          waitlistAvailability,
          transition: {
            label: "Risk tier",
            from: previous,
            to: String(meta.collapseRiskTier),
            direction: meta.collapseRiskTier === "CRITICAL" ? "UP" : "UNCHANGED",
          },
          whyThisMatters:
            "Risk-tier movement changes how aggressively Valsentra should protect capacity and prepare recovery.",
        }));
      }
    }

    if (meta.ghostPingUrgency) {
      const previous = findPreviousMetaValue<string>(
        rows,
        "ghostPingUrgency",
        index,
        meta.ghostPingUrgency
      );

      if (previous && previous !== meta.ghostPingUrgency) {
        insights.push(enrichInsight({
          id: `transition-ghost-${row.id}`,
          title: "Ghost Ping urgency changed",
          summary: `${order.id} Ghost Ping urgency moved ${previous} -> ${meta.ghostPingUrgency}.`,
          severity: meta.ghostPingUrgency === "CRITICAL" ? "CRITICAL" : "WARNING",
          category: "AUTOPILOT",
          orderId: order.id,
          customerName: order.customerName,
          confidence: 80,
          recommendedAction: "Use Ghost Ping timing to prevent silent collapse.",
          reasoning: [
            `Ghost Ping urgency changed from ${previous} to ${meta.ghostPingUrgency}.`,
            meta.ghostPingReasoning ? `Reasoning: ${meta.ghostPingReasoning}.` : "Ghost Ping metadata changed in audit history.",
          ],
          createdAt,
        }, {
          order,
          waitlistAvailability,
          transition: {
            label: "Ghost Ping urgency",
            from: previous,
            to: String(meta.ghostPingUrgency),
            direction: "UP",
          },
          whyThisMatters:
            "Higher Ghost Ping urgency means the system is moving from passive monitoring toward active intervention.",
        }));
      }
    }
  });

  return insights.slice(0, 6);
}

function getRecentWindowCounts(auditRows: Record<string, any>[], matcher: (row: Record<string, any>) => boolean) {
  const now = Date.now();
  const oneDay = 24 * 60 * 60 * 1000;
  let recent = 0;
  let previous = 0;

  for (const row of auditRows) {
    const created = new Date(row.created_at ?? 0).getTime();
    if (Number.isNaN(created) || !matcher(row)) continue;
    const age = now - created;
    if (age <= oneDay) recent += 1;
    else if (age <= oneDay * 2) previous += 1;
  }

  return { recent, previous };
}

function buildDriftInsights(
  orders: BrainOrder[],
  auditRows: Record<string, any>[],
  systemPressure: BrainInsight["systemPressure"]
): BrainInsight[] {
  const insights: BrainInsight[] = [];
  const now = new Date().toISOString();
  const ghostCounts = getRecentWindowCounts(auditRows, (row) => {
    const action = String(row.action ?? "").toLowerCase();
    return action.includes("ghost") || action.includes("reminder");
  });
  const recoveryFailureCounts = getRecentWindowCounts(auditRows, (row) =>
    String(row.action ?? "").toLowerCase().includes("waitlist recovery failed")
  );
  const highRiskOrders = orders.filter(
    (order) => order.collapseProbability >= 70 || order.riskLevel === "HIGH"
  );
  const noShowOrders = orders.filter((order) => order.status === "NO_SHOW");

  if (ghostCounts.recent >= Math.max(2, ghostCounts.previous + 2)) {
    insights.push(enrichInsight({
      id: "drift-ghost-frequency",
      title: "Ghost Ping frequency is increasing",
      summary: `Reminder and Ghost Ping activity rose to ${ghostCounts.recent} events in the last 24 hours.`,
      severity: "WATCH",
      category: "AUTOPILOT",
      confidence: 76,
      recommendedAction: "Watch payment confirmation speed and prepare earlier intervention windows.",
      reasoning: [
        `${ghostCounts.recent} recent Ghost Ping or reminder events.`,
        `${ghostCounts.previous} comparable events in the previous 24-hour window.`,
        "Higher message frequency can indicate payment friction or reservation instability.",
      ],
      createdAt: now,
    }, {
      systemPressure,
      drift: {
        type: "GHOST_PING_INCREASE",
        summary: "Ghost Ping and reminder activity is rising.",
        signals: [`Recent: ${ghostCounts.recent}`, `Previous: ${ghostCounts.previous}`],
      },
      whyThisMatters:
        "Rising intervention frequency means Valsentra may need to act earlier before slots become hard to recover.",
    }));
  }

  if (recoveryFailureCounts.recent > recoveryFailureCounts.previous && recoveryFailureCounts.recent > 0) {
    insights.push(enrichInsight({
      id: "drift-recovery-decay",
      title: "Recovery success is under pressure",
      summary: "Waitlist recovery failures are increasing in the audit stream.",
      severity: "WARNING",
      category: "RECOVERY",
      confidence: 78,
      recommendedAction: "Trigger recovery flow earlier and review waitlist candidate quality.",
      reasoning: [
        `${recoveryFailureCounts.recent} recovery failure events in the last 24 hours.`,
        `${recoveryFailureCounts.previous} recovery failure events in the previous 24-hour window.`,
        "Recovery confidence falls when failed recovery attempts cluster.",
      ],
      createdAt: now,
    }, {
      systemPressure,
      drift: {
        type: "RECOVERY_DECAY",
        summary: "Waitlist recovery reliability is drifting downward.",
        signals: [`Recent failures: ${recoveryFailureCounts.recent}`, `Previous failures: ${recoveryFailureCounts.previous}`],
      },
      whyThisMatters:
        "If recovery confidence keeps falling, high-value slots need earlier protection and faster replacement routing.",
    }));
  }

  if (highRiskOrders.length >= 3) {
    insights.push(enrichInsight({
      id: "drift-risk-clustering",
      title: "High-risk orders are clustering",
      summary: `${highRiskOrders.length} orders are currently high-risk or above 70% collapse probability.`,
      severity: highRiskOrders.length >= 5 ? "WARNING" : "WATCH",
      category: "COLLAPSE_PREVENTION",
      confidence: clampConfidence(62 + highRiskOrders.length * 6),
      recommendedAction: "Prioritize verification and recovery preparation for the highest-value exposed slots.",
      reasoning: highRiskOrders.slice(0, 5).map(
        (order) => `${order.id}: ${order.collapseProbability}% collapse probability, RM ${order.amount} exposure.`
      ),
      createdAt: now,
    }, {
      systemPressure,
      drift: {
        type: "RISK_CLUSTERING",
        summary: "Risk is concentrating across active orders.",
        signals: highRiskOrders.slice(0, 4).map((order) => order.id),
      },
      whyThisMatters:
        "Risk clustering raises operational pressure because multiple slots may need intervention at the same time.",
    }));
  }

  if (noShowOrders.length >= 2) {
    insights.push(enrichInsight({
      id: "drift-noshow-rise",
      title: "No-show probability is rising",
      summary: `${noShowOrders.length} no-show outcomes are present in the current order history.`,
      severity: "WATCH",
      category: "LEARNING",
      confidence: clampConfidence(60 + noShowOrders.length * 5),
      recommendedAction: "Tighten verification and deposit requirements for similar customer patterns.",
      reasoning: noShowOrders.slice(0, 5).map(
        (order) => `${order.id}: no-show outcome with reliability ${order.reliabilityScore}.`
      ),
      createdAt: now,
    }, {
      systemPressure,
      drift: {
        type: "NO_SHOW_RISE",
        summary: "No-show outcomes are contributing to future risk.",
        signals: noShowOrders.slice(0, 4).map((order) => order.id),
      },
      whyThisMatters:
        "No-show drift degrades future automation confidence and increases the need for payment protection.",
    }));
  }

  return insights;
}

function buildPressureInsight(systemPressure: NonNullable<BrainInsight["systemPressure"]>) {
  if (systemPressure.level === "LOW") return null;

  const severity: BrainSeverity =
    systemPressure.level === "CRITICAL"
      ? "CRITICAL"
      : systemPressure.level === "ELEVATED"
        ? "WARNING"
        : "WATCH";

  return enrichInsight({
    id: "system-pressure",
    title: `System pressure is ${systemPressure.level.toLowerCase()}`,
    summary: `Operational pressure score is ${systemPressure.score}/100 based on live exposure, escalations, blocked orders, and recovery coverage.`,
    severity,
    category: "AUTOPILOT",
    confidence: systemPressure.score,
    recommendedAction:
      systemPressure.level === "CRITICAL"
        ? "Escalate to owner and prioritize intervention now."
        : systemPressure.level === "ELEVATED"
          ? "Intervene on the highest-exposure orders first."
          : "Continue monitoring and prepare automation paths.",
    reasoning: systemPressure.reasons,
    createdAt: new Date().toISOString(),
  }, {
    systemPressure,
    whyThisMatters:
      "System pressure summarizes whether Valsentra can safely keep automating or should shift owner attention to the operation.",
  });
}

function isActiveOrder(order: BrainOrder) {
  return order.status !== "CANCELLED" && order.status !== "NO_SHOW";
}

function isUnverified(order: BrainOrder) {
  return order.paymentState !== "VERIFIED" && !order.paymentVerified;
}

function getServiceWindowKey(order: BrainOrder) {
  const value = order.reservationTime || order.createdAt;
  const parsed = new Date(value).getTime();
  if (Number.isNaN(parsed)) return "Unscheduled";

  const date = new Date(parsed);
  const hour = date.getHours();
  const windowStart = Math.floor(hour / 2) * 2;
  return `${String(windowStart).padStart(2, "0")}:00-${String(windowStart + 2).padStart(2, "0")}:00`;
}

function getRecentAuditCount(
  auditRows: Record<string, any>[],
  matcher: (row: Record<string, any>) => boolean
) {
  const oneDay = 24 * 60 * 60 * 1000;
  return auditRows.filter((row) => {
    const created = new Date(row.created_at ?? 0).getTime();
    return !Number.isNaN(created) && Date.now() - created <= oneDay && matcher(row);
  }).length;
}

function calculateLoadDistribution(
  orders: BrainOrder[],
  auditRows: Record<string, any>[],
  waitlistAvailability: number
): NonNullable<BrainInsight["loadDistribution"]> {
  const active = orders.filter(isActiveOrder);
  const paymentExposure = active
    .filter(isUnverified)
    .reduce((sum, order) => sum + Number(order.amount ?? 0), 0);
  const collapseRisk = active.filter((order) => order.collapseProbability >= 60).length;
  const activeEscalations = active.filter((order) => order.collapseProbability >= 60).length;
  const recoveryBacklog = Math.max(activeEscalations - waitlistAvailability, 0);
  const fraudContainment = active.filter(
    (order) => order.terminalMismatch || order.paymentState === "FAILED" || order.paymentState === "BLOCKED"
  ).length;
  const messagingLoad = getRecentAuditCount(auditRows, (row) => {
    const action = String(row.action ?? "").toLowerCase();
    return action.includes("ghost") || action.includes("reminder");
  });
  const reliabilityDegradation = orders.filter(
    (order) => order.status === "NO_SHOW" || order.reliabilityScore <= 40
  ).length;
  const blockedOrders = active.filter(
    (order) => order.paymentState === "BLOCKED" || order.paymentState === "FAILED"
  ).length;

  return {
    paymentExposure,
    collapseRisk,
    recoveryBacklog,
    fraudContainment,
    messagingLoad,
    reliabilityDegradation,
    blockedOrders,
  };
}

function calculateRevenueStability(
  orders: BrainOrder[],
  waitlistAvailability: number
): NonNullable<BrainInsight["revenueStability"]> {
  const active = orders.filter(isActiveOrder);
  const projectedProtectedRevenue = active
    .filter((order) => order.paymentVerified || order.paymentState === "VERIFIED" || order.depositPaid)
    .reduce((sum, order) => sum + Number(order.amount ?? 0), 0);
  const projectedExposedRevenue = active
    .filter(isUnverified)
    .reduce((sum, order) => sum + Number(order.amount ?? 0), 0);
  const atRiskOrders = active.filter((order) => order.collapseProbability >= 60);
  const likelyRecoveryRevenue = atRiskOrders
    .slice(0, waitlistAvailability)
    .reduce((sum, order) => sum + Number(order.amount ?? 0) * (getRecoveryLikelihood(order) / 100), 0);
  const collapseChainProbability = clampConfidence(
    atRiskOrders.length * 14 +
      active.filter((order) => order.ghostPingUrgency === "HIGH" || order.ghostPingUrgency === "CRITICAL").length * 10
  );
  const projectedNoShowImpact = active
    .filter((order) => order.reliabilityScore <= 40 || order.collapseProbability >= 75)
    .reduce((sum, order) => sum + Number(order.amount ?? 0) * 0.35, 0);
  const projectedFraudExposure = active
    .filter((order) => order.terminalMismatch || order.paymentState === "FAILED" || order.paymentState === "BLOCKED")
    .reduce((sum, order) => sum + Number(order.amount ?? 0), 0);

  return {
    projectedProtectedRevenue: Math.round(projectedProtectedRevenue),
    projectedExposedRevenue: Math.round(projectedExposedRevenue),
    likelyRecoveryRevenue: Math.round(likelyRecoveryRevenue),
    collapseChainProbability,
    projectedNoShowImpact: Math.round(projectedNoShowImpact),
    projectedFraudExposure: Math.round(projectedFraudExposure),
  };
}

function calculateOperationalZone(
  systemPressure: NonNullable<BrainInsight["systemPressure"]>,
  load: NonNullable<BrainInsight["loadDistribution"]>,
  revenue: NonNullable<BrainInsight["revenueStability"]>
): NonNullable<BrainInsight["operationalZone"]> {
  const score = clampConfidence(
    systemPressure.score +
      load.recoveryBacklog * 6 +
      load.fraudContainment * 5 +
      revenue.collapseChainProbability * 0.25
  );
  let zone: NonNullable<BrainInsight["operationalZone"]>["zone"] = "STABLE_ZONE";

  if (score >= 82) zone = "CRITICAL_ZONE";
  else if (load.recoveryBacklog > 0 || revenue.collapseChainProbability >= 60) zone = "RECOVERY_ZONE";
  else if (score >= 58 || load.collapseRisk >= 3) zone = "CONGESTED_ZONE";
  else if (score >= 30 || load.paymentExposure > 0) zone = "WATCH_ZONE";

  const summary =
    zone === "CRITICAL_ZONE"
      ? "The whole operation needs owner attention because pressure, exposure, or chain risk is critical."
      : zone === "RECOVERY_ZONE"
        ? "Recovery capacity is now part of the active operating condition."
        : zone === "CONGESTED_ZONE"
          ? "Operational pressure is concentrated across several active signals."
          : zone === "WATCH_ZONE"
            ? "The operation is stable, but exposed orders require continued monitoring."
            : "The operation is stable and automation can remain calm.";

  return { zone, score, summary };
}

function buildSystemNarrative(
  zone: NonNullable<BrainInsight["operationalZone"]>,
  load: NonNullable<BrainInsight["loadDistribution"]>,
  revenue: NonNullable<BrainInsight["revenueStability"]>
) {
  if (zone.zone === "CRITICAL_ZONE") {
    return "Operational pressure is critical due to concentrated exposure, escalations, or recovery constraints.";
  }
  if (load.recoveryBacklog > 0) {
    return "Recovery capacity is under pressure because active escalations exceed available waitlist coverage.";
  }
  if (revenue.projectedFraudExposure > 0) {
    return `Fraud containment is active and currently contains RM ${revenue.projectedFraudExposure} in blocked or failed payment exposure.`;
  }
  if (load.paymentExposure > 0 && load.collapseRisk > 0) {
    return "Operational pressure is rising because unpaid exposure overlaps with collapse risk.";
  }
  if (load.paymentExposure > 0) {
    return "The operation is stable, but payment exposure is still present across active orders.";
  }
  return "The operation is stable, with current protection and recovery signals inside normal bounds.";
}

function buildCrossOrderPatternInsights({
  orders,
  auditRows,
  waitlistAvailability,
  systemPressure,
  loadDistribution,
  revenueStability,
  operationalZone,
}: {
  orders: BrainOrder[];
  auditRows: Record<string, any>[];
  waitlistAvailability: number;
  systemPressure: NonNullable<BrainInsight["systemPressure"]>;
  loadDistribution: NonNullable<BrainInsight["loadDistribution"]>;
  revenueStability: NonNullable<BrainInsight["revenueStability"]>;
  operationalZone: NonNullable<BrainInsight["operationalZone"]>;
}) {
  const insights: BrainInsight[] = [];
  const active = orders.filter(isActiveOrder);
  const now = new Date().toISOString();
  const byWindow = new Map<string, BrainOrder[]>();

  active.forEach((order) => {
    const key = getServiceWindowKey(order);
    byWindow.set(key, [...(byWindow.get(key) ?? []), order]);
  });

  for (const [window, windowOrders] of byWindow) {
    const risky = windowOrders.filter(
      (order) => order.collapseProbability >= 60 || (isUnverified(order) && minutesUntil(order.reservationTime) !== null && (minutesUntil(order.reservationTime) ?? 999) <= 90)
    );

    if (risky.length >= 2) {
      insights.push(enrichInsight({
        id: `cluster-window-${window}`,
        title: "Risk is clustering around a service window",
        summary: `${risky.length} active orders in ${window} carry payment, collapse, or service-time exposure.`,
        severity: risky.length >= 4 ? "WARNING" : "WATCH",
        category: "COLLAPSE_PREVENTION",
        confidence: clampConfidence(62 + risky.length * 7),
        recommendedAction: "Prioritize verification and recovery preparation for this time window.",
        reasoning: risky.map(
          (order) => `${order.id}: ${order.collapseProbability}% collapse, payment ${order.paymentState}.`
        ),
        createdAt: now,
      }, {
        scope: "SYSTEM",
        systemPressure,
        operationalZone,
        revenueStability,
        loadDistribution,
        cluster: {
          label: `Service window ${window}`,
          orders: risky.map((order) => order.id),
          heat: risky.length >= 4 ? "CRITICAL" : "ELEVATED",
        },
        whyThisMatters:
          "Clustered risk can create a chain reaction because multiple slots may need intervention in the same operating window.",
        systemNarrative: `Operational pressure is concentrated around ${window}.`,
      }));
    }
  }

  const delayedPayments = active.filter((order) => isUnverified(order) && getPaymentDelayMinutes(order) >= 30);
  if (delayedPayments.length >= 2) {
    insights.push(enrichInsight({
      id: "pattern-payment-delay",
      title: "Repeated payment delay pattern detected",
      summary: `${delayedPayments.length} active orders have unresolved payment after 30 minutes or more.`,
      severity: delayedPayments.length >= 4 ? "WARNING" : "WATCH",
      category: "PAYMENT_TRUTH",
      confidence: clampConfidence(64 + delayedPayments.length * 6),
      recommendedAction: "Require verification or send targeted payment reminders before service pressure rises.",
      reasoning: delayedPayments.slice(0, 6).map(
        (order) => `${order.id}: payment delayed ${getPaymentDelayMinutes(order)} minutes.`
      ),
      createdAt: now,
    }, {
      scope: "SYSTEM",
      systemPressure,
      operationalZone,
      revenueStability,
      loadDistribution,
      cluster: {
        label: "Payment delay cluster",
        orders: delayedPayments.map((order) => order.id),
        heat: delayedPayments.length >= 4 ? "ELEVATED" : "WATCH",
      },
      whyThisMatters:
        "Repeated payment delays reduce automation confidence and increase the chance of unrecoverable capacity.",
      systemNarrative:
        "Payment exposure is repeating across active orders rather than appearing as a single isolated issue.",
    }));
  }

  const blocked = active.filter(
    (order) => order.paymentState === "BLOCKED" || order.paymentState === "FAILED" || order.terminalMismatch
  );
  if (blocked.length >= 2) {
    insights.push(enrichInsight({
      id: "pattern-blocked-surge",
      title: "Blocked order surge detected",
      summary: `${blocked.length} active orders are blocked, failed, or terminal-mismatch contained.`,
      severity: "WARNING",
      category: "FRAUD_CONTAINMENT",
      confidence: clampConfidence(70 + blocked.length * 5),
      recommendedAction: "Keep fraud containment active and avoid releasing capacity until payment truth clears.",
      reasoning: blocked.map(
        (order) => `${order.id}: ${order.paymentState}${order.terminalMismatch ? ", terminal mismatch" : ""}.`
      ),
      createdAt: now,
    }, {
      scope: "SYSTEM",
      systemPressure,
      operationalZone,
      revenueStability,
      loadDistribution,
      cluster: {
        label: "Fraud containment cluster",
        orders: blocked.map((order) => order.id),
        heat: "ELEVATED",
      },
      riskPrevented: blocked.reduce((sum, order) => sum + Number(order.amount ?? 0), 0),
      whyThisMatters:
        "A surge in blocked orders can signal concentrated payment risk, not just isolated customer friction.",
      systemNarrative:
        "Fraud containment prevented exposure escalation across multiple active orders.",
    }));
  }

  const recoveryFailures = getRecentAuditCount(auditRows, (row) =>
    String(row.action ?? "").toLowerCase().includes("waitlist recovery failed")
  );
  if (recoveryFailures >= 2 || (loadDistribution.recoveryBacklog > 0 && waitlistAvailability === 0)) {
    insights.push(enrichInsight({
      id: "pattern-recovery-cascade",
      title: "Cascading recovery risk detected",
      summary: "Recovery demand may exceed available replacement capacity.",
      severity: "WARNING",
      category: "RECOVERY",
      confidence: clampConfidence(68 + recoveryFailures * 8 + loadDistribution.recoveryBacklog * 6),
      recommendedAction: "Trigger recovery flow earlier and review waitlist coverage.",
      reasoning: [
        `${recoveryFailures} recent waitlist recovery failure event${recoveryFailures === 1 ? "" : "s"}.`,
        `${loadDistribution.recoveryBacklog} recovery backlog signal${loadDistribution.recoveryBacklog === 1 ? "" : "s"}.`,
        `${waitlistAvailability} waitlist candidate${waitlistAvailability === 1 ? "" : "s"} available.`,
      ],
      createdAt: now,
    }, {
      scope: "SYSTEM",
      systemPressure,
      operationalZone,
      revenueStability,
      loadDistribution,
      cluster: {
        label: "Recovery capacity",
        orders: active.filter((order) => order.collapseProbability >= 60).map((order) => order.id),
        heat: "ELEVATED",
      },
      whyThisMatters:
        "Recovery failure can cascade when several risky slots need replacement at the same time.",
      systemNarrative:
        "Recovery capacity is the limiting factor for the current operating window.",
    }));
  }

  return insights.slice(0, 8);
}

function buildSystemOverviewInsight({
  systemPressure,
  loadDistribution,
  revenueStability,
  operationalZone,
  liveEvents,
  operationalPulse,
}: {
  systemPressure: NonNullable<BrainInsight["systemPressure"]>;
  loadDistribution: NonNullable<BrainInsight["loadDistribution"]>;
  revenueStability: NonNullable<BrainInsight["revenueStability"]>;
  operationalZone: NonNullable<BrainInsight["operationalZone"]>;
  liveEvents: LiveOperationalEvent[];
  operationalPulse: NonNullable<BrainInsight["operationalPulse"]>;
}) {
  const severity: BrainSeverity =
    operationalZone.zone === "CRITICAL_ZONE"
      ? "CRITICAL"
      : operationalZone.zone === "CONGESTED_ZONE" || operationalZone.zone === "RECOVERY_ZONE"
        ? "WARNING"
        : operationalZone.zone === "WATCH_ZONE"
          ? "WATCH"
          : "INFO";

  return enrichInsight({
    id: "system-overview",
    title: `Operation is in ${operationalZone.zone.replaceAll("_", " ").toLowerCase()}`,
    summary: buildSystemNarrative(operationalZone, loadDistribution, revenueStability),
    severity,
    category: "AUTOPILOT",
    confidence: operationalZone.score,
    recommendedAction:
      operationalZone.zone === "CRITICAL_ZONE"
        ? "Escalate to owner and prioritize highest-exposure interventions."
        : operationalZone.zone === "RECOVERY_ZONE"
          ? "Prepare recovery flow and protect unresolved payments."
          : operationalZone.zone === "CONGESTED_ZONE"
            ? "Reduce operational pressure by resolving payment and collapse clusters."
            : "Continue monitoring with current automation settings.",
    reasoning: [
      `System pressure is ${systemPressure.level} at ${systemPressure.score}/100.`,
      `Projected exposed revenue: RM ${revenueStability.projectedExposedRevenue}.`,
      `Collapse chain probability: ${revenueStability.collapseChainProbability}%.`,
      operationalZone.summary,
    ],
    createdAt: new Date().toISOString(),
  }, {
    scope: "SYSTEM",
    systemPressure,
    operationalZone,
    revenueStability,
    loadDistribution,
    liveEvents,
    operationalPulse,
    systemNarrative: buildSystemNarrative(operationalZone, loadDistribution, revenueStability),
    whyThisMatters:
      "This is the whole-operation posture Valsentra uses to decide whether to stay calm, monitor, recover, or escalate.",
  });
}

function mapOrganizationSeverity(
  severity: "INFO" | "WATCH" | "WARNING" | "CRITICAL"
): BrainSeverity {
  return severity;
}

function buildOrganizationInsights(
  snapshot: ReturnType<typeof buildMultiLocationIntelligenceSnapshot>
): BrainInsight[] {
  const pulse = snapshot.organizationPulse;
  const branchCount = snapshot.locations.length;
  const highestPressure = [...snapshot.locations].sort(
    (a, b) => b.collapsePressure - a.collapsePressure
  )[0];
  const severity: BrainSeverity =
    highestPressure?.pressureLevel === "CRITICAL"
      ? "CRITICAL"
      : highestPressure?.pressureLevel === "ELEVATED"
        ? "WARNING"
        : highestPressure?.pressureLevel === "WATCH"
          ? "WATCH"
          : "INFO";

  const insights: BrainInsight[] = [
    enrichInsight({
      id: "organization-pulse",
      title: "Organization operational pulse",
      summary: `${branchCount} location${branchCount === 1 ? "" : "s"} under monitoring with RM ${pulse.totalExposure} exposed and RM ${pulse.totalProtectedRevenue} protected.`,
      severity,
      category: "ORGANIZATION",
      organizationId: pulse.organizationId,
      confidence: 86,
      recommendedAction:
        severity === "CRITICAL"
          ? "Prioritize branch-level intervention where pressure is concentrated."
          : "Continue monitoring branch pressure and recovery momentum.",
      reasoning: [
        `Operational stability is ${pulse.operationalStability}.`,
        `Recovery momentum is ${pulse.recoveryMomentum}/100.`,
        `Automation load is ${pulse.automationLoad}/100.`,
      ],
      createdAt: new Date().toISOString(),
    }, {
      scope: "SYSTEM",
      organizationPulse: pulse,
      whyThisMatters:
        "Organization-level intelligence shows whether risk is isolated to one branch or spreading across the business.",
    }),
  ];

  for (const crossLocationInsight of snapshot.insights.slice(0, 4)) {
    const location = snapshot.locations.find(
      (candidate) => candidate.locationId === crossLocationInsight.locationId
    );

    insights.push(enrichInsight({
      id: crossLocationInsight.id,
      title: crossLocationInsight.title,
      summary: crossLocationInsight.summary,
      severity: mapOrganizationSeverity(crossLocationInsight.severity),
      category: "ORGANIZATION",
      organizationId: pulse.organizationId,
      locationId: crossLocationInsight.locationId,
      locationName: crossLocationInsight.locationName,
      confidence: crossLocationInsight.confidence,
      recommendedAction: crossLocationInsight.recommendedAction,
      reasoning: crossLocationInsight.reasoning,
      createdAt: crossLocationInsight.createdAt,
    }, {
      scope: "SYSTEM",
      organizationPulse: pulse,
      locationProfile: location,
      whyThisMatters:
        "Branch benchmarking helps owners distinguish isolated anomalies from organization-wide operational drift.",
    }));
  }

  return insights;
}

function getOrderAuditRows(order: BrainOrder, auditRows: Record<string, any>[]) {
  return auditRows.filter((row) => String(row.order_id ?? "") === order.id);
}

function getRecoveryState(orderRows: Record<string, any>[]): Pick<
  NonNullable<BrainInsight["recoveryRecommendation"]>,
  "state" | "attempted" | "succeeded" | "humanInterventionAvoided"
> {
  const text = orderRows.map((row) => String(row.action ?? "").toLowerCase()).join(" ");
  const attempted = text.includes("waitlist") || text.includes("recovery") || text.includes("auto release");
  const succeeded = text.includes("recovery succeeded") || text.includes("recovered");
  const failed = text.includes("recovery failed") || text.includes("no suitable waitlist");
  const humanInterventionAvoided = attempted && !orderRows.some((row) => Boolean(row.meta?.requiresHumanAction));

  return {
    state: succeeded
      ? "RECOVERY_SUCCEEDED"
      : failed
        ? "RECOVERY_FAILED"
        : attempted
          ? "RECOVERY_ATTEMPTED"
          : "RECOVERY_RECOMMENDED",
    attempted,
    succeeded,
    humanInterventionAvoided,
  };
}

function buildRecoveryRecommendation(
  order: BrainOrder,
  waitlistAvailability: number,
  auditRows: Record<string, any>[]
): BrainInsight["recoveryRecommendation"] | null {
  if (!isActiveOrder(order) || order.paymentState === "VERIFIED" || order.paymentVerified) {
    return null;
  }

  const paymentDelay = getPaymentDelayMinutes(order);
  const reservationMinutes = minutesUntil(order.reservationTime);
  const endangered =
    order.collapseProbability >= 45 ||
    paymentDelay >= 20 ||
    order.ghostPingUrgency === "HIGH" ||
    order.ghostPingUrgency === "CRITICAL" ||
    Number(order.amount ?? 0) >= 250 ||
    (reservationMinutes !== null && reservationMinutes <= 90 && isUnverified(order));

  if (!endangered) return null;

  const actions: NonNullable<BrainInsight["recoveryRecommendation"]>["actions"] = [];

  if (order.depositRequired && !order.depositPaid) actions.push("REQUIRE_DEPOSIT");
  if (paymentDelay >= 20 || order.paymentState === "PENDING") actions.push("SEND_REMINDER");
  if (paymentDelay >= 45 || order.collapseProbability >= 60) actions.push("ESCALATE_PAYMENT");
  if (order.collapseProbability >= 75 && waitlistAvailability > 0) {
    actions.push("OFFER_WAITLIST_REPLACEMENT");
  }
  if (order.collapseProbability >= 88 && waitlistAvailability > 0) actions.push("RELEASE_SLOT");
  if (
    order.terminalMismatch ||
    order.paymentState === "BLOCKED" ||
    order.paymentState === "FAILED" ||
    (order.collapseProbability >= 75 && waitlistAvailability === 0)
  ) {
    actions.push("OWNER_REVIEW");
  }

  if (actions.length === 0) actions.push("SEND_REMINDER");

  const recoveryLikelihood = getForecast(order, waitlistAvailability)?.recoverySuccessLikelihood ?? getRecoveryLikelihood(order);
  const confidence = clampConfidence(
    order.collapseProbability * 0.35 +
      (100 - order.reliabilityScore) * 0.2 +
      recoveryLikelihood * 0.35 +
      (waitlistAvailability > 0 ? 10 : -8)
  );
  const urgency: NonNullable<BrainInsight["recoveryRecommendation"]>["urgency"] =
    order.collapseProbability >= 88 || order.ghostPingUrgency === "CRITICAL"
      ? "CRITICAL"
      : order.collapseProbability >= 70 || order.ghostPingUrgency === "HIGH"
        ? "HIGH"
        : order.collapseProbability >= 45 || paymentDelay >= 20
          ? "MEDIUM"
          : "LOW";
  const automationSafetyLevel: NonNullable<BrainInsight["recoveryRecommendation"]>["automationSafetyLevel"] =
    actions.includes("OWNER_REVIEW")
      ? "OWNER_REVIEW_REQUIRED"
      : order.paymentState === "FAILED" || order.paymentState === "BLOCKED"
        ? "BLOCKED"
        : confidence >= 78 && recoveryLikelihood >= 55
          ? "SAFE_TO_AUTOMATE"
          : "GUARDED_AUTOMATION";
  const state = getRecoveryState(getOrderAuditRows(order, auditRows));

  return {
    actions: Array.from(new Set(actions)),
    confidence,
    estimatedRecoverableRevenue: Number(order.amount ?? 0),
    urgency,
    automationSafetyLevel,
    expectedRecoveryLikelihood: recoveryLikelihood,
    ...state,
    riskPrevented: state.succeeded || state.attempted ? Number(order.amount ?? 0) : 0,
  };
}

function buildRecoveryRecommendationInsights(
  orders: BrainOrder[],
  auditRows: Record<string, any>[],
  waitlistAvailability: number,
  systemPressure: NonNullable<BrainInsight["systemPressure"]>
) {
  return orders
    .map((order) => {
      const recovery = buildRecoveryRecommendation(order, waitlistAvailability, auditRows);
      if (!recovery) return null;

      const severity: BrainSeverity =
        recovery.urgency === "CRITICAL"
          ? "CRITICAL"
          : recovery.urgency === "HIGH"
            ? "WARNING"
            : "WATCH";

      return enrichInsight({
        id: `recovery-recommendation-${order.id}`,
        title: "Autonomous recovery path recommended",
        summary: `${order.id} has endangered revenue with ${recovery.expectedRecoveryLikelihood}% expected recovery likelihood.`,
        severity,
        category: "RECOVERY",
        orderId: order.id,
        customerName: order.customerName,
        confidence: recovery.confidence,
        recommendedAction: recovery.actions.map((action) => action.replaceAll("_", " ")).join(" -> "),
        reasoning: [
          `Collapse probability is ${order.collapseProbability}%.`,
          `Payment delay is ${getPaymentDelayMinutes(order)} minutes.`,
          `Ghost Ping urgency is ${order.ghostPingUrgency}.`,
          `Waitlist availability is ${waitlistAvailability}.`,
          `Automation safety is ${recovery.automationSafetyLevel}.`,
        ],
        createdAt: new Date().toISOString(),
      }, {
        order,
        waitlistAvailability,
        systemPressure,
        recoveryRecommendation: recovery,
        riskPrevented: recovery.riskPrevented,
        humanReviewBypassedSafely: recovery.humanInterventionAvoided,
        transition: {
          label: "Recovery state",
          from: "MONITORING",
          to: recovery.state,
          direction: recovery.succeeded ? "RESTORED" : recovery.attempted ? "UP" : "UNCHANGED",
        },
        whyThisMatters:
          recovery.state === "RECOVERY_SUCCEEDED"
            ? `Valsentra recovered or protected RM ${recovery.estimatedRecoverableRevenue} through the recovery path.`
            : `If recovery is delayed, RM ${recovery.estimatedRecoverableRevenue} may become harder to recover before service time.`,
      });
    })
    .filter((insight): insight is BrainInsight => Boolean(insight))
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 8);
}

function buildOperationalMemoryInsights({
  memory,
  systemPressure,
}: {
  memory: ReturnType<typeof createOperationalMemorySnapshot>;
  systemPressure: NonNullable<BrainInsight["systemPressure"]>;
}) {
  const memorySummary = {
    memoryConfidence: memory.memoryConfidence,
    customerPatternCount: memory.customerProfiles.filter(
      (profile) => profile.noShowCount > 0 || profile.paymentDelayCount > 0 || profile.recoveryFailureCount > 0
    ).length,
    learningSignalCount: memory.learningSignals.length,
    adaptiveRecommendations: memory.adaptiveRecommendations,
  };
  const insights: BrainInsight[] = [];

  if (memory.patterns.length > 0 || memory.learningSignals.length > 0) {
    insights.push(enrichInsight({
      id: "operational-memory-overview",
      title: "Operational memory is influencing recommendations",
      summary: `${memory.learningSignals.length} learning signals and ${memory.patterns.length} behavior patterns are shaping future automation confidence.`,
      severity: memory.patterns.some((pattern) => pattern.severity === "CRITICAL" || pattern.severity === "WARNING")
        ? "WARNING"
        : "WATCH",
      category: "LEARNING",
      confidence: memory.memoryConfidence,
      recommendedAction:
        memory.adaptiveRecommendations[0] ?? "Continue learning from operational outcomes.",
      reasoning: [
        `${memory.customerProfiles.length} customer memory profile${memory.customerProfiles.length === 1 ? "" : "s"} tracked.`,
        `${memory.learningSignals.length} learning signal${memory.learningSignals.length === 1 ? "" : "s"} aggregated from audit history.`,
        `${memory.patterns.length} operational behavior pattern${memory.patterns.length === 1 ? "" : "s"} detected.`,
      ],
      createdAt: new Date().toISOString(),
    }, {
      scope: "SYSTEM",
      systemPressure,
      operationalMemory: memorySummary,
      adaptiveExplanation:
        "Valsentra adjusts recovery timing, deposit strictness, and automation confidence using previous operational outcomes.",
      whyThisMatters:
        "Operational memory lets Valsentra improve future recovery and prediction quality without replacing current workflows.",
    }));
  }

  for (const pattern of memory.patterns.slice(0, 8)) {
    insights.push(enrichInsight({
      id: `memory-pattern-${pattern.id}`,
      title: pattern.title,
      summary: pattern.summary,
      severity: pattern.severity === "CRITICAL" ? "CRITICAL" : pattern.severity === "WARNING" ? "WARNING" : pattern.severity === "WATCH" ? "WATCH" : "INFO",
      category: pattern.type === "FRAUD_RISK_SPIKE" ? "FRAUD_CONTAINMENT" : pattern.type === "RECOVERY_DECAY" ? "RECOVERY" : "LEARNING",
      confidence: pattern.confidence,
      recommendedAction: pattern.adaptiveRecommendation,
      reasoning: pattern.signals,
      createdAt: new Date().toISOString(),
    }, {
      scope: "SYSTEM",
      systemPressure,
      operationalMemory: memorySummary,
      memoryPattern: pattern,
      adaptiveExplanation: pattern.adaptiveRecommendation,
      cluster: pattern.affectedOrderIds.length > 0
        ? {
            label: pattern.type.replaceAll("_", " "),
            orders: pattern.affectedOrderIds,
            heat: pattern.severity === "CRITICAL" ? "CRITICAL" : pattern.severity === "WARNING" ? "ELEVATED" : "WATCH",
          }
        : undefined,
      whyThisMatters:
        "This pattern changes how early Valsentra should intervene and how much confidence it should place in automation.",
    }));
  }

  if (memory.actionProfiles.length > 0) {
    const weakestAction = [...memory.actionProfiles].sort(
      (a, b) => a.confidenceAdjustment - b.confidenceAdjustment
    )[0];
    const strongestAction = [...memory.actionProfiles].sort(
      (a, b) => b.confidenceAdjustment - a.confidenceAdjustment
    )[0];

    if (weakestAction && weakestAction.confidenceAdjustment <= -6) {
      insights.push(enrichInsight({
        id: `memory-action-weak-${weakestAction.action}`,
        title: "Automation confidence decreased from outcome memory",
        summary: `${weakestAction.action} is underperforming against recent operational outcomes.`,
        severity: "WATCH",
        category: "LEARNING",
        confidence: clampConfidence(70 + Math.abs(weakestAction.confidenceAdjustment)),
        recommendedAction: weakestAction.recommendation,
        reasoning: [
          `Historical success rate: ${weakestAction.successRate}%.`,
          `False-positive rate: ${weakestAction.falsePositiveRate}%.`,
          `Confidence adjustment: ${weakestAction.confidenceAdjustment}.`,
          ...weakestAction.evidence.slice(0, 2),
        ],
        createdAt: new Date().toISOString(),
      }, {
        scope: "SYSTEM",
        systemPressure,
        operationalMemory: memorySummary,
        adaptiveExplanation:
          "Rolling outcome memory reduced automation confidence because recent interventions did not convert cleanly.",
      }));
    }

    if (strongestAction && strongestAction.confidenceAdjustment >= 6) {
      insights.push(enrichInsight({
        id: `memory-action-strong-${strongestAction.action}`,
        title: "Automation confidence improved from outcome memory",
        summary: `${strongestAction.action} is gaining confidence based on historical outcomes.`,
        severity: "INFO",
        category: "LEARNING",
        confidence: clampConfidence(68 + strongestAction.confidenceAdjustment),
        recommendedAction: strongestAction.recommendation,
        reasoning: [
          `Historical success rate: ${strongestAction.successRate}%.`,
          `Average protected revenue: RM ${strongestAction.averageRevenueProtected}.`,
          `Confidence adjustment: +${strongestAction.confidenceAdjustment}.`,
        ],
        createdAt: new Date().toISOString(),
      }, {
        scope: "SYSTEM",
        systemPressure,
        operationalMemory: memorySummary,
        adaptiveExplanation:
          "Rolling outcome memory increased automation confidence because similar actions protected revenue reliably.",
      }));
    }
  }

  const degradingBranches = memory.branchProfiles.filter((branch) => branch.trend === "DEGRADING");
  if (degradingBranches.length > 0) {
    insights.push(enrichInsight({
      id: "memory-branch-learning-drift",
      title: "Branch learning drift detected",
      summary: `${degradingBranches.length} branch${degradingBranches.length === 1 ? "" : "es"} show declining operational learning quality.`,
      severity: "WARNING",
      category: "LEARNING",
      confidence: clampConfidence(72 + degradingBranches.length * 5),
      recommendedAction: "Downgrade branch automation confidence and review recovery timing.",
      reasoning: degradingBranches.slice(0, 4).map((branch) =>
        `${branch.locationName}: volatility ${branch.operationalVolatility}/100, confidence adjustment ${branch.confidenceAdjustment}.`
      ),
      createdAt: new Date().toISOString(),
    }, {
      scope: "SYSTEM",
      systemPressure,
      operationalMemory: memorySummary,
      adaptiveExplanation: memory.organizationLearning.explanation,
    }));
  }

  return insights;
}

function buildSimulationInsights({
  orders,
  memory,
  waitlistAvailability,
  digitalTwin,
}: {
  orders: ReturnType<typeof mapAndEnrichOrderFromDb>[];
  memory: ReturnType<typeof createOperationalMemorySnapshot>;
  waitlistAvailability: number;
  digitalTwin?: ReturnType<typeof buildOperationalDigitalTwin>;
}): BrainInsight[] {
  const endangered = orders
    .filter((order) =>
      order.status !== "PAID" &&
      order.status !== "CANCELLED" &&
      order.status !== "NO_SHOW" &&
      (Number(order.collapseProbability ?? 0) >= 60 ||
        order.ghostPingUrgency === "HIGH" ||
        order.ghostPingUrgency === "CRITICAL" ||
        order.terminalMismatch)
    )
    .slice(0, 4);

  return endangered.map((order) => {
    const learningContext = getAdaptiveDecisionContext({
      snapshot: memory,
      action: "OFFER_WAITLIST",
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
    const best = simulation.bestProjectedAction;
    const unsafe =
      best.reversibility === "IRREVERSIBLE" &&
      best.simulationConfidence < policy.confidenceThresholds.irreversible;

    return enrichInsight({
      id: `simulation-${order.id}`,
      title: "Projected operational futures evaluated",
      summary: `${order.id} simulation favors ${best.action} with RM ${best.projectedRevenueProtection} projected protection and RM ${best.projectedExposure} projected exposure.`,
      severity: unsafe ? "WARNING" : best.operationalPressureImpact >= 65 ? "WATCH" : "INFO",
      category: "AUTOPILOT",
      orderId: order.id,
      customerName: order.customerName,
      organizationId: order.organizationId,
      locationId: order.locationId,
      locationName: order.locationName,
      confidence: simulation.confidence,
      recommendedAction: unsafe
        ? "Keep irreversible action behind owner review until simulation confidence improves."
        : `Prefer ${best.action} based on simulated recovery, exposure, and trust risk.`,
      reasoning: [
        `Best projected action: ${simulation.bestProjectedAction.action} (${simulation.bestProjectedAction.score}/100).`,
        `Safest action: ${simulation.safestProjectedAction.action}.`,
        `Highest recovery action: ${simulation.highestRecoveryAction.action}.`,
        `Lowest trust-risk action: ${simulation.lowestTrustRiskAction.action}.`,
        ...best.explanation.slice(0, 2),
        ...simulation.recommendedPolicyAdjustments.slice(0, 2),
      ],
      createdAt: new Date().toISOString(),
    }, {
      order: {
        ...order,
        organizationId: order.organizationId ?? "org-valsentra",
        locationId: order.locationId ?? "loc-primary",
        locationName: order.locationName ?? "Primary Location",
        status: order.status,
        paymentState: order.paymentState ?? "UNPAID",
        paymentVerified: Boolean(order.paymentVerified),
        riskLevel: order.riskLevel ?? "LOW",
        reservationTime: order.reservationTime || null,
        slotHoldExpiresAt: order.slotHoldExpiresAt ?? null,
        lastReminderSentAt: order.lastReminderSentAt ?? null,
        awaitingDetails: Boolean(order.awaitingDetails),
        createdAt: order.createdAt ?? new Date().toISOString(),
        collapseProbability: order.collapseProbability ?? 0,
        collapseRiskTier: order.collapseRiskTier ?? "STABLE",
        recommendedIntervention: order.recommendedIntervention ?? "MONITOR",
        instabilityFactors: order.instabilityFactors ?? [],
        collapseExplanation: order.collapseExplanation ?? "",
        ghostPingShouldSend: Boolean(order.ghostPingShouldSend),
        ghostPingUrgency: order.ghostPingUrgency ?? "LOW",
        ghostPingReasoning: order.ghostPingReasoning ?? "",
      },
      riskPrevented: best.projectedRevenueProtection,
      whyThisMatters:
        "Simulation lets Valsentra reject unsafe futures before execution and choose the path with the best risk-adjusted outcome.",
      adaptiveExplanation: simulation.memoryInfluence.join(" "),
    });
  });
}

function buildCommunicationInsights({
  orders,
  auditRows,
  memory,
  digitalTwin,
  waitlistAvailability,
}: {
  orders: ReturnType<typeof mapAndEnrichOrderFromDb>[];
  auditRows: Record<string, any>[];
  memory: ReturnType<typeof createOperationalMemorySnapshot>;
  digitalTwin: ReturnType<typeof buildOperationalDigitalTwin>;
  waitlistAvailability: number;
}): BrainInsight[] {
  const climate = buildCommunicationClimate({
    orders,
    auditRows,
    memory,
    digitalTwin,
  });
  const active = orders.filter((order) =>
    order.status !== "PAID" &&
    order.status !== "CANCELLED" &&
    order.status !== "NO_SHOW" &&
    order.paymentState !== "VERIFIED"
  );
  const insights: BrainInsight[] = [];

  insights.push(enrichInsight({
    id: "communication-climate",
    title: "Recovery communication climate",
    summary: `${climate.activeRecoveryFlows} active recovery flow${climate.activeRecoveryFlows === 1 ? "" : "s"} with ${climate.communicationFatigue}/100 fatigue and ${climate.escalationEffectiveness}/100 escalation effectiveness.`,
    severity:
      climate.communicationFatigue >= 75
        ? "WARNING"
        : climate.communicationPressure >= 65
          ? "WATCH"
          : "INFO",
    category: "RECOVERY",
    confidence: clampConfidence(70 + climate.escalationEffectiveness * 0.2),
    recommendedAction:
      climate.communicationFatigue >= 75
        ? "Slow external outreach and route sensitive cases to internal review."
        : "Continue provider-ready orchestration without increasing message pressure.",
    reasoning: [
      `Communication pressure: ${climate.communicationPressure}/100.`,
      `Recovery communication load: ${climate.recoveryCommunicationLoad}/100.`,
      `Customer responsiveness climate: ${climate.customerResponsivenessClimate}/100.`,
      ...climate.trustWarnings,
      memory.communicationLearning.explanation,
    ],
    createdAt: new Date().toISOString(),
  }, {
    scope: "SYSTEM",
    operationalMemory: {
      memoryConfidence: memory.memoryConfidence,
      customerPatternCount: memory.customerProfiles.length,
      learningSignalCount: memory.learningSignals.length,
      adaptiveRecommendations: [
        "Use communication fatigue and response climate before escalating outreach.",
      ],
    },
    adaptiveExplanation:
      "Communication orchestration uses recovery outcomes, fatigue, digital twin pressure, and policy posture before preparing outreach.",
  }));

  for (const order of active.slice(0, 3)) {
    const orderAuditRows = auditRows.filter((row) => String(row.order_id ?? row.orderId ?? "") === order.id);
    const learningContext = getAdaptiveDecisionContext({
      snapshot: memory,
      action: "SEND_REMINDER",
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
    const orchestration = orchestrateRecoveryCommunication({
      order,
      auditRows: orderAuditRows,
      memory,
      digitalTwin,
      policy,
      waitlistAvailability,
    });

    insights.push(enrichInsight({
      id: `communication-flow-${order.id}`,
      title: orchestration.suppressed
        ? "Recovery outreach suppressed by trust protection"
        : "Active recovery flow prepared",
      summary: `${order.id}: ${orchestration.step.replaceAll("_", " ").toLowerCase()} via ${orchestration.channel} with ${orchestration.recoveryConfidence}% recovery confidence.`,
      severity: orchestration.suppressed ? "WATCH" : orchestration.trustRisk >= 70 ? "WARNING" : "INFO",
      category: "RECOVERY",
      orderId: order.id,
      customerName: order.customerName,
      organizationId: order.organizationId,
      locationId: order.locationId,
      locationName: order.locationName,
      confidence: orchestration.recoveryConfidence,
      recommendedAction: orchestration.suppressed
        ? "Respect suppression reason before escalating."
        : "Message is provider-ready; enable provider integration when approved.",
      reasoning: [
        `Channel: ${orchestration.channel}.`,
        `Attempt count: ${orchestration.attemptCount}.`,
        `Trust risk: ${orchestration.trustRisk}/100.`,
        `Communication fatigue: ${orchestration.communicationFatigue}/100.`,
        ...orchestration.explainability.slice(0, 4),
      ],
      createdAt: new Date().toISOString(),
    }, {
      order: {
        ...order,
        organizationId: order.organizationId ?? "org-valsentra",
        locationId: order.locationId ?? "loc-primary",
        locationName: order.locationName ?? "Primary Location",
        status: order.status,
        paymentState: order.paymentState ?? "UNPAID",
        paymentVerified: Boolean(order.paymentVerified),
        riskLevel: order.riskLevel ?? "LOW",
        reservationTime: order.reservationTime || null,
        slotHoldExpiresAt: order.slotHoldExpiresAt ?? null,
        lastReminderSentAt: order.lastReminderSentAt ?? null,
        awaitingDetails: Boolean(order.awaitingDetails),
        createdAt: order.createdAt ?? new Date().toISOString(),
        collapseProbability: order.collapseProbability ?? 0,
        collapseRiskTier: order.collapseRiskTier ?? "STABLE",
        recommendedIntervention: order.recommendedIntervention ?? "MONITOR",
        instabilityFactors: order.instabilityFactors ?? [],
        collapseExplanation: order.collapseExplanation ?? "",
        ghostPingShouldSend: Boolean(order.ghostPingShouldSend),
        ghostPingUrgency: order.ghostPingUrgency ?? "LOW",
        ghostPingReasoning: order.ghostPingReasoning ?? "",
      },
      riskPrevented: Math.round(Number(order.amount ?? 0) * orchestration.recoveryConfidence / 100),
      adaptiveExplanation:
        "Recovery communication is sequenced from payment state, customer reliability, branch pressure, fatigue, and trust safeguards.",
    }));
  }

  return insights;
}

function buildDigitalTwinInsights(
  twin: ReturnType<typeof buildOperationalDigitalTwin>
): BrainInsight[] {
  const org = twin.organization;
  const topRisk = twin.instabilityRanking[0];
  const insights: BrainInsight[] = [
    enrichInsight({
      id: "digital-twin-live-state",
      title: `Live business state: ${org.state.replaceAll("_", " ").toLowerCase()}`,
      summary: `${org.name} is projected to move toward ${org.projectedNextState.replaceAll("_", " ").toLowerCase()} with ${twin.predictedEvolution.projectedInstability}/100 projected instability.`,
      severity:
        org.state === "OVERLOADED" || org.state === "FRAUD_ELEVATED" || org.state === "COLLAPSE_RISK"
          ? "WARNING"
          : org.state === "PRESSURED" || org.state === "DEGRADED"
            ? "WATCH"
            : "INFO",
      category: "ORGANIZATION",
      organizationId: org.id,
      confidence: org.transitionConfidence,
      recommendedAction:
        org.state === "OVERLOADED"
          ? "Reduce automation saturation and prioritize human review queues."
          : org.state === "FRAUD_ELEVATED"
            ? "Tighten fraud sensitivity and release tolerance."
            : org.state === "RECOVERING"
              ? "Keep reversible recovery paths active while pressure falls."
              : "Continue monitoring operational climate.",
      reasoning: [
        org.explainability.whyThisState,
        `Projected next state: ${org.projectedNextState}.`,
        `Trust climate: ${org.climate.trustClimate}/100.`,
        `Operational stress: ${org.climate.operationalStress}/100.`,
        ...org.explainability.memoryInfluence.slice(0, 2),
      ],
      createdAt: twin.generatedAt,
    }, {
      scope: "SYSTEM",
      systemNarrative: org.explainability.projectedRisk,
      adaptiveExplanation: org.explainability.policyInfluence.join(" "),
      whyThisMatters:
        "The digital twin models the business as a living operational system, so Valsentra can adjust policy before isolated events become systemic drift.",
    }),
  ];

  if (topRisk && topRisk.score >= 55) {
    insights.push(enrichInsight({
      id: `digital-twin-instability-${topRisk.id}`,
      title: "Operational drift warning",
      summary: `${topRisk.name} leads the instability ranking at ${topRisk.score}/100 in ${topRisk.state.toLowerCase().replaceAll("_", " ")} state.`,
      severity: topRisk.score >= 75 ? "WARNING" : "WATCH",
      category: "ORGANIZATION",
      confidence: topRisk.score,
      recommendedAction: "Use branch state, fatigue, and saturation signals before increasing automation aggressiveness.",
      reasoning: [
        `Fraud drift: ${twin.systemicDrift.fraudDrift}/100.`,
        `Human intervention load: ${twin.systemicDrift.humanInterventionLoad}/100.`,
        `Collapse clustering: ${twin.systemicDrift.collapseClustering}/100.`,
        `Automation dependence: ${twin.systemicDrift.automationDependence}/100.`,
      ],
      createdAt: twin.generatedAt,
    }, {
      scope: "SYSTEM",
      adaptiveExplanation:
        "Digital twin drift detection raises caution when branch fatigue, collapse clustering, or automation dependence begins concentrating.",
    }));
  }

  return insights;
}

function classifyLiveEvent(row: Record<string, any>): LiveOperationalEvent["type"] {
  const action = String(row.action ?? "").toLowerCase();
  const meta = row.meta ?? {};

  if (action.includes("verified") || action.includes("payment")) return "PAYMENT_VERIFICATION";
  if (action.includes("ghost") || meta.ghostPingUrgency) return "GHOST_PING_ESCALATION";
  if (action.includes("waitlist cascade") || action.includes("waitlist recovery")) return "WAITLIST_REPLACEMENT";
  if (action.includes("recovery")) return "RECOVERY_ATTEMPT";
  if (action.includes("fraud") || action.includes("blocked") || action.includes("terminal")) return "FRAUD_RISK_SPIKE";
  if (action.includes("autopilot") || action.includes("auto release")) return "AUTOMATION_DECISION";
  if (meta.learningEntry?.eventType === "WAITLIST_RECOVERY_SUCCEEDED" || action.includes("recovered")) {
    return "AUTONOMOUS_RECOVERY";
  }
  if (meta.learningEntry || action.includes("reliability")) return "RELIABILITY_CHANGE";
  if (meta.collapseProbability !== undefined) return "COLLAPSE_CHANGE";
  return "PRESSURE_CHANGE";
}

function getLiveEventSeverity(row: Record<string, any>): BrainSeverity {
  const action = String(row.action ?? "").toLowerCase();
  const meta = row.meta ?? {};
  const collapse = Number(meta.collapseProbability ?? 0);

  if (
    action.includes("failed") ||
    action.includes("blocked") ||
    action.includes("fraud") ||
    meta.ghostPingUrgency === "CRITICAL" ||
    collapse >= 85
  ) {
    return "CRITICAL";
  }
  if (
    action.includes("release") ||
    action.includes("human review") ||
    action.includes("suggested") ||
    meta.ghostPingUrgency === "HIGH" ||
    collapse >= 60
  ) {
    return "WARNING";
  }
  if (collapse >= 35 || action.includes("reminder") || action.includes("ghost")) {
    return "WATCH";
  }
  return "INFO";
}

function buildLiveOperationalEvents(
  orders: BrainOrder[],
  auditRows: Record<string, any>[],
  systemPressure: NonNullable<BrainInsight["systemPressure"]>
): LiveOperationalEvent[] {
  const orderById = new Map(orders.map((order) => [order.id, order]));
  const auditEvents = auditRows.slice(0, 24).map((row, index): LiveOperationalEvent => {
    const meta = row.meta ?? {};
    const orderId = row.order_id ? String(row.order_id) : undefined;
    const order = orderId ? orderById.get(orderId) : undefined;
    const type = classifyLiveEvent(row);
    const severity = getLiveEventSeverity(row);
    const collapse = meta.collapseProbability ?? order?.collapseProbability;
    const recovered = String(row.action ?? "").toLowerCase().includes("recovered") || String(row.action ?? "").toLowerCase().includes("succeeded");

    return {
      id: `live-audit-${row.id ?? index}`,
      type,
      title:
        type === "PAYMENT_VERIFICATION"
          ? "Payment truth changed"
          : type === "GHOST_PING_ESCALATION"
            ? "Ghost Ping escalation updated"
            : type === "WAITLIST_REPLACEMENT"
              ? "Waitlist replacement activity"
              : type === "FRAUD_RISK_SPIKE"
                ? "Fraud or risk containment event"
                : type === "AUTOMATION_DECISION"
                  ? "Automation decision recorded"
                  : type === "AUTONOMOUS_RECOVERY"
                    ? "Autonomous recovery event"
                    : type === "RELIABILITY_CHANGE"
                      ? "Reliability memory changed"
                      : type === "COLLAPSE_CHANGE"
                        ? "Collapse probability changed"
                        : "Operational pressure changed",
      summary: String(row.action ?? "Operational event"),
      orderId,
      severity,
      previousState: meta.previousState ?? (collapse !== undefined ? `Collapse ${collapse}%` : "Observed"),
      nextLikelyState: recovered
        ? "Revenue protected"
        : meta.requiresHumanAction
          ? "Owner review"
          : order?.recommendedIntervention
            ? String(order.recommendedIntervention).replaceAll("_", " ")
            : "Continue monitoring",
      preventedOutcome: recovered
        ? "Revenue loss avoided"
        : severity === "CRITICAL"
          ? "Uncontained exposure"
          : "Operational drift",
      operationalImpact:
        meta.recoverableRevenue || meta.orderAmount
          ? `RM ${Number(meta.recoverableRevenue ?? meta.orderAmount).toLocaleString("en-MY")} impact tracked`
          : systemPressure.level === "CRITICAL"
            ? "Contributes to critical system pressure"
            : "Contributes to live operating state",
      createdAt: String(row.created_at ?? new Date().toISOString()),
      chainId: orderId ? `chain-${orderId}` : "chain-system",
    };
  });

  const activeEscalationEvents = orders
    .filter((order) => isActiveOrder(order) && (order.collapseProbability >= 70 || order.ghostPingUrgency === "HIGH" || order.ghostPingUrgency === "CRITICAL"))
    .slice(0, 8)
    .map((order): LiveOperationalEvent => ({
      id: `live-order-${order.id}`,
      type: "COLLAPSE_CHANGE",
      title: "Collapse escalation active",
      summary: `${order.id} is being watched at ${order.collapseProbability}% collapse probability.`,
      orderId: order.id,
      severity: order.collapseProbability >= 85 ? "CRITICAL" : "WARNING",
      previousState: "Active order",
      nextLikelyState: order.recommendedIntervention.replaceAll("_", " "),
      preventedOutcome: "Unrecoverable slot collapse",
      operationalImpact: `RM ${Number(order.amount ?? 0).toLocaleString("en-MY")} exposed revenue under watch`,
      createdAt: new Date().toISOString(),
      chainId: `chain-${order.id}`,
    }));

  return [...activeEscalationEvents, ...auditEvents]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 24);
}

function calculateOperationalPulse({
  orders,
  auditRows,
  systemPressure,
  revenueStability,
}: {
  orders: BrainOrder[];
  auditRows: Record<string, any>[];
  systemPressure: NonNullable<BrainInsight["systemPressure"]>;
  revenueStability: NonNullable<BrainInsight["revenueStability"]>;
}): NonNullable<BrainInsight["operationalPulse"]> {
  const active = orders.filter(isActiveOrder);
  const collapseVelocity = active.filter((order) => order.collapseProbability >= 70).length;
  const recoverySuccesses = getRecentAuditCount(auditRows, (row) => {
    const action = String(row.action ?? "").toLowerCase();
    return action.includes("recovered") || action.includes("waitlist recovery succeeded");
  });
  const recoveryFailures = getRecentAuditCount(auditRows, (row) =>
    String(row.action ?? "").toLowerCase().includes("waitlist recovery failed")
  );
  const recoveryMomentum = clampConfidence(50 + recoverySuccesses * 12 - recoveryFailures * 14);
  const automationLoad = getRecentAuditCount(auditRows, (row) => {
    const action = String(row.action ?? "").toLowerCase();
    return action.includes("autopilot") || action.includes("auto release") || action.includes("suggested");
  });
  const interventionFrequency = getRecentAuditCount(auditRows, (row) => {
    const action = String(row.action ?? "").toLowerCase();
    return action.includes("reminder") || action.includes("ghost") || action.includes("review") || action.includes("release");
  });
  const autonomousActionCount = automationLoad + recoverySuccesses;
  const collapseEscalationCount = active.filter((order) => order.collapseProbability >= 60).length;
  const stability: NonNullable<BrainInsight["operationalPulse"]>["stability"] =
    systemPressure.level === "CRITICAL"
      ? "STRAINED"
      : systemPressure.level === "ELEVATED"
        ? "ACTIVE"
        : systemPressure.level === "WATCH"
          ? "WATCHING"
          : "STABLE";

  return {
    pressure: systemPressure.score,
    collapseVelocity,
    recoveryMomentum,
    automationLoad,
    interventionFrequency,
    stability,
    protectedRevenue: revenueStability.projectedProtectedRevenue,
    exposureGrowth: revenueStability.projectedExposedRevenue,
    autonomousActionCount,
    collapseEscalationCount,
  };
}

function severityRank(severity: BrainSeverity) {
  if (severity === "CRITICAL") return 4;
  if (severity === "WARNING") return 3;
  if (severity === "WATCH") return 2;
  return 1;
}

export function buildOperationalBrainInsights({
  ordersRaw,
  auditRaw,
  waitlistRaw,
}: {
  ordersRaw: Array<Record<string, any>>;
  auditRaw: Array<Record<string, any>>;
  waitlistRaw: Array<Record<string, any>>;
}) {
  const canonicalOrders = (ordersRaw ?? []).map(mapAndEnrichOrderFromDb);
  const orders = (ordersRaw ?? []).map(mapOrderFromDb);
  const organizationSnapshot = buildMultiLocationIntelligenceSnapshot({
    orders: canonicalOrders,
    auditRows: auditRaw ?? [],
  });
  const memory = createOperationalMemorySnapshot({
    orders,
    auditRows: auditRaw ?? [],
  });
  const digitalTwin = buildOperationalDigitalTwin({
    orders: canonicalOrders,
    auditRows: auditRaw ?? [],
    memory,
    organization: organizationSnapshot,
    waitlistCount: waitlistRaw?.length ?? 0,
  });
  const waitlistAvailability = waitlistRaw?.length ?? 0;
  const systemPressure = calculateSystemPressure(
    orders,
    auditRaw ?? [],
    waitlistAvailability
  );
  const loadDistribution = calculateLoadDistribution(
    orders,
    auditRaw ?? [],
    waitlistAvailability
  );
  const revenueStability = calculateRevenueStability(
    orders,
    waitlistAvailability
  );
  const operationalZone = calculateOperationalZone(
    systemPressure,
    loadDistribution,
    revenueStability
  );
  const liveEvents = buildLiveOperationalEvents(
    orders,
    auditRaw ?? [],
    systemPressure
  );
  const operationalPulse = calculateOperationalPulse({
    orders,
    auditRows: auditRaw ?? [],
    systemPressure,
    revenueStability,
  });
  const orderById = new Map(orders.map((order) => [order.id, order]));

  const orderInsights = orders.flatMap((order) =>
    buildOrderInsights(order, waitlistAvailability)
  );
  const transitionInsights = orders.flatMap((order) =>
    buildTransitionInsights(order, auditRaw ?? [], waitlistAvailability)
  );
  const auditInsights = (auditRaw ?? [])
    .map((row) => buildAuditInsight(row, orderById))
    .filter((insight): insight is BrainInsight => Boolean(insight));
  const driftInsights = buildDriftInsights(
    orders,
    auditRaw ?? [],
    systemPressure
  );
  const pressureInsight = buildPressureInsight(systemPressure);
  const recoveryRecommendationInsights = buildRecoveryRecommendationInsights(
    orders,
    auditRaw ?? [],
    waitlistAvailability,
    systemPressure
  );
  const memoryInsights = buildOperationalMemoryInsights({
    memory,
    systemPressure,
  });
  const systemOverviewInsight = buildSystemOverviewInsight({
    systemPressure,
    loadDistribution,
    revenueStability,
    operationalZone,
    liveEvents,
    operationalPulse,
  });
  const crossOrderInsights = buildCrossOrderPatternInsights({
    orders,
    auditRows: auditRaw ?? [],
    waitlistAvailability,
    systemPressure,
    loadDistribution,
    revenueStability,
    operationalZone,
  });
  const organizationInsights = buildOrganizationInsights(organizationSnapshot);
  const simulationInsights = buildSimulationInsights({
    orders: canonicalOrders,
    memory,
    waitlistAvailability,
    digitalTwin,
  });
  const digitalTwinInsights = buildDigitalTwinInsights(digitalTwin);
  const communicationInsights = buildCommunicationInsights({
    orders: canonicalOrders,
    auditRows: auditRaw ?? [],
    memory,
    digitalTwin,
    waitlistAvailability,
  });

  const insights = [
    systemOverviewInsight,
    ...digitalTwinInsights,
    ...communicationInsights,
    ...organizationInsights,
    ...simulationInsights,
    ...(pressureInsight ? [pressureInsight] : []),
    ...memoryInsights,
    ...crossOrderInsights,
    ...recoveryRecommendationInsights,
    ...driftInsights,
    ...orderInsights,
    ...transitionInsights,
    ...auditInsights,
  ]
    .sort((a, b) => {
      const severityDelta = severityRank(b.severity) - severityRank(a.severity);
      if (severityDelta !== 0) return severityDelta;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    })
    .slice(0, 24);

  return insights;
}
