import { supabaseAdmin } from "@/app/lib/admin";
import { mapAndEnrichOrderFromDb, mapOrderToDb } from "@/app/lib/domain/orderMapper";
import type { RestaurantOrder } from "@/app/lib/domain/restaurant";
import { buildIdempotencyKey, checkIdempotencyKey } from "@/app/lib/infrastructure/idempotencyLayer";
import { runWaitlistCascade } from "@/app/lib/waitlistCascadeService";

export type OperationalInboundIntent =
  | "CONFIRM_ARRIVAL"
  | "RUNNING_LATE"
  | "ACCEPT_WAITLIST_SLOT"
  | "REJECT_WAITLIST_SLOT"
  | "PAYMENT_SENT"
  | "CANCEL_REQUEST"
  | "RESCHEDULE_REQUEST"
  | "NEEDS_HUMAN"
  | "UNKNOWN";

export type InboundCommunicationPayload = {
  provider: string;
  messageId: string;
  sender: string;
  body: string;
  timestamp?: string | null;
  organizationId?: string | null;
  locationId?: string | null;
  metadata?: Record<string, unknown>;
};

export type InboundOperationalResult = {
  ok: boolean;
  duplicate: boolean;
  intent: OperationalInboundIntent;
  confidence: number;
  matchedOrderId: string | null;
  matchedContext: "ORDER" | "PAYMENT_REQUEST" | "WAITLIST_RECOVERY" | "UNMATCHED";
  actionTaken: string;
  requiresHumanReview: boolean;
  operationalLabel: string;
  auditMeta: Record<string, unknown>;
};

function includesAny(value: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(value));
}

export function normalizeInboundPhone(value: unknown) {
  const raw = String(value ?? "").trim().replace(/^whatsapp:/i, "");
  const digits = raw.replace(/\D/g, "");

  if (!digits) return "";
  if (digits.startsWith("00")) return digits.slice(2);
  if (digits.startsWith("0")) return `6${digits}`;
  return digits;
}

export function classifyOperationalInboundIntent(message: string): {
  intent: OperationalInboundIntent;
  confidence: number;
  requiresHumanReview: boolean;
  reason: string;
} {
  const text = message.toLowerCase().trim();

  if (!text) {
    return {
      intent: "UNKNOWN",
      confidence: 15,
      requiresHumanReview: true,
      reason: "Empty customer reply.",
    };
  }

  if (
    includesAny(text, [
      /\baccept\b/,
      /\btake\s+(?:it|slot)\b/,
      /\bslot\s+(?:yes|ok|okay)\b/,
      /\byes\b.*\bslot\b/,
      /\bconfirm\b.*\bslot\b/,
      /\bi\s+can\s+come\b/,
    ])
  ) {
    return {
      intent: "ACCEPT_WAITLIST_SLOT",
      confidence: 88,
      requiresHumanReview: false,
      reason: "Customer appears to accept a waitlist recovery slot.",
    };
  }

  if (
    includesAny(text, [
      /\breject\b/,
      /\bno\s+thanks\b/,
      /\bcan't\s+take\b/,
      /\bcannot\s+take\b/,
      /\bnot\s+available\b/,
      /\bpass\b/,
    ])
  ) {
    return {
      intent: "REJECT_WAITLIST_SLOT",
      confidence: 84,
      requiresHumanReview: false,
      reason: "Customer appears to reject a waitlist recovery slot.",
    };
  }

  if (
    includesAny(text, [
      /\bpaid\b/,
      /\bpayment\s+(?:sent|done|made|completed)\b/,
      /\btransfer(?:red)?\b/,
      /\breceipt\b/,
      /\bscreenshot\b/,
      /\bproof\b/,
    ])
  ) {
    return {
      intent: "PAYMENT_SENT",
      confidence: 86,
      requiresHumanReview: true,
      reason: "Customer claims payment was sent; Payment Truth still requires provider callback or manager review.",
    };
  }

  if (
    includesAny(text, [
      /\brunning\s+late\b/,
      /\blate\b/,
      /\bdelay(?:ed)?\b/,
      /\bstuck\b/,
      /\botw\b/,
      /\bon\s+the\s+way\b/,
    ])
  ) {
    return {
      intent: "RUNNING_LATE",
      confidence: 82,
      requiresHumanReview: false,
      reason: "Customer says they are running late or on the way.",
    };
  }

  if (
    includesAny(text, [
      /\bconfirm(?:ed)?\b/,
      /\bcoming\b/,
      /\bwill\s+(?:come|be there)\b/,
      /\bsee\s+you\b/,
      /\bon\s+my\s+way\b/,
    ])
  ) {
    return {
      intent: "CONFIRM_ARRIVAL",
      confidence: 78,
      requiresHumanReview: false,
      reason: "Customer confirms arrival or booking attendance.",
    };
  }

  if (
    includesAny(text, [
      /\bcancel\b/,
      /\bcancellation\b/,
      /\bcan't\s+(?:come|make it)\b/,
      /\bcannot\s+(?:come|make it)\b/,
      /\bno\s+longer\s+coming\b/,
    ])
  ) {
    return {
      intent: "CANCEL_REQUEST",
      confidence: 86,
      requiresHumanReview: true,
      reason: "Customer appears to request cancellation; Valsentra does not auto-cancel.",
    };
  }

  if (
    includesAny(text, [
      /\breschedule\b/,
      /\bchange\b.*\btime\b/,
      /\bmove\b.*\b(?:time|to)\b/,
      /\b(?:to|at)\s+\d{1,2}(?::|\.)?\d{0,2}\s*(?:am|pm)\b/,
    ])
  ) {
    return {
      intent: "RESCHEDULE_REQUEST",
      confidence: 80,
      requiresHumanReview: true,
      reason: "Customer appears to request a time change; staff must approve availability.",
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
      intent: "NEEDS_HUMAN",
      confidence: 78,
      requiresHumanReview: true,
      reason: "Customer appears to need a human reply.",
    };
  }

  return {
    intent: "UNKNOWN",
    confidence: 35,
    requiresHumanReview: true,
    reason: "No deterministic operational rule matched confidently.",
  };
}

