import { NextResponse } from "next/server";
import { buildOperationalCapacitySnapshot } from "@/app/lib/operationalCapacityEngine";
import {
  enforceRateLimit,
  requireRouteRole,
} from "@/app/lib/security/routeProtection";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const access = await requireRouteRole({
    request,
    route: "/api/operational/capacity",
    allowedRoles: ["staff", "manager", "owner", "admin", "internal"],
  });
  if (!access.ok) return access.response;

  const rateLimit = await enforceRateLimit({
    request,
    route: "/api/operational/capacity",
    scope: "operational-capacity-get",
    maxRequests: 90,
    windowMs: 60_000,
  });
  if (!rateLimit.ok) return rateLimit.response;

  try {
    const url = new URL(request.url);
    const locationId = url.searchParams.get("locationId") ?? access.actor.locationId ?? null;
    const snapshot = await buildOperationalCapacitySnapshot({
      organizationId: access.actor.organizationId,
      locationId,
    });

    return NextResponse.json({
      ok: true,
      traceId: access.traceId,
      capacity: snapshot,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Operational capacity check failed.",
        traceId: access.traceId,
      },
      { status: 500 }
    );
  }
}
