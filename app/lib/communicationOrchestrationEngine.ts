import type { RestaurantOrder } from "@/app/lib/domain/restaurant";
import type { OperationalDigitalTwin } from "@/app/lib/operationalDigitalTwinEngine";
import type { OperationalMemorySnapshot } from "@/app/lib/operationalMemoryEngine";
import type { OperationalPolicy } from "@/app/lib/policyEngine";

export type CommunicationChannel = "WHATSAPP" | "SMS" | "EMAIL" | "INTERNAL";
export type RecoverySequenceStep =
  | "PAYMENT_REMINDER"
  | "ESCALATE_PAYMENT"
  | "REMINDER"
  | "ESCALATION"
  | "URGENCY_INCREASE"
  | "RELEASE_WARNING"
  | "FINAL_RECOVERY_ATTEMPT"
  | "WAITLIST_REPLACEMENT_ACTIVATION"
  | "FRAUD_VERIFICATION"
  | "OWNER_STAFF_INTERVENTION";

export type CommunicationResponseState =
  | "NOT_SENT"
  | "PREPARED"
  | "SENT"
  | "RESPONDED"
  | "PAYMENT_COMPLETED"
  | "FAILED"
  | "SUPPRESSED";

export type CommunicationProviderMessage = {
  channel: CommunicationChannel;
  to: string;
  subject?: string;
  body: string;
  metadata: Record<string, unknown>;
};

export type CommunicationProvider = {
  channel: CommunicationChannel;
  // Provider-ready seam only: current flows prepare auditable messages but do not send WhatsApp/SMS/email.
  prepare(input: CommunicationProviderMessage): CommunicationProviderMessage;
};

export type RecoveryConversationContext = {
  orderId: string;
  activeRecoveryState:
    | "MONITORING"
    | "RECOVERY_ACTIVE"
    | "RELEASE_WARNING_ACTIVE"
    | "WAITLIST_ACTIVATED"
    | "OWNER_REVIEW_REQUESTED"
    | "SUPPRESSED";
  unresolvedPaymentState: string;
  releaseWarningState: "NONE" | "PREPARED" | "FINAL";
  customerResponsiveness: number;
  interventionHistory: string[];
  communicationOutcomes: string[];
};

export type RecoverySequenceDecision = {
  id: string;
  orderId: string;
  channel: CommunicationChannel;
  step: RecoverySequenceStep;
  responseState: CommunicationResponseState;
  attemptCount: number;
  escalationStage: number;
  recoveryConfidence: number;
  projectedRecoveryLikelihood: number;
  trustRisk: number;
  communicationFatigue: number;
  cooldownMinutes: number;
  nextEligibleAt: string;
  shouldPrepareMessage: boolean;
  suppressed: boolean;
  suppressionReasons: string[];
  message: CommunicationProviderMessage;
  conversationContext: RecoveryConversationContext;
  simulation: {
    recoveryProbability: number;
    customerTrustImpact: number;
    overloadRisk: number;
    falsePositiveRisk: number;
    waitlistOpportunity: number;
    escalationEffectiveness: number;
  };
  priorityDiagnostics: {
    paymentUnresolved: boolean;
    hasPhone: boolean;
    customerFacing: boolean;
    internalOnly: boolean;
    selectedReason: string;
    reminderSkippedReason: string | null;
    lastReminderSentAt: string | null;
    minutesSinceLastReminder: number | null;
    cooldownRemainingMinutes: number;
    slotUnrecoverable: boolean;
    quietHoursSuppressed: boolean;
    quietHoursOverrideUsed: boolean;
  };
  explainability: string[];
};

export type CommunicationClimate = {
  communicationPressure: number;
  recoveryCommunicationLoad: number;
  escalationEffectiveness: number;
  responseLatency: number;
  customerResponsivenessClimate: number;
  communicationFatigue: number;
  activeRecoveryFlows: number;
  trustWarnings: string[];
};

type AuditRow = Record<string, any>;

function clamp(value: number) {
  return Math.max(0, Math.min(Math.round(value), 100));
}

function minutesSince(value?: string | null) {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  if (Number.isNaN(parsed)) return null;
  return Math.round((Date.now() - parsed) / 60000);
}