function phoneMatches(left: string, right: string) {
  return Boolean(left && right && (left === right || left.endsWith(right) || right.endsWith(left)));
}

function appendNote(existing: string, note: string) {
  return [existing, note].filter(Boolean).join(" | ").slice(0, 2000);
}

function operationalLabel(intent: OperationalInboundIntent) {
  const labels: Record<OperationalInboundIntent, string> = {
    CONFIRM_ARRIVAL: "Customer Arriving",
    RUNNING_LATE: "Running Late",
    ACCEPT_WAITLIST_SLOT: "Wants Slot",
    REJECT_WAITLIST_SLOT: "Slot Declined",
    PAYMENT_SENT: "Payment Proof Sent",
    CANCEL_REQUEST: "Needs Manager",
    RESCHEDULE_REQUEST: "Customer Needs Reply",
    NEEDS_HUMAN: "Customer Needs Reply",
    UNKNOWN: "Customer Needs Reply",
  };
  return labels[intent];
}

async function findPaymentRequestContext(payload: InboundCommunicationPayload) {
  const phone = normalizeInboundPhone(payload.sender);
  if (!phone) return null;

  let query = supabaseAdmin
    .from("payment_requests")
    .select("*")
    .in("status", ["pending", "created", "sent"])
    .order("created_at", { ascending: false })
    .limit(50);

  if (payload.organizationId) query = query.eq("organization_id", payload.organizationId);

  const { data } = await query;
  return (data ?? []).find((row) => phoneMatches(normalizeInboundPhone(row.customer_phone), phone)) ?? null;
}

async function findOrderContext(payload: InboundCommunicationPayload, paymentRequest: Record<string, any> | null) {
  const phone = normalizeInboundPhone(payload.sender);
  const orderIdFromMetadata = String(payload.metadata?.orderId ?? payload.metadata?.order_id ?? paymentRequest?.order_id ?? "");

  let query = supabaseAdmin
    .from("orders")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);

  if (payload.organizationId) query = query.eq("organization_id", payload.organizationId);
  if (orderIdFromMetadata) query = query.eq("id", orderIdFromMetadata);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const orders = (data ?? []).map(mapAndEnrichOrderFromDb);
  if (orderIdFromMetadata) return orders[0] ?? null;

  const matches = orders.filter((order) => phoneMatches(normalizeInboundPhone(order.phone), phone));
  if (payload.organizationId) return matches[0] ?? null;

  const organizations = new Set(matches.map((order) => order.organizationId));
  return organizations.size === 1 ? matches[0] ?? null : null;
}

async function findWaitlistRecoveryContext(payload: InboundCommunicationPayload, order: RestaurantOrder | null) {
  const phone = normalizeInboundPhone(payload.sender);
  if (!phone) return { lead: null, recoveryOrder: order };

  let leadQuery = supabaseAdmin
    .from("waitlist_leads")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);
  if (payload.organizationId) leadQuery = leadQuery.eq("organization_id", payload.organizationId);

  const { data: leadRows } = await leadQuery;
  const lead = (leadRows ?? []).find((row) => phoneMatches(normalizeInboundPhone(row.phone), phone)) ?? null;
  if (!lead) return { lead: null, recoveryOrder: order };

  const { data: auditRows } = await supabaseAdmin
    .from("audit_logs")
    .select("order_id, meta, created_at")
    .eq("organization_id", lead.organization_id ?? payload.organizationId ?? "org-valsentra")
    .or(`meta->>recoveryOfferCandidateId.eq.${lead.id},meta->>selectedLeadId.eq.${lead.id}`)
    .order("created_at", { ascending: false })
    .limit(5);

  const offeredOrderId = auditRows?.[0]?.order_id ?? null;
  if (!offeredOrderId) return { lead, recoveryOrder: order };

  const { data: recoveryOrderRow } = await supabaseAdmin
    .from("orders")
    .select("*")
    .eq("id", offeredOrderId)
    .eq("organization_id", lead.organization_id ?? payload.organizationId ?? "org-valsentra")
    .maybeSingle();

  return {
    lead,
    recoveryOrder: recoveryOrderRow ? mapAndEnrichOrderFromDb(recoveryOrderRow) : order,
  };
}

