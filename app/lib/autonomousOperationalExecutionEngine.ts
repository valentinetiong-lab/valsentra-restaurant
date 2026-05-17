import { supabaseAdmin } from "@/app/lib/admin";
import {
  buildLiveServiceCoordinationSnapshot,
  getRecoveryCooldownMultiplier,
  shouldReduceRecoveryEscalation,
  shouldThrottleNonCriticalReminder,
  type LiveCoordinationState,
  type LiveServiceCoordinationSnapshot,
} from "@/app/lib/liveServiceCoordinationEngine";
import {
  buildIdempotencyKey,
  checkIdempotencyKey,
} from "@/app/lib/infrastructure/idempotencyLayer";
import {
  appendOperationalTimelineEvent,
  type OperationalTimelineEventType,
} from "@/app/lib/operationalTimelineMemoryEngine";
import { publishOperationalCommand } from "@/app/lib/operationalCommandBus";
import { buildOperationalPartition } from "@/app/lib/operationalPartitionEngine";

export type AutonomousOperationalExecutionState =
  | "EXECUTION_IDLE"
  | "EXECUTION_STABILIZING"
  | "EXECUTION_THROTTLING"
  | "EXECUTION_SUPPRESSING"
  | "EXECUTION_RECOVERY_MODE"
  | "EXECUTION_RUSH_LOCK"
  | "EXECUTION_COOLDOWN";

export type SafeOperationalActionType =
  | "PAUSE_NON_CRITICAL_REMINDERS"
  | "SLOW_WAITLIST_ESCALATION"
  | "STAGGER_RECOVERY_OFFERS"
  | "SUPPRESS_DUPLICATE_REMINDER_BURSTS"
  | "DELAY_NON_CRITICAL_NOTIFICATIONS"
  | "REDUCE_NOISY_DIAGNOSTICS"
  | "PRIORITIZE_PAYMENT_REVIEW_CARDS"
  | "PRIORITIZE_ARRIVAL_VISIBILITY"
  | "INCREASE_RECOVERY_COOLDOWN_WINDOWS"
  | "ACTIVATE_RUSH_LOCK"
  | "DEACTIVATE_RUSH_LOCK";

export type SafeOperationalAction = {
  actionType: SafeOperationalActionType;
  label: string;
  reason: string;
  reversible: true;
  expiresAt: string;
  cooldownMinutes: number;
  priority: "LOW" | "NORMAL" | "HIGH" | "CRITICAL";
  executionState: AutonomousOperationalExecutionState;
};

export type AutonomousOperationalExecutionResult = {
  organizationId: string;
  locationId: string | null;
  executionState: AutonomousOperationalExecutionState;
  coordinationState: LiveCoordinationState;
  ownerSummary: string;
  staffGuidance: string[];
  actionsEvaluated: number;
  actionsExecuted: SafeOperationalAction[];
  actionsSkipped: Array<{
    actionType: SafeOperationalActionType;
    reason: string;
  }>;
  activePacingPolicy: {
    suppressNonCriticalReminders: boolean;
    reduceRecoveryEscalation: boolean;
    staggerRecoveryOffers: boolean;
    delayNonCriticalNotifications: boolean;
    suppressNoisyDiagnostics: boolean;
    prioritizePaymentReview: boolean;
    prioritizeArrivalVisibility: boolean;
    recoveryCooldownMultiplier: number;
    rushLockActive: boolean;
    expiresAt: string;
  };
  generatedAt: string;
};

const EXECUTION_TRIGGERS: LiveCoordinationState[] = [
  "ARRIVAL_WAVE",
  "PAYMENT_BOTTLENECK",
  "RECOVERY_SATURATION",
  "FULFILLMENT_DELAY",
  "SERVICE_STRAIN",
  "RUSH_LOCK",
  "STABILIZING",
];

