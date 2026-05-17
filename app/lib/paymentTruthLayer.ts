import type {
  PaymentState,
  PaymentTruthStatus,
  RestaurantOrder,
} from "@/app/lib/domain/restaurant";

export type ProviderPaymentStatus =
  | "PAID"
  | "PENDING"
  | "FAILED"
  | "CANCELLED"
  | "REFUNDED"
  | "UNKNOWN";

export type PaymentProviderTruth = {
  orderId: string;
  organizationId?: string | null;
  locationId?: string | null;
  paymentIntentId?: string | null;
  providerReference?: string | null;
  expectedAmount: number;
  paidAmount: number;
  currency: string;
  paymentStatus: ProviderPaymentStatus;
  callbackSource: string;
  verifiedAt?: string | null;
  mismatchReason?: string | null;
  providerMetadata?: Record<string, unknown>;
};

export type ReleaseGateDecision = {
  canRelease: boolean;
  label: "Confirmed Paid" | "Needs Manager" | "Do Not Release" | "Waiting For Payment";
  blockers: string[];
  reason: string;
  paymentTruthStatus?: PaymentTruthStatus | null;
  requiresManagerReview: boolean;
};

type ReleaseOrderInput = Pick<
  RestaurantOrder,
  | "amount"
  | "depositRequired"
  | "depositPaid"
  | "paymentState"
  | "paymentVerified"
  | "paymentTruthStatus"
  | "paymentTruthSource"
  | "paymentProviderVerifiedAt"
  | "paymentManagerOverrideAt"
  | "paymentManagerOverrideReason"
  | "paymentMismatchReason"
  | "terminalMismatch"
  | "riskLevel"
  | "status"
>;

function numberValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function normalizeProviderPaymentStatus(value: unknown): ProviderPaymentStatus {
  const normalized = String(value ?? "").trim().toUpperCase();

  if (
    normalized === "PAID" ||
    normalized === "SUCCEEDED" ||
    normalized === "SUCCESS" ||
    normalized === "CAPTURED" ||
    normalized === "SETTLED"
  ) {
    return "PAID";
  }

  if (normalized === "PENDING" || normalized === "PROCESSING" || normalized === "AUTHORIZED") {
    return "PENDING";
  }

  if (normalized === "FAILED" || normalized === "DECLINED") return "FAILED";
  if (normalized === "CANCELLED" || normalized === "CANCELED") return "CANCELLED";
  if (normalized === "REFUNDED") return "REFUNDED";

  return "UNKNOWN";
}

export function normalizePaymentTruthPayload(payload: Record<string, any>): PaymentProviderTruth {
  const metadata = payload.metadata && typeof payload.metadata === "object" ? payload.metadata : {};
  const orderId = String(payload.orderId ?? payload.order_id ?? metadata.orderId ?? metadata.order_id ?? "");
  const expectedAmount = numberValue(
    payload.expectedAmount ?? payload.expected_amount ?? payload.amount_expected ?? metadata.expectedAmount
  );
  const paidAmount = numberValue(
    payload.paidAmount ?? payload.paid_amount ?? payload.amount_paid ?? payload.amount ?? metadata.paidAmount
  );
  const paymentStatus = normalizeProviderPaymentStatus(
    payload.paymentStatus ?? payload.payment_status ?? payload.status ?? payload.eventType
  );
  const mismatchReason =
    paymentStatus === "PAID" && expectedAmount > 0 && paidAmount !== expectedAmount
      ? `Expected ${expectedAmount}, provider confirmed ${paidAmount}.`
      : null;

  return {
    orderId,
    organizationId: payload.organizationId ?? payload.organization_id ?? metadata.organizationId ?? null,
    locationId: payload.locationId ?? payload.location_id ?? metadata.locationId ?? null,
    paymentIntentId:
      payload.paymentIntentId ?? payload.payment_intent_id ?? payload.intentId ?? metadata.paymentIntentId ?? null,
    providerReference:
      payload.providerReference ??
      payload.provider_reference ??
      payload.transactionId ??
      payload.transaction_id ??
      payload.reference ??
      metadata.providerReference ??
      null,
    expectedAmount,
    paidAmount,
    currency: String(payload.currency ?? metadata.currency ?? "MYR").toUpperCase(),
    paymentStatus,
    callbackSource: String(payload.provider ?? payload.callbackSource ?? payload.source ?? "payment-provider"),
    verifiedAt:
      payload.verifiedAt ??
      payload.verified_at ??
      payload.paidAt ??
      payload.paid_at ??
      (paymentStatus === "PAID" ? new Date().toISOString() : null),
    mismatchReason,
    providerMetadata: payload,
  };
}