function addMinutes(minutes: number) {
  return new Date(Date.now() + minutes * 60000).toISOString();
}

function isQuietHour(date = new Date()) {
  const hour = date.getHours();
  return hour < 8 || hour >= 22;
}

function canUseDevelopmentQuietHoursOverride(
  order: RestaurantOrder,
  step: RecoverySequenceStep,
  channel: CommunicationChannel
) {
  const explicitTestOrder =
    order.id.startsWith("DEV-QUIET-OVERRIDE-") ||
    String(order.notes ?? "").includes("DEV quiet-hours override test") ||
    String(order.protectionReason ?? "").includes("Quiet-hours override verification");

  return (
    process.env.NODE_ENV !== "production" &&
    process.env.DEV_ALLOW_QUIET_HOURS_WHATSAPP === "true" &&
    explicitTestOrder &&
    step === "PAYMENT_REMINDER" &&
    channel === "WHATSAPP"
  );
}

function getAuditText(rows: AuditRow[]) {
  return rows.map((row) => String(row.action ?? "").toLowerCase()).join(" ");
}

function countCommunicationAttempts(rows: AuditRow[]) {
  return rows.filter((row) => {
    const action = String(row.action ?? "").toLowerCase();
    return action.includes("reminder") || action.includes("ghost") || action.includes("communication") || action.includes("whatsapp");
  }).length;
}

function countEscalationAttempts(rows: AuditRow[]) {
  return rows.filter((row) => {
    const action = String(row.action ?? "").toLowerCase();
    const step = String(row.meta?.communicationOrchestration?.step ?? row.meta?.deliveryAttempt?.step ?? "").toUpperCase();
    return (
      action.includes("escalat") ||
      step === "ESCALATE_PAYMENT" ||
      step === "ESCALATION"
    );
  }).length;
}

function getLastReminderSentAt(order: RestaurantOrder, rows: AuditRow[]) {
  if (order.lastReminderSentAt) return order.lastReminderSentAt;

  const reminderRow = rows.find((row) => {
    const action = String(row.action ?? "").toLowerCase();
    const step = String(row.meta?.communicationOrchestration?.step ?? row.meta?.deliveryAttempt?.step ?? "").toUpperCase();
    return (
      action.includes("whatsapp reminder") ||
      action.includes("payment reminder") ||
      step === "PAYMENT_REMINDER" ||
      step === "REMINDER"
    );
  });

  return reminderRow?.created_at ?? reminderRow?.createdAt ?? null;
}

function isPaymentUnresolved(order: RestaurantOrder) {
  return (
    !order.paymentVerified &&
    order.status !== "PAID" &&
    order.paymentState !== "VERIFIED" &&
    (order.status === "UNPAID" ||
      order.status === "PAYMENT_SENT" ||
      order.paymentState === "UNPAID" ||
      order.paymentState === "PENDING" ||
      !order.paymentState)
  );
}

function isSlotExpired(order: RestaurantOrder) {
  if (!order.slotHoldExpiresAt) return false;
  const parsed = new Date(order.slotHoldExpiresAt).getTime();
  return Number.isFinite(parsed) && parsed <= Date.now();
}

function chooseChannel(order: RestaurantOrder, step: RecoverySequenceStep): CommunicationChannel {
  if (
    step === "OWNER_STAFF_INTERVENTION" ||
    step === "FRAUD_VERIFICATION" ||
    step === "WAITLIST_REPLACEMENT_ACTIVATION"
  ) {
    return "INTERNAL";
  }
  if (order.phone) return "WHATSAPP";
  return "EMAIL";
}

