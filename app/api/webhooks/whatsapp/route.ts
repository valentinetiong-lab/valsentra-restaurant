import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/admin";
import { evaluateAutonomousRecoveryActions } from "@/app/lib/autonomousRecoveryActionEngine";
import {
  buildConversationalRecoveryResponse,
  type WhatsAppIntent,
} from "@/app/lib/conversationalRecoveryEngine";
import {
  buildCustomerOperationalMemoryProfiles,
  getCustomerOperationalMemoryForOrder,
} from "@/app/lib/customerOperationalMemoryEngine";
import { mapAndEnrichOrderFromDb, mapOrderToDb } from "@/app/lib/domain/orderMapper";
import { evaluateWebhookReliability } from "@/app/lib/infrastructure/webhookReliabilityLayer";
import { appendOperationalTimelineEvent } from "@/app/lib/operationalTimelineMemoryEngine";
import { executeDirectCommunication } from "@/app/lib/providers/communication/communicationExecutionService";
import {
  extractWhatsAppWebhookSummary,
  normalizeWhatsAppDeliveryState,
  type WhatsAppDeliveryState,
} from "@/app/lib/providers/communication/whatsappBusinessIntegration";
import {
  createTraceId,
  enforceRateLimit,
  getExecutionSource,
} from "@/app/lib/security/routeProtection";

function getPayloadSummary(payload: Record<string, unknown>) {
  const messageId =
    payload.MessageSid ??
    payload.SmsSid ??
    payload.messageId ??
    payload.id ??
    "unknown";
  const from = payload.From ?? payload.from ?? null;
  const body = payload.Body ?? payload.body ?? null;
  const status = payload.MessageStatus ?? payload.SmsStatus ?? payload.status ?? null;

  return { messageId, from, body, status };
}

function timelineEventForWhatsAppDelivery(state: WhatsAppDeliveryState) {
  if (state === "DELIVERED") return "WHATSAPP_MESSAGE_DELIVERED" as const;
  if (state === "READ") return "WHATSAPP_MESSAGE_READ" as const;
  if (state === "FAILED") return "WHATSAPP_SEND_FAILED" as const;
  if (state === "RETRYING") return "WHATSAPP_RETRY_STARTED" as const;
  if (state === "SUPPRESSED") return "WHATSAPP_SUPPRESSED" as const;
  return "WHATSAPP_MESSAGE_SENT" as const;
}

function normalizePhone(value: unknown) {
  const raw = String(value ?? "").trim().replace(/^whatsapp:/i, "");
  const digits = raw.replace(/\D/g, "");

  if (!digits) return "";
  if (digits.startsWith("00")) return digits.slice(2);
  if (digits.startsWith("0")) return `6${digits}`;
  return digits;
}

function includesAny(value: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(value));
}

