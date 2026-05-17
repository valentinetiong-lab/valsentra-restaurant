import { NextResponse } from "next/server";
import { resolveOperationalPolicyState } from "@/app/lib/operationalPolicyOrchestrator";
import {
  enforceRateLimit,
  requireRouteRole,
} from "@/app/lib/security/routeProtection";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const access = await requireRouteRole({
    request,
    route: "/api/operational/command-center",
    allowedRoles: ["staff", "manager", "owner", "admin", "internal"],
  });
  if (!access.ok) return access.response;

  const rateLimit = await enforceRateLimit({
    request,
    route: "/api/operational/command-center",
    scope: "operational-command-center-get",
    maxRequests: 90,
    windowMs: 60_000,
  });
  if (!rateLimit.ok) return rateLimit.response;

  try {
    const url = new URL(request.url);
    const locationId = url.searchParams.get("locationId") ?? access.actor.locationId ?? null;
    const commandCenter = await resolveOperationalPolicyState({
      organizationId: access.actor.organizationId,
      locationId,
    });

    return NextResponse.json({
      ok: true,
      traceId: access.traceId,
      commandCenter,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Operational command center failed safely.",
        traceId: access.traceId,
      },
      { status: 500 }
    );
  }
}