function chooseStep({
  order,
  auditRows,
  waitlistAvailability,
  cooldownMinutes,
}: {
  order: RestaurantOrder;
  auditRows: AuditRow[];
  waitlistAvailability: number;
  cooldownMinutes: number;
}): {
  step: RecoverySequenceStep;
  diagnostics: RecoverySequenceDecision["priorityDiagnostics"];
} {
  const attempts = countCommunicationAttempts(auditRows);
  const escalationAttempts = countEscalationAttempts(auditRows);
  const collapse = Number(order.collapseProbability ?? 0);
  const paymentUnresolved = isPaymentUnresolved(order);
  const hasPhone = Boolean(order.phone);
  const lastReminderSentAt = getLastReminderSentAt(order, auditRows);
  const minutesSinceLastReminder = minutesSince(lastReminderSentAt);
  const cooldownRemainingMinutes =
    minutesSinceLastReminder !== null
      ? Math.max(0, Math.round(cooldownMinutes - minutesSinceLastReminder))
      : 0;
  const slotExpired = isSlotExpired(order);
  const slotUnrecoverable =
    collapse >= 94 || (slotExpired && escalationAttempts > 0) || (collapse >= 90 && escalationAttempts > 0);

  let step: RecoverySequenceStep;
  let selectedReason = "";
  let reminderSkippedReason: string | null = null;

  if (order.terminalMismatch || order.paymentState === "FAILED" || order.paymentState === "BLOCKED") {
    step = "FRAUD_VERIFICATION";
    selectedReason = "Payment-risk signals require internal fraud/payment verification.";
    reminderSkippedReason = "Fraud uncertainty blocks customer-facing payment outreach.";
  } else if (paymentUnresolved && hasPhone && !slotUnrecoverable) {
    if (!lastReminderSentAt) {
      step = "PAYMENT_REMINDER";
      selectedReason = "Unverified payment has a reachable customer phone and no recent reminder.";
    } else if (cooldownRemainingMinutes > 0) {
      step = "PAYMENT_REMINDER";
      selectedReason = "Payment reminder remains the correct next customer-facing action.";
      reminderSkippedReason = `Reminder cooldown has ${cooldownRemainingMinutes} minute${cooldownRemainingMinutes === 1 ? "" : "s"} remaining.`;
    } else {
      step = "ESCALATE_PAYMENT";
      selectedReason = "A payment reminder was already sent and cooldown elapsed while payment stayed unresolved.";
      reminderSkippedReason = "Initial reminder already sent; escalation is now eligible.";
    }
  } else if (slotUnrecoverable && waitlistAvailability > 0) {
    step = "WAITLIST_REPLACEMENT_ACTIVATION";
    selectedReason = "Slot is unrecoverable after payment escalation, so waitlist recovery takes priority.";
    reminderSkippedReason = paymentUnresolved
      ? "Payment outreach is no longer the safest primary action for this slot."
      : null;
  } else if (collapse >= 82) {
    step = "FINAL_RECOVERY_ATTEMPT";
    selectedReason = "Collapse risk is high but not yet unrecoverable.";
  } else if (collapse >= 72) {
    step = "RELEASE_WARNING";
    selectedReason = "Collapse risk crossed release-warning range.";
  } else if (order.ghostPingUrgency === "HIGH" || order.ghostPingUrgency === "CRITICAL") {
    step = "URGENCY_INCREASE";
    selectedReason = "Ghost Ping urgency increased.";
  } else if (order.depositRequired && !order.depositPaid) {
    step = "ESCALATE_PAYMENT";
    selectedReason = "Required deposit is unpaid.";
  } else if (attempts > 0) {
    step = "ESCALATE_PAYMENT";
    selectedReason = "Previous recovery communication exists and unresolved payment needs escalation.";
  } else {
    step = "PAYMENT_REMINDER";
    selectedReason = "Default first recovery action is a payment reminder.";
  }

  const channel = chooseChannel(order, step);

  return {
    step,
    diagnostics: {
      paymentUnresolved,
      hasPhone,
      customerFacing: channel !== "INTERNAL",
      internalOnly: channel === "INTERNAL",
      selectedReason,
      reminderSkippedReason,
      lastReminderSentAt,
      minutesSinceLastReminder,
      cooldownRemainingMinutes,
      slotUnrecoverable,
      quietHoursSuppressed: false,
      quietHoursOverrideUsed: false,
    },
  };
}