function classifyInboundMessage(message: string): {
  intent: WhatsAppIntent;
  confidence: number;
  requiresHumanReview: boolean;
  reason: string;
} {
  const text = message.toLowerCase().trim();

  if (!text) {
    return {
      intent: "UNKNOWN",
      confidence: 20,
      requiresHumanReview: true,
      reason: "Empty inbound message.",
    };
  }

  if (
    includesAny(text, [
      /\bpaid\b/,
      /\bpay(?:ment)?\s*(?:done|made|sent|completed)\b/,
      /\balready\s+paid\b/,
      /\bdone\s+pay(?:ment)?\b/,
      /\btransferred\b/,
      /\breceipt\b/,
      /\bscreenshot\b/,
    ])
  ) {
    return {
      intent: "PAID_ALREADY",
      confidence: 88,
      requiresHumanReview: true,
      reason: "Customer claims payment was completed; staff must verify Payment Truth before release.",
    };
  }

  if (
    includesAny(text, [
      /\bcancel\b/,
      /\bcancelled\b/,
      /\bcancellation\b/,
      /\bcan't\s+(?:come|make it)\b/,
      /\bcannot\s+(?:come|make it)\b/,
      /\bno longer coming\b/,
    ])
  ) {
    return {
      intent: "CANCEL_REQUEST",
      confidence: 86,
      requiresHumanReview: true,
      reason: "Customer appears to request cancellation; Valsentra does not auto-cancel from inbound text.",
    };
  }

  if (
    includesAny(text, [
      /\blate\b/,
      /\brunning\s+late\b/,
      /\bdelay(?:ed)?\b/,
      /\bstuck\b/,
      /\bon\s+the\s+way\b/,
      /\botw\b/,
    ])
  ) {
    return {
      intent: "RUNNING_LATE",
      confidence: 82,
      requiresHumanReview: true,
      reason: "Customer indicates lateness; staff should monitor slot timing.",
    };
  }

  if (
    includesAny(text, [
      /\bchange\b.*\btime\b/,
      /\breschedule\b/,
      /\bmove\b.*\b(?:to|time)\b/,
      /\b(?:to|at)\s+\d{1,2}(?::|\.)?\d{0,2}\s*(?:am|pm)\b/,
      /\b\d{1,2}(?::|\.)\d{2}\s*(?:am|pm)\b/,
    ])
  ) {
    return {
      intent: "CHANGE_TIME_REQUEST",
      confidence: 80,
      requiresHumanReview: true,
      reason: "Customer may be requesting a time change; staff must confirm availability.",
    };
  }

  if (
    includesAny(text, [
      /\bconfirm(?:ed)?\b/,
      /\byes\b/,
      /\bok(?:ay)?\b/,
      /\bcoming\b/,
      /\bsee you\b/,
      /\bwill be there\b/,
    ])
  ) {
    return {
      intent: "CONFIRM_BOOKING",
      confidence: 76,
      requiresHumanReview: false,
      reason: "Customer appears to confirm the booking.",
    };
  }

  if (
    includesAny(text, [
      /\bhelp\b/,
      /\bhuman\b/,
      /\bstaff\b/,
      /\bmanager\b/,
      /\bcall\b/,
      /\btalk\b/,
      /\bspeak\b/,
    ])
  ) {
    return {
      intent: "HELP_OR_HUMAN",
      confidence: 78,
      requiresHumanReview: true,
      reason: "Customer appears to request human assistance.",
    };
  }

  return {
    intent: "UNKNOWN",
    confidence: 35,
    requiresHumanReview: true,
    reason: "No deterministic keyword rule matched confidently.",
  };
}

async function findActiveOrderByPhone(from: unknown) {
  const inboundPhone = normalizePhone(from);
  if (!inboundPhone) return { matchedOrder: null, activeOrders: [] };

  const { data, error } = await supabaseAdmin
    .from("orders")
    .select("*")
    .not("status", "in", '("CANCELLED","NO_SHOW")')
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    throw new Error(error.message);
  }

  const activeOrders = (data ?? []).map(mapAndEnrichOrderFromDb);
  const matched = activeOrders.find((order) => {
    const orderPhone = normalizePhone(order.phone);
    return orderPhone && (orderPhone === inboundPhone || orderPhone.endsWith(inboundPhone) || inboundPhone.endsWith(orderPhone));
  });

  return { matchedOrder: matched ?? null, activeOrders };
}

async function getOrderAuditRows(orderId: string | null) {
  if (!orderId) return [];

  const { data, error } = await supabaseAdmin
    .from("audit_logs")
    .select("*")
    .eq("order_id", orderId)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
}

function buildOrderNote({
  existingNotes,
  intent,
  message,
}: {
  existingNotes: string;
  intent: WhatsAppIntent;
  message: string;
}) {
  const trimmedMessage = message.trim().slice(0, 220);
  const noteByIntent: Record<WhatsAppIntent, string> = {
    PAID_ALREADY: `Inbound WhatsApp: customer says payment is completed. Staff payment verification required. Message: "${trimmedMessage}"`,
    CANCEL_REQUEST: `Inbound WhatsApp: customer requested cancellation. Staff review required before cancelling. Message: "${trimmedMessage}"`,
    RUNNING_LATE: `Inbound WhatsApp: customer is running late. Staff should monitor slot timing. Message: "${trimmedMessage}"`,
    CHANGE_TIME_REQUEST: `Inbound WhatsApp: customer requested a time change. Staff review required before changing reservation time. Message: "${trimmedMessage}"`,
    CONFIRM_BOOKING: `Inbound WhatsApp: customer confirmed booking. Message: "${trimmedMessage}"`,
    HELP_OR_HUMAN: `Inbound WhatsApp: customer requested human help. Staff review required. Message: "${trimmedMessage}"`,
    UNKNOWN: `Inbound WhatsApp: unclassified customer reply. Staff review required. Message: "${trimmedMessage}"`,
  };

  return [existingNotes, noteByIntent[intent]].filter(Boolean).join(" | ");
}

