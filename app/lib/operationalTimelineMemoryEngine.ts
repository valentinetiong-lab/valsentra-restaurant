import { supabaseAdmin } from "@/app/lib/admin";

export type OperationalTimelineEventType =
  | "BOOKING_CREATED"
  | "PAYMENT_REQUESTED"
  | "PAYMENT_CONFIRMED"
  | "PAYMENT_BLOCKED"
  | "PAYMENT_MISMATCH"
  | "WAITLIST_RECOVERY_STARTED"
  | "WAITLIST_RECOVERED"
  | "WAITLIST_FAILED"
  | "CUSTOMER_REPLY_RECEIVED"
  | "CUSTOMER_RUNNING_LATE"
  | "PROVIDER_FAILURE"
  | "MESSAGE_SENT"
  | "MESSAGE_FAILED"
  | "AUTO_RELEASE_TRIGGERED"
  | "MANAGER_OVERRIDE"
  | "NO_SHOW_CONFIRMED"
  | "FULFILLMENT_BLOCKED"
  | "FULFILLMENT_RELEASED"
  | "COLLAPSE_RISK_TRIGGERED"
  | "ARRIVAL_PRESSURE_HIGH"
  | "PAYMENT_CONGESTION"
  | "RECOVERY_OVERLOAD"
  | "PROVIDER_DEGRADED"
  | "ARRIVAL_WAVE_STARTED"
  | "PAYMENT_BOTTLENECK_ACTIVE"
  | "RECOVERY_PACING_REDUCED"
  | "RUSH_LOCK_ENABLED"
  | "SERVICE_STABILIZING"
  | "COORDINATION_STATE_CHANGED"
  | "AUTONOMOUS_THROTTLE_STARTED"
  | "RECOVERY_ESCALATION_SLOWED"
  | "REMINDER_SUPPRESSION_ENABLED"
  | "RUSH_LOCK_AUTO_ENABLED"
  | "EXECUTION_STABILIZED"
  | "EXECUTION_COOLDOWN_STARTED"
  | "EXECUTION_STATE_CHANGED"
  | "WHATSAPP_MESSAGE_SENT"
  | "WHATSAPP_MESSAGE_DELIVERED"
  | "WHATSAPP_MESSAGE_READ"
  | "WHATSAPP_SEND_FAILED"
  | "WHATSAPP_RETRY_STARTED"
  | "WHATSAPP_SUPPRESSED"
  | "PRESSURE_STATE_CHANGED"
  | "POLICY_OVERRIDE_APPLIED"
  | "RECOVERY_THROTTLED"
  | "REMINDERS_SUPPRESSED"
  | "PAYMENT_PRIORITY_ENABLED"
  | "COLLAPSE_PROTECTION_ENABLED"
  | "RUNTIME_HEARTBEAT"
  | "ENGINE_EXECUTION_STARTED"
  | "ENGINE_EXECUTION_COMPLETED"
  | "ENGINE_EXECUTION_DELAYED"
  | "RUNTIME_PRESSURE_HIGH"
  | "RUNTIME_BACKOFF_ENABLED"
  | "RUNTIME_DEGRADED"
  | "RUNTIME_RECOVERED"
  | "WORKER_REGISTERED"
  | "WORKER_HEARTBEAT"
  | "WORKER_OVERLOADED"
  | "WORKER_FAILOVER_STARTED"
  | "EXECUTION_REASSIGNED"
  | "PARTITION_REBALANCED"
  | "MESH_DEGRADED"
  | "MESH_RECOVERED";

export type OperationalTimelineSeverity = "INFO" | "WATCH" | "WARNING" | "CRITICAL";

export type OperationalTimelineCategory =
  | "BOOKING"
  | "PAYMENT"
  | "RECOVERY"
  | "WAITLIST"
  | "CUSTOMER"
  | "COMMUNICATION"
  | "ESCALATION"
  | "FULFILLMENT"
  | "PROVIDER"
  | "WORKER";