function addMinutes(minutes: number) {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

function bucket(minutes = 15) {
  return String(Math.floor(Date.now() / (minutes * 60_000)));
}

function executionStateFor(coordination: LiveServiceCoordinationSnapshot): AutonomousOperationalExecutionState {
  if (coordination.state === "RUSH_LOCK") return "EXECUTION_RUSH_LOCK";
  if (coordination.throttles.pauseLowPriorityOutbound || coordination.state === "SERVICE_STRAIN") return "EXECUTION_THROTTLING";
  if (coordination.throttles.suppressNonCriticalReminders) return "EXECUTION_SUPPRESSING";
  if (coordination.state === "RECOVERY_SATURATION") return "EXECUTION_RECOVERY_MODE";
  if (coordination.state === "STABILIZING") return "EXECUTION_COOLDOWN";
  if (coordination.state === "NORMAL_FLOW") return "EXECUTION_IDLE";
  return "EXECUTION_STABILIZING";
}

function action(
  actionType: SafeOperationalActionType,
  label: string,
  reason: string,
  executionState: AutonomousOperationalExecutionState,
  priority: SafeOperationalAction["priority"],
  durationMinutes: number,
  cooldownMinutes = durationMinutes
): SafeOperationalAction {
  return {
    actionType,
    label,
    reason,
    reversible: true,
    expiresAt: addMinutes(durationMinutes),
    cooldownMinutes,
    priority,
    executionState,
  };
}

export function evaluateExecutionPolicy(
  coordination: LiveServiceCoordinationSnapshot
): SafeOperationalAction[] {
  if (!EXECUTION_TRIGGERS.includes(coordination.state)) return [];

  const state = executionStateFor(coordination);
  const actions: SafeOperationalAction[] = [];

  if (shouldThrottleNonCriticalReminder(coordination)) {
    actions.push(action(
      "PAUSE_NON_CRITICAL_REMINDERS",
      "Reminder pressure reduced",
      "Live service pressure is high enough that non-critical reminders should pause temporarily.",
      state,
      "HIGH",
      coordination.state === "RUSH_LOCK" ? 20 : 12
    ));
    actions.push(action(
      "SUPPRESS_DUPLICATE_REMINDER_BURSTS",
      "Duplicate reminder bursts suppressed",
      "Valsentra is preventing repeated reminder bursts while staff handle live service pressure.",
      state,
      "HIGH",
      15
    ));
  }

  if (shouldReduceRecoveryEscalation(coordination)) {
    actions.push(action(
      "SLOW_WAITLIST_ESCALATION",
      "Recovery pacing slowed",
      "Waitlist escalation speed is reduced so recovery does not create more live-service noise.",
      state,
      "HIGH",
      18
    ));
    actions.push(action(
      "STAGGER_RECOVERY_OFFERS",
      "Recovery offers staggered",
      "Outbound recovery offers are staggered to prevent customer contact flooding.",
      state,
      "HIGH",
      18
    ));
    actions.push(action(
      "INCREASE_RECOVERY_COOLDOWN_WINDOWS",
      "Recovery cooldown increased",
      `Recovery cooldown multiplier set to ${getRecoveryCooldownMultiplier(coordination)}x while service is pressured.`,
      state,
      "NORMAL",
      20
    ));
  }

  if (coordination.throttles.pauseLowPriorityOutbound) {
    actions.push(action(
      "DELAY_NON_CRITICAL_NOTIFICATIONS",
      "Low-priority notifications delayed",
      "Low-priority outbound notifications are delayed until rush lock clears.",
      state,
      "CRITICAL",
      15
    ));
  }

  if (coordination.throttles.suppressNoisyDiagnostics) {
    actions.push(action(
      "REDUCE_NOISY_DIAGNOSTICS",
      "Operational noise reduced",
      "Advanced diagnostics are de-emphasized so staff can focus on urgent work.",
      state,
      "NORMAL",
      20
    ));
  }

  if (coordination.throttles.prioritizePaymentReview) {
    actions.push(action(
      "PRIORITIZE_PAYMENT_REVIEW_CARDS",
      "Payment review prioritized",
      "Payment review and blocked releases should be shown ahead of lower-priority work.",
      state,
      "CRITICAL",
      15
    ));
  }

  if (coordination.throttles.prioritizeArrivalVisibility) {
    actions.push(action(
      "PRIORITIZE_ARRIVAL_VISIBILITY",
      "Arrival visibility prioritized",
      "Arriving-soon bookings should stay prominent while the service wave is active.",
      state,
      "HIGH",
      15
    ));
  }

  if (coordination.state === "RUSH_LOCK") {
    actions.push(action(
      "ACTIVATE_RUSH_LOCK",
      "Rush stabilization active",
      "Valsentra activated rush lock to protect staff focus during peak service pressure.",
      "EXECUTION_RUSH_LOCK",
      "CRITICAL",
      15
    ));
  }

  if (coordination.state === "STABILIZING") {
    actions.push(action(
      "DEACTIVATE_RUSH_LOCK",
      "Service pressure stabilizing",
      "Rush lock can clear gradually as service pressure returns to a safer level.",
      "EXECUTION_COOLDOWN",
      "NORMAL",
      10
    ));
  }

  return actions;
}

function timelineEventForAction(actionType: SafeOperationalActionType): OperationalTimelineEventType {
  if (actionType === "SLOW_WAITLIST_ESCALATION" || actionType === "STAGGER_RECOVERY_OFFERS") return "RECOVERY_ESCALATION_SLOWED";
  if (actionType === "PAUSE_NON_CRITICAL_REMINDERS" || actionType === "SUPPRESS_DUPLICATE_REMINDER_BURSTS") return "REMINDER_SUPPRESSION_ENABLED";
  if (actionType === "ACTIVATE_RUSH_LOCK") return "RUSH_LOCK_AUTO_ENABLED";
  if (actionType === "DEACTIVATE_RUSH_LOCK") return "EXECUTION_STABILIZED";
  if (actionType === "INCREASE_RECOVERY_COOLDOWN_WINDOWS") return "EXECUTION_COOLDOWN_STARTED";
  return "AUTONOMOUS_THROTTLE_STARTED";
}

async function writeExecutionAudit({
  organizationId,
  locationId,
  actionItem,
  coordination,
  idempotencyKey,
}: {
  organizationId: string;
  locationId?: string | null;
  actionItem: SafeOperationalAction;
  coordination: LiveServiceCoordinationSnapshot;
  idempotencyKey: string;
}) {
  const meta = {
    operationalEvent: "AUTONOMOUS_OPERATIONAL_EXECUTION",
    autonomousOperationalExecution: true,
    actionType: actionItem.actionType,
    executionState: actionItem.executionState,
    coordinationState: coordination.state,
    capacityState: coordination.capacityState,
    idempotencyKey,
    reversible: true,
    expiresAt: actionItem.expiresAt,
    cooldownMinutes: actionItem.cooldownMinutes,
    priority: actionItem.priority,
    reason: actionItem.reason,
    safetyBoundaries: [
      "No payment truth changes.",
      "No release, cancellation, refund, or manager bypass.",
      "Pacing action expires automatically.",
    ],
    activeThrottles: coordination.throttles,
  };

  await supabaseAdmin.from("audit_logs").insert({
    action: `Autonomous pacing applied: ${actionItem.label}`,
    staff: "Autonomous Operational Execution",
    order_id: "OPERATION",
    organization_id: organizationId,
    location_id: locationId ?? null,
    meta,
  });

  await appendOperationalTimelineEvent({
    organizationId,
    locationId,
    orderId: "OPERATION",
    actorSource: "Autonomous Operational Execution",
    eventType: timelineEventForAction(actionItem.actionType),
    summary: `${actionItem.label}: ${actionItem.reason}`,
    severity: actionItem.priority === "CRITICAL" ? "CRITICAL" : actionItem.priority === "HIGH" ? "WARNING" : "WATCH",
    category: actionItem.actionType.includes("RECOVERY") || actionItem.actionType.includes("WAITLIST") ? "RECOVERY" : "WORKER",
    correlationId: idempotencyKey,
    idempotencyKey: `timeline:${idempotencyKey}`,
    metadata: meta,
  });

  await publishOperationalCommand({
    eventType:
      actionItem.actionType.includes("RECOVERY") || actionItem.actionType.includes("WAITLIST")
        ? "RECOVERY_THROTTLED"
        : actionItem.actionType.includes("PAYMENT")
          ? "PAYMENT_PRIORITY_ENABLED"
          : actionItem.actionType.includes("REMINDER") || actionItem.actionType.includes("NOTIFICATION")
            ? "REMINDERS_SUPPRESSED"
            : actionItem.actionType === "ACTIVATE_RUSH_LOCK"
              ? "COLLAPSE_PROTECTION_ENABLED"
              : "POLICY_OVERRIDE_APPLIED",
    organizationId,
    locationId,
    source: "Autonomous Operational Execution",
    summary: `${actionItem.label}: ${actionItem.reason}`,
    severity: actionItem.priority === "CRITICAL" ? "CRITICAL" : actionItem.priority === "HIGH" ? "WARNING" : "WATCH",
    correlationId: idempotencyKey,
    executionId: idempotencyKey,
    payload: meta,
  });
}

async function executeSafeAction({
  organizationId,
  locationId,
  actionItem,
  coordination,
}: {
  organizationId: string;
  locationId?: string | null;
  actionItem: SafeOperationalAction;
  coordination: LiveServiceCoordinationSnapshot;
}) {
  const idempotencyKey = buildIdempotencyKey({
    scope: "AUTONOMOUS_EXECUTION",
    organizationId,
    orderId: "OPERATION",
    action: actionItem.actionType,
    bucket: bucket(Math.max(5, actionItem.cooldownMinutes)),
  });

  const duplicate = await checkIdempotencyKey({
    key: idempotencyKey,
    scope: "AUTONOMOUS_EXECUTION",
    organizationId,
    locationId: locationId ?? null,
    orderId: "OPERATION",
    metadata: {
      actionType: actionItem.actionType,
      coordinationState: coordination.state,
      executionState: actionItem.executionState,
      expiresAt: actionItem.expiresAt,
    },
  });

  if (duplicate.duplicate) {
    return {
      executed: false,
      duplicate,
      idempotencyKey,
    };
  }

  await writeExecutionAudit({
    organizationId,
    locationId,
    actionItem,
    coordination,
    idempotencyKey,
  });

  return {
    executed: true,
    duplicate,
    idempotencyKey,
  };
}

export async function runAutonomousOperationalExecution({
  organizationId,
  locationId = null,
}: {
  organizationId: string;
  locationId?: string | null;
}): Promise<AutonomousOperationalExecutionResult> {
  const coordination = await buildLiveServiceCoordinationSnapshot({ organizationId, locationId });
  const partition = await buildOperationalPartition({ organizationId, locationId });
  if (partition.state === "PARTITION_FAILOVER" || partition.state === "PARTITION_DEGRADED") {
    await publishOperationalCommand({
      eventType: partition.state === "PARTITION_FAILOVER" ? "EXECUTION_REASSIGNED" : "PARTITION_REBALANCED",
      organizationId,
      locationId,
      source: "Autonomous Operational Execution",
      summary:
        partition.state === "PARTITION_FAILOVER"
          ? "Autonomous pacing is using worker failover protection."
          : "Autonomous pacing is respecting worker mesh load balancing.",
      severity: "WATCH",
      correlationId: partition.replaySafeRecoveryKey,
      payload: {
        partitionState: partition.state,
        ownerWorkerId: partition.ownerWorkerId,
        failoverCandidateWorkerId: partition.failoverCandidateWorkerId,
        executionPressure: partition.executionPressure,
      },
    });
  }
  const executionState = executionStateFor(coordination);
  const policyActions = evaluateExecutionPolicy(coordination);
  const actionsExecuted: SafeOperationalAction[] = [];
  const actionsSkipped: AutonomousOperationalExecutionResult["actionsSkipped"] = [];

  for (const actionItem of policyActions) {
    const result = await executeSafeAction({
      organizationId,
      locationId,
      actionItem,
      coordination,
    });

    if (result.executed) {
      actionsExecuted.push(actionItem);
    } else {
      actionsSkipped.push({
        actionType: actionItem.actionType,
        reason: result.duplicate.reason,
      });
    }
  }

  const expiresAt = actionsExecuted[0]?.expiresAt ?? addMinutes(executionState === "EXECUTION_IDLE" ? 5 : 10);

  return {
    organizationId,
    locationId,
    executionState,
    coordinationState: coordination.state,
    ownerSummary:
      executionState === "EXECUTION_IDLE"
        ? "No autonomous pacing action is needed right now."
        : actionsExecuted.length > 0
          ? `${actionsExecuted[0].label}. ${coordination.ownerSummary}`
          : `Pacing is already active. ${coordination.ownerSummary}`,
    staffGuidance:
      executionState === "EXECUTION_IDLE"
        ? ["Normal Flow"]
        : Array.from(new Set([
            ...coordination.staffGuidance,
            ...actionsExecuted.map((item) => {
              if (item.actionType === "ACTIVATE_RUSH_LOCK") return "Rush Protection Active";
              if (item.actionType.includes("RECOVERY") || item.actionType.includes("WAITLIST")) return "Recovery Slowed";
              if (item.actionType.includes("REMINDER") || item.actionType.includes("NOTIFICATION")) return "Notifications Reduced";
              if (item.actionType.includes("PAYMENT")) return "Payments Prioritized";
              if (item.actionType === "DEACTIVATE_RUSH_LOCK") return "Service Stabilizing";
              return "Service Stabilizing";
            }),
          ])).slice(0, 6),
    actionsEvaluated: policyActions.length,
    actionsExecuted,
    actionsSkipped,
    activePacingPolicy: {
      suppressNonCriticalReminders: coordination.throttles.suppressNonCriticalReminders,
      reduceRecoveryEscalation: coordination.throttles.reduceRecoveryEscalation,
      staggerRecoveryOffers: coordination.throttles.reduceRecoveryEscalation,
      delayNonCriticalNotifications: coordination.throttles.pauseLowPriorityOutbound,
      suppressNoisyDiagnostics: coordination.throttles.suppressNoisyDiagnostics,
      prioritizePaymentReview: coordination.throttles.prioritizePaymentReview,
      prioritizeArrivalVisibility: coordination.throttles.prioritizeArrivalVisibility,
      recoveryCooldownMultiplier: getRecoveryCooldownMultiplier(coordination),
      rushLockActive: coordination.state === "RUSH_LOCK",
      expiresAt,
    },
    generatedAt: new Date().toISOString(),
  };
}
