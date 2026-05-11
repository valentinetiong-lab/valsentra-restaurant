export type AuditEventInput = {
  action: string;
  staff: string;
  orderId: string;
  meta?: Record<string, unknown>;
};

export function buildAuditEvent(input: AuditEventInput) {
  return {
    action: input.action,
    staff: input.staff,
    order_id: input.orderId,
    meta: input.meta,
  };
}

export function getTimelineEventLabel(action: string) {
  const lower = action.toLowerCase();

  if (lower.includes("waitlist") || lower.includes("recovered")) return "Waitlist recovery";
  if (lower.includes("release")) return "Slot release";
  if (lower.includes("reminder")) return "Payment reminder";
  if (lower.includes("verified")) return "Payment verified";
  if (lower.includes("created")) return "Order created";

  return "Audit event";
}
