import crypto from "crypto";

export type WhatsAppDeliveryState =
  | "QUEUED"
  | "SENT"
  | "DELIVERED"
  | "READ"
  | "FAILED"
  | "RETRYING"
  | "SUPPRESSED";

export type WhatsAppTemplateType =
  | "PAYMENT_REMINDER"
  | "PAYMENT_LINK"
  | "ARRIVAL_REMINDER"
  | "WAITLIST_RECOVERY_OFFER"
  | "RECOVERY_ESCALATION"
  | "CANCELLATION_FOLLOW_UP"
  | "OPERATIONAL_ALERT";

export type WhatsAppProviderMetadata = {
  providerMessageId?: string | null;
  deliveryState: WhatsAppDeliveryState;
  organizationId?: string | null;
  locationId?: string | null;
  orderId?: string | null;
  executionId?: string | null;
  correlationId?: string | null;
  retryState?: "NONE" | "RETRYABLE" | "RETRYING" | "EXHAUSTED";
  sentAt?: string | null;
  templateType?: WhatsAppTemplateType | string | null;
  providerPayload?: Record<string, unknown>;
};

export function normalizeWhatsAppDeliveryState(value: unknown): WhatsAppDeliveryState {
  const status = String(value ?? "").toLowerCase();
  if (status === "queued" || status === "accepted" || status === "scheduled") return "QUEUED";
  if (status === "sent" || status === "sending") return "SENT";
  if (status === "delivered") return "DELIVERED";
  if (status === "read") return "READ";
  if (status === "failed" || status === "undelivered" || status === "canceled") return "FAILED";
  if (status === "retrying") return "RETRYING";
  if (status === "suppressed") return "SUPPRESSED";
  return "QUEUED";
}

export function normalizeWhatsAppRecipient(value: string) {
  const trimmed = value.trim();
  const withoutPrefix = trimmed.replace(/^whatsapp:/i, "");
  const normalized = withoutPrefix.replace(/[^\d+]/g, "");

  if (!normalized) return withoutPrefix;
  if (normalized.startsWith("+")) return normalized;
  if (normalized.startsWith("00")) return `+${normalized.slice(2)}`;
  if (normalized.startsWith("60")) return `+${normalized}`;

  return normalized;
}

export function toWhatsAppAddress(value: string) {
  const normalized = normalizeWhatsAppRecipient(value);
  return normalized.startsWith("whatsapp:") ? normalized : `whatsapp:${normalized}`;
}

export function inferWhatsAppTemplateType(metadata?: Record<string, unknown>): WhatsAppTemplateType {
  const source = `${metadata?.templateType ?? ""} ${metadata?.recoverySequenceStep ?? ""} ${metadata?.source ?? ""} ${metadata?.paymentRequestId ?? ""}`.toUpperCase();
  if (source.includes("PAYMENT_LINK") || metadata?.paymentRequestId) return "PAYMENT_LINK";
  if (source.includes("PAYMENT_REMINDER")) return "PAYMENT_REMINDER";
  if (source.includes("WAITLIST") || source.includes("RECOVERY_OFFER")) return "WAITLIST_RECOVERY_OFFER";
  if (source.includes("ESCALATE") || source.includes("RELEASE_WARNING")) return "RECOVERY_ESCALATION";
  if (source.includes("CANCEL")) return "CANCELLATION_FOLLOW_UP";
  if (source.includes("ARRIVAL")) return "ARRIVAL_REMINDER";
  return "OPERATIONAL_ALERT";
}

export function extractWhatsAppWebhookSummary(payload: Record<string, unknown>) {
  const messageId =
    payload.MessageSid ??
    payload.SmsSid ??
    payload.messageId ??
    payload.message_id ??
    payload.id ??
    payload.MessageId ??
    "unknown";
  const parentMessageId =
    payload.OriginalRepliedMessageSid ??
    payload.ParentMessageSid ??
    payload.parentMessageId ??
    payload.contextMessageId ??
    null;
  const from = payload.From ?? payload.from ?? payload.sender ?? null;
  const to = payload.To ?? payload.to ?? null;
  const body = payload.Body ?? payload.body ?? payload.message ?? payload.text ?? null;
  const status = payload.MessageStatus ?? payload.SmsStatus ?? payload.status ?? payload.deliveryStatus ?? null;
  const errorCode = payload.ErrorCode ?? payload.errorCode ?? null;
  const errorMessage = payload.ErrorMessage ?? payload.errorMessage ?? null;

  return {
    messageId: String(messageId),
    parentMessageId: parentMessageId ? String(parentMessageId) : null,
    from,
    to,
    body,
    status,
    deliveryState: normalizeWhatsAppDeliveryState(status),
    errorCode,
    errorMessage,
    isDeliveryReceipt: Boolean(status),
    isCustomerReply: Boolean(body) && !status,
  };
}

function twilioSignatureBase(url: string, params: Record<string, unknown>) {
  return Object.keys(params)
    .sort()
    .reduce((base, key) => `${base}${key}${String(params[key] ?? "")}`, url);
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function validateWhatsAppBusinessWebhookSignature({
  requestUrl,
  rawBody,
  params,
  signature,
}: {
  requestUrl: string;
  rawBody: string;
  params: Record<string, unknown>;
  signature?: string | null;
}) {
  const twilioToken = process.env.TWILIO_AUTH_TOKEN;
  const genericSecret = process.env.WHATSAPP_WEBHOOK_SIGNING_SECRET;

  if (!twilioToken && !genericSecret) {
    return {
      validated: true,
      configured: false,
      provider: "provider-ready",
      reason: "No WhatsApp webhook signing secret is configured; development/provider-ready webhook accepted.",
    };
  }

  if (!signature) {
    return {
      validated: false,
      configured: true,
      provider: process.env.COMMUNICATION_PROVIDER === "twilio" ? "twilio" : "generic",
      reason: "Missing WhatsApp webhook signature.",
    };
  }

  if (process.env.COMMUNICATION_PROVIDER === "twilio" && twilioToken) {
    const expected = crypto
      .createHmac("sha1", twilioToken)
      .update(twilioSignatureBase(requestUrl, params))
      .digest("base64");

    if (safeEqual(expected, signature)) {
      return {
        validated: true,
        configured: true,
        provider: "twilio",
        reason: "Twilio WhatsApp webhook signature validated.",
      };
    }
  }

  if (genericSecret) {
    const expected = crypto.createHmac("sha256", genericSecret).update(rawBody).digest("hex");
    return {
      validated: safeEqual(expected, signature),
      configured: true,
      provider: "generic",
      reason: "Generic WhatsApp webhook signature checked.",
    };
  }

  return {
    validated: false,
    configured: true,
    provider: "twilio",
    reason: "WhatsApp webhook signature did not match configured provider.",
  };
}
