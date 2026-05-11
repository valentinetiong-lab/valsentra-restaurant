export type GhostPingUrgency =
  | "LOW"
  | "MEDIUM"
  | "HIGH"
  | "CRITICAL";

export type GhostPingMessageType =
  | "SOFT_CONFIRMATION"
  | "PAYMENT_REMINDER"
  | "FINAL_CONFIRMATION"
  | "RECOVERY_WARNING";

export type GhostPingEscalationStage =
  | "NONE"
  | "WATCH"
  | "ESCALATED"
  | "RECOVERY_READY";

export type GhostPingInput = {
  collapseProbability?: number;
  collapseRiskTier?: string;

  paymentState?: string;
  paymentVerified?: boolean;

  depositRequired?: boolean;
  depositPaid?: boolean;

  reservationTime?: string | null;

  lastReminderSentAt?: string | null;

  recommendedIntervention?: string;

  instabilityFactors?: string[];
};

export type GhostPingResult = {
  shouldSendGhostPing: boolean;

  urgencyLevel: GhostPingUrgency;

  messageType: GhostPingMessageType;

  escalationStage: GhostPingEscalationStage;

  recommendedDelayMinutes: number;

  reasoning: string;
};

function minutesUntil(value?: string | null) {
  if (!value) return null;

  const timestamp = new Date(value).getTime();

  if (Number.isNaN(timestamp)) {
    return null;
  }

  return Math.floor((timestamp - Date.now()) / 60000);
}

export function evaluateGhostPing(
  input: GhostPingInput
): GhostPingResult {
  const collapseProbability = Number(input.collapseProbability ?? 0);

  const reservationMinutesLeft = minutesUntil(
    input.reservationTime
  );

  const instabilityFactors = input.instabilityFactors ?? [];

  let urgencyLevel: GhostPingUrgency = "LOW";

  let messageType: GhostPingMessageType =
    "SOFT_CONFIRMATION";

  let escalationStage: GhostPingEscalationStage =
    "NONE";

  let recommendedDelayMinutes = 30;

  let shouldSendGhostPing = false;

  const reasoning: string[] = [];

  if (collapseProbability >= 35) {
    shouldSendGhostPing = true;

    urgencyLevel = "MEDIUM";

    escalationStage = "WATCH";

    recommendedDelayMinutes = 20;

    reasoning.push(
      "Collapse probability crossed watch threshold"
    );
  }

  if (
    collapseProbability >= 60 ||
    input.paymentState === "PENDING"
  ) {
    shouldSendGhostPing = true;

    urgencyLevel = "HIGH";

    messageType = "PAYMENT_REMINDER";

    escalationStage = "ESCALATED";

    recommendedDelayMinutes = 10;

    reasoning.push(
      "Payment instability detected"
    );
  }

  if (
    collapseProbability >= 75 ||
    (input.depositRequired && !input.depositPaid)
  ) {
    shouldSendGhostPing = true;

    urgencyLevel = "HIGH";

    messageType = "FINAL_CONFIRMATION";

    escalationStage = "ESCALATED";

    recommendedDelayMinutes = 5;

    reasoning.push(
      "Booking approaching collapse conditions"
    );
  }

  if (
    collapseProbability >= 90
  ) {
    shouldSendGhostPing = true;

    urgencyLevel = "CRITICAL";

    messageType = "RECOVERY_WARNING";

    escalationStage = "RECOVERY_READY";

    recommendedDelayMinutes = 0;

    reasoning.push(
      "Recovery protocol should prepare"
    );
  }

  if (
    reservationMinutesLeft !== null &&
    reservationMinutesLeft <= 60
  ) {
    recommendedDelayMinutes = Math.min(
      recommendedDelayMinutes,
      5
    );

    reasoning.push(
      "Reservation time is close"
    );
  }

  if (
    instabilityFactors.includes(
      "Terminal/payment mismatch detected"
    )
  ) {
    urgencyLevel = "CRITICAL";

    escalationStage = "RECOVERY_READY";

    messageType = "RECOVERY_WARNING";

    shouldSendGhostPing = true;

    reasoning.push(
      "Terminal mismatch triggered critical escalation"
    );
  }

  return {
    shouldSendGhostPing,

    urgencyLevel,

    messageType,

    escalationStage,

    recommendedDelayMinutes,

    reasoning:
      reasoning.length === 0
        ? "Booking currently stable."
        : reasoning.join(", "),
  };
}