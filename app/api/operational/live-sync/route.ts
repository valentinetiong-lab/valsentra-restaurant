import { NextResponse } from "next/server";
import { buildLiveOperationalSyncSnapshot } from "@/app/lib/liveOperationalSyncEngine";
import {
  enforceRateLimit,
  requireRouteRole,
} from "@/app/lib/security/routeProtection";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const access = await requireRouteRole({
    request,
    route: "/api/operational/live-sync",
    allowedRoles: ["staff", "manager", "owner", "admin", "internal"],
  });
  if (!access.ok) return access.response;

  const rateLimit = await enforceRateLimit({
    request,
    route: "/api/operational/live-sync",
    scope: "operational-live-sync-get",
    maxRequests: 120,
    windowMs: 60_000,
  });
  if (!rateLimit.ok) return rateLimit.response;

  try {
    const url = new URL(request.url);
    const locationId = url.searchParams.get("locationId") ?? access.actor.locationId ?? null;
    const sync = await buildLiveOperationalSyncSnapshot({
      organizationId: access.actor.organizationId,
      locationId,
    });

    return NextResponse.json({
      ok: true,
      traceId: access.traceId,
      sync,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Live operational sync failed safely.",
        traceId: access.traceId,
      },
      { status: 500 }
    );
  }
}
