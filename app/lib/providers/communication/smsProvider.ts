import type {
  CommunicationProvider,
  CommunicationProviderResult,
  CommunicationSendInput,
  ProviderStatus,
} from "@/app/lib/providers/communication/communicationProviderTypes";

function isSmsConfigured() {
  return Boolean(
    process.env.COMMUNICATION_PROVIDER === "sms" &&
      process.env.SMS_PROVIDER_API_KEY &&
      process.env.SMS_PROVIDER_FROM
  );
}

export function getSmsProviderStatus(): ProviderStatus {
  const configured = isSmsConfigured();

  return {
    provider: "sms-provider",
    channel: "SMS",
    status: configured ? "READY" : "NOT_CONFIGURED",
    configured,
    liveSendingEnabled: configured,
    reason: configured
      ? "SMS provider is configured for live sends."
      : "SMS is provider-ready but no live SMS provider is configured.",
  };
}

export function createSmsProvider(): CommunicationProvider {
  return {
    name: "sms-provider",
    mode: isSmsConfigured() ? "LIVE" : "INTERNAL",
    channel: "SMS",
    canSend(input: CommunicationSendInput) {
      return input.channel === "SMS" && isSmsConfigured();
    },
    async send(input: CommunicationSendInput): Promise<CommunicationProviderResult> {
      return {
        ok: false,
        provider: "sms-provider",
        mode: isSmsConfigured() ? "LIVE" : "INTERNAL",
        status: "SUPPRESSED",
        error:
          input.channel === "SMS"
            ? "SMS provider adapter is configured as a safe boundary, but no live SMS sender is enabled yet."
            : "SMS provider only supports SMS messages.",
        retryable: false,
        metadata: {
          providerReady: true,
          realMessageSent: false,
          channel: input.channel,
        },
      };
    },
  };
}
