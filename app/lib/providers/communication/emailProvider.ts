import type {
  CommunicationProvider,
  CommunicationProviderResult,
  CommunicationSendInput,
  ProviderStatus,
} from "@/app/lib/providers/communication/communicationProviderTypes";

function isEmailConfigured() {
  return Boolean(
    process.env.COMMUNICATION_PROVIDER === "email" &&
      process.env.EMAIL_PROVIDER_API_KEY &&
      process.env.EMAIL_PROVIDER_FROM
  );
}

export function getEmailProviderStatus(): ProviderStatus {
  const configured = isEmailConfigured();

  return {
    provider: "email-provider",
    channel: "EMAIL",
    status: configured ? "READY" : "NOT_CONFIGURED",
    configured,
    liveSendingEnabled: configured,
    reason: configured
      ? "Email provider is configured for live sends."
      : "Email is provider-ready but no live email provider is configured.",
  };
}

export function createEmailProvider(): CommunicationProvider {
  return {
    name: "email-provider",
    mode: isEmailConfigured() ? "LIVE" : "INTERNAL",
    channel: "EMAIL",
    canSend(input: CommunicationSendInput) {
      return input.channel === "EMAIL" && isEmailConfigured();
    },
    async send(input: CommunicationSendInput): Promise<CommunicationProviderResult> {
      return {
        ok: false,
        provider: "email-provider",
        mode: isEmailConfigured() ? "LIVE" : "INTERNAL",
        status: "SUPPRESSED",
        error:
          input.channel === "EMAIL"
            ? "Email provider adapter is configured as a safe boundary, but no live email sender is enabled yet."
            : "Email provider only supports EMAIL messages.",
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
