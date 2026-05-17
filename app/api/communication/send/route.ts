import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/admin";
import { createEmailProvider } from "@/app/lib/providers/communication/emailProvider";
import { createInternalCommunicationProvider } from "@/app/lib/providers/communication/internalProvider";
import { createSmsProvider } from "@/app/lib/providers/communication/smsProvider";
import { createWhatsAppProvider } from "@/app/lib/providers/communication/whatsappProvider";
import {
  enqueueOperationalJob,
  executeOperationalJob,
} from "@/app/lib/infrastructure/operationalJobEngine";
import { appendOperationalTimelineFromAudit } from "@/app/lib/operationalTimelineMemoryEngine";
import {
  createTraceId,
  enforceRateLimit,
  requireRouteRole,
} from "@/app/lib/security/routeProtection";
import { actorAuditMeta } from "@/app/lib/security/tenantSupabase";
import type {
  CommunicationChannel,
  CommunicationProvider,
  CommunicationProviderResult,
  CommunicationSendInput,
} from "@/app/lib/providers/communication/communicationProviderTypes";

const CHANNELS: CommunicationChannel[] = ["WHATSAPP", "SMS", "EMAIL", "INTERNAL"];

function isChannel(value: unknown): value is CommunicationChannel {
  return typeof value === "string" && CHANNELS.includes(value as CommunicationChannel);
}

function cleanString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function maskRecipient(value: string) {
  const normalized = value.replace(/^whatsapp:/, "");
  if (normalized.length <= 4) return "****";
  return `${"*".repeat(Math.max(normalized.length - 4, 4))}${normalized.slice(-4)}`;
}

function validateInput(body: Record<string, unknown>): CommunicationSendInput | { error: string } {
  const channel = body.channel;
  const to = cleanString(body.to);
  const message = cleanString(body.message);
  const orderId = cleanString(body.orderId);
  const customerName = cleanString(body.customerName);
  const metadata =
    body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)
      ? (body.metadata as Record<string, unknown>)
      : {};

  if (!isChannel(channel)) {
    return { error: "channel must be WHATSAPP, SMS, EMAIL, or INTERNAL." };
  }

  if (!to) {
    return { error: "to is required." };
  }

  if (!message) {
    return { error: "message is required." };
  }

  return {
    channel,
    to,
    message,
    orderId: orderId || undefined,
    customerName: customerName || undefined,
    metadata,
  };
}

function selectProvider(input: CommunicationSendInput): CommunicationProvider {
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

  return createInternalCommunicationProvider();
}

async function writeCommunicationAudit(
  input: CommunicationSendInput,
  result: CommunicationProviderResult,
  actorMeta: Record<string, unknown>
) {
  const orderId = input.orderId ?? "COMMUNICATION";
  const action =
    result.mode === "LIVE"
      ? `Communication sent via ${result.provider}`
      : `Communication prepared via ${result.provider}`;
  const meta = {
    operationalEvent: true,
    category: "AUTONOMOUS_ACTION",
    severity: result.ok ? "INFO" : "WARNING",
    title:
      result.mode === "LIVE"
        ? "Provider communication sent"
        : "Provider-ready communication recorded",
    summary:
      result.mode === "LIVE"
        ? `${input.channel} message sent for ${orderId}.`
        : `${input.channel} message recorded for ${orderId}; no real customer message was sent.`,
    channel: input.channel,
    to: maskRecipient(input.to),
    orderId: input.orderId ?? null,
    customerName: input.customerName ?? null,
    provider: result.provider,
    providerMode: result.mode,
    providerStatus: result.status,
    providerMessageId: result.messageId ?? null,
    providerError: result.error ?? null,
    communicationMetadata: input.metadata ?? {},
    providerMetadata: result.metadata ?? {},
    realMessageSent: result.mode === "LIVE" && (result.status === "SENT" || result.status === "QUEUED"),
    ...actorMeta,
  };

  await supabaseAdmin.from("audit_logs").insert({
    action,
    staff: "Valsentra Communication Provider",
    order_id: orderId,
    organization_id: actorMeta.organizationId ?? "org-valsentra",
    location_id: actorMeta.locationId ?? null,
    meta,
  });

  await appendOperationalTimelineFromAudit({
    action,
    staff: "Valsentra Communication Provider",
    orderId,
    organizationId: String(actorMeta.organizationId ?? "org-valsentra"),
    locationId: typeof actorMeta.locationId === "string" ? actorMeta.locationId : null,
    meta,
  });
}

export async function POST(request: Request) {
  const access = await requireRouteRole({
    request,
    route: "/api/communication/send",
    allowedRoles: ["admin", "internal"],
  });
  if (!access.ok) return access.response;

  const rateLimit = await enforceRateLimit({
    request,
    route: "/api/communication/send",
    scope: "communication-send",
    maxRequests: 20,
    windowMs: 60_000,
  });
  if (!rateLimit.ok) return rateLimit.response;

  const traceId = access.traceId ?? createTraceId(request);
  const actorMeta = actorAuditMeta(access.actor, traceId);

  try {
    const body = await request.json().catch(() => null);

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }

    const input = validateInput(body as Record<string, unknown>);

    if ("error" in input) {
      return NextResponse.json({ error: input.error }, { status: 400 });
    }

    const scopedInput: CommunicationSendInput = {
      ...input,
      metadata: {
        ...(input.metadata ?? {}),
        organizationId: access.actor.organizationId,
        locationId: access.actor.locationId,
        traceId,
      },
    };

    const queued = await enqueueOperationalJob({
      organizationId: access.actor.organizationId,
      locationId: access.actor.locationId,
      jobType: "communication_send",
      priority: scopedInput.channel === "WHATSAPP" ? "high" : "normal",
      idempotencyKey:
        typeof scopedInput.metadata?.idempotencyKey === "string"
          ? scopedInput.metadata.idempotencyKey
          : `communication:${access.actor.organizationId}:${scopedInput.orderId ?? "system"}:${scopedInput.channel}:${Date.now()}`,
      payload: {
        input: scopedInput,
      },
      traceId,
      actor: {
        userId: access.actor.userId,
        role: access.actor.role,
        source: access.actor.source,
      },
    });
    const jobResult = await executeOperationalJob(queued.job.id);
    const result = (jobResult as any).result ?? jobResult;

    if (scopedInput.channel !== "WHATSAPP" || !("provider" in result)) {
      const provider = selectProvider(scopedInput);
      const fallback = await provider.send(scopedInput);
      await writeCommunicationAudit(scopedInput, fallback, actorMeta);
    }

    return NextResponse.json({
      ...result,
      liveSendingEnabled: result.mode === "LIVE",
      jobId: queued.job.id,
      duplicateJob: queued.duplicate,
      traceId,
      executionSource: "protected-communication-send-route",
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message ?? "Failed to send communication." },
      { status: 500 }
    );
  }
}