function getCooldown(step: RecoverySequenceStep, policy: OperationalPolicy) {
  if (step === "FRAUD_VERIFICATION" || step === "OWNER_STAFF_INTERVENTION") return 0;
  if (step === "FINAL_RECOVERY_ATTEMPT" || step === "RELEASE_WARNING") return Math.max(15, 60 - policy.escalationSpeed * 0.45);
  if (step === "URGENCY_INCREASE" || step === "ESCALATION" || step === "ESCALATE_PAYMENT") return Math.max(25, 90 - policy.escalationSpeed * 0.5);
  return Math.max(45, 120 - policy.escalationSpeed * 0.4);
}

function buildMessage({
  order,
  channel,
  step,
  recoveryLikelihood,
}: {
  order: RestaurantOrder;
  channel: CommunicationChannel;
  step: RecoverySequenceStep;
  recoveryLikelihood: number;
}): CommunicationProviderMessage {
  // These templates remain provider-agnostic. External sending is performed only by
  // the server-side communication provider layer when live provider env vars exist.
  const name = order.customerName || "Customer";
  const amount = Number(order.depositAmount || order.amount || 0);
  const bodyByStep: Record<RecoverySequenceStep, string> = {
    PAYMENT_REMINDER: `Hi ${name}, your Valsentra order ${order.id} is still awaiting payment confirmation. Please complete payment to keep the slot protected.`,
    ESCALATE_PAYMENT: `Hi ${name}, your required deposit/payment for ${order.id} is still unresolved. Please verify payment soon so the team can keep your slot active.`,
    REMINDER: `Hi ${name}, your Valsentra order ${order.id} is still awaiting payment confirmation. Please complete payment to keep the slot protected.`,
    ESCALATION: `Hi ${name}, your required deposit/payment for ${order.id} is still unresolved. Please verify payment soon so the team can keep your slot active.`,
    URGENCY_INCREASE: `Hi ${name}, your slot for ${order.id} is approaching risk because payment has not been verified. Please complete or confirm payment as soon as possible.`,
    RELEASE_WARNING: `Hi ${name}, we still cannot verify payment for ${order.id}. The slot may need owner review or release if payment remains unresolved.`,
    FINAL_RECOVERY_ATTEMPT: `Hi ${name}, final payment verification is needed for ${order.id}. Please respond now so the slot can remain protected.`,
    WAITLIST_REPLACEMENT_ACTIVATION: `Internal recovery: ${order.id} is at high collapse risk. Prepare waitlist replacement while protecting customer trust.`,
    FRAUD_VERIFICATION: `Internal verification: ${order.id} has payment-risk signals. Do not release without payment truth review.`,
    OWNER_STAFF_INTERVENTION: `Owner review requested for ${order.id}. Exposure RM ${amount}; projected recovery likelihood ${recoveryLikelihood}%.`,
  };

  return {
    channel,
    to: channel === "INTERNAL" ? "operations" : order.phone || order.customerName || "unknown",
    subject: channel === "EMAIL" || channel === "INTERNAL" ? `Valsentra recovery orchestration: ${order.id}` : undefined,
    body: bodyByStep[step],
    metadata: {
      orderId: order.id,
      step,
      recoveryLikelihood,
      providerReady: true,
    },
  };
}

export function buildRecoveryConversationContext({
  order,
  auditRows,
}: {
  order: RestaurantOrder;
  auditRows: AuditRow[];
}): RecoveryConversationContext {
  const text = getAuditText(auditRows);
  const attempts = countCommunicationAttempts(auditRows);
  const responded = text.includes("responded") || text.includes("payment verified") || order.paymentVerified;
  const customerResponsiveness = clamp(Number(order.reliabilityScore ?? 70) - attempts * 8 + (responded ? 20 : 0));

  return {
    orderId: order.id,
    activeRecoveryState: text.includes("waitlist")
      ? "WAITLIST_ACTIVATED"
      : text.includes("release warning")
        ? "RELEASE_WARNING_ACTIVE"
        : attempts > 0
          ? "RECOVERY_ACTIVE"
          : "MONITORING",
    unresolvedPaymentState: order.paymentState ?? "UNPAID",
    releaseWarningState: text.includes("final recovery") ? "FINAL" : text.includes("release warning") ? "PREPARED" : "NONE",
    customerResponsiveness,
    interventionHistory: auditRows.slice(0, 6).map((row) => String(row.action ?? "Operational intervention")),
    communicationOutcomes: auditRows
      .filter((row) => row.meta?.communicationOutcome)
      .map((row) => String(row.meta.communicationOutcome)),
  };
}