async function cancelRecoveryJobs(order: RestaurantOrder) {
  if (!order.organizationId) return;
  await supabaseAdmin
    .from("operational_jobs")
    .update({
      status: "cancelled",
      updated_at: new Date().toISOString(),
      last_error: "Stopped because customer accepted recovery slot.",
    })
    .eq("organization_id", order.organizationId)
    .eq("job_type", "waitlist_recovery_autopilot")
    .in("status", ["pending", "retrying"])
    .contains("payload", { orderId: order.id });
}

async function applyOperationalAction({
  order,
  intent,
  confidence,
  message,
  waitlistLead,
}: {
  order: RestaurantOrder | null;
  intent: OperationalInboundIntent;
  confidence: number;
  message: string;
  waitlistLead: Record<string, any> | null;
}) {
  if (!order || confidence < 70) {
    return {
      actionTaken: order ? "FLAGGED_FOR_STAFF_REVIEW" : "UNMATCHED_REPLY_QUEUED",
      requiresHumanReview: true,
      cascade: null,
    };
  }

  const now = new Date().toISOString();
  const note = `Inbound reply: ${operationalLabel(intent)}. Message: "${message.trim().slice(0, 220)}"`;

  if (intent === "CONFIRM_ARRIVAL") {
    await supabaseAdmin
      .from("orders")
      .update(mapOrderToDb({ notes: appendNote(order.notes ?? "", note), protectionReason: "Customer Arriving" }))
      .eq("id", order.id)
      .eq("organization_id", order.organizationId);
    return { actionTaken: "CUSTOMER_ARRIVAL_NOTED", requiresHumanReview: false, cascade: null };
  }

  if (intent === "RUNNING_LATE") {
    const currentHold = order.slotHoldExpiresAt ? new Date(order.slotHoldExpiresAt).getTime() : Date.now();
    const extendedHold = new Date(Math.max(currentHold, Date.now()) + 10 * 60_000).toISOString();
    await supabaseAdmin
      .from("orders")
      .update(mapOrderToDb({
        notes: appendNote(order.notes ?? "", note),
        slotHoldExpiresAt: extendedHold,
        protectionReason: "Running Late",
      }))
      .eq("id", order.id)
      .eq("organization_id", order.organizationId);
    return { actionTaken: "LATE_ARRIVAL_TOLERANCE_EXTENDED", requiresHumanReview: false, cascade: null };
  }

  if (intent === "PAYMENT_SENT") {
    await supabaseAdmin
      .from("orders")
      .update(mapOrderToDb({
        notes: appendNote(order.notes ?? "", note),
        paymentState: "PENDING",
        paymentVerified: false,
        paymentTruthStatus: "SCREENSHOT_ONLY",
        paymentTruthSource: "CUSTOMER_SCREENSHOT",
        protectionReason: "Payment Proof Sent",
      }))
      .eq("id", order.id)
      .eq("organization_id", order.organizationId);
    return { actionTaken: "PAYMENT_PROOF_REVIEW_REQUIRED", requiresHumanReview: true, cascade: null };
  }

  if (intent === "ACCEPT_WAITLIST_SLOT") {
    const cascade = await runWaitlistCascade({
      orderId: order.id,
      staffName: "Inbound Recovery",
      organizationId: order.organizationId,
    });
    await cancelRecoveryJobs(order);
    await supabaseAdmin
      .from("orders")
      .update(mapOrderToDb({
        notes: appendNote(order.notes ?? "", waitlistLead ? `${note}. Waitlist lead accepted.` : note),
        recoveryState: cascade.ok ? "RECOVERED" : "WAITING_RESPONSE",
        recoveryUpdatedAt: now,
        recoverySelectedLeadId: waitlistLead?.id ?? order.recoverySelectedLeadId ?? null,
        protectionReason: cascade.ok ? "Replacement Found" : "Wants Slot",
      }))
      .eq("id", order.id)
      .eq("organization_id", order.organizationId);
    return {
      actionTaken: cascade.ok ? "WAITLIST_SLOT_LOCKED" : "WAITLIST_ACCEPTANCE_NEEDS_STAFF_REVIEW",
      requiresHumanReview: true,
      cascade,
    };
  }

  if (intent === "REJECT_WAITLIST_SLOT") {
    await supabaseAdmin
      .from("orders")
      .update(mapOrderToDb({
        notes: appendNote(order.notes ?? "", note),
        recoveryState: "OPEN_RECOVERY",
        recoveryUpdatedAt: now,
        protectionReason: "Recovery still searching",
      }))
      .eq("id", order.id)
      .eq("organization_id", order.organizationId);
    return { actionTaken: "WAITLIST_SLOT_DECLINED", requiresHumanReview: false, cascade: null };
  }

  await supabaseAdmin
    .from("orders")
    .update(mapOrderToDb({ notes: appendNote(order.notes ?? "", note), protectionReason: operationalLabel(intent) }))
    .eq("id", order.id)
    .eq("organization_id", order.organizationId);

  return {
    actionTaken:
      intent === "CANCEL_REQUEST"
        ? "CANCELLATION_REVIEW_REQUIRED"
        : intent === "RESCHEDULE_REQUEST"
          ? "RESCHEDULE_REVIEW_REQUIRED"
          : "CUSTOMER_REPLY_REVIEW_REQUIRED",
    requiresHumanReview: true,
    cascade: null,
  };
}

