import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/admin";
import {
  processInboundOperationalMessage,
  type InboundCommunicationPayload,
} from "@/app/lib/inboundOperationalMessagingEngine";
import {
  createTraceId,
  enforceRateLimit,
  getExecutionSource,
} from "@/app/lib/security/routeProtection";
import { appendOperationalTimelineEvent, appendOperationalTimelineFromAudit } from "@/app/lib/operationalTimelineMemoryEngine";
import {
  extractWhatsAppWebhookSummary,
  normalizeWhatsAppDeliveryState,
} from "@/app/lib/providers/communication/whatsappBusinessIntegration";

function cleanString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

async function parseBody(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) return request.json();
  if (contentType.includes("form")) {
    return request.formData().then((formData) => Object.fromEntries(formData.entries()));
  }
  const raw = await request.text();
  return { body: raw };
}

function normalizeInboundPayload(body: Record<string, unknown>): InboundCommunicationPayload | { error: string } {
  const metadata =
    body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)
      ? (body.metadata as Record<string, unknown>)
      : {};
  const provider = cleanString(body.provider) || cleanString(metadata.provider) || "unknown";
  const messageId =
    cleanString(body.messageId) ||
    cleanString(body.message_id) ||
    cleanString(body.MessageSid) ||
    cleanString(body.SmsSid) ||
    cleanString(body.id);
  const sender =
    cleanString(body.sender) ||
    cleanString(body.from) ||
    cleanString(body.From) ||
    cleanString(metadata.sender);
  const messageBody =
    cleanString(body.body) ||
    cleanString(body.Body) ||
    cleanString(body.message) ||
    cleanString(body.text);

  if (!messageId) return { error: "Inbound communication is missing messageId." };
  if (!sender) return { error: "Inbound communication is missing sender." };
  if (!messageBody) return { error: "Inbound communication is missing message body." };

  return {
    provider,
    messageId,
    sender,
    body: messageBody,
    timestamp:
      cleanString(body.timestamp) ||
      cleanString(body.createdAt) ||
      cleanString(body.created_at) ||
      null,
    organizationId:
      cleanString(body.organizationId) ||
      cleanString(body.organization_id) ||
      cleanString(metadata.organizationId) ||
      null,
    locationId:
      cleanString(body.locationId) ||
      cleanString(body.location_id) ||
      cleanString(metadata.locationId) ||
      null,
    metadata: {
      ...metadata,
      deliveryMetadata: body.deliveryMetadata ?? body.delivery_metadata ?? null,
      rawProviderPayload: body,
    },
  };
}

function timelineEventForDelivery(state: string) {
  if (state === "DELIVERED") return "WHATSAPP_MESSAGE_DELIVERED" as const;
  if (state === "READ") return "WHATSAPP_MESSAGE_READ" as const;
  if (state === "FAILED") return "WHATSAPP_SEND_FAILED" as const;
  if (state === "RETRYING") return "WHATSAPP_RETRY_STARTED" as const;
  if (state === "SUPPRESSED") return "WHATSAPP_SUPPRESSED" as const;
  return "WHATSAPP_MESSAGE_SENT" as const;
}