export function orchestrateRecoveryCommunication({
  order,
  auditRows,
  memory,
  digitalTwin,
  policy,
  waitlistAvailability,
}: {
  order: RestaurantOrder;
  auditRows: AuditRow[];
  memory: OperationalMemorySnapshot;
  digitalTwin: OperationalDigitalTwin;
  policy: OperationalPolicy;
  waitlistAvailability: number;
}): RecoverySequenceDecision {
  const baselineCooldown = Math.round(getCooldown("PAYMENT_REMINDER", policy));
  const priority = chooseStep({
    order,
    auditRows,
    waitlistAvailability,
    cooldownMinutes: baselineCooldown,
  });
  const step = priority.step;
  const channel = chooseChannel(order, step);
  const context = buildRecoveryConversationContext({ order, auditRows });
  const attempts = countCommunicationAttempts(auditRows);
  const lastCommunication = auditRows.find((row) => {
    const action = String(row.action ?? "").toLowerCase();
    return action.includes("reminder") || action.includes("ghost") || action.includes("communication");
  });
  const cooldownMinutes = Math.round(getCooldown(step, policy));
  const sinceLast = minutesSince(lastCommunication?.created_at ?? lastCommunication?.createdAt);
  const branchTwin = digitalTwin.branches.find((branch) => branch.id === (order.locationId ?? "loc-primary"));
  const branchFatigue = branchTwin?.metrics.operationalFatigue ?? digitalTwin.organization.metrics.operationalFatigue;
  const vip = Number(order.reliabilityScore ?? 0) >= 95;
  const communicationFatigue = clamp(attempts * 18 + branchFatigue * 0.35 + (vip ? 12 : 0));
  const suppressionReasons: string[] = [];
  const quietHourActive = isQuietHour() && channel !== "INTERNAL";
  const quietHoursOverrideUsed =
    quietHourActive && canUseDevelopmentQuietHoursOverride(order, step, channel);
  const quietHoursSuppressed = quietHourActive && !quietHoursOverrideUsed;

  if (quietHoursSuppressed) suppressionReasons.push("Quiet hours suppress external outreach.");
  if (sinceLast !== null && sinceLast < cooldownMinutes) suppressionReasons.push(`Cooldown active for ${cooldownMinutes - sinceLast} more minutes.`);
  if (communicationFatigue >= 78) suppressionReasons.push("Communication fatigue risk is too high.");
  if (vip && (step === "RELEASE_WARNING" || step === "FINAL_RECOVERY_ATTEMPT")) {
    suppressionReasons.push("VIP trust protection requires human-reviewed tone before aggressive escalation.");
  }
  if ((order.terminalMismatch || order.paymentState === "BLOCKED") && channel !== "INTERNAL") {
    suppressionReasons.push("Fraud uncertainty requires internal verification before customer outreach.");
  }

  const actionProfile = memory.actionProfiles.find((profile) => profile.action === step || profile.action === "SEND_REMINDER");
  const recoveryLikelihood = clamp(
    (actionProfile?.successRate ?? 50) * 0.35 +
      context.customerResponsiveness * 0.28 +
      policy.recoveryAggressiveness * 0.18 +
      waitlistAvailability * 8 -
      communicationFatigue * 0.16
  );
  const trustRisk = clamp(communicationFatigue * 0.45 + (vip ? 20 : 0) + (step.includes("RELEASE") ? 18 : 0));
  const message = buildMessage({
    order,
    channel,
    step,
    recoveryLikelihood,
  });

  return {
    id: `communication-${order.id}-${step.toLowerCase()}`,
    orderId: order.id,
    channel,
    step,
    responseState: suppressionReasons.length > 0 ? "SUPPRESSED" : "PREPARED",
    attemptCount: attempts + 1,
    escalationStage: Math.min(5, attempts + 1),
    recoveryConfidence: recoveryLikelihood,
    projectedRecoveryLikelihood: recoveryLikelihood,
    trustRisk,
    communicationFatigue,
    cooldownMinutes,
    nextEligibleAt: addMinutes(cooldownMinutes),
    shouldPrepareMessage: suppressionReasons.length === 0,
    suppressed: suppressionReasons.length > 0,
    suppressionReasons,
    message,
    conversationContext: context,
    simulation: {
      recoveryProbability: recoveryLikelihood,
      customerTrustImpact: trustRisk,
      overloadRisk: branchFatigue,
      falsePositiveRisk: actionProfile?.falsePositiveRate ?? 0,
      waitlistOpportunity: clamp(waitlistAvailability * 20),
      escalationEffectiveness: actionProfile?.successRate ?? 50,
    },
    priorityDiagnostics: {
      ...priority.diagnostics,
      cooldownRemainingMinutes:
        sinceLast !== null ? Math.max(0, Math.round(cooldownMinutes - sinceLast)) : priority.diagnostics.cooldownRemainingMinutes,
      customerFacing: channel !== "INTERNAL",
      internalOnly: channel === "INTERNAL",
      quietHoursSuppressed,
      quietHoursOverrideUsed,
    },
    explainability: [
      `${step} selected from payment state ${order.paymentState ?? "UNPAID"} and collapse ${order.collapseProbability ?? 0}%.`,
      priority.diagnostics.selectedReason,
      ...(priority.diagnostics.reminderSkippedReason ? [priority.diagnostics.reminderSkippedReason] : []),
      `Customer responsiveness climate is ${context.customerResponsiveness}/100.`,
      `Branch fatigue is ${branchFatigue}/100.`,
      `Policy recovery aggressiveness is ${policy.recoveryAggressiveness}/100.`,
      ...(quietHoursOverrideUsed
        ? ["Development-only quiet-hours override allowed this WhatsApp payment reminder."]
        : []),
      ...(suppressionReasons.length > 0 ? suppressionReasons : ["Trust protection allows this message to be prepared."]),
    ],
  };
}