export async function processInboundOperationalMessage(payload: InboundCommunicationPayload): Promise<InboundOperationalResult> {
  const classification = classifyOperationalInboundIntent(payload.body);
  const paymentRequest = await findPaymentRequestContext(payload);
  const orderContext = await findOrderContext(payload, paymentRequest);
  const waitlistContext = await findWaitlistRecoveryContext(payload, orderContext);
  const order = waitlistContext.recoveryOrder ?? orderContext;
  const organizationId = order?.organizationId ?? paymentRequest?.organization_id ?? payload.organizationId ?? "org-valsentra";
  const locationId = order?.locationId ?? paymentRequest?.location_id ?? payload.locationId ?? null;
  const idempotencyKey = buildIdempotencyKey({
    scope: "WEBHOOK",
    organizationId,
    orderId: order?.id ?? null,
    action: "communication-inbound",
    providerMessageId: payload.messageId,
  });
  const duplicate = await checkIdempotencyKey({
    key: idempotencyKey,
    scope: "WEBHOOK",
    organizationId,
    locationId,
    orderId: order?.id ?? null,
    metadata: {
      provider: payload.provider,
      sender: normalizeInboundPhone(payload.sender),
      intent: classification.intent,
    },
  });

  if (duplicate.duplicate) {
    return {
      ok: true,
      duplicate: true,
      intent: classification.intent,
      confidence: classification.confidence,
      matchedOrderId: order?.id ?? null,
      matchedContext: order ? "ORDER" : "UNMATCHED",
      actionTaken: "DUPLICATE_INBOUND_BLOCKED",
      requiresHumanReview: false,
      operationalLabel: operationalLabel(classification.intent),
      auditMeta: { idempotencyKey, duplicateReason: duplicate.reason },
    };
  }

  const action = await applyOperationalAction({
    order,
    intent: classification.intent,
    confidence: classification.confidence,
    message: payload.body,
    waitlistLead: waitlistContext.lead,
  });
  const matchedContext = waitlistContext.lead
    ? "WAITLIST_RECOVERY"
    : paymentRequest
      ? "PAYMENT_REQUEST"
      : order
        ? "ORDER"
        : "UNMATCHED";

  return {
    ok: true,
    duplicate: false,
    intent: classification.intent,
    confidence: classification.confidence,
    matchedOrderId: order?.id ?? null,
    matchedContext,
    actionTaken: action.actionTaken,
    requiresHumanReview: action.requiresHumanReview,
    operationalLabel: operationalLabel(classification.intent),
    auditMeta: {
      operationalEvent: "INBOUND_OPERATIONAL_MESSAGE",
      category: "COMMUNICATION",
      idempotencyKey,
      organizationId,
      locationId,
      provider: payload.provider,
      sender: normalizeInboundPhone(payload.sender),
      messageId: payload.messageId,
      inboundIntent: classification.intent,
      confidence: classification.confidence,
      classificationReason: classification.reason,
      operationalLabel: operationalLabel(classification.intent),
      matchedContext,
      matchedOrderId: order?.id ?? null,
      matchedPaymentRequestId: paymentRequest?.id ?? null,
      matchedWaitlistLeadId: waitlistContext.lead?.id ?? null,
      actionTaken: action.actionTaken,
      requiresHumanReview: action.requiresHumanReview,
      cascade: action.cascade,
      receivedAt: payload.timestamp ?? new Date().toISOString(),
      providerMetadata: payload.metadata ?? {},
    },
  };
}
