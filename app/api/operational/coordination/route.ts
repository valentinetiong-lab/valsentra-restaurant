import { NextResponse } from "next/server";
import { buildLiveServiceCoordinationSnapshot } from "@/app/lib/liveServiceCoordinationEngine";
import {
  enforceRateLimit,
  requireRouteRole,
} from "@/app/lib/security/routeProtection";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const access = await requireRouteRole({
    request,
    route: "/api/operational/coordination",
    allowedRoles: ["staff", "manager", "owner", "admin", "internal"],
  });
  if (!access.ok) return access.response;

  const rateLimit = await enforceRateLimit({
    request,
    route: "/api/operational/coordination",
    scope: "operational-coordination-get",
    maxRequests: 90,
    windowMs: 60_000,
  });
  if (!rateLimit.ok) return rateLimit.response;

  try {
    const url = new URL(request.url);
    const locationId = url.searchParams.get("locationId") ?? access.actor.locationId ?? null;
    const previousState = url.searchParams.get("previousState") as any;
    const coordination = await buildLiveServiceCoordinationSnapshot({
      organizationId: access.actor.organizationId,
      locationId,
      previousState: previousState || null,
    });

    return NextResponse.json({
      ok: true,
      traceId: access.traceId,
      coordination,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Live service coordination check failed.",
        traceId: access.traceId,
      },
      { status: 500 }
    );
  }
}
