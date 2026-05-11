export type ReliabilityEvent =
  | "ORDER_COMPLETED"
  | "DEPOSIT_PAID"
  | "ORDER_CANCELLED"
  | "NO_SHOW"
  | "LATE_ARRIVAL"
  | "FRAUD_ATTEMPT"
  | "PAYMENT_VERIFIED"
  | "PAYMENT_FAILED"
  | "SCREENSHOT_SUBMITTED";

export type ReliabilityBand =
  | "BLACKLISTED"
  | "RISKY"
  | "WATCH"
  | "TRUSTED"
  | "VIP";

export type CustomerReliabilityProfile = {
  customerName?: string;
  phone?: string;
  completed: number;
  cancelled: number;
  noShows: number;
  depositsPaid: number;
  late: number;
  fraudAttempts?: number;
  paymentVerified?: number;
  paymentFailed?: number;
  screenshotsSubmitted?: number;
};

export type ReliabilityDecision = {
  score: number;
  band: ReliabilityBand;
  shouldRequireDeposit: boolean;
  shouldBlock: boolean;
  explanation: string;
};

const RELIABILITY_WEIGHTS: Record<ReliabilityEvent, number> = {
  ORDER_COMPLETED: 2,
  DEPOSIT_PAID: 5,
  ORDER_CANCELLED: -10,
  NO_SHOW: -25,
  LATE_ARRIVAL: -5,
  FRAUD_ATTEMPT: -40,
  PAYMENT_VERIFIED: 3,
  PAYMENT_FAILED: -20,
  SCREENSHOT_SUBMITTED: -3,
};

function clampScore(score: number) {
  if (score > 100) return 100;
  if (score < 0) return 0;
  return Math.round(score);
}

export function applyReliabilityEvent(
  currentScore: number,
  event: ReliabilityEvent
) {
  const safeCurrentScore = Number.isFinite(currentScore) ? currentScore : 70;
  const nextScore = safeCurrentScore + RELIABILITY_WEIGHTS[event];

  return clampScore(nextScore);
}

export function calculateReliability(customer: CustomerReliabilityProfile) {
  let score = 70;

  score += customer.completed * 2;
  score += customer.depositsPaid * 5;
  score += (customer.paymentVerified ?? 0) * 3;

  score -= customer.cancelled * 10;
  score -= customer.noShows * 25;
  score -= customer.late * 5;
  score -= (customer.fraudAttempts ?? 0) * 40;
  score -= (customer.paymentFailed ?? 0) * 20;
  score -= (customer.screenshotsSubmitted ?? 0) * 3;

  return clampScore(score);
}

export function getReliabilityBand(score: number): ReliabilityBand {
  if (score <= 10) return "BLACKLISTED";
  if (score < 50) return "RISKY";
  if (score < 75) return "WATCH";
  if (score >= 90) return "VIP";
  return "TRUSTED";
}

export function evaluateCustomerReliability(
  customer: CustomerReliabilityProfile
): ReliabilityDecision {
  const score = calculateReliability(customer);
  const band = getReliabilityBand(score);

  if (band === "BLACKLISTED") {
    return {
      score,
      band,
      shouldRequireDeposit: true,
      shouldBlock: true,
      explanation:
        "Customer is blacklisted due to severe reliability issues. Owner approval is required before accepting new orders.",
    };
  }

  if (band === "RISKY") {
    return {
      score,
      band,
      shouldRequireDeposit: true,
      shouldBlock: false,
      explanation:
        "Customer has weak reliability history. Deposit should be required before holding capacity.",
    };
  }

  if (band === "WATCH") {
    return {
      score,
      band,
      shouldRequireDeposit: true,
      shouldBlock: false,
      explanation:
        "Customer is not dangerous, but history is mixed. Valsentra should protect the slot with a deposit.",
    };
  }

  if (band === "VIP") {
    return {
      score,
      band,
      shouldRequireDeposit: false,
      shouldBlock: false,
      explanation:
        "Customer has excellent reliability history. Normal payment flow is acceptable.",
    };
  }

  return {
    score,
    band,
    shouldRequireDeposit: false,
    shouldBlock: false,
    explanation:
      "Customer has trusted reliability history. Standard protection rules are enough.",
  };
}

export function buildReliabilityProfileFromOrders(
  orders: Array<{
    customerName?: string;
    phone?: string;
    status?: string;
    depositPaid?: boolean;
    paymentVerified?: boolean;
    paymentState?: string;
    terminalMismatch?: boolean;
  }>
): CustomerReliabilityProfile {
  const firstOrder = orders[0];

  const profile: CustomerReliabilityProfile = {
    customerName: firstOrder?.customerName,
    phone: firstOrder?.phone,
    completed: 0,
    cancelled: 0,
    noShows: 0,
    depositsPaid: 0,
    late: 0,
    fraudAttempts: 0,
    paymentVerified: 0,
    paymentFailed: 0,
    screenshotsSubmitted: 0,
  };

  for (const order of orders) {
    if (order.status === "PAID") profile.completed += 1;
    if (order.status === "CANCELLED") profile.cancelled += 1;
    if (order.status === "NO_SHOW") profile.noShows += 1;
    if (order.depositPaid) profile.depositsPaid += 1;
    if (order.paymentVerified || order.paymentState === "VERIFIED") {
      profile.paymentVerified = (profile.paymentVerified ?? 0) + 1;
    }
    if (order.paymentState === "FAILED" || order.paymentState === "BLOCKED") {
      profile.paymentFailed = (profile.paymentFailed ?? 0) + 1;
    }
    if (order.paymentState === "PENDING") {
      profile.screenshotsSubmitted = (profile.screenshotsSubmitted ?? 0) + 1;
    }
    if (order.terminalMismatch) {
      profile.fraudAttempts = (profile.fraudAttempts ?? 0) + 1;
    }
  }

  return profile;
}