function appendConversationContextNote({
  existingNotes,
  generatedReply,
}: {
  existingNotes: string;
  generatedReply: string | null;
}) {
  if (!generatedReply) return existingNotes;
  return [existingNotes, `Valsentra reply prepared: "${generatedReply.slice(0, 220)}"`]
    .filter(Boolean)
    .join(" | ");
}

async function applySafeOrderUpdate({
  order,
  intent,
  confidence,
  message,
}: {
  order: ReturnType<typeof mapAndEnrichOrderFromDb>;
  intent: WhatsAppIntent;
  confidence: number;
  message: string;
}) {
  if (confidence < 70) {
    return {
      actionTaken: "AUDIT_ONLY_LOW_CONFIDENCE",
      requiresHumanReview: true,
    };
  }

  const notes = buildOrderNote({
    existingNotes: order.notes ?? "",
    intent,
    message,
  });

  if (intent === "PAID_ALREADY") {
    await supabaseAdmin
      .from("orders")
      .update(
        mapOrderToDb({
          notes,
          paymentState: "PENDING",
          paymentVerified: false,
        })
      )
      .eq("id", order.id)
      .eq("organization_id", order.organizationId);

    return {
      actionTaken: "FLAGGED_PAYMENT_VERIFICATION_REQUIRED",
      requiresHumanReview: true,
    };
  }

  if (
    intent === "CANCEL_REQUEST" ||
    intent === "RUNNING_LATE" ||
    intent === "CHANGE_TIME_REQUEST" ||
    intent === "HELP_OR_HUMAN" ||
    intent === "CONFIRM_BOOKING"
  ) {
    await supabaseAdmin
      .from("orders")
      .update(mapOrderToDb({ notes }))
      .eq("id", order.id)
      .eq("organization_id", order.organizationId);

    return {
      actionTaken:
        intent === "CONFIRM_BOOKING"
          ? "BOOKING_CONFIRMATION_NOTED"
          : "FLAGGED_FOR_STAFF_REVIEW",
      requiresHumanReview: intent !== "CONFIRM_BOOKING",
    };
  }

  await supabaseAdmin
    .from("orders")
    .update(mapOrderToDb({ notes }))
    .eq("id", order.id)
    .eq("organization_id", order.organizationId);

  return {
    actionTaken: "UNKNOWN_REPLY_FLAGGED_FOR_STAFF_REVIEW",
    requiresHumanReview: true,
  };
}

