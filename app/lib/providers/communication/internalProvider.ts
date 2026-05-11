import type {
  CommunicationProvider,
  CommunicationProviderResult,
  CommunicationSendInput,
} from "@/app/lib/providers/communication/communicationProviderTypes";

export function createInternalCommunicationProvider(): CommunicationProvider {
  return {
    name: "internal-mock",
    mode: "INTERNAL",
    canSend() {
      return true;
    },
    async send(input: CommunicationSendInput): Promise<CommunicationProviderResult> {
      // Local/dev safety: this records the communication intent only. It never sends
      // a customer-facing WhatsApp/SMS/email message.
      return {
        ok: true,
        provider: "internal-mock",
        mode: "INTERNAL",
        status: "RECORDED",
        messageId: `internal-${Date.now()}`,
        metadata: {
          channel: input.channel,
          orderId: input.orderId ?? null,
          customerName: input.customerName ?? null,
          providerReady: true,
          realMessageSent: false,
        },
      };
    },
  };
}