export type AppendOperationalTimelineEventInput = {
  organizationId: string;
  locationId?: string | null;
  orderId?: string | null;
  actorSource?: string | null;
  actorUserId?: string | null;
  eventType: OperationalTimelineEventType;
  summary: string;
  severity?: OperationalTimelineSeverity;
  category?: OperationalTimelineCategory;
  timestamp?: string;
  metadata?: Record<string, unknown>;
  traceId?: string | null;
  executionId?: string | null;
  correlationId?: string | null;
  idempotencyKey?: string | null;
};

export type OperationalTimelineMemoryEvent = {
  id: string;
  organizationId: string;
  locationId: string | null;
  orderId: string | null;
  actorSource: string | null;
  actorUserId: string | null;
  eventType: OperationalTimelineEventType;
  summary: string;
  severity: OperationalTimelineSeverity;
  category: OperationalTimelineCategory;
  timestamp: string;
  metadata: Record<string, unknown>;
  traceId: string | null;
  executionId: string | null;
  correlationId: string | null;
  idempotencyKey: string;
};

const EVENT_CATEGORY: Record<OperationalTimelineEventType, OperationalTimelineCategory> = {
  BOOKING_CREATED: "BOOKING",
  PAYMENT_REQUESTED: "PAYMENT",
  PAYMENT_CONFIRMED: "PAYMENT",
  PAYMENT_BLOCKED: "PAYMENT",
  PAYMENT_MISMATCH: "PAYMENT",
  WAITLIST_RECOVERY_STARTED: "WAITLIST",
  WAITLIST_RECOVERED: "RECOVERY",
  WAITLIST_FAILED: "RECOVERY",
  CUSTOMER_REPLY_RECEIVED: "CUSTOMER",
  CUSTOMER_RUNNING_LATE: "CUSTOMER",
  PROVIDER_FAILURE: "PROVIDER",
  PROVIDER_DEGRADED: "PROVIDER",
  MESSAGE_SENT: "COMMUNICATION",
  MESSAGE_FAILED: "COMMUNICATION",
  AUTO_RELEASE_TRIGGERED: "FULFILLMENT",
  MANAGER_OVERRIDE: "ESCALATION",
  NO_SHOW_CONFIRMED: "BOOKING",
  FULFILLMENT_BLOCKED: "FULFILLMENT",
  FULFILLMENT_RELEASED: "FULFILLMENT",
  COLLAPSE_RISK_TRIGGERED: "WORKER",
  ARRIVAL_PRESSURE_HIGH: "BOOKING",
  PAYMENT_CONGESTION: "PAYMENT",
  RECOVERY_OVERLOAD: "RECOVERY",
  ARRIVAL_WAVE_STARTED: "BOOKING",
  PAYMENT_BOTTLENECK_ACTIVE: "PAYMENT",
  RECOVERY_PACING_REDUCED: "RECOVERY",
  RUSH_LOCK_ENABLED: "WORKER",
  SERVICE_STABILIZING: "WORKER",
  COORDINATION_STATE_CHANGED: "WORKER",
  AUTONOMOUS_THROTTLE_STARTED: "WORKER",
  RECOVERY_ESCALATION_SLOWED: "RECOVERY",
  REMINDER_SUPPRESSION_ENABLED: "COMMUNICATION",
  RUSH_LOCK_AUTO_ENABLED: "WORKER",
  EXECUTION_STABILIZED: "WORKER",
  EXECUTION_COOLDOWN_STARTED: "WORKER",
  EXECUTION_STATE_CHANGED: "WORKER",
  WHATSAPP_MESSAGE_SENT: "COMMUNICATION",
  WHATSAPP_MESSAGE_DELIVERED: "COMMUNICATION",
  WHATSAPP_MESSAGE_READ: "COMMUNICATION",
  WHATSAPP_SEND_FAILED: "COMMUNICATION",
  WHATSAPP_RETRY_STARTED: "COMMUNICATION",
  WHATSAPP_SUPPRESSED: "COMMUNICATION",
  PRESSURE_STATE_CHANGED: "WORKER",
  POLICY_OVERRIDE_APPLIED: "WORKER",
  RECOVERY_THROTTLED: "RECOVERY",
  REMINDERS_SUPPRESSED: "COMMUNICATION",
  PAYMENT_PRIORITY_ENABLED: "PAYMENT",
  COLLAPSE_PROTECTION_ENABLED: "WORKER",
  RUNTIME_HEARTBEAT: "WORKER",
  ENGINE_EXECUTION_STARTED: "WORKER",
  ENGINE_EXECUTION_COMPLETED: "WORKER",
  ENGINE_EXECUTION_DELAYED: "WORKER",
  RUNTIME_PRESSURE_HIGH: "WORKER",
  RUNTIME_BACKOFF_ENABLED: "WORKER",
  RUNTIME_DEGRADED: "WORKER",
  RUNTIME_RECOVERED: "WORKER",
  WORKER_REGISTERED: "WORKER",
  WORKER_HEARTBEAT: "WORKER",
  WORKER_OVERLOADED: "WORKER",
  WORKER_FAILOVER_STARTED: "WORKER",
  EXECUTION_REASSIGNED: "WORKER",
  PARTITION_REBALANCED: "WORKER",
  MESH_DEGRADED: "WORKER",
  MESH_RECOVERED: "WORKER",
};

