import {
  evaluateCustomerReliability,
  type CustomerReliabilityProfile,
} from "./reliabilityEngine";

type OrderType =
  | "DINE_IN_RESERVATION"
  | "PREORDER_PICKUP"
  | "DELIVERY_PREORDER";

type DepositDecisionInput = {
  orderType: OrderType;
  guests: number;
  amount: number;

  // Supports old staff page calls
  reliabilityScore?: number;
  lowReliabilityThreshold?: number;

  // Supports new reliability engine calls
  customerProfile?: CustomerReliabilityProfile;

  dineInDepositGuestsThreshold: number;
  pickupDepositAmountThreshold: number;
  requireDeliveryDeposit: boolean;
};

export type DepositDecision = {
  required: boolean;
  depositAmount: number;
  reason: string;
  rule?: string;
  confidence?: number;
};

function roundToTwo(value: number) {
  return Math.round(value * 100) / 100;
}

function buildFallbackProfile(input: DepositDecisionInput): CustomerReliabilityProfile {
  const score = input.reliabilityScore ?? 70;

  return {
    completed: score >= 75 ? 1 : 0,
    cancelled: score < 60 ? 1 : 0,
    noShows: score < 40 ? 1 : 0,
    depositsPaid: score >= 70 ? 1 : 0,
    late: score < 50 ? 1 : 0,
    fraudAttempts: score <= 10 ? 1 : 0,
    paymentVerified: score >= 75 ? 1 : 0,
    paymentFailed: score < 50 ? 1 : 0,
    screenshotsSubmitted: 0,
  };
}

export function calculateDepositDecision(
  input: DepositDecisionInput
): DepositDecision {
  let required = false;
  let reason = "No deposit required";
  let rule = "NONE";
  let confidence = 60;

  const customerProfile = input.customerProfile ?? buildFallbackProfile(input);
  const reliabilityDecision = evaluateCustomerReliability(customerProfile);

  if (reliabilityDecision.shouldBlock) {
    return {
      required: true,
      depositAmount: roundToTwo(input.amount),
      reason: "Blacklisted customer → full payment required",
      rule: "BLACKLISTED_CUSTOMER",
      confidence: 95,
    };
  }

  if (reliabilityDecision.shouldRequireDeposit) {
    required = true;
    reason = reliabilityDecision.explanation;
    rule = `RELIABILITY_${reliabilityDecision.band}`;
    confidence = 85;
  }

  if (
    input.lowReliabilityThreshold !== undefined &&
    input.reliabilityScore !== undefined &&
    input.reliabilityScore <= input.lowReliabilityThreshold
  ) {
    required = true;
    reason = "Low reliability customer";
    rule = "LOW_RELIABILITY_SCORE";
    confidence = Math.max(confidence, 80);
  }

  if (
    input.orderType === "DINE_IN_RESERVATION" &&
    input.guests >= input.dineInDepositGuestsThreshold
  ) {
    required = true;
    reason = "Large dine-in booking";
    rule = "DINE_IN_LARGE_GROUP";
    confidence = Math.max(confidence, 75);
  }

  if (
    input.orderType === "PREORDER_PICKUP" &&
    input.amount >= input.pickupDepositAmountThreshold
  ) {
    required = true;
    reason = "High-value pickup order";
    rule = "HIGH_VALUE_PICKUP";
    confidence = Math.max(confidence, 75);
  }

  if (
    input.orderType === "DELIVERY_PREORDER" &&
    input.requireDeliveryDeposit
  ) {
    required = true;
    reason = "Delivery orders require deposit";
    rule = "DELIVERY_POLICY";
    confidence = Math.max(confidence, 70);
  }

  let depositAmount = 0;

  if (required) {
    if (reliabilityDecision.band === "VIP") {
      depositAmount = roundToTwo(input.amount * 0.1);
    } else if (reliabilityDecision.band === "RISKY") {
      depositAmount = roundToTwo(input.amount * 0.5);
    } else {
      depositAmount = roundToTwo(input.amount * 0.3);
    }
  }

  return {
    required,
    depositAmount,
    reason,
    rule,
    confidence,
  };
}