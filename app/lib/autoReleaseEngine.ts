import { isExpired } from "./slotTimerEngine";
import {
  evaluateCustomerReliability,
  type CustomerReliabilityProfile,
} from "./reliabilityEngine";
import type { PaymentState } from "./domain/restaurant";

export type AutoReleaseDecision = {
  shouldRelease: boolean;
  reason: string;
  rule: string;
  riskLevel: "LOW" | "MED" | "HIGH";
  confidence: number;
  explanation: string;
  requiresHumanAction: boolean;
};

export function evaluateAutoRelease(order: {
  slotHoldExpiresAt?: string | null;
  paymentState?: PaymentState;
  autoReleaseEligible?: boolean;
  status?: string;
  amount?: number;
  riskLevel?: "LOW" | "MED" | "HIGH";
  customerProfile?: CustomerReliabilityProfile;
}): AutoReleaseDecision {
  const reliabilityDecision = order.customerProfile
    ? evaluateCustomerReliability(order.customerProfile)
    : null;

  if (!order.autoReleaseEligible) {
    return {
      shouldRelease: false,
      reason: "Auto-release disabled for this order",
      rule: "AUTO_RELEASE_DISABLED",
      riskLevel: "LOW",
      confidence: 0,
      explanation: "Order is not eligible for automatic release",
      requiresHumanAction: false,
    };
  }

  if (order.status === "PAID") {
    return {
      shouldRelease: false,
      reason: "Order already paid",
      rule: "ORDER_ALREADY_PAID",
      riskLevel: "LOW",
      confidence: 0,
      explanation: "Paid orders should never be auto-released.",
      requiresHumanAction: false,
    };
  }

  if (order.status === "CANCELLED" || order.status === "NO_SHOW") {
    return {
      shouldRelease: false,
      reason: "Order already closed",
      rule: "ORDER_ALREADY_CLOSED",
      riskLevel: "LOW",
      confidence: 0,
      explanation: "Closed orders do not need another release decision.",
      requiresHumanAction: false,
    };
  }

  if (!order.slotHoldExpiresAt) {
    return {
      shouldRelease: false,
      reason: "No slot expiry set",
      rule: "NO_EXPIRY",
      riskLevel: "LOW",
      confidence: 0,
      explanation: "System cannot determine expiry without slotHoldExpiresAt",
      requiresHumanAction: true,
    };
  }

  const expired = isExpired(order.slotHoldExpiresAt);

  if (!expired) {
    return {
      shouldRelease: false,
      reason: "Slot still active",
      rule: "NOT_EXPIRED",
      riskLevel: "LOW",
      confidence: 0,
      explanation: "Customer still has time to complete payment",
      requiresHumanAction: false,
    };
  }

  if (order.paymentState === "VERIFIED") {
    return {
      shouldRelease: false,
      reason: "Payment already verified",
      rule: "PAYMENT_VERIFIED",
      riskLevel: "LOW",
      confidence: 0,
      explanation: "Order is fully paid, no need to release slot",
      requiresHumanAction: false,
    };
  }

  const riskLevel = order.riskLevel ?? "MED";

  if (reliabilityDecision?.band === "VIP") {
    return {
      shouldRelease: false,
      reason: "VIP customer requires manual review before release",
      rule: "VIP_MANUAL_REVIEW",
      riskLevel: "LOW",
      confidence: 60,
      explanation:
        "Customer has excellent reliability history, so Valsentra avoids auto-releasing immediately without staff review.",
      requiresHumanAction: true,
    };
  }

  if (reliabilityDecision?.band === "BLACKLISTED") {
    return {
      shouldRelease: true,
      reason: "Blacklisted customer did not verify payment before expiry",
      rule: "BLACKLISTED_EXPIRED_UNPAID_SLOT",
      riskLevel: "HIGH",
      confidence: 98,
      explanation:
        "Customer has severe reliability issues and failed to complete payment before expiry. Valsentra releases the slot to protect capacity.",
      requiresHumanAction: false,
    };
  }

  let confidence = 70;

  if (riskLevel === "HIGH") confidence = 90;
  if (riskLevel === "LOW") confidence = 50;

  if (reliabilityDecision?.band === "RISKY") confidence = Math.max(confidence, 88);
  if (reliabilityDecision?.band === "WATCH") confidence = Math.max(confidence, 78);

  return {
    shouldRelease: true,
    reason: "Slot expired without verified payment",
    rule: reliabilityDecision
      ? `EXPIRED_UNPAID_SLOT_${reliabilityDecision.band}`
      : "EXPIRED_UNPAID_SLOT",
    riskLevel,
    confidence,
    explanation: reliabilityDecision
      ? `${reliabilityDecision.explanation} Customer also failed to complete payment before expiry, so Valsentra released the slot to prevent revenue loss.`
      : "Customer failed to complete payment before expiry, system released slot to prevent revenue loss",
    requiresHumanAction: false,
  };
}

/* 🔙 BACKWARD COMPAT */
export function shouldAutoRelease(order: any) {
  return evaluateAutoRelease(order).shouldRelease;
}

export function getAutoReleaseReason() {
  return "Slot expired without verified payment";
}
