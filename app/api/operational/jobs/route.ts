import { NextResponse } from "next/server";
import {
  getOperationalJobSnapshot,
} from "@/app/lib/infrastructure/operationalJobEngine";
import { runOperationalWorkerCycle } from "@/app/lib/infrastructure/operationalWorkerRuntime";
import {
  enforceRateLimit,
  requireRouteRole,
} from "@/app/lib/security/routeProtection";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const access = await requireRouteRole({
    request,
    route: "/api/operational/jobs",
    allowedRoles: ["owner", "manager", "admin", "internal"],
  });
  if (!access.ok) return access.response;

  const snapshot = await getOperationalJobSnapshot(access.actor.organizationId);
  return NextResponse.json(snapshot);
}

export async function POST(request: Request) {
  const access = await requireRouteRole({
    request,
    route: "/api/operational/jobs",
    allowedRoles: ["internal"],
  });
  if (!access.ok) return access.response;

  const rateLimit = await enforceRateLimit({
    request,
    route: "/api/operational/jobs",
    scope: "operational-jobs-run",
    maxRequests: 20,
    windowMs: 60_000,
  });
  if (!rateLimit.ok) return rateLimit.response;

  const body = await request.json().catch(() => ({}));
  const cycle = await runOperationalWorkerCycle({
    organizationId: access.actor.organizationId,
    batchSize: Number(body.limit ?? 5),
  });

  return NextResponse.json({
    ...cycle,
    traceId: access.traceId,
  });
}
