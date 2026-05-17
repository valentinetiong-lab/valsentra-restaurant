import { createHmac, timingSafeEqual } from "crypto";
import type {
  PaymentProvider,
  PaymentProviderCallback,
  PaymentProviderInput,
  PaymentProviderResult,
  PaymentWebhookVerificationResult,
} from "@/app/lib/providers/payment/paymentProviderTypes";

type DuitNowConfig = {
  apiKey: string;
  merchantId: string;
  requestUrl?: string;
  statusUrl?: string;
  cancelUrl?: string;
  webhookSecret?: string;
};

function getConfig(): DuitNowConfig | null {
  if (process.env.PAYMENT_PROVIDER !== "duitnow") return null;
  if (!process.env.PAYMENT_PROVIDER_API_KEY || !process.env.PAYMENT_PROVIDER_MERCHANT_ID) {
    return null;
  }

  return {
    apiKey: process.env.PAYMENT_PROVIDER_API_KEY,
    merchantId: process.env.PAYMENT_PROVIDER_MERCHANT_ID,
    requestUrl: process.env.PAYMENT_PROVIDER_REQUEST_URL,
    statusUrl: process.env.PAYMENT_PROVIDER_STATUS_URL,
    cancelUrl: process.env.PAYMENT_PROVIDER_CANCEL_URL,
    webhookSecret: process.env.PAYMENT_WEBHOOK_SIGNING_SECRET,
  };
}

function referenceFor(input: PaymentProviderInput) {
  return `DUITNOW-${input.organizationId}-${input.orderId}-${Date.now()}`.replace(/[^A-Za-z0-9-]/g, "-");
}

function signatureValid(rawBody: string, suppliedSignature: string, secret: string) {
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const supplied = suppliedSignature.replace(/^sha256=/i, "");
  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied);

  return (
    expectedBuffer.length === suppliedBuffer.length &&
    timingSafeEqual(expectedBuffer, suppliedBuffer)
  );
}

