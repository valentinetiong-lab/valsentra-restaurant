import { supabaseAdmin } from "@/app/lib/admin";
import { checkIdempotencyKey } from "@/app/lib/infrastructure/idempotencyLayer";
import { appendOperationalTimelineFromAudit } from "@/app/lib/operationalTimelineMemoryEngine";

export type OperationalEventCategory =
  | "PAYMENT"
  | "GHOST_PING"
  | "RECOVERY"
  | "COLLAPSE"
  | "FRAUD"
  | "WAITLIST"
  | "AUTONOMOUS_ACTION"
  | "LEARNING";

export type OperationalEventSeverity = "INFO" | "WATCH" | "WARNING" | "CRITICAL";

export type OperationalEventInput = {
  // Stable dedupe key. Recurring monitoring events should include an explicit time bucket;
  // irreversible outcomes should use a stable order/action key so the loop cannot replay them.
  eventKey: string;
  category: OperationalEventCategory;
  severity: OperationalEventSeverity;
  action: string;
  staff?: string;
  orderId: string;
  organizationId?: string;
  locationId?: string;
  locationName?: string;
  title: string;
  summary: string;
  reasoning?: string[];
  recommendedAction?: string;
  confidence?: number;
  meta?: Record<string, unknown>;
};

export function buildOperationalEvent(input: OperationalEventInput) {
  return {
    action: input.action,
    staff: input.staff ?? "Valsentra Continuous Engine",
    order_id: input.orderId,
    organization_id: input.organizationId ?? input.meta?.organizationId ?? "org-valsentra",
    location_id: input.locationId ?? input.meta?.locationId ?? null,
    meta: {
      eventKey: input.eventKey,
      operationalEvent: true,
      organizationId: input.organizationId,
      locationId: input.locationId,
      locationName: input.locationName,
      category: input.category,
      severity: input.severity,
      title: input.title,
      summary: input.summary,
      reasoning: input.reasoning ?? [],
      recommendedAction: input.recommendedAction ?? "Continue monitoring.",
      confidence: input.confidence ?? 70,
      ...input.meta,
    },
  };
}

export function getEventKeySet(rows: Array<Record<string, any>>) {
  return new Set(
    rows
      .map((row) => row.meta?.eventKey)
      .filter((eventKey): eventKey is string => typeof eventKey === "string")
  );
}

export async function persistOperationalEvent(input: OperationalEventInput) {
  const duplicate = await checkIdempotencyKey({
    key: input.eventKey,
    scope: "AUDIT_EVENT",
    organizationId: input.organizationId ?? String(input.meta?.organizationId ?? "org-valsentra"),
    locationId: input.locationId ?? (input.meta?.locationId as string | null | undefined) ?? null,
    orderId: input.orderId,
    metadata: {
      action: input.action,
      category: input.category,
    },
  });

  if (duplicate.duplicate) {
    return { ok: true as const, duplicate: true as const };
  }

  const { error } = await supabaseAdmin
    .from("audit_logs")
    .insert(buildOperationalEvent(input));

  if (error) {
    return { ok: false as const, error: error.message };
  }

  await appendOperationalTimelineFromAudit({
    action: input.action,
    staff: input.staff ?? "Valsentra Continuous Engine",
    orderId: input.orderId,
    organizationId: input.organizationId ?? String(input.meta?.organizationId ?? "org-valsentra"),
    locationId: input.locationId ?? (input.meta?.locationId as string | null | undefined) ?? null,
    meta: {
      eventKey: input.eventKey,
      operationalEvent: true,
      category: input.category,
      severity: input.severity,
      title: input.title,
      summary: input.summary,
      reasoning: input.reasoning ?? [],
      recommendedAction: input.recommendedAction ?? "Continue monitoring.",
      confidence: input.confidence ?? 70,
      ...input.meta,
    },
  });

  return { ok: true as const };
}