const EVENT_SEVERITY: Partial<Record<OperationalTimelineEventType, OperationalTimelineSeverity>> = {
  PAYMENT_BLOCKED: "WARNING",
  PAYMENT_MISMATCH: "WARNING",
  WAITLIST_FAILED: "WARNING",
  PROVIDER_FAILURE: "WARNING",
  MESSAGE_FAILED: "WARNING",
  AUTO_RELEASE_TRIGGERED: "WATCH",
  MANAGER_OVERRIDE: "WATCH",
  NO_SHOW_CONFIRMED: "WARNING",
  FULFILLMENT_BLOCKED: "WARNING",
  COLLAPSE_RISK_TRIGGERED: "CRITICAL",
  ARRIVAL_PRESSURE_HIGH: "WARNING",
  PAYMENT_CONGESTION: "WARNING",
  RECOVERY_OVERLOAD: "WARNING",
  PROVIDER_DEGRADED: "WARNING",
  ARRIVAL_WAVE_STARTED: "WARNING",
  PAYMENT_BOTTLENECK_ACTIVE: "WARNING",
  RECOVERY_PACING_REDUCED: "WATCH",
  RUSH_LOCK_ENABLED: "CRITICAL",
  SERVICE_STABILIZING: "INFO",
  COORDINATION_STATE_CHANGED: "WATCH",
  AUTONOMOUS_THROTTLE_STARTED: "WARNING",
  RECOVERY_ESCALATION_SLOWED: "WATCH",
  REMINDER_SUPPRESSION_ENABLED: "WATCH",
  RUSH_LOCK_AUTO_ENABLED: "CRITICAL",
  EXECUTION_STABILIZED: "INFO",
  EXECUTION_COOLDOWN_STARTED: "INFO",
  EXECUTION_STATE_CHANGED: "WATCH",
  WHATSAPP_MESSAGE_SENT: "INFO",
  WHATSAPP_MESSAGE_DELIVERED: "INFO",
  WHATSAPP_MESSAGE_READ: "INFO",
  WHATSAPP_SEND_FAILED: "WARNING",
  WHATSAPP_RETRY_STARTED: "WATCH",
  WHATSAPP_SUPPRESSED: "WATCH",
  PRESSURE_STATE_CHANGED: "WATCH",
  POLICY_OVERRIDE_APPLIED: "WATCH",
  RECOVERY_THROTTLED: "WATCH",
  REMINDERS_SUPPRESSED: "WATCH",
  PAYMENT_PRIORITY_ENABLED: "WARNING",
  COLLAPSE_PROTECTION_ENABLED: "CRITICAL",
  RUNTIME_HEARTBEAT: "INFO",
  ENGINE_EXECUTION_STARTED: "INFO",
  ENGINE_EXECUTION_COMPLETED: "INFO",
  ENGINE_EXECUTION_DELAYED: "WATCH",
  RUNTIME_PRESSURE_HIGH: "WARNING",
  RUNTIME_BACKOFF_ENABLED: "WATCH",
  RUNTIME_DEGRADED: "WARNING",
  RUNTIME_RECOVERED: "INFO",
  WORKER_REGISTERED: "INFO",
  WORKER_HEARTBEAT: "INFO",
  WORKER_OVERLOADED: "WARNING",
  WORKER_FAILOVER_STARTED: "WARNING",
  EXECUTION_REASSIGNED: "WATCH",
  PARTITION_REBALANCED: "WATCH",
  MESH_DEGRADED: "WARNING",
  MESH_RECOVERED: "INFO",
};

