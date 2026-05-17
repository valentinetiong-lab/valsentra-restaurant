import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "../../lib/admin";
import {
  enforceRateLimit,
  requireRouteRole,
} from "@/app/lib/security/routeProtection";
import { actorAuditMeta } from "@/app/lib/security/tenantSupabase";
import { appendOperationalTimelineFromAudit } from "@/app/lib/operationalTimelineMemoryEngine";

function mapAuditFromDb(row: Record<string, any>) {
  return {
    id: row.id,
    action: row.action,
    staff: row.staff,
    orderId: row.order_id,
    meta: row.meta ?? {},
    createdAt: row.created_at,
  };
}

export async function GET(request: Request) {
  const access = await requireRouteRole({
    request,
    route: "/api/audit",
    allowedRoles: ["staff", "manager", "owner", "admin", "internal"],
  });
  if (!access.ok) return access.response;

  try {
    const { data, error } = await supabaseAdmin
      .from("audit_logs")
      .select("*")
      .eq("meta->>organizationId", access.actor.organizationId)
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json((data ?? []).map(mapAuditFromDb));
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Failed to fetch audit logs" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const access = await requireRouteRole({
    request,
    route: "/api/audit",
    allowedRoles: ["staff", "manager", "owner", "admin", "internal"],
  });
  if (!access.ok) return access.response;

  const rateLimit = await enforceRateLimit({
    request,
    route: "/api/audit",
    scope: "audit-post",
    maxRequests: 120,
    windowMs: 60_000,
  });
  if (!rateLimit.ok) return rateLimit.response;

  try {
    const body = await request.json();

    const payload = {
      action: body.action,
      staff: body.staff,
      order_id: body.orderId,
      organization_id: access.actor.organizationId,
      location_id: access.actor.locationId,
      meta: {
        ...(body.meta ?? {}),
        ...actorAuditMeta(access.actor, access.traceId),
      },
    };

    const { data, error } = await supabaseAdmin
      .from("audit_logs")
      .insert(payload)
      .select("*")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    await appendOperationalTimelineFromAudit({
      action: payload.action,
      staff: payload.staff,
      orderId: payload.order_id,
      organizationId: payload.organization_id,
      locationId: payload.location_id,
      meta: payload.meta,
      createdAt: data.created_at,
    });

    return NextResponse.json(mapAuditFromDb(data));
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Failed to create audit log" },
      { status: 500 }
    );
  }
}
