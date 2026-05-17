import type {
  PaymentProvider,
  PaymentProviderInput,
  PaymentProviderResult,
} from "@/app/lib/providers/payment/paymentProviderTypes";
import { createDuitNowProvider } from "@/app/lib/providers/payment/duitNowProvider";

function configuredProviderName() {
  return process.env.PAYMENT_PROVIDER?.trim() || "not-configured";
}

function isPaymentProviderConfigured() {
  return Boolean(
    process.env.PAYMENT_PROVIDER &&
      process.env.PAYMENT_PROVIDER_API_KEY &&
      process.env.PAYMENT_PROVIDER_MERCHANT_ID
  );
}

export function getPaymentProviderStatus() {
  const configured = isPaymentProviderConfigured();

  return {
    provider: configuredProviderName(),
    configured,
    livePaymentsEnabled: configured,
    status: configured ? "READY" : "NOT_CONFIGURED",
    reason: configured
      ? "Payment provider is configured behind the provider boundary."
      : "Payment provider boundary is ready, but live payment creation/verification is disabled until provider env vars are configured.",
  };
}

export function createPaymentProvider(): PaymentProvider {
  if (process.env.PAYMENT_PROVIDER === "duitnow") {
    return createDuitNowProvider();
  }

  const configured = isPaymentProviderConfigured();

  return {
    name: configuredProviderName(),
    mode: configured ? "PROVIDER_READY" : "NOT_CONFIGURED",
    canExecute() {
      return configured;
    },
    async execute(input: PaymentProviderInput): Promise<PaymentProviderResult> {
      return {
        ok: false,
          provider: configuredProviderName(),
          mode: configured ? "PROVIDER_READY" : "NOT_CONFIGURED",
        status: "SUPPRESSED",
        error:
          "Live payment provider execution is not enabled yet. Staff payment state changes still use the existing Payment Truth safety flow.",
        retryable: false,
          metadata: {
          providerReady: true,
          livePaymentExecuted: false,
          action: input.action,
          organizationId: input.organizationId,
          locationId: input.locationId ?? null,
          orderId: input.orderId,
          },
      };
    },
    verifyWebhookSignature() {
      return {
        ok: process.env.NODE_ENV !== "production",
        configured: false,
        reason:
          process.env.NODE_ENV === "production"
            ? "Payment webhook signing secret is required in production."
            : "Payment webhook signing secret is not configured; development callback accepted.",
      };
    },
    normalizeCallbackPayload(payload: Record<string, any>) {
      const metadata = payload.metadata && typeof payload.metadata === "object" ? payload.metadata : {};
      return {
        orderId: String(payload.orderId ?? payload.order_id ?? metadata.orderId ?? ""),
        organizationId: payload.organizationId ?? payload.organization_id ?? metadata.organizationId ?? null,
        locationId: payload.locationId ?? payload.location_id ?? metadata.locationId ?? null,
        paymentIntentId: payload.paymentIntentId ?? payload.payment_intent_id ?? null,
        providerReference:
          payload.providerReference ?? payload.provider_reference ?? payload.reference ?? null,
        expectedAmount: payload.expectedAmount ?? payload.expected_amount ?? null,
        paidAmount: Number(payload.paidAmount ?? payload.paid_amount ?? payload.amount ?? 0),
        currency: String(payload.currency ?? metadata.currency ?? "MYR").toUpperCase(),
        paymentStatus: String(payload.status ?? payload.paymentStatus ?? "UNKNOWN"),
        callbackSource: configuredProviderName(),
        verifiedAt: payload.verifiedAt ?? payload.verified_at ?? payload.paidAt ?? payload.paid_at ?? null,
        providerMetadata: payload,
      };
    },
    async getPaymentStatus(input: PaymentProviderInput): Promise<PaymentProviderResult> {
      return this.execute({ ...input, action: "GET_PAYMENT_STATUS" });
    },
    async cancelPaymentRequest(input: PaymentProviderInput): Promise<PaymentProviderResult> {
      return this.execute({ ...input, action: "CANCEL_PAYMENT_REQUEST" });
    },
  };
}