export function paymentTruthToOrderPatch(truth: PaymentProviderTruth): Partial<RestaurantOrder> {
  const mismatch = Boolean(truth.mismatchReason);
  const providerConfirmed = truth.paymentStatus === "PAID" && !mismatch;

  return {
    paymentIntentId: truth.paymentIntentId ?? null,
    paymentProviderReference: truth.providerReference ?? null,
    paymentExpectedAmount: truth.expectedAmount,
    paymentPaidAmount: truth.paidAmount,
    paymentCurrency: truth.currency,
    paymentTruthStatus: providerConfirmed
      ? "PROVIDER_CONFIRMED"
      : mismatch
        ? "AMOUNT_MISMATCH"
        : truth.paymentStatus === "PENDING"
          ? "PENDING_PROVIDER"
          : "FAILED",
    paymentTruthSource: "PROVIDER_CALLBACK",
    paymentProviderVerifiedAt: providerConfirmed ? truth.verifiedAt ?? new Date().toISOString() : null,
    paymentMismatchReason: truth.mismatchReason ?? null,
    paymentProviderMetadata: truth.providerMetadata ?? null,
    paymentState: providerConfirmed ? "VERIFIED" : mismatch ? "BLOCKED" : paymentStateFromProviderStatus(truth.paymentStatus),
    paymentVerified: providerConfirmed,
    terminalMismatch: mismatch,
    protectionReason: providerConfirmed
      ? "Provider confirmed payment"
      : mismatch
        ? "Amount mismatch"
        : "Waiting for provider payment confirmation",
  };
}

function paymentStateFromProviderStatus(status: ProviderPaymentStatus): PaymentState {
  if (status === "PENDING" || status === "UNKNOWN") return "PENDING";
  if (status === "FAILED" || status === "CANCELLED" || status === "REFUNDED") return "FAILED";
  return "PENDING";
}

export function hasProviderPaymentTruth(order: ReleaseOrderInput) {
  return (
    order.paymentTruthStatus === "PROVIDER_CONFIRMED" &&
    order.paymentTruthSource === "PROVIDER_CALLBACK" &&
    Boolean(order.paymentProviderVerifiedAt)
  );
}

export function hasManagerPaymentOverride(order: ReleaseOrderInput) {
  return (
    order.paymentTruthStatus === "MANAGER_OVERRIDE" &&
    order.paymentTruthSource === "MANAGER_OVERRIDE" &&
    Boolean(order.paymentManagerOverrideAt) &&
    Boolean(order.paymentManagerOverrideReason)
  );
}

export function canReleaseOrder(order: ReleaseOrderInput): ReleaseGateDecision {
  const blockers: string[] = [];
  const zeroPaymentFlowAllowed =
    Number(order.amount ?? 0) <= 0 && !order.depositRequired && order.paymentState !== "BLOCKED";

  if (zeroPaymentFlowAllowed) {
    return {
      canRelease: true,
      label: "Confirmed Paid",
      blockers: [],
      reason: "No payment is due for this order.",
      paymentTruthStatus: order.paymentTruthStatus,
      requiresManagerReview: false,
    };
  }

  if (order.paymentState === "UNPAID" || order.status === "UNPAID") {
    blockers.push("Waiting For Payment");
  }

  if (order.paymentState === "PENDING" || order.paymentTruthStatus === "PENDING_PROVIDER") {
    blockers.push("Provider has not confirmed payment yet");
  }

  if (order.paymentTruthStatus === "SCREENSHOT_ONLY") {
    blockers.push("Customer Sent Proof, but provider has not confirmed payment");
  }

  if (order.terminalMismatch || order.paymentTruthStatus === "AMOUNT_MISMATCH") {
    blockers.push(order.paymentMismatchReason || "Amount Mismatch");
  }

  if (order.paymentState === "FAILED" || order.paymentState === "BLOCKED") {
    blockers.push("Needs Manager");
  }

  if (order.riskLevel === "HIGH" && !hasProviderPaymentTruth(order) && !hasManagerPaymentOverride(order)) {
    blockers.push("High-risk payment needs manager review");
  }

  if (hasProviderPaymentTruth(order) || hasManagerPaymentOverride(order)) {
    return {
      canRelease: true,
      label: "Confirmed Paid",
      blockers: [],
      reason: hasProviderPaymentTruth(order)
        ? "Provider confirmed payment server-side."
        : "Manager approved release with a recorded reason.",
      paymentTruthStatus: order.paymentTruthStatus,
      requiresManagerReview: false,
    };
  }

  if (blockers.length === 0 && order.paymentVerified) {
    blockers.push("Payment was marked paid without provider confirmation");
  }

  return {
    canRelease: false,
    label: blockers.some((blocker) => blocker.includes("Waiting")) ? "Waiting For Payment" : "Do Not Release",
    blockers,
    reason: blockers[0] ?? "Payment truth is not confirmed yet.",
    paymentTruthStatus: order.paymentTruthStatus,
    requiresManagerReview: blockers.some((blocker) => blocker.includes("Manager") || blocker.includes("Mismatch")),
  };
}
