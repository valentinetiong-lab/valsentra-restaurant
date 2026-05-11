export type CollapseRiskTier = "STABLE" | "WATCH" | "AT_RISK" | "CRITICAL";

export type RecommendedIntervention =
  | "NONE"
  | "GHOST_PING"
  | "DEPOSIT_ESCALATION"
  | "PAYMENT_REMINDER"
  | "PREPARE_WAITLIST"
  | "RELEASE_AND_RECOVER";

export type CollapseProbabilityInput = {
  amount: number;
  guests?: number;
  orderType?: string;
  paymentState?: string;
  paymentVerified?: boolean;
  depositRequired?: boolean;
  depositPaid?: boolean;
  reliabilityScore?: number;
  riskLevel?: "LOW" | "MED" | "HIGH";
  slotHoldExpiresAt?: string | null;
  reservationTime?: string | null;
  terminalMismatch?: boolean;
  awaitingDetails?: boolean;
};

export type CollapseProbabilityResult = {
  collapseProbability: number;
  riskTier: CollapseRiskTier;
  recommendedIntervention: RecommendedIntervention;
  instabilityFactors: string[];
  explanation: string;
};

function clamp(value: number) {
  return Math.max(0, Math.min(value, 100));
}

function minutesUntil(value?: string | null) {
  if (!value) return null;

  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return null;

  return (time - Date.now()) / 60000;
}

function getRiskTier(score: number): CollapseRiskTier {
  if (score >= 80) return "CRITICAL";
  if (score >= 60) return "AT_RISK";
  if (score >= 35) return "WATCH";
  return "STABLE";
}

function getRecommendedIntervention(
  score: number,
  input: CollapseProbabilityInput
): RecommendedIntervention {
  const holdMinutesLeft = minutesUntil(input.slotHoldExpiresAt);

  if (input.paymentState === "VERIFIED" || input.paymentVerified) {
    return "NONE";
  }

  if (score >= 85 && holdMinutesLeft !== null && holdMinutesLeft <= 0) {
    return "RELEASE_AND_RECOVER";
  }

  if (score >= 75) {
    return "PREPARE_WAITLIST";
  }

  if (input.depositRequired && !input.depositPaid) {
    return "DEPOSIT_ESCALATION";
  }

  if (input.paymentState === "PENDING" || input.paymentState === "UNPAID") {
    return "PAYMENT_REMINDER";
  }

  if (score >= 45) {
    return "GHOST_PING";
  }

  return "NONE";
}

export function evaluateCollapseProbability(
  input: CollapseProbabilityInput
): CollapseProbabilityResult {
  let score = 10;
  const factors: string[] = [];

  const amount = Number(input.amount ?? 0);
  const reliability = Number(input.reliabilityScore ?? 70);
  const holdMinutesLeft = minutesUntil(input.slotHoldExpiresAt);
  const reservationMinutesLeft = minutesUntil(input.reservationTime);

  if (input.paymentState !== "VERIFIED" && !input.paymentVerified) {
    score += 18;
    factors.push("Payment not verified");
  }

  if (input.paymentState === "PENDING") {
    score += 12;
    factors.push("Payment still pending");
  }

  if (input.paymentState === "FAILED" || input.paymentState === "BLOCKED") {
    score += 30;
    factors.push("Payment failed or blocked");
  }

  if (input.depositRequired && !input.depositPaid) {
    score += 18;
    factors.push("Required deposit not paid");
  }

  if (reliability < 50) {
    score += 22;
    factors.push("Low customer reliability");
  } else if (reliability < 75) {
    score += 10;
    factors.push("Mixed customer reliability");
  }

  if (input.riskLevel === "HIGH") {
    score += 20;
    factors.push("High-risk order");
  } else if (input.riskLevel === "MED") {
    score += 10;
    factors.push("Medium-risk order");
  }

  if (amount >= 300) {
    score += 12;
    factors.push("High-value slot");
  } else if (amount >= 150) {
    score += 6;
    factors.push("Moderate-value slot");
  }

  if ((input.guests ?? 1) >= 6) {
    score += 10;
    factors.push("Large party size");
  }

  if (holdMinutesLeft !== null && holdMinutesLeft <= 0) {
    score += 25;
    factors.push("Slot hold expired");
  } else if (holdMinutesLeft !== null && holdMinutesLeft <= 10) {
    score += 15;
    factors.push("Slot hold close to expiry");
  }

  if (reservationMinutesLeft !== null && reservationMinutesLeft <= 60) {
    score += 12;
    factors.push("Reservation is soon");
  }

  if (input.terminalMismatch) {
    score += 30;
    factors.push("Terminal/payment mismatch detected");
  }

  if (input.awaitingDetails) {
    score += 10;
    factors.push("Recovered order still awaiting details");
  }

  const collapseProbability = clamp(Math.round(score));
  const riskTier = getRiskTier(collapseProbability);
  const recommendedIntervention = getRecommendedIntervention(
    collapseProbability,
    input
  );

  return {
    collapseProbability,
    riskTier,
    recommendedIntervention,
    instabilityFactors: factors,
    explanation:
      factors.length === 0
        ? "Booking appears stable. No immediate intervention needed."
        : `Collapse risk is driven by: ${factors.join(", ")}.`,
  };
}