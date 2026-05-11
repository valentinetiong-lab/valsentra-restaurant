import type { PaymentState } from "./domain/restaurant";
import type { ReliabilityEvent } from "./reliabilityEngine";
import {
  blockPaymentTransition,
  createUnpaidPaymentState,
  failPaymentTransition,
  getPaymentStateLabel,
  isPaymentLocked,
  isPaymentVerified,
  sendPaymentLinkTransition,
  submitScreenshotTransition,
} from "./engines/paymentEngine";

export type { PaymentState };

export type PaymentVerificationDecision = {
  paymentState: PaymentState;
  paymentVerified: boolean;
  terminalMismatch: boolean;
  shouldBlock: boolean;
  reliabilityEvent?: ReliabilityEvent;
  reason: string;
};

export {
  blockPaymentTransition,
  createUnpaidPaymentState,
  failPaymentTransition,
  getPaymentStateLabel,
  isPaymentLocked,
  isPaymentVerified,
  sendPaymentLinkTransition,
  submitScreenshotTransition,
};

export function verifyPaymentAmount(
  expectedAmount: number,
  receivedAmount: number
): PaymentVerificationDecision {
  if (Number.isNaN(receivedAmount) || receivedAmount <= 0) {
    return {
      paymentState: "FAILED",
      paymentVerified: false,
      terminalMismatch: true,
      shouldBlock: true,
      reliabilityEvent: "FRAUD_ATTEMPT",
      reason: "Invalid payment amount entered",
    };
  }

  if (receivedAmount !== expectedAmount) {
    return {
      paymentState: "BLOCKED",
      paymentVerified: false,
      terminalMismatch: true,
      shouldBlock: true,
      reliabilityEvent: "FRAUD_ATTEMPT",
      reason: `Payment mismatch. Expected ${expectedAmount}, got ${receivedAmount}`,
    };
  }

  return {
    paymentState: "VERIFIED",
    paymentVerified: true,
    terminalMismatch: false,
    shouldBlock: false,
    reliabilityEvent: "ORDER_COMPLETED",
    reason: "Payment verified successfully",
  };
}

