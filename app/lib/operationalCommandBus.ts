import { supabaseAdmin } from "@/app/lib/admin";
import { checkIdempotencyKey } from "@/app/lib/infrastructure/idempotencyLayer";
import {
  appendOperationalTimelineEvent,
  type OperationalTimelineEventType,
  type OperationalTimelineSeverity,
} from "@/app/lib/operationalTimelineMemoryEngine";

export type OperationalCommandBusEventType =
  | "PRESSURE_STATE_CHANGED"
  | "POLICY_OVERRIDE_APPLIED"
  | "RECOVERY_THROTTLED"
  | "REMINDERS_SUPPRESSED"
  | "PAYMENT_PRIORITY_ENABLED"
  | "PROVIDER_DEGRADED"
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

export type OperationalCommandBusEvent = {
  id: string;
  eventType: OperationalCommandBusEventType;
  organizationId: string;
  locationId: string | null;
  source: string;
  summary: string;
  severity: OperationalTimelineSeverity;
  correlationId: string;
  executionId: string | null;
  timestamp: string;
  payload: Record<string, unknown>;
};

export type PublishOperationalCommandInput = {
  eventType: OperationalCommandBusEventType;
  organizationId: string;
  locationId?: string | null;
  source: string;
  summary: string;
  severity?: OperationalTimelineSeverity;
  correlationId?: string | null;
  executionId?: string | null;
  payload?: Record<string, unknown>;
  idempotencyKey?: string | null;
};

function commandEventKey(input: PublishOperationalCommandInput) {
  const bucket = new Date().toISOString().slice(0, 13);
  return input.idempotencyKey ??
    [
      "command-bus",
      input.organizationId,
      input.locationId ?? "org",
      input.eventType,
      input.correlationId ?? bucket,
    ]
      .map((part) => String(part).replace(/\s+/g, "_").toLowerCase())
      .join(":");
}

function timelineEventType(eventType: OperationalCommandBusEventType): OperationalTimelineEventType {
  if (eventType === "PROVIDER_DEGRADED") return "PROVIDER_DEGRADED";
  return eventType;
}

function mapAudit(row: Record<string, any>): OperationalCommandBusEvent {
  const meta = row.meta ?? {};
  return {
    id: String(row.id),
    eventType: meta.commandBusEventType,
    organizationId: row.organization_id ?? meta.organizationId ?? "org-valsentra",
    locationId: row.location_id ?? meta.locationId ?? null,
    source: row.staff ?? meta.source ?? "Valsentra",
    summary: meta.summary ?? row.action ?? "Operational command event.",
    severity: meta.severity ?? "INFO",
    correlationId: meta.correlationId ?? meta.idempotencyKey ?? String(row.id),
    executionId: meta.executionId ?? null,
    timestamp: row.created_at ?? new Date().toISOString(),
    payload: meta.payload ?? {},
  };
}

export async function publishOperationalCommand(input: PublishOperationalCommandInput) {
  const idempotencyKey = commandEventKey(input);
  const duplicate = await checkIdempotencyKey({
    key: idempotencyKey,
    scope: "AUDIT_EVENT",
    organizationId: input.organizationId,
    locationId: input.locationId ?? null,
    orderId: "OPERATION",
    metadata: {
      commandBusEventType: input.eventType,
      source: input.source,
      correlationId: input.correlationId ?? null,
    },
  });

  if (duplicate.duplicate) {
    return { ok: true as const, duplicate: true as const, reason: duplicate.reason };
  }

  const timestamp = new Date().toISOString();
  const meta = {
    operationalEvent: "OPERATIONAL_COMMAND_BUS",
    commandBusEvent: true,
    commandBusEventType: input.eventType,
    organizationId: input.organizationId,
    locationId: input.locationId ?? null,
    source: input.source,
    summary: input.summary,
    severity: input.severity ?? "INFO",
    correlationId: input.correlationId ?? idempotencyKey,
    executionId: input.executionId ?? null,
    idempotencyKey,
    timestamp,
    payload: input.payload ?? {},
  };

  const { error } = await supabaseAdmin.from("audit_logs").insert({
    action: `Operational command: ${input.eventType.replaceAll("_", " ").toLowerCase()}`,
    staff: input.source,
    order_id: "OPERATION",
    organization_id: input.organizationId,
    location_id: input.locationId ?? null,
    meta,
  });

  if (error) return { ok: false as const, error: error.message };

  await appendOperationalTimelineEvent({
    organizationId: input.organizationId,
    locationId: input.locationId ?? null,
    orderId: "OPERATION",
    actorSource: input.source,
    eventType: timelineEventType(input.eventType),
    summary: input.summary,
    severity: input.severity ?? "INFO",
    category:
      input.eventType === "PAYMENT_PRIORITY_ENABLED"
        ? "PAYMENT"
        : input.eventType === "REMINDERS_SUPPRESSED"
          ? "COMMUNICATION"
          : input.eventType === "RECOVERY_THROTTLED"
            ? "RECOVERY"
            : "WORKER",
    correlationId: input.correlationId ?? idempotencyKey,
    executionId: input.executionId ?? null,
    idempotencyKey: `timeline:${idempotencyKey}`,
    metadata: meta,
  });

  return { ok: true as const, duplicate: false as const, idempotencyKey };
}

export async function subscribeOperationalCommands({
  eventType,
  organizationId,
  locationId = null,
  limit = 50,
}: {
  eventType?: OperationalCommandBusEventType | "ALL";
  organizationId: string;
  locationId?: string | null;
  limit?: number;
}) {
  let query = supabaseAdmin
    .from("audit_logs")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("meta->>operationalEvent", "OPERATIONAL_COMMAND_BUS")
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 100));

  if (locationId) query = query.or(`location_id.is.null,location_id.eq.${locationId}`);
  if (eventType && eventType !== "ALL") query = query.eq("meta->>commandBusEventType", eventType);

  const { data, error } = await query;
  if (error) return { ok: false as const, events: [], error: error.message };

  return { ok: true as const, events: (data ?? []).map(mapAudit) };
}
