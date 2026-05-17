import type { RecoverySequenceDecision } from "@/app/lib/communicationOrchestrationEngine";
import { checkIdempotencyKey } from "@/app/lib/infrastructure/idempotencyLayer";
import {
  getActiveOperationalPacingPolicy,
  isCriticalOperationalCommunication,
} from "@/app/lib/operationalPacingPolicyStore";
import { publishOperationalCommand } from "@/app/lib/operationalCommandBus";
import { buildOperationalPartition } from "@/app/lib/operationalPartitionEngine";
import { createEmailProvider } from "@/app/lib/providers/communication/emailProvider";
import { createInternalCommunicationProvider } from "@/app/lib/providers/communication/internalProvider";
import { createSmsProvider } from "@/app/lib/providers/communication/smsProvider";
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
  const smsProvider = createSmsProvider();
  const emailProvider = createEmailProvider();

  if (input.channel === "WHATSAPP" && whatsappProvider.canSend(input)) {
    return whatsappProvider;
  }

  if (input.channel === "SMS" && smsProvider.canSend(input)) {
    return smsProvider;
  }

  if (input.channel === "EMAIL" && emailProvider.canSend(input)) {
    return emailProvider;
  }

  // Production-safe default: without explicit live provider configuration,
  // autonomous communication is recorded internally and no customer message is sent.
  return createInternalCommunicationProvider();
}

function isCriticalRecoveryStep(step: RecoverySequenceDecision["step"]) {
  return step === "ESCALATE_PAYMENT" || step === "RELEASE_WARNING" || step === "FINAL_RECOVERY_ATTEMPT";
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
    const duplicate = await checkIdempotencyKey({
      key: eventKey,
      scope: "WHATSAPP_SEND",
      organizationId:
        typeof decision.message.metadata?.organizationId === "string"
          ? decision.message.metadata.organizationId
          : undefined,
      locationId:
        typeof decision.message.metadata?.locationId === "string"
          ? decision.message.metadata.locationId
          : undefined,
      orderId,
    });
  if (duplicate.duplicate) {
    return {
      attempted: false,
      provider: "idempotency-layer",
      mode: "INTERNAL",
      status: "SKIPPED",
      ok: true,
      error: duplicate.reason,
      realMessageSent: false,
      maskedRecipient: maskRecipient(decision.message.to),
      attemptedAt: new Date().toISOString(),
      providerStatus: getWhatsAppProviderStatus(),
    };
  }

  const organizationId =
    typeof decision.message.metadata?.organizationId === "string"
      ? decision.message.metadata.organizationId
      : "org-valsentra";
  const locationId =
    typeof decision.message.metadata?.locationId === "string"
      ? decision.message.metadata.locationId
      : null;
  const pacingPolicy = await getActiveOperationalPacingPolicy({ organizationId, locationId });
  const partition = await buildOperationalPartition({ organizationId, locationId });
  const critical = isCriticalRecoveryStep(decision.step) || isCriticalOperationalCommunication(decision.message.metadata);

  if (!critical && (pacingPolicy.suppressNonCriticalReminders || pacingPolicy.delayNonCriticalNotifications)) {
    await publishOperationalCommand({
      eventType: "REMINDERS_SUPPRESSED",
      organizationId,
      locationId,
      source: "Communication Execution Service",
      summary: "Non-critical WhatsApp reminder delayed during rush pressure.",
      severity: "WATCH",
      correlationId: eventKey,
      payload: {
        orderId,
        step: decision.step,
        pacingExpiresAt: pacingPolicy.expiresAt,
        rushLockActive: pacingPolicy.rushLockActive,
        partitionState: partition.state,
        ownerWorkerId: partition.ownerWorkerId,
      },
    });

    return {
      attempted: false,
      provider: "autonomous-operational-execution",
      mode: "INTERNAL",
      status: "SKIPPED",
      ok: true,
      error: "Non-critical customer message delayed by active rush pacing protection.",
      realMessageSent: false,
      maskedRecipient: maskRecipient(decision.message.to),
      attemptedAt: new Date().toISOString(),
      providerStatus: getWhatsAppProviderStatus(),
    };
  }

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
  await publishOperationalCommand({
    eventType: result.ok ? "ENGINE_EXECUTION_COMPLETED" : "RUNTIME_DEGRADED",
    organizationId,
    locationId,
    source: "Communication Execution Service",
    summary: result.ok
      ? "Communication provider execution completed."
      : "Communication provider execution degraded safely.",
    severity: result.ok ? "INFO" : "WARNING",
    correlationId: eventKey,
    executionId: eventKey,
    payload: {
      orderId,
      channel: input.channel,
      provider: result.provider,
      providerStatus: result.status,
      liveMode: result.mode === "LIVE",
      retryable: Boolean(result.retryable),
      degraded: Boolean(result.degraded),
      partitionState: partition.state,
      ownerWorkerId: partition.ownerWorkerId,
    },
  });

  return {
    attempted: true,
    provider: result.provider,
    mode: result.mode,
    status: result.status,
    ok: result.ok,
    messageId: result.messageId,
    error: result.error,
    realMessageSent: result.mode === "LIVE" && (result.status === "SENT" || result.status === "QUEUED"),
    maskedRecipient: maskRecipient(input.to),
    attemptedAt,
    providerStatus: getWhatsAppProviderStatus(),
  };
}