export async function POST(request: Request) {
  const rateLimit = await enforceRateLimit({
    request,
    route: "/api/webhooks/communication",
    scope: "communication-webhook",
    maxRequests: 180,
    windowMs: 60_000,
  });
  if (!rateLimit.ok) return rateLimit.response;

  const traceId = createTraceId(request);
  const executionSource = getExecutionSource(request);

  try {
    const body = await parseBody(request).catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ ok: false, error: "Invalid inbound payload.", traceId }, { status: 400 });
    }

    const deliverySummary = extractWhatsAppWebhookSummary(body as Record<string, unknown>);
    if (deliverySummary.isDeliveryReceipt) {
      const deliveryState = normalizeWhatsAppDeliveryState(deliverySummary.status);
      const organizationId =
        cleanString((body as Record<string, unknown>).organizationId) ||
        cleanString((body as Record<string, unknown>).organization_id) ||
        "org-valsentra";
      const locationId =
        cleanString((body as Record<string, unknown>).locationId) ||
        cleanString((body as Record<string, unknown>).location_id) ||
        null;
      const orderId =
        cleanString((body as Record<string, unknown>).orderId) ||
        cleanString((body as Record<string, unknown>).order_id) ||
        "COMMUNICATION";
      const auditMeta = {
        operationalEvent: "WHATSAPP_DELIVERY_STATUS",
        title: `WhatsApp message ${deliveryState.toLowerCase()}`,
        summary: `WhatsApp message ${deliverySummary.messageId} is ${deliveryState.toLowerCase()}.`,
        severity: deliveryState === "FAILED" ? "WARNING" : "INFO",
        provider: deliverySummary.isDeliveryReceipt ? "whatsapp" : "communication",
        providerMessageId: deliverySummary.messageId,
        parentMessageId: deliverySummary.parentMessageId,
        deliveryState,
        retryState: deliveryState === "FAILED" ? "RETRYABLE" : "NONE",
        traceId,
        executionSource,
        rawProviderPayload: body,
      };

      await supabaseAdmin.from("audit_logs").insert({
        action: `WhatsApp delivery ${deliveryState.toLowerCase()}`,
        staff: "Valsentra Communication Webhook",
        order_id: orderId,
        organization_id: organizationId,
        location_id: locationId,
        meta: auditMeta,
      });

      await appendOperationalTimelineEvent({
        organizationId,
        locationId,
        orderId,
        actorSource: "WhatsApp Business Webhook",
        eventType: timelineEventForDelivery(deliveryState),
        summary: String(auditMeta.summary),
        severity: auditMeta.severity as "INFO" | "WATCH" | "WARNING" | "CRITICAL",
        category: "COMMUNICATION",
        traceId,
        correlationId: String(deliverySummary.messageId),
        idempotencyKey: `whatsapp-delivery:${organizationId}:${deliverySummary.messageId}:${deliveryState}`,
        metadata: auditMeta,
      });

      return NextResponse.json({
        ok: true,
        deliveryState,
        providerMessageId: deliverySummary.messageId,
        traceId,
      });
    }

    const payload = normalizeInboundPayload(body as Record<string, unknown>);
    if ("error" in payload) {
      return NextResponse.json({ ok: false, error: payload.error, traceId }, { status: 400 });
    }

    const result = await processInboundOperationalMessage(payload);

    const auditAction = result.duplicate
        ? "Duplicate inbound customer reply blocked"
        : `Inbound customer reply: ${result.operationalLabel}`;
    const organizationId =
      typeof result.auditMeta.organizationId === "string"
        ? result.auditMeta.organizationId
        : payload.organizationId ?? "org-valsentra";
    const auditMeta = {
      ...result.auditMeta,
      title: result.operationalLabel,
      summary: result.matchedOrderId
        ? `${result.operationalLabel} matched to ${result.matchedOrderId}.`
        : `${result.operationalLabel} could not be matched automatically.`,
      severity: result.requiresHumanReview ? "WATCH" : "INFO",
      recommendedAction: result.requiresHumanReview
        ? "Staff should review this customer reply."
        : "Continue service flow.",
      traceId,
      executionSource,
    };

    await supabaseAdmin.from("audit_logs").insert({
      action: auditAction,
      staff: "Valsentra Inbound Messaging",
      order_id: result.matchedOrderId ?? "COMMUNICATION",
      organization_id: organizationId,
      location_id: payload.locationId ?? null,
      meta: auditMeta,
    });

    await appendOperationalTimelineFromAudit({
      action: auditAction,
      staff: "Valsentra Inbound Messaging",
      orderId: result.matchedOrderId ?? "COMMUNICATION",
      organizationId,
      locationId: payload.locationId ?? null,
      meta: auditMeta,
    });

    return NextResponse.json({
      ok: result.ok,
      duplicate: result.duplicate,
      intent: result.intent,
      confidence: result.confidence,
      matchedOrderId: result.matchedOrderId,
      matchedContext: result.matchedContext,
      actionTaken: result.actionTaken,
      requiresHumanReview: result.requiresHumanReview,
      operationalLabel: result.operationalLabel,
      traceId,
    });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Inbound communication processing failed.", traceId },
      { status: 500 }
    );
  }
}
