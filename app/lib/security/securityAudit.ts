import { supabaseAdmin } from "@/app/lib/admin";
import type { RequestActor } from "@/app/lib/security/auth";

export type SecurityAuditAction =
  | "blocked_route_access"
  | "production_guard_violation"
  | "unsafe_execution_attempt"
  | "missing_env_var"
  | "unauthorized_route_access";

export type SecurityAuditInput = {
  action: SecurityAuditAction;
  route: string;
  reason: string;
  traceId?: string;
  source?: string;
  severity?: "INFO" | "WATCH" | "WARNING" | "CRITICAL";
  actor?: RequestActor | null;
  metadata?: Record<string, unknown>;
};

function safeMeta(input: SecurityAuditInput) {
  return {
    operationalEvent: true,
    category: "AUTONOMOUS_ACTION",
    severity: input.severity ?? "WARNING",
    title: "Security guard event",
    summary: input.reason,
    securityEvent: true,
    securityAction: input.action,
    route: input.route,
    traceId: input.traceId ?? null,
    source: input.source ?? "unknown",
    organizationId: input.actor?.organizationId ?? input.metadata?.organizationId ?? null,
    actorUserId: input.actor?.userId ?? input.metadata?.actorUserId ?? null,
    actorRole: input.actor?.role ?? input.metadata?.actorRole ?? null,
    locationId: input.actor?.locationId ?? input.metadata?.locationId ?? null,
    requestTraceId: input.traceId ?? null,
    ...input.metadata,
  };
}

export async function writeSecurityAudit(input: SecurityAuditInput) {
  try {
    await supabaseAdmin.from("audit_logs").insert({
      action: input.action,
      staff: "Valsentra Security Guard",
      order_id: "SECURITY",
      organization_id: input.actor?.organizationId ?? input.metadata?.organizationId ?? "org-valsentra",
      location_id: input.actor?.locationId ?? input.metadata?.locationId ?? null,
      meta: safeMeta(input),
    });
  } catch (error) {
    console.warn("Security audit write failed", {
      route: input.route,
      action: input.action,
      traceId: input.traceId,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
