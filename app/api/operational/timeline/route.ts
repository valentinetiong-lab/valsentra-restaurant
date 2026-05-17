import { NextResponse } from "next/server";
import { fetchOperationalTimelineEvents } from "@/app/lib/operationalTimelineMemoryEngine";
import {
  enforceRateLimit,
  requireRouteRole,
} from "@/app/lib/security/routeProtection";

function parseLimit(value: string | null) {
  const parsed = Number(value ?? 50);
  if (!Number.isFinite(parsed)) return 50;
  return Math.min(Math.max(Math.round(parsed), 1), 100);
}

export async function GET(request: Request) {
  const access = await requireRouteRole({
    request,
    route: "/api/operational/timeline",
    allowedRoles: ["staff", "manager", "owner", "admin", "internal"],
  });
  if (!access.ok) return access.response;

  const rateLimit = await enforceRateLimit({
    request,
    route: "/api/operational/timeline",
    scope: "operational-timeline-get",
    maxRequests: 120,
    windowMs: 60_000,
  });
  if (!rateLimit.ok) return rateLimit.response;

  const url = new URL(request.url);
  const limit = parseLimit(url.searchParams.get("limit"));
  const cursor = url.searchParams.get("cursor");
  const orderId = url.searchParams.get("orderId");
  const category = url.searchParams.get("category");

  const result = await fetchOperationalTimelineEvents({
    organizationId: access.actor.organizationId,
    limit,
    cursor,
    orderId,
    category,
  });

  if (!result.ok) {
    return NextResponse.json(
      {
        ok: false,
        events: [],
        error: result.error,
        traceId: access.traceId,
      },
      { status: 200 }
    );
  }

  return NextResponse.json({
    ok: true,
    events: result.events,
    nextCursor: result.nextCursor,
    traceId: access.traceId,
  });
}
