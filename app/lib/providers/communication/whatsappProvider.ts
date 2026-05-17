import type {
  CommunicationProvider,
  CommunicationProviderResult,
  CommunicationSendInput,
  ProviderStatus,
} from "@/app/lib/providers/communication/communicationProviderTypes";
import {
  inferWhatsAppTemplateType,
  normalizeWhatsAppDeliveryState,
  normalizeWhatsAppRecipient,
  toWhatsAppAddress,
} from "@/app/lib/providers/communication/whatsappBusinessIntegration";

type TwilioConfig = {
  accountSid: string;
  authToken: string;
  from: string;
};

function getTwilioConfig(): TwilioConfig | null {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_WHATSAPP_FROM;
  const enabled = process.env.COMMUNICATION_PROVIDER === "twilio";

  if (!enabled || !accountSid || !authToken || !from) {
    return null;
  }

  return { accountSid, authToken, from };
}

export function getWhatsAppProviderStatus(): ProviderStatus & {
  communicationProvider: string;
  hasAccountSid: boolean;
  hasAuthToken: boolean;
  hasFrom: boolean;
} {
  const configured = Boolean(getTwilioConfig());
  return {
    provider: "twilio-whatsapp",
    channel: "WHATSAPP",
    status: configured ? "READY" : "NOT_CONFIGURED",
    configured,
    liveSendingEnabled: configured,
    reason: configured
      ? "Twilio WhatsApp is configured for live provider sends."
      : "WhatsApp is provider-ready but live sending is disabled until Twilio env vars are configured.",
    communicationProvider: process.env.COMMUNICATION_PROVIDER ?? "internal",
    hasAccountSid: Boolean(process.env.TWILIO_ACCOUNT_SID),
    hasAuthToken: Boolean(process.env.TWILIO_AUTH_TOKEN),
    hasFrom: Boolean(process.env.TWILIO_WHATSAPP_FROM),
  };
}

export function createWhatsAppProvider(): CommunicationProvider {
  const config = getTwilioConfig();

  return {
    name: "twilio-whatsapp",
    mode: config ? "LIVE" : "INTERNAL",
    channel: "WHATSAPP",
    canSend(input: CommunicationSendInput) {
      return Boolean(config) && input.channel === "WHATSAPP";
    },
    async send(input: CommunicationSendInput): Promise<CommunicationProviderResult> {
      if (!config) {
        return {
          ok: false,
          provider: "twilio-whatsapp",
          mode: "INTERNAL",
          status: "SUPPRESSED",
          error:
            "WhatsApp provider is not configured. Set COMMUNICATION_PROVIDER=twilio plus Twilio WhatsApp credentials to enable live sending.",
          metadata: {
            providerReady: true,
            realMessageSent: false,
          },
        };
      }

      if (input.channel !== "WHATSAPP") {
        return {
          ok: false,
          provider: "twilio-whatsapp",
          mode: "LIVE",
          status: "FAILED",
          error: "Twilio WhatsApp provider only supports WHATSAPP channel.",
        };
      }

      // Live sending only happens when the explicit Twilio env configuration exists.
      // This adapter stays outside engines so orchestration logic cannot accidentally
      // send customer messages during local development.
      const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Messages.json`;
      const normalizedRecipient = normalizeWhatsAppRecipient(input.to);
      const templateType = inferWhatsAppTemplateType(input.metadata);
      const body = new URLSearchParams({
        From: toWhatsAppAddress(config.from),
        To: toWhatsAppAddress(normalizedRecipient),
        Body: input.message,
      });
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15_000);
      const started = Date.now();

      let response: Response;
      try {
        response = await fetch(endpoint, {
          method: "POST",
          headers: {
            Authorization: `Basic ${Buffer.from(
              `${config.accountSid}:${config.authToken}`
            ).toString("base64")}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body,
          signal: controller.signal,
        });
      } catch (error: any) {
        return {
          ok: false,
          provider: "twilio-whatsapp",
          mode: "LIVE",
          status: "FAILED",
          error:
            error?.name === "AbortError"
              ? "Twilio WhatsApp send timed out after 15 seconds."
              : error?.message ?? "Twilio WhatsApp send failed before receiving a response.",
          degraded: true,
          retryable: true,
          latencyMs: Date.now() - started,
          metadata: {
            deliveryState: "FAILED",
            retryState: "RETRYABLE",
            templateType,
            organizationId: input.metadata?.organizationId ?? null,
            locationId: input.metadata?.locationId ?? null,
            orderId: input.orderId ?? null,
            executionId: input.metadata?.executionId ?? null,
            correlationId: input.metadata?.correlationId ?? input.metadata?.idempotencyKey ?? null,
            sentAt: null,
          },
        };
      } finally {
        clearTimeout(timeout);
      }

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        const retryable = response.status >= 500 || response.status === 429;
        return {
          ok: false,
          provider: "twilio-whatsapp",
          mode: "LIVE",
          status: retryable ? "RETRYING" : "FAILED",
          error: data?.message ?? "Twilio WhatsApp send failed.",
          degraded: retryable,
          retryable,
          latencyMs: Date.now() - started,
          metadata: {
            twilio: data,
            deliveryState: retryable ? "RETRYING" : "FAILED",
            retryState: retryable ? "RETRYABLE" : "EXHAUSTED",
            templateType,
            organizationId: input.metadata?.organizationId ?? null,
            locationId: input.metadata?.locationId ?? null,
            orderId: input.orderId ?? null,
            executionId: input.metadata?.executionId ?? null,
            correlationId: input.metadata?.correlationId ?? input.metadata?.idempotencyKey ?? null,
            sentAt: null,
          },
        };
      }

      const deliveryState = normalizeWhatsAppDeliveryState(data?.status ?? "queued");

      return {
        ok: true,
        provider: "twilio-whatsapp",
        mode: "LIVE",
        status: deliveryState === "QUEUED" ? "QUEUED" : "SENT",
        messageId: data?.sid,
        latencyMs: Date.now() - started,
        metadata: {
          twilio: data,
          realMessageSent: true,
          providerMessageId: data?.sid ?? null,
          deliveryState,
          retryState: "NONE",
          templateType,
          organizationId: input.metadata?.organizationId ?? null,
          locationId: input.metadata?.locationId ?? null,
          orderId: input.orderId ?? null,
          executionId: input.metadata?.executionId ?? null,
          correlationId: input.metadata?.correlationId ?? input.metadata?.idempotencyKey ?? null,
          sentAt: new Date().toISOString(),
          normalizedRecipient,
        },
      };
    },
  };
}