function cleanIdPart(value?: string | null) {
  return String(value ?? "none").replace(/[^A-Za-z0-9:_-]/g, "-").slice(0, 140);
}

function buildTimelineIdempotencyKey(input: AppendOperationalTimelineEventInput) {
  if (input.idempotencyKey) return input.idempotencyKey;

  const correlation =
    input.correlationId ??
    input.executionId ??
    input.traceId ??
    input.metadata?.idempotencyKey ??
    input.metadata?.eventKey ??
    input.metadata?.providerMessageId ??
    input.metadata?.paymentRequestId ??
    input.timestamp ??
    new Date().toISOString().slice(0, 16);

  return [
    "timeline",
    cleanIdPart(input.organizationId),
    cleanIdPart(input.orderId),
    cleanIdPart(input.eventType),
    cleanIdPart(String(correlation)),
  ].join(":");
}

export function timelineEventFromAudit({
  action,
  staff,
  orderId,
  organizationId,
  locationId,
  meta = {},
  createdAt,
}: {
  action: string;
  staff?: string | null;
  orderId?: string | null;
  organizationId: string;
  locationId?: string | null;
  meta?: Record<string, any>;
  createdAt?: string | null;
}): AppendOperationalTimelineEventInput {
  const source = `${action} ${meta.operationalEvent ?? ""} ${meta.category ?? ""} ${meta.title ?? ""}`.toLowerCase();
  const paymentTruthStatus = String(meta.paymentTruth?.status ?? meta.paymentTruthStatus ?? "").toUpperCase();
  const inboundIntent = String(meta.inboundIntent ?? meta.intent ?? "").toUpperCase();

  let eventType: OperationalTimelineEventType = "BOOKING_CREATED";

  if (source.includes("payment link") || source.includes("payment request")) eventType = "PAYMENT_REQUESTED";
  if (source.includes("provider payment confirmed") || paymentTruthStatus === "PROVIDER_CONFIRMED") eventType = "PAYMENT_CONFIRMED";
  if (source.includes("amount mismatch") || paymentTruthStatus === "AMOUNT_MISMATCH") eventType = "PAYMENT_MISMATCH";
  if (source.includes("payment blocked") || source.includes("blocked payment")) eventType = "PAYMENT_BLOCKED";
  if (source.includes("release blocked") || source.includes("fulfillment blocked")) eventType = "FULFILLMENT_BLOCKED";
  if (source.includes("released after") || source.includes("fulfillment released")) eventType = "FULFILLMENT_RELEASED";
  if (source.includes("waitlist recovery offer") || source.includes("recovery started") || source.includes("recovery is still searching")) eventType = "WAITLIST_RECOVERY_STARTED";
  if (source.includes("replacement found") || source.includes("waitlist recovered") || source.includes("slot recovered")) eventType = "WAITLIST_RECOVERED";
  if (source.includes("recovery failed") || source.includes("no suitable waitlist")) eventType = "WAITLIST_FAILED";
  if (source.includes("inbound customer reply") || source.includes("customer reply")) eventType = "CUSTOMER_REPLY_RECEIVED";
  if (inboundIntent === "RUNNING_LATE" || source.includes("running late")) eventType = "CUSTOMER_RUNNING_LATE";
  if (source.includes("provider failure") || source.includes("provider timeout") || source.includes("provider offline")) eventType = "PROVIDER_FAILURE";
  if (source.includes("provider degraded")) eventType = "PROVIDER_DEGRADED";
  if (source.includes("collapse risk triggered")) eventType = "COLLAPSE_RISK_TRIGGERED";
  if (source.includes("arrival pressure")) eventType = "ARRIVAL_PRESSURE_HIGH";
  if (source.includes("payment congestion")) eventType = "PAYMENT_CONGESTION";
  if (source.includes("recovery overload")) eventType = "RECOVERY_OVERLOAD";
  if (source.includes("arrival wave")) eventType = "ARRIVAL_WAVE_STARTED";
  if (source.includes("payment bottleneck")) eventType = "PAYMENT_BOTTLENECK_ACTIVE";
  if (source.includes("recovery pacing")) eventType = "RECOVERY_PACING_REDUCED";
  if (source.includes("rush lock")) eventType = "RUSH_LOCK_ENABLED";
  if (source.includes("service stabilizing")) eventType = "SERVICE_STABILIZING";
  if (source.includes("coordination state")) eventType = "COORDINATION_STATE_CHANGED";
  if (source.includes("autonomous throttle")) eventType = "AUTONOMOUS_THROTTLE_STARTED";
  if (source.includes("recovery escalation slowed")) eventType = "RECOVERY_ESCALATION_SLOWED";
  if (source.includes("reminder suppression")) eventType = "REMINDER_SUPPRESSION_ENABLED";
  if (source.includes("rush lock auto")) eventType = "RUSH_LOCK_AUTO_ENABLED";
  if (source.includes("execution stabilized")) eventType = "EXECUTION_STABILIZED";
  if (source.includes("execution cooldown")) eventType = "EXECUTION_COOLDOWN_STARTED";
  if (source.includes("execution state")) eventType = "EXECUTION_STATE_CHANGED";
  if (source.includes("whatsapp message sent")) eventType = "WHATSAPP_MESSAGE_SENT";
  if (source.includes("whatsapp message delivered")) eventType = "WHATSAPP_MESSAGE_DELIVERED";
  if (source.includes("whatsapp message read")) eventType = "WHATSAPP_MESSAGE_READ";
  if (source.includes("whatsapp send failed")) eventType = "WHATSAPP_SEND_FAILED";
  if (source.includes("whatsapp retry")) eventType = "WHATSAPP_RETRY_STARTED";
  if (source.includes("whatsapp suppressed")) eventType = "WHATSAPP_SUPPRESSED";
  if ((source.includes("whatsapp") || source.includes("twilio")) && source.includes("sent")) eventType = "WHATSAPP_MESSAGE_SENT";
  if ((source.includes("whatsapp") || source.includes("twilio")) && source.includes("failed")) eventType = "WHATSAPP_SEND_FAILED";
  if ((source.includes("whatsapp") || source.includes("twilio")) && source.includes("retry")) eventType = "WHATSAPP_RETRY_STARTED";
  if ((source.includes("whatsapp") || source.includes("twilio")) && source.includes("suppressed")) eventType = "WHATSAPP_SUPPRESSED";
  if (source.includes("pressure state changed")) eventType = "PRESSURE_STATE_CHANGED";
  if (source.includes("policy override applied")) eventType = "POLICY_OVERRIDE_APPLIED";
  if (source.includes("recovery throttled")) eventType = "RECOVERY_THROTTLED";
  if (source.includes("reminders suppressed")) eventType = "REMINDERS_SUPPRESSED";
  if (source.includes("payment priority enabled")) eventType = "PAYMENT_PRIORITY_ENABLED";
  if (source.includes("collapse protection enabled")) eventType = "COLLAPSE_PROTECTION_ENABLED";
  if (source.includes("runtime heartbeat")) eventType = "RUNTIME_HEARTBEAT";
  if (source.includes("engine execution started")) eventType = "ENGINE_EXECUTION_STARTED";
  if (source.includes("engine execution completed")) eventType = "ENGINE_EXECUTION_COMPLETED";
  if (source.includes("engine execution delayed")) eventType = "ENGINE_EXECUTION_DELAYED";
  if (source.includes("runtime pressure high")) eventType = "RUNTIME_PRESSURE_HIGH";
  if (source.includes("runtime backoff enabled")) eventType = "RUNTIME_BACKOFF_ENABLED";
  if (source.includes("runtime degraded")) eventType = "RUNTIME_DEGRADED";
  if (source.includes("runtime recovered")) eventType = "RUNTIME_RECOVERED";
  if (source.includes("worker registered")) eventType = "WORKER_REGISTERED";
  if (source.includes("worker heartbeat")) eventType = "WORKER_HEARTBEAT";
  if (source.includes("worker overloaded")) eventType = "WORKER_OVERLOADED";
  if (source.includes("worker failover started")) eventType = "WORKER_FAILOVER_STARTED";
  if (source.includes("execution reassigned")) eventType = "EXECUTION_REASSIGNED";
  if (source.includes("partition rebalanced")) eventType = "PARTITION_REBALANCED";
  if (source.includes("mesh degraded")) eventType = "MESH_DEGRADED";
  if (source.includes("mesh recovered")) eventType = "MESH_RECOVERED";
  if (source.includes("communication sent") || source.includes("message sent")) eventType = "MESSAGE_SENT";
  if (source.includes("communication failed") || source.includes("message failed")) eventType = "MESSAGE_FAILED";
  if (source.includes("auto release") || source.includes("auto-release")) eventType = "AUTO_RELEASE_TRIGGERED";
  if (source.includes("manager override")) eventType = "MANAGER_OVERRIDE";
  if (source.includes("no show") || source.includes("no-show")) eventType = "NO_SHOW_CONFIRMED";
  if (source.includes("created order") || source.includes("booking created")) eventType = "BOOKING_CREATED";

  const summary =
    String(meta.summary ?? meta.title ?? "").trim() ||
    action ||
    "Operational event recorded.";

  return {
    organizationId,
    locationId,
    orderId,
    actorSource: staff ?? "Valsentra",
    actorUserId: typeof meta.actorUserId === "string" ? meta.actorUserId : null,
    eventType,
    summary: staff ? `${summary}` : summary,
    severity: normalizeTimelineSeverity(meta.severity ?? EVENT_SEVERITY[eventType]),
    category: EVENT_CATEGORY[eventType],
    timestamp: createdAt ?? new Date().toISOString(),
    metadata: {
      auditAction: action,
      auditStaff: staff ?? null,
      ...meta,
    },
    traceId:
      typeof meta.traceId === "string"
        ? meta.traceId
        : typeof meta.requestTraceId === "string"
          ? meta.requestTraceId
          : null,
    executionId: typeof meta.executionId === "string" ? meta.executionId : null,
    correlationId:
      typeof meta.eventKey === "string"
        ? meta.eventKey
        : typeof meta.idempotencyKey === "string"
          ? meta.idempotencyKey
          : null,
    idempotencyKey:
      typeof meta.eventKey === "string"
        ? `timeline:${organizationId}:${meta.eventKey}`
        : typeof meta.idempotencyKey === "string"
          ? `timeline:${organizationId}:${meta.idempotencyKey}`
          : null,
  };
}

