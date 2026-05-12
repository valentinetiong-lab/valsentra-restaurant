import type { ConversationalRecoveryDecision, WhatsAppIntent } from "@/app/lib/conversationalRecoveryEngine";
import type { CustomerOperationalMemoryProfile } from "@/app/lib/customerOperationalMemoryEngine";
import type { RestaurantOrder } from "@/app/lib/domain/restaurant";

export type AutonomousRecoveryActionType =
  | "MARK_CUSTOMER_RESPONSIVE"
  | "REDUCE_COLLAPSE_SEVERITY"
  | "UPDATE_OPERATIONAL_STATUS"
  | "ACKNOWLEDGE_RUNNING_LATE"
  | "PLACE_MONITORED_LATE_STATE"
  | "PROPOSE_SAFER_ALTERNATIVE_SLOT"
  | "RESERVE_TENTATIVE_RECOVERY_SLOT"
  | "ESCALATE_TO_STAFF_REVIEW"
  | "REDUCE_COMMUNICATION_PRESSURE"
  | "INCREASE_RECOVERY_LIKELIHOOD";

export type AutonomousRecoveryStateTransition = {
  from: string;
  to: string;
  reason: string;
};

export type AutonomousRecoveryActionDecision = {
  actionType: AutonomousRecoveryActionType;
  actionReason: string;
  confidence: number;
  safetyChecksPassed: boolean;
  blockedBy: string[];
  operationalImpact: string;
  recommendedStaffReview: boolean;
  recoveryStateTransition: AutonomousRecoveryStateTransition;
};

export type AutonomousRecoveryActionEvaluation = {
  executionAllowed: boolean;
  actions: AutonomousRecoveryActionDecision[];
  executedActions: AutonomousRecoveryActionDecision[];
  blockedActions: AutonomousRecoveryActionDecision[];
  diagnostics: {
    safetyScore: number;
    trustScore: number;
    recoveryConfidence: number;
    executionAllowed: boolean;
    guardrailsApplied: string[];
    recoveryConsensusSignals: string[];
  };
  auditEvents: Array<{
    action: string;
    title: string;
    summary: string;
    severity: "INFO" | "WATCH" | "WARNING" | "CRITICAL";
    eventKeySuffix: string;
    actionDecision: AutonomousRecoveryActionDecision;
  }>;
  orderNote: string | null;
};

type AuditRow = Record<string, any>;

function clamp(value: number) {
  return Math.max(0, Math.min(Math.round(value), 100));
}

function hasUnresolvedEscalation(auditRows: AuditRow[]) {
  return auditRows.some((row) => {
    const action = String(row.action ?? "").toLowerCase();
    const state = String(row.meta?.conversationContext?.conversationState ?? "").toLowerCase();
    return (
      action.includes("staff review") ||
      action.includes("owner review") ||
      state.includes("awaiting_staff_review") ||
      row.meta?.requiresHumanReview === true
    );
  });
}

function fraudOrPaymentMismatch(order: RestaurantOrder) {
  return Boolean(order.terminalMismatch || order.paymentState === "BLOCKED" || order.paymentState === "FAILED");
}

function highRiskConflict(order: RestaurantOrder) {
  return (
    order.riskLevel === "HIGH" ||
    order.collapseRiskTier === "CRITICAL" ||
    Number(order.collapseProbability ?? 0) >= 88
  );
}

function vipOrManualReviewProtected(order: RestaurantOrder, memory?: CustomerOperationalMemoryProfile | null) {
  const vipTrust = Number(order.reliabilityScore ?? 0) >= 95 || Number(memory?.operationalReliability ?? 0) >= 92;
  const manualReviewText = `${order.notes ?? ""} ${order.protectionReason ?? ""}`.toLowerCase();
  return vipTrust || manualReviewText.includes("manual review") || manualReviewText.includes("owner review");
}

function getTrustScore(order: RestaurantOrder, memory?: CustomerOperationalMemoryProfile | null) {
  const memoryTrust = memory
    ? memory.operationalReliability * 0.34 +
      memory.communicationTrust * 0.3 +
      memory.recoveryCooperationScore * 0.22 +
      (100 - memory.ghostRisk) * 0.14
    : Number(order.reliabilityScore ?? 70);

  return clamp(memoryTrust);
}

