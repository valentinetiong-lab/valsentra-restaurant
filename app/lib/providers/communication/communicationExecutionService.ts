import type { RecoverySequenceDecision } from "@/app/lib/communicationOrchestrationEngine";
import { createInternalCommunicationProvider } from "@/app/lib/providers/communication/internalProvider";
import {
  createWhatsAppProvider,
  getWhatsAppProviderStatus,
} from "@/app/lib/providers/communication/whatsappProvider";
import type {
  CommunicationProviderResult,
  CommunicationSendInput,
} from "@/app/lib/providers/communication/communicationProviderTypes";

export type CommunicationExecutionResult = {
  attempted: boolean;
  provider: string;
  mode: "INTERNAL" | "LIVE";
  status: CommunicationProviderResult["status"] | "SKIPPED";
  ok: boolean;
  messageId?: string;
  error?: string;
  realMessageSent: boolean;
  maskedRecipient: string;
  attemptedAt: string;
  providerStatus: ReturnType<typeof getWhatsAppProviderStatus>;
};

export type DirectCommunicationExecutionResult = CommunicationExecutionResult & {
  providerMetadata?: Record<string, unknown>;
};

function maskRecipient(value: string) {
  const normalized = value.replace(/^whatsapp:/, "");
  if (normalized.length <= 4) return "****";
  return `${"*".repeat(Math.max(normalized.length - 4, 4))}${normalized.slice(-4)}`;
}

function selectProvider(input: CommunicationSendInput) {
  const whatsappProvider = createWhatsAppProvider();

  if (input.channel === "WHATSAPP" && whatsappProvider.canSend(input)) {
    return whatsappProvider;
  }

  // Production-safe default: without explicit live provider configuration,
  // autonomous communication is recorded internally and no customer message is sent.
  return createInternalCommunicationProvider();
}

export async function executeRecoveryCommunication({
  decision,
  orderId,
  customerName,
  eventKey,
}: {
  decision: RecoverySequenceDecision;
  orderId: string;
  customerName?: string;
  eventKey: string;
}): Promise<CommunicationExecutionResult> {
  const input: CommunicationSendInput = {
    channel: decision.message.channel,
    to: decision.message.to,
    message: decision.message.body,
    orderId,
    customerName,
    metadata: {
      ...decision.message.metadata,
      eventKey,
      recoverySequenceStep: decision.step,
      escalationStage: decision.escalationStage,
      attemptCount: decision.attemptCount,
      recoveryConfidence: decision.recoveryConfidence,
      projectedRecoveryLikelihood: decision.projectedRecoveryLikelihood,
      trustRisk: decision.trustRisk,
      communicationFatigue: decision.communicationFatigue,
    },
  };
  const provider = selectProvider(input);
  const attemptedAt = new Date().toISOString();
  const result = await provider.send(input);

  return {
    attempted: true,
    provider: result.provider,
    mode: result.mode,
    status: result.status,
    ok: result.ok,
    messageId: result.messageId,
    error: result.error,
    realMessageSent: result.mode === "LIVE" && result.status === "SENT",
    maskedRecipient: maskRecipient(input.to),
    attemptedAt,
    providerStatus: getWhatsAppProviderStatus(),
  };
}

export async function executeDirectCommunication(
  input: CommunicationSendInput
): Promise<DirectCommunicationExecutionResult> {
  const provider = selectProvider(input);
  const attemptedAt = new Date().toISOString();
  const result = await provider.send(input);

  return {
    attempted: true,
    provider: result.provider,
    mode: result.mode,
    status: result.status,
    ok: result.ok,
    messageId: result.messageId,
    error: result.error,
    realMessageSent: result.mode === "LIVE" && result.status === "SENT",
    maskedRecipient: maskRecipient(input.to),
    attemptedAt,
    providerStatus: getWhatsAppProviderStatus(),
    providerMetadata: result.metadata,
  };
}
