import { NextResponse } from "next/server";
import {
  getContinuousOperationalLoopState,
  startContinuousOperationalLoop,
  stopContinuousOperationalLoop,
} from "@/app/lib/continuousOperationalScheduler";
import {
  enqueueOperationalJob,
  executeOperationalJob,
  runDueOperationalJobs,
} from "@/app/lib/infrastructure/operationalJobEngine";
import {
  enforceRateLimit,
  requireRouteRole,
} from "@/app/lib/security/routeProtection";

export const dynamic = "force-dynamic";

export async function GET() {
  const state = getContinuousOperationalLoopState();

  return NextResponse.json({
    running: state.running,
    lastRunAt: state.lastRunAt ?? null,
    lastResult: state.lastResult ?? null,
    lastError: state.lastError ?? null,
  });
}

export async function POST(req: Request) {
  const access = await requireRouteRole({
    request: req,
    route: "/api/operational/continuous",
    allowedRoles: ["internal"],
  });
  if (!access.ok) return access.response;

  const rateLimit = await enforceRateLimit({
    request: req,
    route: "/api/operational/continuous",
    scope: "operational-continuous",
    maxRequests: 10,
    windowMs: 60_000,
  });
  if (!rateLimit.ok) return rateLimit.response;

  const body = await req.json().catch(() => ({}));
  const action = body.action ?? "run";

  if (action === "start") {
    const state = startContinuousOperationalLoop({
      organizationId: access.actor.organizationId,
    });
    return NextResponse.json({
      running: state.running,
      lastRunAt: state.lastRunAt ?? null,
      lastResult: state.lastResult ?? null,
      lastError: state.lastError ?? null,
      traceId: access.traceId,
      executionSource: "protected-operational-continuous-route",
    });
  }

  if (action === "drain") {
    const results = await runDueOperationalJobs(access.actor.organizationId, Number(body.limit ?? 5));
    return NextResponse.json({
      running: getContinuousOperationalLoopState().running,
      results,
      traceId: access.traceId,
      executionSource: "protected-operational-continuous-route",
    });
  }

  if (action === "stop") {
    const state = stopContinuousOperationalLoop();
    return NextResponse.json({
      running: state.running,
      lastRunAt: state.lastRunAt ?? null,
      lastResult: state.lastResult ?? null,
      lastError: state.lastError ?? null,
      traceId: access.traceId,
      executionSource: "protected-operational-continuous-route",
    });
  }

  const queued = await enqueueOperationalJob({
    organizationId: access.actor.organizationId,
    locationId: access.actor.locationId,
    jobType: "continuous_operational_pass",
    priority: "high",
    idempotencyKey: `continuous:${access.actor.organizationId}:${new Date().toISOString().slice(0, 16)}`,
    payload: {
      action: "run",
    },
    traceId: access.traceId,
    actor: {
      userId: access.actor.userId,
      role: access.actor.role,
      source: access.actor.source,
    },
  });
  const result = await executeOperationalJob(queued.job.id);

  return NextResponse.json({
    running: getContinuousOperationalLoopState().running,
    result,
    jobId: queued.job.id,
    duplicateJob: queued.duplicate,
    traceId: access.traceId,
    executionSource: "protected-operational-continuous-route",
  });
}