function normalizeTimelineSeverity(value: unknown): OperationalTimelineSeverity {
  const severity = String(value ?? "").toUpperCase();
  if (severity === "CRITICAL") return "CRITICAL";
  if (severity === "WARNING") return "WARNING";
  if (severity === "WATCH") return "WATCH";
  return "INFO";
}

function mapTimelineRow(row: Record<string, any>): OperationalTimelineMemoryEvent {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    locationId: row.location_id ?? null,
    orderId: row.order_id ?? null,
    actorSource: row.actor_source ?? null,
    actorUserId: row.actor_user_id ?? null,
    eventType: row.event_type as OperationalTimelineEventType,
    summary: String(row.summary ?? "Operational event recorded."),
    severity: normalizeTimelineSeverity(row.severity),
    category: (row.category ?? EVENT_CATEGORY[row.event_type as OperationalTimelineEventType] ?? "BOOKING") as OperationalTimelineCategory,
    timestamp: row.event_timestamp ?? row.created_at ?? new Date().toISOString(),
    metadata: row.metadata ?? {},
    traceId: row.trace_id ?? null,
    executionId: row.execution_id ?? null,
    correlationId: row.correlation_id ?? null,
    idempotencyKey: String(row.idempotency_key),
  };
}

export async function appendOperationalTimelineEvent(input: AppendOperationalTimelineEventInput) {
  try {
    const organizationId = input.organizationId || "org-valsentra";
    const idempotencyKey = buildTimelineIdempotencyKey({ ...input, organizationId });

    const { error } = await supabaseAdmin
      .from("operational_timeline_events")
      .upsert(
        {
          organization_id: organizationId,
          location_id: input.locationId ?? null,
          order_id: input.orderId ?? null,
          actor_source: input.actorSource ?? "Valsentra",
          actor_user_id: input.actorUserId ?? null,
          event_type: input.eventType,
          summary: input.summary,
          severity: input.severity ?? EVENT_SEVERITY[input.eventType] ?? "INFO",
          category: input.category ?? EVENT_CATEGORY[input.eventType],
          event_timestamp: input.timestamp ?? new Date().toISOString(),
          metadata: input.metadata ?? {},
          trace_id: input.traceId ?? null,
          execution_id: input.executionId ?? null,
          correlation_id: input.correlationId ?? null,
          idempotency_key: idempotencyKey,
        },
        {
          onConflict: "organization_id,idempotency_key",
          ignoreDuplicates: true,
        }
      );

    if (error) {
      console.warn("[operational-timeline] append skipped", error.message);
      return { ok: false as const, error: error.message };
    }

    return { ok: true as const, idempotencyKey };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Timeline write failed.";
    console.warn("[operational-timeline] append failed", message);
    return { ok: false as const, error: message };
  }
}

export async function appendOperationalTimelineFromAudit(input: Parameters<typeof timelineEventFromAudit>[0]) {
  return appendOperationalTimelineEvent(timelineEventFromAudit(input));
}

export async function fetchOperationalTimelineEvents({
  organizationId,
  limit = 50,
  cursor,
  orderId,
  category,
}: {
  organizationId: string;
  limit?: number;
  cursor?: string | null;
  orderId?: string | null;
  category?: string | null;
}) {
  try {
    let query = supabaseAdmin
      .from("operational_timeline_events")
      .select("*")
      .eq("organization_id", organizationId)
      .order("event_timestamp", { ascending: false })
      .limit(Math.min(Math.max(limit, 1), 100));

    if (cursor) query = query.lt("event_timestamp", cursor);
    if (orderId) query = query.eq("order_id", orderId);
    if (category) query = query.eq("category", category);

    const { data, error } = await query;

    if (error) {
      return { ok: false as const, events: [], error: error.message };
    }

    return {
      ok: true as const,
      events: (data ?? []).map(mapTimelineRow),
      nextCursor: data?.length ? data[data.length - 1].event_timestamp : null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Timeline fetch failed.";
    return { ok: false as const, events: [], error: message };
  }
}