function getRecoveryConfidence({
  order,
  intent,
  response,
  memory,
}: {
  order: RestaurantOrder;
  intent: WhatsAppIntent;
  response: ConversationalRecoveryDecision | null;
  memory?: CustomerOperationalMemoryProfile | null;
}) {
  const base =
    intent === "CONFIRM_BOOKING"
      ? 78
      : intent === "RUNNING_LATE"
        ? 72
        : intent === "CHANGE_TIME_REQUEST" && response?.conversationContext.proposedRecoverySlot
          ? 68
          : intent === "PAID_ALREADY"
            ? 58
            : 42;

  return clamp(
    base +
      Number(memory?.recoveryCooperationScore ?? 50) * 0.18 +
      Number(memory?.communicationResponsiveness ?? order.reliabilityScore ?? 60) * 0.12 -
      Number(order.collapseProbability ?? 0) * 0.12
  );
}

function baseBlockedBy({
  confidence,
  safetyScore,
  trustScore,
  order,
  auditRows,
  memory,
}: {
  confidence: number;
  safetyScore: number;
  trustScore: number;
  order: RestaurantOrder;
  auditRows: AuditRow[];
  memory?: CustomerOperationalMemoryProfile | null;
}) {
  return [
    ...(confidence < 74 ? ["Inbound confidence below autonomous execution threshold."] : []),
    ...(safetyScore < 72 ? ["Safety score below autonomous execution threshold."] : []),
    ...(trustScore < 62 ? ["Customer trust score below autonomous execution threshold."] : []),
    ...(fraudOrPaymentMismatch(order) ? ["Fraud or payment mismatch guardrail is active."] : []),
    ...(highRiskConflict(order) ? ["High-risk collapse/payment conflict requires staff review."] : []),
    ...(hasUnresolvedEscalation(auditRows) ? ["Unresolved staff/owner escalation already exists."] : []),
    ...(vipOrManualReviewProtected(order, memory) ? ["VIP/manual-review protection requires human oversight."] : []),
  ];
}

function createAction({
  actionType,
  actionReason,
  confidence,
  blockedBy,
  operationalImpact,
  recommendedStaffReview,
  from,
  to,
}: {
  actionType: AutonomousRecoveryActionType;
  actionReason: string;
  confidence: number;
  blockedBy: string[];
  operationalImpact: string;
  recommendedStaffReview: boolean;
  from: string;
  to: string;
}): AutonomousRecoveryActionDecision {
  return {
    actionType,
    actionReason,
    confidence,
    safetyChecksPassed: blockedBy.length === 0,
    blockedBy,
    operationalImpact,
    recommendedStaffReview,
    recoveryStateTransition: {
      from,
      to: blockedBy.length === 0 ? to : "STAFF_REVIEW_REQUIRED",
      reason: blockedBy.length === 0 ? actionReason : blockedBy[0],
    },
  };
}

function eventForAction(action: AutonomousRecoveryActionDecision) {
  if (!action.safetyChecksPassed) {
    return {
      action: "autonomousRecoveryBlocked",
      title: "Autonomous recovery blocked by guardrails",
      summary: action.blockedBy[0] ?? "A safety guardrail prevented autonomous recovery execution.",
      severity: "WATCH" as const,
      eventKeySuffix: `blocked:${action.actionType}`,
      actionDecision: action,
    };
  }

  if (action.actionType === "PLACE_MONITORED_LATE_STATE") {
    return {
      action: "lateArrivalProtected",
      title: "Late arrival protected",
      summary: "Valsentra placed the reservation into monitored-late state without releasing the slot.",
      severity: "INFO" as const,
      eventKeySuffix: "late-arrival-protected",
      actionDecision: action,
    };
  }

  if (action.actionType === "RESERVE_TENTATIVE_RECOVERY_SLOT") {
    return {
      action: "tentativeSlotReserved",
      title: "Tentative recovery slot reserved",
      summary: "Valsentra reserved a tentative recovery slot pending customer confirmation and staff approval.",
      severity: "INFO" as const,
      eventKeySuffix: "tentative-slot-reserved",
      actionDecision: action,
    };
  }

  return {
    action: action.actionType === "UPDATE_OPERATIONAL_STATUS" ? "recoveryStateChanged" : "autonomousRecoveryExecuted",
    title: "Autonomous recovery action executed",
    summary: action.operationalImpact,
    severity: "INFO" as const,
    eventKeySuffix: `executed:${action.actionType}`,
    actionDecision: action,
  };
}

