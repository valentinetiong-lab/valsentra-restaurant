import type { PaymentState, RestaurantOrder } from "../domain/restaurant";

export const PAYMENT_STATES = [
  "UNPAID",
  "PENDING",
  "VERIFIED",
  "FAILED",
  "BLOCKED",
] as const satisfies readonly PaymentState[];

export function normalisePaymentState(value?: string | null): PaymentState {
  if (value === "VERIFIED") return "VERIFIED";
  if (value === "FAILED" || value === "SUSPICIOUS") return "FAILED";
  if (value === "BLOCKED") return "BLOCKED";
  if (value === "PENDING" || value === "LINK_SENT" || value === "SCREENSHOT_SUBMITTED") {
    return "PENDING";
  }
  return "UNPAID";
}

export function isPaymentVerified(order: Pick<RestaurantOrder, "paymentState" | "paymentVerified" | "status">) {
  return order.status === "PAID" || order.paymentState === "VERIFIED" || Boolean(order.paymentVerified);
}

export function isPaymentPending(paymentState?: PaymentState) {
  return paymentState === "PENDING";
}

export function isPaymentFailed(paymentState?: PaymentState) {
  return paymentState === "FAILED";
}

export function isPaymentBlocked(paymentState?: PaymentState) {
  return paymentState === "BLOCKED";
}

export function isPaymentSuspicious(order: Pick<RestaurantOrder, "paymentState" | "terminalMismatch">) {
  return order.terminalMismatch || order.paymentState === "FAILED" || order.paymentState === "BLOCKED";
}

export function isPaymentLocked(paymentState?: PaymentState) {
  return (
    paymentState === "UNPAID" ||
    paymentState === "PENDING" ||
    paymentState === "FAILED" ||
    paymentState === "BLOCKED"
  );
}

export function getPaymentStateLabel(paymentState?: PaymentState) {
  return paymentState ?? "UNPAID";
}

export function createUnpaidPaymentState(): PaymentState {
  return "UNPAID";
}

export function sendPaymentLinkTransition(): PaymentState {
  // Provider-ready state transition only: this marks intent/link workflow state, not a real payment-provider send.
  return "PENDING";
}

export function submitScreenshotTransition(): PaymentState {
  // Manual verification placeholder: screenshot submission remains internal until a real payment provider is connected.
  return "PENDING";
}

export function failPaymentTransition(): PaymentState {
  return "FAILED";
}

export function blockPaymentTransition(): PaymentState {
  return "BLOCKED";
}