export async function executeDirectCommunication(
  input: CommunicationSendInput
): Promise<DirectCommunicationExecutionResult> {
  const idempotencyKey =
    typeof input.metadata?.idempotencyKey === "string"
      ? input.metadata.idempotencyKey
      : typeof input.metadata?.eventKey === "string"
        ? input.metadata.eventKey
        : null;

  if (idempotencyKey) {
    const duplicate = await checkIdempotencyKey({
      key: idempotencyKey,
      scope: "WHATSAPP_SEND",
      organizationId:
        typeof input.metadata?.organizationId === "string"
          ? input.metadata.organizationId
          : undefined,
      locationId:
        typeof input.metadata?.locationId === "string"
          ? input.metadata.locationId
          : undefined,
      orderId: input.orderId ?? null,
      metadata: input.metadata ?? {},
    });

    if (duplicate.duplicate) {
      return {
        attempted: false,
        provider: "idempotency-layer",
        mode: "INTERNAL",
        status: "SKIPPED",
        ok: true,
        error: duplicate.reason,
        realMessageSent: false,
        maskedRecipient: maskRecipient(input.to),
        attemptedAt: new Date().toISOString(),
        providerStatus: getWhatsAppProviderStatus(),
        providerMetadata: {
          idempotencyKey,
          duplicateBlocked: true,
        },
      };
    }
  }

  const organizationId =
    typeof input.metadata?.organizationId === "string"
      ? input.metadata.organizationId
      : "org-valsentra";
  const locationId =
    typeof input.metadata?.locationId === "string"
      ? input.metadata.locationId
      : null;
  const pacingPolicy = await getActiveOperationalPacingPolicy({ organizationId, locationId });
  const partition = await buildOperationalPartition({ organizationId, locationId });
  const critical = isCriticalOperationalCommunication(input.metadata);

  if (!critical && (pacingPolicy.suppressNonCriticalReminders || pacingPolicy.delayNonCriticalNotifications)) {
    await publishOperationalCommand({
      eventType: "REMINDERS_SUPPRESSED",
      organizationId,
      locationId,
      source: "Communication Execution Service",
      summary: "Non-critical message delayed during rush pressure.",
      severity: "WATCH",
      correlationId:
        typeof input.metadata?.idempotencyKey === "string"
          ? input.metadata.idempotencyKey
          : typeof input.metadata?.eventKey === "string"
            ? input.metadata.eventKey
            : `communication-suppressed:${input.orderId ?? "system"}`,
      payload: {
        orderId: input.orderId ?? null,
        channel: input.channel,
        pacingExpiresAt: pacingPolicy.expiresAt,
        rushLockActive: pacingPolicy.rushLockActive,
        partitionState: partition.state,
        ownerWorkerId: partition.ownerWorkerId,
      },
    });

    return {
      attempted: false,
      provider: "autonomous-operational-execution",
      mode: "INTERNAL",
      status: "SKIPPED",
      ok: true,
      error: "Non-critical message delayed by active rush pacing protection.",
      realMessageSent: false,
      maskedRecipient: maskRecipient(input.to),
      attemptedAt: new Date().toISOString(),
      providerStatus: getWhatsAppProviderStatus(),
      providerMetadata: {
        autonomousPacingSuppressed: true,
        pacingExpiresAt: pacingPolicy.expiresAt,
        rushLockActive: pacingPolicy.rushLockActive,
      },
    };
  }

  const provider = selectProvider(input);
  const attemptedAt = new Date().toISOString();
  const result = await provider.send(input);
  await publishOperationalCommand({
    eventType: result.ok ? "ENGINE_EXECUTION_COMPLETED" : "RUNTIME_DEGRADED",
    organizationId,
    locationId,
    source: "Communication Execution Service",
    summary: result.ok
      ? "Communication provider execution completed."
      : "Communication provider execution degraded safely.",
    severity: result.ok ? "INFO" : "WARNING",
    correlationId:
      typeof input.metadata?.idempotencyKey === "string"
        ? input.metadata.idempotencyKey
        : typeof input.metadata?.eventKey === "string"
          ? input.metadata.eventKey
          : `communication:${input.orderId ?? "system"}:${attemptedAt.slice(0, 16)}`,
    executionId:
      typeof input.metadata?.executionId === "string" ? input.metadata.executionId : null,
    payload: {
      orderId: input.orderId ?? null,
      channel: input.channel,
      provider: result.provider,
      providerStatus: result.status,
      liveMode: result.mode === "LIVE",
      retryable: Boolean(result.retryable),
      degraded: Boolean(result.degraded),
      partitionState: partition.state,
      ownerWorkerId: partition.ownerWorkerId,
    },
  });

  return {
    attempted: true,
    provider: result.provider,
    mode: result.mode,
    status: result.status,
    ok: result.ok,
    messageId: result.messageId,
    error: result.error,
    realMessageSent: result.mode === "LIVE" && (result.status === "SENT" || result.status === "QUEUED"),
    maskedRecipient: maskRecipient(input.to),
    attemptedAt,
    providerStatus: getWhatsAppProviderStatus(),
    providerMetadata: {
      ...(result.metadata ?? {}),
      latencyMs: result.latencyMs ?? null,
      retryable: Boolean(result.retryable),
      degraded: Boolean(result.degraded),
    },
  };
}
