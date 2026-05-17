import { getEmailProviderStatus } from "@/app/lib/providers/communication/emailProvider";
import { getSmsProviderStatus } from "@/app/lib/providers/communication/smsProvider";
import { getWhatsAppProviderStatus } from "@/app/lib/providers/communication/whatsappProvider";
import { getPaymentProviderStatus } from "@/app/lib/providers/payment/paymentProvider";

export function getProviderHealthSnapshot() {
  const communication = [
    getWhatsAppProviderStatus(),
    getSmsProviderStatus(),
    getEmailProviderStatus(),
  ];
  const payment = getPaymentProviderStatus();

  const degraded = [
    ...communication.filter((provider) => provider.status === "DEGRADED" || provider.status === "OUTAGE"),
    ...(payment.status === "READY" ? [] : []),
  ];

  return {
    communication,
    payment,
    degradedCount: degraded.length,
    liveCommunicationChannels: communication
      .filter((provider) => provider.liveSendingEnabled)
      .map((provider) => provider.channel),
    livePaymentsEnabled: payment.livePaymentsEnabled,
  };
}