async function postJson(url: string, apiKey: string, payload: Record<string, unknown>) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  const started = Date.now();

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));

    return {
      response,
      data,
      latencyMs: Date.now() - started,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeCallback(payload: Record<string, any>): PaymentProviderCallback {
  const metadata = payload.metadata && typeof payload.metadata === "object" ? payload.metadata : {};

  return {
    orderId: String(payload.orderId ?? payload.order_id ?? metadata.orderId ?? metadata.order_id ?? ""),
    organizationId: payload.organizationId ?? payload.organization_id ?? metadata.organizationId ?? null,
    locationId: payload.locationId ?? payload.location_id ?? metadata.locationId ?? null,
    paymentIntentId:
      payload.paymentIntentId ?? payload.payment_intent_id ?? payload.requestId ?? payload.request_id ?? null,
    providerReference:
      payload.providerReference ??
      payload.provider_reference ??
      payload.reference ??
      payload.transactionId ??
      payload.transaction_id ??
      null,
    expectedAmount:
      payload.expectedAmount ?? payload.expected_amount ?? metadata.expectedAmount ?? null,
    paidAmount: Number(payload.paidAmount ?? payload.paid_amount ?? payload.amount ?? 0),
    currency: String(payload.currency ?? metadata.currency ?? "MYR").toUpperCase(),
    paymentStatus: String(payload.status ?? payload.paymentStatus ?? payload.payment_status ?? "UNKNOWN"),
    callbackSource: "duitnow",
    verifiedAt: payload.verifiedAt ?? payload.verified_at ?? payload.paidAt ?? payload.paid_at ?? null,
    providerMetadata: payload,
  };
}

export function createDuitNowProvider(): PaymentProvider {
  const config = getConfig();
  const mode = config ? (config.requestUrl ? "LIVE" : "PROVIDER_READY") : "NOT_CONFIGURED";

  return {
    name: "duitnow",
    mode,
    canExecute(input: PaymentProviderInput) {
      return Boolean(config) && input.currency === "MYR";
    },
    async execute(input: PaymentProviderInput): Promise<PaymentProviderResult> {
      if (!config) {
        return {
          ok: false,
          provider: "duitnow",
          mode: "NOT_CONFIGURED",
          status: "SUPPRESSED",
          error:
            "DuitNow payment provider is not configured. Set PAYMENT_PROVIDER=duitnow with provider credentials before sending customer payment requests.",
          retryable: false,
          metadata: { action: input.action, providerReady: true, livePaymentCreated: false },
        };
      }

      const providerReference = String(input.metadata?.providerReference ?? referenceFor(input));
      const expiresAt =
        typeof input.metadata?.expiresAt === "string"
          ? input.metadata.expiresAt
          : new Date(Date.now() + 15 * 60_000).toISOString();

      if (!config.requestUrl) {
        return {
          ok: false,
          provider: "duitnow",
          mode: "PROVIDER_READY",
          status: "SUPPRESSED",
          providerReference,
          expiresAt,
          error:
            "DuitNow credentials are present, but PAYMENT_PROVIDER_REQUEST_URL is not configured. No live payment request was created.",
          retryable: false,
          metadata: {
            providerReady: true,
            livePaymentCreated: false,
            merchantId: config.merchantId,
          },
        };
      }

      try {
        const { response, data, latencyMs } = await postJson(config.requestUrl, config.apiKey, {
          merchantId: config.merchantId,
          reference: providerReference,
          amount: input.amount,
          currency: input.currency ?? "MYR",
          customerPhone: input.metadata?.customerPhone ?? null,
          orderId: input.orderId,
          organizationId: input.organizationId,
          locationId: input.locationId ?? null,
          expiresAt,
          metadata: input.metadata ?? {},
        });

        if (!response.ok) {
          return {
            ok: false,
            provider: "duitnow",
            mode: "LIVE",
            status: "FAILED",
            providerReference,
            expiresAt,
            error: data?.message ?? "DuitNow payment request failed.",
            retryable: response.status >= 500 || response.status === 429,
            metadata: { providerResponse: data, latencyMs },
          };
        }

        return {
          ok: true,
          provider: "duitnow",
          mode: "LIVE",
          status: "CREATED",
          paymentLink: data.paymentUrl ?? data.payment_url ?? data.checkoutUrl ?? data.checkout_url,
          paymentQrPayload: data.qrPayload ?? data.qr_payload ?? data.qrString ?? data.qr_string,
          providerReference: data.reference ?? data.providerReference ?? providerReference,
          expiresAt: data.expiresAt ?? data.expires_at ?? expiresAt,
          metadata: { providerResponse: data, latencyMs, livePaymentCreated: true },
        };
      } catch (error: any) {
        return {
          ok: false,
          provider: "duitnow",
          mode: "LIVE",
          status: "FAILED",
          providerReference,
          expiresAt,
          error:
            error?.name === "AbortError"
              ? "DuitNow payment request timed out after 15 seconds."
              : error?.message ?? "DuitNow payment request failed.",
          retryable: true,
          metadata: { livePaymentCreated: false },
        };
      }
    },
    verifyWebhookSignature(rawBody: string, headers: Headers): PaymentWebhookVerificationResult {
      if (!config?.webhookSecret) {
        return {
          ok: process.env.NODE_ENV !== "production",
          configured: false,
          reason:
            process.env.NODE_ENV === "production"
              ? "Payment webhook signing secret is required in production."
              : "Payment webhook signing secret is not configured; development callback accepted.",
        };
      }

      const supplied =
        headers.get("x-duitnow-signature") ??
        headers.get("x-payment-signature") ??
        headers.get("x-valsentra-payment-signature");

      if (!supplied) {
        return { ok: false, configured: true, reason: "Missing DuitNow webhook signature." };
      }

      return {
        ok: signatureValid(rawBody, supplied, config.webhookSecret),
        configured: true,
        reason: "DuitNow webhook signature checked.",
      };
    },
    normalizeCallbackPayload(payload: Record<string, any>) {
      return normalizeCallback(payload);
    },
    async getPaymentStatus(input: PaymentProviderInput): Promise<PaymentProviderResult> {
      if (!config?.statusUrl) {
        return {
          ok: false,
          provider: "duitnow",
          mode,
          status: "SUPPRESSED",
          providerReference: String(input.metadata?.providerReference ?? ""),
          error: "DuitNow status endpoint is not configured.",
          retryable: false,
        };
      }

      return {
        ok: false,
        provider: "duitnow",
        mode: "PROVIDER_READY",
        status: "SUPPRESSED",
        providerReference: String(input.metadata?.providerReference ?? ""),
        error:
          "DuitNow status lookup is provider-ready, but provider-specific response mapping has not been enabled.",
        retryable: false,
      };
    },
    async cancelPaymentRequest(input: PaymentProviderInput): Promise<PaymentProviderResult> {
      if (!config?.cancelUrl) {
        return {
          ok: false,
          provider: "duitnow",
          mode,
          status: "SUPPRESSED",
          providerReference: String(input.metadata?.providerReference ?? ""),
          error: "DuitNow cancel endpoint is not configured.",
          retryable: false,
        };
      }

      return {
        ok: false,
        provider: "duitnow",
        mode: "PROVIDER_READY",
        status: "SUPPRESSED",
        providerReference: String(input.metadata?.providerReference ?? ""),
        error:
          "DuitNow cancellation is provider-ready, but provider-specific response mapping has not been enabled.",
        retryable: false,
      };
    },
  };
}
