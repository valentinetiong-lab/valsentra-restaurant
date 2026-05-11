import { supabaseAdmin } from "@/app/lib/admin";

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
  const { error } = await supabaseAdmin
    .from("audit_logs")
    .insert(buildOperationalEvent(input));

  if (error) {
    return { ok: false as const, error: error.message };
  }

  return { ok: true as const };
}
