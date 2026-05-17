import { NextResponse } from "next/server";
import {
  getPersistentOperationalRuntimeSnapshot,
  runPersistentOperationalRuntimeTick,
} from "@/app/lib/persistentOperationalRuntime";
import {
  enforceRateLimit,
  requireRouteRole,
} from "@/app/lib/security/routeProtection";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const access = await requireRouteRole({
    request,
    route: "/api/operational/runtime",
    allowedRoles: ["staff", "manager", "owner", "admin", "internal"],
  });
  if (!access.ok) return access.response;

  const rateLimit = await enforceRateLimit({
    request,
    route: "/api/operational/runtime",
    scope: "operational-runtime-get",
    maxRequests: 90,
    windowMs: 60_000,
  });
  if (!rateLimit.ok) return rateLimit.response;

  try {
    const url = new URL(request.url);
    const locationId = url.searchParams.get("locationId") ?? access.actor.locationId ?? null;
    const runtime = await getPersistentOperationalRuntimeSnapshot({
      organizationId: access.actor.organizationId,
      locationId,
    });

    return NextResponse.json({
      ok: true,
      traceId: access.traceId,
      runtime,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Operational runtime failed safely.",
        traceId: access.traceId,
      },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  const access = await requireRouteRole({
    request,
    route: "/api/operational/runtime",
    allowedRoles: ["owner", "manager", "admin", "internal"],
  });
  if (!access.ok) return access.response;

  const rateLimit = await enforceRateLimit({
    request,
    route: "/api/operational/runtime",
    scope: "operational-runtime-post",
    maxRequests: 20,
    windowMs: 60_000,
  });
  if (!rateLimit.ok) return rateLimit.response;

  try {
    const body = await request.json().catch(() => ({}));
    const locationId =
      typeof body.locationId === "string" ? body.locationId : access.actor.locationId ?? null;
    const tick = await runPersistentOperationalRuntimeTick({
      organizationId: access.actor.organizationId,
      locationId,
      runWorkerBatch: Boolean(body.runWorkerBatch),
    });

    return NextResponse.json({
      ok: true,
      traceId: access.traceId,
      tick,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Operational runtime tick failed safely.",
        traceId: access.traceId,
      },
      { status: 500 }
    );
  }
}
