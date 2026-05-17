import { NextResponse } from "next/server";
import { runAutonomousOperationalExecution } from "@/app/lib/autonomousOperationalExecutionEngine";
import {
  enforceRateLimit,
  requireRouteRole,
} from "@/app/lib/security/routeProtection";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const access = await requireRouteRole({
    request,
    route: "/api/operational/execution",
    allowedRoles: ["staff", "manager", "owner", "admin", "internal"],
  });
  if (!access.ok) return access.response;

  const rateLimit = await enforceRateLimit({
    request,
    route: "/api/operational/execution",
    scope: "operational-execution-get",
    maxRequests: 60,
    windowMs: 60_000,
  });
  if (!rateLimit.ok) return rateLimit.response;

  try {
    const url = new URL(request.url);
    const locationId = url.searchParams.get("locationId") ?? access.actor.locationId ?? null;
    const execution = await runAutonomousOperationalExecution({
      organizationId: access.actor.organizationId,
      locationId,
    });

    return NextResponse.json({
      ok: true,
      traceId: access.traceId,
      execution,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Autonomous operational execution failed safely.",
        traceId: access.traceId,
      },
      { status: 500 }
    );
  }
}