export function evaluateAutonomousRecoveryActions({
  order,
  intent,
  inboundConfidence,
  recoveryResponse,
  customerMemory,
  auditRows,
}: {
  order: RestaurantOrder | null;
  intent: WhatsAppIntent;
  inboundConfidence: number;
  recoveryResponse: ConversationalRecoveryDecision | null;
  customerMemory?: CustomerOperationalMemoryProfile | null;
  auditRows: AuditRow[];
}): AutonomousRecoveryActionEvaluation {
  if (!order) {
    const blocked = createAction({
      actionType: "ESCALATE_TO_STAFF_REVIEW",
      actionReason: "No active order matched the inbound customer reply.",
      confidence: inboundConfidence,
      blockedBy: ["No matched order."],
      operationalImpact: "Customer reply requires manual triage because no order was matched.",
      recommendedStaffReview: true,
      from: "UNMATCHED_REPLY",
      to: "STAFF_REVIEW_REQUIRED",
    });

    return {
      executionAllowed: false,
      actions: [blocked],
      executedActions: [],
      blockedActions: [blocked],
      diagnostics: {
        safetyScore: 0,
        trustScore: 0,
        recoveryConfidence: 0,
        executionAllowed: false,
        guardrailsApplied: blocked.blockedBy,
        recoveryConsensusSignals: ["Inbound WhatsApp could not be matched to an active order."],
      },
      auditEvents: [eventForAction(blocked)],
      orderNote: null,
    };
  }

  const trustScore = getTrustScore(order, customerMemory);
  const recoveryConfidence = getRecoveryConfidence({
    order,
    intent,
    response: recoveryResponse,
    memory: customerMemory,
  });
  const safetyScore = clamp(
    inboundConfidence * 0.28 +
      trustScore * 0.28 +
      recoveryConfidence * 0.24 +
      (fraudOrPaymentMismatch(order) ? -30 : 12) +
      (highRiskConflict(order) ? -18 : 8) +
      (hasUnresolvedEscalation(auditRows) ? -14 : 6)
  );
  const blockedBy = baseBlockedBy({
    confidence: inboundConfidence,
    safetyScore,
    trustScore,
    order,
    auditRows,
    memory: customerMemory,
  });
  const actions: AutonomousRecoveryActionDecision[] = [];

  if (intent === "CONFIRM_BOOKING") {
    actions.push(
      createAction({
        actionType: "MARK_CUSTOMER_RESPONSIVE",
        actionReason: "Customer confirmed the booking with sufficient deterministic confidence.",
        confidence: clamp(recoveryConfidence + 8),
        blockedBy,
        operationalImpact: "Customer responsiveness is marked in audit memory, improving recovery confidence for this booking.",
        recommendedStaffReview: false,
        from: "AWAITING_RESPONSE",
        to: "CUSTOMER_RESPONSIVE",
      }),
      createAction({
        actionType: "REDUCE_COMMUNICATION_PRESSURE",
        actionReason: "A direct customer confirmation reduces the need for repeated reminders.",
        confidence: clamp(recoveryConfidence + 5),
        blockedBy,
        operationalImpact: "Communication pressure can be lowered because the customer responded.",
        recommendedStaffReview: false,
        from: "RECOVERY_COMMUNICATION_ACTIVE",
        to: "MONITORING_CONFIRMED_CUSTOMER",
      }),
      createAction({
        actionType: "INCREASE_RECOVERY_LIKELIHOOD",
        actionReason: "Confirmed customer intent improves deterministic recovery likelihood without changing payment truth.",
        confidence: recoveryConfidence,
        blockedBy,
        operationalImpact: "Recovery likelihood signal increased for future orchestration decisions.",
        recommendedStaffReview: false,
        from: "RECOVERY_UNCERTAIN",
        to: "RECOVERY_MORE_LIKELY",
      })
    );
  } else if (intent === "RUNNING_LATE") {
    actions.push(
      createAction({
        actionType: "ACKNOWLEDGE_RUNNING_LATE",
        actionReason: "Customer proactively disclosed lateness, reducing ghost uncertainty.",
        confidence: recoveryConfidence,
        blockedBy,
        operationalImpact: "Late arrival is acknowledged while preserving staff oversight.",
        recommendedStaffReview: true,
        from: "ARRIVAL_UNCERTAIN",
        to: "LATE_ARRIVAL_ACKNOWLEDGED",
      }),
      createAction({
        actionType: "PLACE_MONITORED_LATE_STATE",
        actionReason: "Late arrival can be monitored without cancelling, refunding, or changing payment state.",
        confidence: recoveryConfidence,
        blockedBy,
        operationalImpact: "Reservation enters monitored-late state so staff can protect the slot.",
        recommendedStaffReview: true,
        from: "ACTIVE_RESERVATION",
        to: "MONITORED_LATE",
      })
    );
  } else if (intent === "CHANGE_TIME_REQUEST") {
    const hasTentativeSlot = Boolean(recoveryResponse?.conversationContext.proposedRecoverySlot);
    actions.push(
      createAction({
        actionType: hasTentativeSlot ? "RESERVE_TENTATIVE_RECOVERY_SLOT" : "PROPOSE_SAFER_ALTERNATIVE_SLOT",
        actionReason: hasTentativeSlot
          ? "A lower-risk slot was identified, but staff approval remains required before changing the booking."
          : "No safe automatic slot change is available; safer alternatives should be proposed for staff review.",
        confidence: recoveryConfidence,
        blockedBy: hasTentativeSlot ? blockedBy : [...blockedBy, "No confirmed safe requested slot."],
        operationalImpact: hasTentativeSlot
          ? "Tentative slot is reserved in audit context only; reservation time is unchanged until staff approves."
          : "Time-change request is routed toward safer alternatives without modifying the reservation.",
        recommendedStaffReview: true,
        from: "TIME_CHANGE_REQUESTED",
        to: hasTentativeSlot ? "TENTATIVE_SLOT_HELD" : "ALTERNATIVE_SLOT_PROPOSED",
      })
    );
  } else if (intent === "PAID_ALREADY" || intent === "CANCEL_REQUEST" || intent === "HELP_OR_HUMAN") {
    actions.push(
      createAction({
        actionType: "ESCALATE_TO_STAFF_REVIEW",
        actionReason:
          intent === "PAID_ALREADY"
            ? "Payment claims require staff Payment Truth verification."
            : intent === "CANCEL_REQUEST"
              ? "Cancellation requests are never auto-confirmed."
              : "Customer requested human assistance.",
        confidence: inboundConfidence,
        blockedBy: ["Human approval required by policy."],
        operationalImpact: "Valsentra escalated the recovery case without executing irreversible action.",
        recommendedStaffReview: true,
        from: "CUSTOMER_REPLY_RECEIVED",
        to: "STAFF_REVIEW_REQUIRED",
      })
    );
  } else {
    actions.push(
      createAction({
        actionType: "ESCALATE_TO_STAFF_REVIEW",
        actionReason: "Inbound message did not reach deterministic confidence for autonomous recovery.",
        confidence: inboundConfidence,
        blockedBy: ["Unknown or low-confidence intent."],
        operationalImpact: "No autonomous recovery state change was executed.",
        recommendedStaffReview: true,
        from: "UNKNOWN_REPLY",
        to: "STAFF_REVIEW_REQUIRED",
      })
    );
  }

  const executedActions = actions.filter((action) => action.safetyChecksPassed);
  const blockedActions = actions.filter((action) => !action.safetyChecksPassed);
  const executionAllowed = executedActions.length > 0;
  const recoveryConsensusSignals = [
    `Inbound intent ${intent} classified at ${inboundConfidence}% confidence.`,
    `Trust score ${trustScore}/100.`,
    `Recovery confidence ${recoveryConfidence}/100.`,
    ...(recoveryResponse ? [recoveryResponse.operationalDecision] : []),
    ...(customerMemory?.orchestrationBiasesApplied ?? []),
  ];
  const guardrailsApplied = [
    "No auto-refund.",
    "No auto-payment verification.",
    "No auto-cancellation.",
    "No high-risk time change without staff review.",
    ...blockedActions.flatMap((action) => action.blockedBy),
  ];
  const orderNote = executionAllowed
    ? [
        `Autonomous recovery state: ${executedActions
          .map((action) => action.recoveryStateTransition.to)
          .join(", ")}.`,
        `Safety score ${safetyScore}/100; trust score ${trustScore}/100; recovery confidence ${recoveryConfidence}/100.`,
      ].join(" ")
    : null;

  return {
    executionAllowed,
    actions,
    executedActions,
    blockedActions,
    diagnostics: {
      safetyScore,
      trustScore,
      recoveryConfidence,
      executionAllowed,
      guardrailsApplied: Array.from(new Set(guardrailsApplied)),
      recoveryConsensusSignals,
    },
    auditEvents: actions.map(eventForAction),
    orderNote,
  };
}