export function buildCommunicationClimate({
  orders,
  auditRows,
  memory,
  digitalTwin,
}: {
  orders: RestaurantOrder[];
  auditRows: AuditRow[];
  memory: OperationalMemorySnapshot;
  digitalTwin: OperationalDigitalTwin;
}): CommunicationClimate {
  const activeOrders = orders.filter((order) => order.status !== "PAID" && order.status !== "CANCELLED" && order.status !== "NO_SHOW");
  const communicationRows = auditRows.filter((row) => {
    const action = String(row.action ?? "").toLowerCase();
    return action.includes("reminder") || action.includes("ghost") || action.includes("communication") || row.meta?.communicationOrchestration;
  });
  const successRows = communicationRows.filter((row) => {
    const action = String(row.action ?? "").toLowerCase();
    return action.includes("verified") || action.includes("recovered") || row.meta?.communicationOutcome === "SUCCEEDED";
  });
  const responseLatency = clamp(
    communicationRows.reduce((sum, row) => sum + Number(row.meta?.responseLatencyMinutes ?? 45), 0) /
      Math.max(communicationRows.length, 1)
  );
  const responsiveness = clamp(
    memory.customerProfiles.reduce((sum, profile) => sum + profile.averageReliability - profile.ghostPingCount * 4, 0) /
      Math.max(memory.customerProfiles.length, 1)
  );
  const communicationFatigue = clamp(
    communicationRows.length * 8 + digitalTwin.organization.metrics.operationalFatigue * 0.35
  );

  return {
    communicationPressure: clamp(communicationRows.length * 10 + activeOrders.length * 8),
    recoveryCommunicationLoad: clamp(communicationRows.length * 12),
    escalationEffectiveness: clamp((successRows.length / Math.max(communicationRows.length, 1)) * 100),
    responseLatency,
    customerResponsivenessClimate: responsiveness,
    communicationFatigue,
    activeRecoveryFlows: activeOrders.length,
    trustWarnings: [
      ...(communicationFatigue >= 70 ? ["Communication fatigue is elevated."] : []),
      ...(responseLatency >= 70 ? ["Response latency is slowing recovery."] : []),
      ...(responsiveness <= 45 ? ["Customer responsiveness climate is weak."] : []),
    ],
  };
}
