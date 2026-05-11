export type LearningEventType =
  | "ORDER_CREATED"
  | "PAYMENT_LINK_SENT"
  | "PAYMENT_VERIFIED"
  | "PAYMENT_FAILED"
  | "TERMINAL_MISMATCH"
  | "DEPOSIT_PAID"
  | "REMINDER_SENT"
  | "GHOST_PING_RECOMMENDED"
  | "GHOST_PING_SENT"
  | "ORDER_CANCELLED"
  | "NO_SHOW"
  | "AUTO_RELEASED"
  | "WAITLIST_RECOVERY_ATTEMPTED"
  | "WAITLIST_RECOVERY_SUCCEEDED"
  | "WAITLIST_RECOVERY_FAILED"
  | "CUSTOMER_SHOWED_UP";

export type LearningOutcome =
  | "POSITIVE"
  | "NEUTRAL"
  | "NEGATIVE"
  | "UNKNOWN";

export type ContinuousLearningInput = {
  orderId: string;
  customerName?: string;
  phone?: string;
  eventType: LearningEventType;
  outcome?: LearningOutcome;
  collapseProbability?: number;
  collapseRiskTier?: string;
  recommendedIntervention?: string;
  ghostPingUrgency?: string;
  ghostPingMessageType?: string;
  reliabilityScore?: number;
  amount?: number;
  orderType?: string;
  notes?: string;
};

export type ContinuousLearningEntry = {
  orderId: string;
  customerName?: string;
  phone?: string;
  eventType: LearningEventType;
  outcome: LearningOutcome;
  signalWeight: number;
  learningSummary: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};

function getSignalWeight(eventType: LearningEventType, outcome: LearningOutcome) {
  if (eventType === "NO_SHOW") return -30;
  if (eventType === "PAYMENT_FAILED") return -20;
  if (eventType === "TERMINAL_MISMATCH") return -25;
  if (eventType === "ORDER_CANCELLED") return -12;
  if (eventType === "AUTO_RELEASED") return -15;

  if (eventType === "PAYMENT_VERIFIED") return 18;
  if (eventType === "DEPOSIT_PAID") return 12;
  if (eventType === "CUSTOMER_SHOWED_UP") return 25;
  if (eventType === "WAITLIST_RECOVERY_SUCCEEDED") return 20;

  if (outcome === "POSITIVE") return 10;
  if (outcome === "NEGATIVE") return -10;

  return 0;
}

function buildLearningSummary(input: ContinuousLearningInput, signalWeight: number) {
  const customer = input.customerName || input.phone || "Customer";

  if (signalWeight > 0) {
    return `${customer} generated a positive reliability signal from ${input.eventType}.`;
  }

  if (signalWeight < 0) {
    return `${customer} generated a negative reliability signal from ${input.eventType}.`;
  }

  return `${customer} generated a neutral operational signal from ${input.eventType}.`;
}

export function createContinuousLearningEntry(
  input: ContinuousLearningInput
): ContinuousLearningEntry {
  const outcome = input.outcome ?? "UNKNOWN";
  const signalWeight = getSignalWeight(input.eventType, outcome);

  return {
    orderId: input.orderId,
    customerName: input.customerName,
    phone: input.phone,
    eventType: input.eventType,
    outcome,
    signalWeight,
    learningSummary: buildLearningSummary(input, signalWeight),
    metadata: {
      collapseProbability: input.collapseProbability,
      collapseRiskTier: input.collapseRiskTier,
      recommendedIntervention: input.recommendedIntervention,
      ghostPingUrgency: input.ghostPingUrgency,
      ghostPingMessageType: input.ghostPingMessageType,
      reliabilityScore: input.reliabilityScore,
      amount: input.amount,
      orderType: input.orderType,
      notes: input.notes,
    },
    createdAt: new Date().toISOString(),
  };
}