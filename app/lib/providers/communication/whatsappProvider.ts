import type {
  CommunicationProvider,
  CommunicationProviderResult,
  CommunicationSendInput,
} from "@/app/lib/providers/communication/communicationProviderTypes";

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

export function getWhatsAppProviderStatus() {
  return {
    provider: "twilio-whatsapp",
    configured: Boolean(getTwilioConfig()),
    communicationProvider: process.env.COMMUNICATION_PROVIDER ?? "internal",
    hasAccountSid: Boolean(process.env.TWILIO_ACCOUNT_SID),
    hasAuthToken: Boolean(process.env.TWILIO_AUTH_TOKEN),
    hasFrom: Boolean(process.env.TWILIO_WHATSAPP_FROM),
  };
}

function normalizeWhatsAppRecipient(value: string) {
  const trimmed = value.trim();
  const withoutPrefix = trimmed.replace(/^whatsapp:/i, "");
  const normalized = withoutPrefix.replace(/[^\d+]/g, "");

  if (!normalized) return withoutPrefix;
  if (normalized.startsWith("+")) return normalized;
  if (normalized.startsWith("00")) return `+${normalized.slice(2)}`;
  if (normalized.startsWith("60")) return `+${normalized}`;

  return normalized;
}

function toWhatsAppAddress(value: string) {
  const normalized = normalizeWhatsAppRecipient(value);
  return normalized.startsWith("whatsapp:") ? normalized : `whatsapp:${normalized}`;
}

export function createWhatsAppProvider(): CommunicationProvider {
  const config = getTwilioConfig();

  return {
    name: "twilio-whatsapp",
    mode: config ? "LIVE" : "INTERNAL",
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
      const body = new URLSearchParams({
        From: toWhatsAppAddress(config.from),
        To: toWhatsAppAddress(input.to),
        Body: input.message,
      });
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15_000);

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
        };
      } finally {
        clearTimeout(timeout);
      }

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        return {
          ok: false,
          provider: "twilio-whatsapp",
          mode: "LIVE",
          status: "FAILED",
          error: data?.message ?? "Twilio WhatsApp send failed.",
          metadata: { twilio: data },
        };
      }

      return {
        ok: true,
        provider: "twilio-whatsapp",
        mode: "LIVE",
        status: "SENT",
        messageId: data?.sid,
        metadata: {
          twilio: data,
          realMessageSent: true,
        },
      };
    },
  };
}
