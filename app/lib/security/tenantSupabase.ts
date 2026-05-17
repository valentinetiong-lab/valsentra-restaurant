import type { RequestActor } from "@/app/lib/security/auth";

export function scopeSelectToActor<T extends { eq: (column: string, value: string) => T }>(
  query: T,
  actor: RequestActor,
  column = "organization_id"
) {
  return query.eq(column, actor.organizationId);
}

export function scopeMutationToActor<T extends { eq: (column: string, value: string) => T }>(
  query: T,
  actor: RequestActor,
  column = "organization_id"
) {
  return query.eq(column, actor.organizationId);
}

export function attachTenantToPayload<T extends Record<string, unknown>>(
  payload: T,
  actor: RequestActor
) {
  return {
    ...payload,
    organization_id: payload.organization_id ?? actor.organizationId,
    location_id: payload.location_id ?? actor.locationId ?? undefined,
  };
}

export function actorAuditMeta(actor: RequestActor, traceId: string) {
  return {
    organizationId: actor.organizationId,
    locationId: actor.locationId,
    actorUserId: actor.userId,
    actorStaffId: actor.staffId,
    actorRole: actor.role,
    requestTraceId: traceId,
  };
}