export async function POST(request: Request) {
  const rateLimit = await enforceRateLimit({
    request,
    route: "/api/webhooks/whatsapp",
    scope: "whatsapp-webhook",
    maxRequests: 120,
    windowMs: 60_000,
  });
  if (!rateLimit.ok) return rateLimit.response;

  const traceId = createTraceId(request);
  const executionSource = getExecutionSource(request);

  try {
    const contentType = request.headers.get("content-type") ?? "";
    const rawBody = await request.clone().text().catch(() => "");
    const payload = contentType.includes("application/json")
      ? await request.json()
      : contentType.includes("form")
      ? await request.formData().then((formData) => Object.fromEntries(formData.entries()))
      : await request.text().then((text) => ({ rawBody: text }));

    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return NextResponse.json({ error: "Invalid webhook payload." }, { status: 400 });
    }

    const summary = {
      ...getPayloadSummary(payload as Record<string, unknown>),
      ...extractWhatsAppWebhookSummary(payload as Record<string, unknown>),
    };
    const webhookReliability = await evaluateWebhookReliability({
      headers: request.headers,
      provider: "whatsapp",
      messageId: String(summary.messageId),
      orderId: null,
      rawBody,
      requestUrl: request.url,
      params: payload as Record<string, unknown>,
    });

    if (!webhookReliability.accepted && (webhookReliability.malformed || !webhookReliability.signatureValidated)) {
      await supabaseAdmin.from("audit_logs").insert({
        action: "webhookRejected",
        staff: "Valsentra Webhook Reliability",
        order_id: "COMMUNICATION",
        organization_id: "org-valsentra",
        location_id: null,
        meta: {
          operationalEvent: true,
          category: "AUTONOMOUS_ACTION",
          severity: webhookReliability.malformed ? "WARNING" : "CRITICAL",
          title: "WhatsApp webhook rejected",
          summary: webhookReliability.reason,
          eventKey: webhookReliability.idempotencyKey,
          idempotencyKey: webhookReliability.idempotencyKey,
          traceId,
          executionSource,
          webhookReliability,
        },
      });

      return NextResponse.json(
        { ok: false, rejected: true, webhookReliability },
        { status: webhookReliability.status }
      );
    }

    if (webhookReliability.replayDetected) {
      return NextResponse.json({
        ok: true,
        replay: true,
        recorded: false,
        webhookReliability,
      });
    }

    const deliveryState = normalizeWhatsAppDeliveryState(summary.status);
    const webhookType = summary.status ? "DELIVERY_STATUS" : "INBOUND_OR_REPLY";
    const body = typeof summary.body === "string" ? summary.body : "";
    const matchResult = webhookType === "INBOUND_OR_REPLY"
      ? await findActiveOrderByPhone(summary.from)
      : { matchedOrder: null, activeOrders: [] };
    const matchedOrder = matchResult.matchedOrder;
    const classification = webhookType === "INBOUND_OR_REPLY"
      ? classifyInboundMessage(body)
      : {
          intent: "UNKNOWN" as WhatsAppIntent,
          confidence: 0,
          requiresHumanReview: false,
          reason: "Delivery status webhook does not contain customer intent.",
        };
    const safeUpdate =
      matchedOrder && webhookType === "INBOUND_OR_REPLY"
        ? await applySafeOrderUpdate({
            order: matchedOrder,
            intent: classification.intent,
            confidence: classification.confidence,
            message: body,
          })
        : {
            actionTaken:
              webhookType === "DELIVERY_STATUS"
                ? "DELIVERY_STATUS_RECORDED"
                : "AUDIT_ONLY_NO_MATCHED_ORDER",
            requiresHumanReview: webhookType === "INBOUND_OR_REPLY",
          };
    const matchedOrderId = matchedOrder?.id ?? null;
    const recoveryResponse =
      webhookType === "INBOUND_OR_REPLY"
        ? buildConversationalRecoveryResponse({
            order: matchedOrder,
            activeOrders: matchResult.activeOrders,
            intent: classification.intent,
            confidence: classification.confidence,
            inboundMessage: body,
          })
        : null;
    const orderAuditRows = await getOrderAuditRows(matchedOrderId);
    const customerMemoryProfiles = buildCustomerOperationalMemoryProfiles({
      orders: matchResult.activeOrders,
      auditRows: orderAuditRows,
    });
    const customerMemory = matchedOrder
      ? getCustomerOperationalMemoryForOrder({
          order: matchedOrder,
          profiles: customerMemoryProfiles,
        })
      : null;
    const autonomousRecovery =
      webhookType === "INBOUND_OR_REPLY"
        ? evaluateAutonomousRecoveryActions({
            order: matchedOrder,
            intent: classification.intent,
            inboundConfidence: classification.confidence,
            recoveryResponse,
            customerMemory,
            auditRows: orderAuditRows,
          })
        : null;
    const replyExecution =
      matchedOrder && recoveryResponse?.shouldSendReply && recoveryResponse.generatedReply
        ? await executeDirectCommunication({
            channel: "WHATSAPP",
            to: matchedOrder.phone,
            message: recoveryResponse.generatedReply,
            orderId: matchedOrder.id,
            customerName: matchedOrder.customerName,
            metadata: {
              source: "conversational-recovery-engine-v1",
              inboundMessageId: summary.messageId,
              inboundIntent: classification.intent,
              recoveryActionType: recoveryResponse.recoveryActionType,
              conversationContext: recoveryResponse.conversationContext,
            idempotencyKey: `whatsapp-recovery-reply:${String(summary.messageId)}:${matchedOrder.id}`,
            traceId,
            executionSource,
          },
          })
        : null;

    if (matchedOrder && recoveryResponse?.generatedReply) {
      await supabaseAdmin
        .from("orders")
        .update(
          mapOrderToDb({
            notes: appendConversationContextNote({
              existingNotes: buildOrderNote({
                existingNotes: matchedOrder.notes ?? "",
                intent: classification.intent,
                message: body,
              }),
              generatedReply: recoveryResponse.generatedReply,
            }),
          })
        )
        .eq("id", matchedOrder.id)
        .eq("organization_id", matchedOrder.organizationId);
    }

    if (matchedOrder && autonomousRecovery?.orderNote) {
      const recoveryBaseNotes = appendConversationContextNote({
        existingNotes: buildOrderNote({
          existingNotes: matchedOrder.notes ?? "",
          intent: classification.intent,
          message: body,
        }),
        generatedReply: recoveryResponse?.generatedReply ?? null,
      });

      await supabaseAdmin
        .from("orders")
        .update(
          mapOrderToDb({
            notes: [recoveryBaseNotes, autonomousRecovery.orderNote]
              .filter(Boolean)
              .join(" | "),
          })
        )
        .eq("id", matchedOrder.id)
        .eq("organization_id", matchedOrder.organizationId);
    }

    if (matchedOrder && recoveryResponse) {
      const responseAuditRows = [
        {
          action: "recoveryResponseGenerated",
          title: "Conversational recovery response generated",
          summary: recoveryResponse.generatedReply
            ? `Valsentra generated a ${recoveryResponse.recoveryActionType.toLowerCase().replaceAll("_", " ")} reply.`
            : "Valsentra did not generate an automated reply for this inbound message.",
          eventKey: `whatsapp-recovery-response:${String(summary.messageId)}:${matchedOrder.id}`,
        },
        ...(replyExecution
          ? [
              {
                action: "recoveryOfferSent",
                title: replyExecution.realMessageSent
                  ? "Conversational recovery reply sent"
                  : "Conversational recovery reply recorded",
                summary: replyExecution.realMessageSent
                  ? `Reply sent through ${replyExecution.provider}.`
                  : `Reply recorded through ${replyExecution.provider}; no live customer message was sent.`,
                eventKey: `whatsapp-recovery-offer:${String(summary.messageId)}:${matchedOrder.id}`,
              },
            ]
          : []),
        ...(recoveryResponse.conversationContext.awaitingCustomerConfirmation
          ? [
              {
                action: "customerAwaitingConfirmation",
                title: "Customer confirmation required",
                summary: "Valsentra offered a recovery option and is awaiting customer confirmation before staff review.",
                eventKey: `whatsapp-awaiting-confirmation:${String(summary.messageId)}:${matchedOrder.id}`,
              },
            ]
          : []),
      ];

      await supabaseAdmin.from("audit_logs").insert(
        responseAuditRows.map((row) => ({
          action: row.action,
          staff: "Valsentra Conversational Recovery",
          order_id: matchedOrder.id,
          organization_id: matchedOrder.organizationId,
          location_id: matchedOrder.locationId,
          meta: {
            operationalEvent: true,
            category: "RECOVERY",
            severity: recoveryResponse.requiresHumanReview ? "WATCH" : "INFO",
            title: row.title,
            summary: row.summary,
            eventKey: row.eventKey,
            confidence: classification.confidence,
            recommendedAction: recoveryResponse.requiresHumanReview
              ? "Staff should review before changing operational state."
              : "Continue monitoring.",
            reasoning: [recoveryResponse.operationalDecision],
            recoveryResponseGenerated: true,
            recoveryOfferSent: row.action === "recoveryOfferSent",
            customerAwaitingConfirmation: recoveryResponse.conversationContext.awaitingCustomerConfirmation,
            inboundIntent: classification.intent,
            generatedReply: recoveryResponse.generatedReply,
            operationalDecision: recoveryResponse.operationalDecision,
            slotAvailabilityChecked: recoveryResponse.slotAvailabilityChecked,
            recoveryActionType: recoveryResponse.recoveryActionType,
            conversationContext: recoveryResponse.conversationContext,
            replyExecution: replyExecution
              ? {
                  attempted: replyExecution.attempted,
                  provider: replyExecution.provider,
                  providerMode: replyExecution.mode,
                  status: replyExecution.status,
                  ok: replyExecution.ok,
                  messageId: replyExecution.messageId ?? null,
                  error: replyExecution.error ?? null,
                  realMessageSent: replyExecution.realMessageSent,
                  maskedRecipient: replyExecution.maskedRecipient,
                  attemptedAt: replyExecution.attemptedAt,
                  providerStatus: replyExecution.providerStatus,
                }
              : null,
            diagnostics: recoveryResponse.diagnostics,
          },
        }))
      );
    }

    if (matchedOrder && autonomousRecovery) {
      await supabaseAdmin.from("audit_logs").insert(
        autonomousRecovery.auditEvents.map((event) => ({
          action: event.action,
          staff: "Valsentra Autonomous Recovery",
          order_id: matchedOrder.id,
          organization_id: matchedOrder.organizationId,
          location_id: matchedOrder.locationId,
          meta: {
            operationalEvent: true,
            category: "RECOVERY",
            severity: event.severity,
            title: event.title,
            summary: event.summary,
            eventKey: `autonomous-recovery:${String(summary.messageId)}:${matchedOrder.id}:${event.eventKeySuffix}`,
            confidence: event.actionDecision.confidence,
            recommendedAction: event.actionDecision.recommendedStaffReview
              ? "Staff review remains required before irreversible operational changes."
              : "Continue monitoring the recovered state.",
            reasoning: [
              event.actionDecision.actionReason,
              ...autonomousRecovery.diagnostics.recoveryConsensusSignals,
            ],
            autonomousRecoveryAction: event.actionDecision,
            autonomousRecoveryDiagnostics: autonomousRecovery.diagnostics,
            autonomousRecoveryExecuted: event.action === "autonomousRecoveryExecuted",
            autonomousRecoveryBlocked: event.action === "autonomousRecoveryBlocked",
            recoveryStateChanged: event.action === "recoveryStateChanged",
            lateArrivalProtected: event.action === "lateArrivalProtected",
            tentativeSlotReserved: event.action === "tentativeSlotReserved",
            safetyScore: autonomousRecovery.diagnostics.safetyScore,
            trustScore: autonomousRecovery.diagnostics.trustScore,
            recoveryConfidence: autonomousRecovery.diagnostics.recoveryConfidence,
            executionAllowed: autonomousRecovery.diagnostics.executionAllowed,
            guardrailsApplied: autonomousRecovery.diagnostics.guardrailsApplied,
            recoveryConsensusSignals: autonomousRecovery.diagnostics.recoveryConsensusSignals,
            inboundIntent: classification.intent,
            matchedOrderId,
          },
        }))
      );
    }

    const finalAuditAction =
      webhookType === "INBOUND_OR_REPLY"
        ? `Inbound WhatsApp reply classified as ${classification.intent}`
        : `WhatsApp delivery ${deliveryState.toLowerCase()}`;
    const finalOrganizationId = matchedOrder?.organizationId ?? "org-valsentra";
    const finalLocationId = matchedOrder?.locationId ?? null;
    const finalAuditMeta = {
      operationalEvent: true,
      category: webhookType === "INBOUND_OR_REPLY" ? "RECOVERY" : "AUTONOMOUS_ACTION",
      severity:
        webhookType === "DELIVERY_STATUS" && deliveryState === "FAILED"
          ? "WARNING"
          : classification.requiresHumanReview || !matchedOrderId
            ? "WATCH"
            : "INFO",
      title:
        webhookType === "INBOUND_OR_REPLY"
          ? "Customer WhatsApp reply received"
          : `WhatsApp message ${deliveryState.toLowerCase()}`,
      summary:
        webhookType === "INBOUND_OR_REPLY"
          ? matchedOrderId
            ? `Customer reply matched ${matchedOrderId} and was classified as ${classification.intent}.`
            : `Customer reply could not be matched to an active order.`
          : `WhatsApp message ${String(summary.messageId)} is ${deliveryState.toLowerCase()}.`,
      recommendedAction: safeUpdate.requiresHumanReview
        ? "Staff should review the customer reply before changing operational state."
        : deliveryState === "FAILED"
          ? "Valsentra will retry safely when the message is retryable."
          : "Continue monitoring.",
      confidence: classification.confidence,
      reasoning: [classification.reason],
      eventKey: `whatsapp-inbound:${String(summary.messageId)}:${matchedOrderId ?? "unmatched"}:${deliveryState}`,
      idempotencyKey: webhookReliability.idempotencyKey,
      webhookReliability,
      providerReady: true,
      traceId,
      executionSource,
      webhookType,
      provider: "twilio-whatsapp",
      providerMessageId: summary.messageId,
      parentMessageId: summary.parentMessageId ?? null,
      deliveryState,
      retryState:
        deliveryState === "FAILED" && webhookReliability.retryTracking.safeToRetry
          ? "RETRYABLE"
          : deliveryState === "RETRYING"
            ? "RETRYING"
            : "NONE",
      messageId: summary.messageId,
      from: summary.from,
      to: summary.to ?? null,
      body: summary.body,
      status: summary.status,
      errorCode: summary.errorCode ?? null,
      errorMessage: summary.errorMessage ?? null,
      inboundIntent: classification.intent,
      intent: classification.intent,
      matchedOrderId,
      actionTaken: safeUpdate.actionTaken,
      requiresHumanReview: safeUpdate.requiresHumanReview,
      generatedReply: recoveryResponse?.generatedReply ?? null,
      operationalDecision: recoveryResponse?.operationalDecision ?? null,
      slotAvailabilityChecked: recoveryResponse?.slotAvailabilityChecked ?? false,
      recoveryActionType: recoveryResponse?.recoveryActionType ?? null,
      conversationContext: recoveryResponse?.conversationContext ?? null,
      replyExecution: replyExecution
        ? {
            attempted: replyExecution.attempted,
            provider: replyExecution.provider,
            providerMode: replyExecution.mode,
            status: replyExecution.status,
            ok: replyExecution.ok,
            messageId: replyExecution.messageId ?? null,
            error: replyExecution.error ?? null,
            realMessageSent: replyExecution.realMessageSent,
            maskedRecipient: replyExecution.maskedRecipient,
            attemptedAt: replyExecution.attemptedAt,
            providerStatus: replyExecution.providerStatus,
          }
        : null,
      diagnostics: {
        matchedOrderId,
        intent: classification.intent,
        confidence: classification.confidence,
        actionTaken: safeUpdate.actionTaken,
        requiresHumanReview: safeUpdate.requiresHumanReview,
        normalizedFrom: normalizePhone(summary.from),
        orderMatched: Boolean(matchedOrderId),
        generatedReply: recoveryResponse?.generatedReply ?? null,
        operationalDecision: recoveryResponse?.operationalDecision ?? null,
        slotAvailabilityChecked: recoveryResponse?.slotAvailabilityChecked ?? false,
        recoveryActionType: recoveryResponse?.recoveryActionType ?? null,
        autonomousRecovery: autonomousRecovery?.diagnostics ?? null,
      },
      rawPayload: payload,
    };

    await supabaseAdmin.from("audit_logs").insert({
      action: finalAuditAction,
      staff: "Valsentra Communication Webhook",
      order_id: matchedOrderId ?? "COMMUNICATION",
      organization_id: finalOrganizationId,
      location_id: finalLocationId,
      meta: finalAuditMeta,
    });

    await appendOperationalTimelineEvent({
      organizationId: finalOrganizationId,
      locationId: finalLocationId,
      orderId: matchedOrderId ?? "COMMUNICATION",
      actorSource: "WhatsApp Business Webhook",
      eventType:
        webhookType === "INBOUND_OR_REPLY"
          ? "CUSTOMER_REPLY_RECEIVED"
          : timelineEventForWhatsAppDelivery(deliveryState),
      summary: String(finalAuditMeta.summary),
      severity: finalAuditMeta.severity as "INFO" | "WATCH" | "WARNING" | "CRITICAL",
      category: "COMMUNICATION",
      traceId,
      correlationId: webhookReliability.idempotencyKey,
      idempotencyKey: `timeline:${webhookReliability.idempotencyKey}:${deliveryState}`,
      metadata: finalAuditMeta,
    });

    return NextResponse.json({
      ok: true,
      recorded: true,
      providerReady: true,
      messageId: summary.messageId,
      matchedOrderId,
      intent: classification.intent,
      confidence: classification.confidence,
      actionTaken: safeUpdate.actionTaken,
      requiresHumanReview: safeUpdate.requiresHumanReview,
      generatedReply: recoveryResponse?.generatedReply ?? null,
      operationalDecision: recoveryResponse?.operationalDecision ?? null,
      slotAvailabilityChecked: recoveryResponse?.slotAvailabilityChecked ?? false,
      recoveryActionType: recoveryResponse?.recoveryActionType ?? null,
      replySent: Boolean(replyExecution?.realMessageSent),
      replyProviderStatus: replyExecution?.status ?? null,
      webhookReliability,
      traceId,
      executionSource,
      autonomousRecovery: autonomousRecovery
        ? {
            executionAllowed: autonomousRecovery.executionAllowed,
            executedActions: autonomousRecovery.executedActions.map((action) => action.actionType),
            blockedActions: autonomousRecovery.blockedActions.map((action) => ({
              actionType: action.actionType,
              blockedBy: action.blockedBy,
            })),
            diagnostics: autonomousRecovery.diagnostics,
          }
        : null,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message ?? "Failed to process WhatsApp webhook." },
      { status: 500 }
    );
  }
}
