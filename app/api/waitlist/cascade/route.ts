import { NextResponse } from "next/server";
import {
  enqueueOperationalJob,
  executeOperationalJob,
} from "@/app/lib/infrastructure/operationalJobEngine";
import {
  enforceRateLimit,
  requireRouteRole,
} from "@/app/lib/security/routeProtection";

export async function POST(req: Request) {
  const access = await requireRouteRole({
    request: req,
    route: "/api/waitlist/cascade",
    allowedRoles: ["staff", "manager", "owner", "admin", "internal"],
  });
  if (!access.ok) return access.response;

  const rateLimit = await enforceRateLimit({
    request: req,
    route: "/api/waitlist/cascade",
    scope: "waitlist-cascade",
    maxRequests: 20,
    windowMs: 60_000,
  });
  if (!rateLimit.ok) return rateLimit.response;

  try {
    const { orderId, staffName } = await req.json();

    const queued = await enqueueOperationalJob({
      organizationId: access.actor.organizationId,
      locationId: access.actor.locationId,
      jobType: "waitlist_cascade",
      priority: "high",
      idempotencyKey: `waitlist-cascade:${access.actor.organizationId}:${orderId}`,
      payload: {
        orderId,
        staffName: staffName ?? "Staff",
      },
      traceId: access.traceId,
      actor: {
        userId: access.actor.userId,
        role: access.actor.role,
        source: access.actor.source,
      },
    });
    const result = await executeOperationalJob(queued.job.id);

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error ?? "Waitlist cascade job failed", jobId: queued.job.id },
        { status: 400 }
      );
    }

    return NextResponse.json({
      message: "Waitlist cascade success",
      result,
      jobId: queued.job.id,
      duplicateJob: queued.duplicate,
      traceId: access.traceId,
      executionSource: "protected-waitlist-cascade-route",
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Cascade failed" },
      { status: 500 }
    );
  }
}
