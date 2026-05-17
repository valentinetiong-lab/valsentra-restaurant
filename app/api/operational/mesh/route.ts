import { NextResponse } from "next/server";
import {
  buildDistributedWorkerMeshSnapshot,
  registerMeshWorker,
} from "@/app/lib/distributedOperationalWorkerMesh";
import { getPersistentOperationalRuntimeSnapshot } from "@/app/lib/persistentOperationalRuntime";
import {
  enforceRateLimit,
  requireRouteRole,
} from "@/app/lib/security/routeProtection";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const access = await requireRouteRole({
    request,
    route: "/api/operational/mesh",
    allowedRoles: ["staff", "manager", "owner", "admin", "internal"],
  });
  if (!access.ok) return access.response;

  const rateLimit = await enforceRateLimit({
    request,
    route: "/api/operational/mesh",
    scope: "operational-mesh-get",
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
    const mesh = await buildDistributedWorkerMeshSnapshot({
      organizationId: access.actor.organizationId,
      locationId,
      runtime,
    });

    return NextResponse.json({
      ok: true,
      traceId: access.traceId,
      mesh,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Operational worker mesh failed safely.",
        traceId: access.traceId,
      },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  const access = await requireRouteRole({
    request,
    route: "/api/operational/mesh",
    allowedRoles: ["owner", "manager", "admin", "internal"],
  });
  if (!access.ok) return access.response;

  const rateLimit = await enforceRateLimit({
    request,
    route: "/api/operational/mesh",
    scope: "operational-mesh-post",
    maxRequests: 30,
    windowMs: 60_000,
  });
  if (!rateLimit.ok) return rateLimit.response;

  try {
    const body = await request.json().catch(() => ({}));
    const locationId =
      typeof body.locationId === "string" ? body.locationId : access.actor.locationId ?? null;
    const worker = await registerMeshWorker({
      organizationId: access.actor.organizationId,
      locationId,
      workerId: typeof body.workerId === "string" ? body.workerId : null,
    });

    return NextResponse.json({
      ok: true,
      traceId: access.traceId,
      worker,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Operational worker registration failed safely.",
        traceId: access.traceId,
      },
      { status: 500 }
    );
  }
}
