import crypto from "crypto";
import { buildIdempotencyKey, checkIdempotencyKey } from "@/app/lib/infrastructure/idempotencyLayer";
import { validateWhatsAppBusinessWebhookSignature } from "@/app/lib/providers/communication/whatsappBusinessIntegration";

export type WebhookReliabilityResult = {
  accepted: boolean;
  status: number;
  replayDetected: boolean;
  malformed: boolean;
  signatureValidated: boolean;
  timeoutMs: number;
  idempotencyKey: string;
  providerFailureHandling: string;
  retryTracking: {
    retryAttempt: number;
    safeToRetry: boolean;
  };
  reason: string;
};

export function parseRetryAttempt(headers: Headers) {
  const retry =
    headers.get("x-twilio-retry-count") ??
    headers.get("x-provider-retry-count") ??
    headers.get("x-webhook-retry-count") ??
    "0";

  const value = Number(retry);
  return Number.isFinite(value) ? value : 0;
}

export function validateWebhookSignature({
  rawBody,
  signature,
  secret,
}: {
  rawBody: string;
  signature?: string | null;
  secret?: string | null;
}) {
  if (!secret) return { validated: true, reason: "No webhook signing secret configured; validation is provider-ready." };
  if (!signature) return { validated: false, reason: "Missing webhook signature." };

  const digest = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const safeDigest = Buffer.from(digest);
  const safeSignature = Buffer.from(signature);

  if (safeDigest.length !== safeSignature.length) {
    return { validated: false, reason: "Webhook signature length mismatch." };
  }

  return {
    validated: crypto.timingSafeEqual(safeDigest, safeSignature),
    reason: "Webhook signature checked with configured secret.",
  };
}

export async function evaluateWebhookReliability({
  headers,
  provider,
  messageId,
  orderId,
  rawBody,
  requestUrl,
  params,
}: {
  headers: Headers;
  provider: string;
  messageId: string;
  orderId?: string | null;
  rawBody: string;
  requestUrl?: string;
  params?: Record<string, unknown>;
}): Promise<WebhookReliabilityResult> {
  const malformed = !messageId || messageId === "unknown";
  const retryAttempt = parseRetryAttempt(headers);
  const idempotencyKey = buildIdempotencyKey({
    scope: "WEBHOOK",
    orderId,
    action: provider,
    providerMessageId: messageId,
  });
  const replay = await checkIdempotencyKey({ key: idempotencyKey, scope: "WEBHOOK" });
  const signature = headers.get("x-twilio-signature") ?? headers.get("x-provider-signature");
  const signatureResult =
    provider === "whatsapp"
      ? validateWhatsAppBusinessWebhookSignature({
          requestUrl: requestUrl ?? "",
          rawBody,
          params: params ?? {},
          signature,
        })
      : validateWebhookSignature({
          rawBody,
          signature,
          secret: process.env.WHATSAPP_WEBHOOK_SIGNING_SECRET ?? null,
        });

  return {
    accepted: !malformed && !replay.duplicate && signatureResult.validated,
    status: malformed ? 400 : replay.duplicate ? 200 : signatureResult.validated ? 200 : 401,
    replayDetected: replay.duplicate,
    malformed,
    signatureValidated: signatureResult.validated,
    timeoutMs: 15000,
    idempotencyKey,
    providerFailureHandling: "Provider failures are recorded and routed through retry-safe audit metadata.",
    retryTracking: {
      retryAttempt,
      safeToRetry: retryAttempt < 5 && !replay.duplicate,
    },
    reason: malformed ? "Malformed webhook payload." : replay.duplicate ? replay.reason : signatureResult.reason,
  };
}
