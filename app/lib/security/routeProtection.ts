import { NextResponse } from "next/server";
import { roleAllowed, resolveRequestActor, type AuthRole } from "@/app/lib/security/auth";
import { isProduction, type GuardResult } from "@/app/lib/security/environment";
import { writeSecurityAudit } from "@/app/lib/security/securityAudit";

export type RouteRole = AuthRole;

type RateLimitState = {
  count: number;
  windowStartedAt: number;
};

const rateLimitState = new Map<string, RateLimitState>();

export function createTraceId(request?: Request) {
  return (
    request?.headers.get("x-request-id") ??
    request?.headers.get("x-valsentra-trace-id") ??
    `trace_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
  );
}

export function getExecutionSource(request?: Request) {
  return (
    request?.headers.get("x-valsentra-source") ??
    request?.headers.get("user-agent") ??
    "unknown"
  );
}

export function getClientKey(request: Request, scope: string) {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return `${scope}:${forwardedFor || "local"}`;
}

export function checkRateLimit({
  key,
  maxRequests,
  windowMs,
}: {
  key: string;
  maxRequests: number;
  windowMs: number;
}) {
  const now = Date.now();
  const current = rateLimitState.get(key);

  if (!current || now - current.windowStartedAt > windowMs) {
    rateLimitState.set(key, { count: 1, windowStartedAt: now });
    return { ok: true, remaining: maxRequests - 1 };
  }

  if (current.count >= maxRequests) {
    return {
      ok: false,
      remaining: 0,
      retryAfterSeconds: Math.ceil((windowMs - (now - current.windowStartedAt)) / 1000),
    };
  }

  current.count += 1;
  return { ok: true, remaining: maxRequests - current.count };
}

export function buildGuardErrorResponse({
  guard,
  traceId,
}: {
  guard: Exclude<GuardResult, { ok: true }>;
  traceId: string;
}) {
  return NextResponse.json(
    {
      ok: false,
      error: guard.message,
      code: guard.code,
      traceId,
    },
    { status: guard.status }
  );
}

export async function blockWithSecurityAudit({
  guard,
  request,
  route,
  action = "production_guard_violation",
}: {
  guard: Exclude<GuardResult, { ok: true }>;
  request?: Request;
  route: string;
  action?: "blocked_route_access" | "production_guard_violation" | "unsafe_execution_attempt" | "unauthorized_route_access";
}) {
  const traceId = createTraceId(request);

  await writeSecurityAudit({
    action,
    route,
    reason: guard.message,
    traceId,
    source: getExecutionSource(request),
    severity: guard.status >= 500 ? "CRITICAL" : "WARNING",
    metadata: {
      code: guard.code,
      production: isProduction,
    },
  });

  return buildGuardErrorResponse({ guard, traceId });
}

export async function requireRouteRole({
  request,
  route,
  allowedRoles,
}: {
  request: Request;
  route: string;
  allowedRoles: RouteRole[];
}) {
  const traceId = createTraceId(request);
  const actor = await resolveRequestActor(request);

  if (actor && (actor.source === "development" || roleAllowed(actor.role, allowedRoles))) {
    return { ok: true as const, traceId, actor };
  }

  await writeSecurityAudit({
    action: "unauthorized_route_access",
    route,
    reason: actor
      ? `Actor role ${actor.role} is not authorized for this route.`
      : "Request did not include a valid Supabase session or internal system credential.",
    traceId,
    source: getExecutionSource(request),
    severity: "CRITICAL",
    actor,
    metadata: {
      allowedRoles,
      suppliedRole: actor?.role ?? null,
      actorSource: actor?.source ?? null,
    },
  });

  return {
    ok: false as const,
    response: NextResponse.json(
      {
        ok: false,
        error: actor ? "Forbidden route access." : "Unauthorized route access.",
        code: actor ? "FORBIDDEN_ROUTE_ACCESS" : "UNAUTHORIZED_ROUTE_ACCESS",
        traceId,
      },
      { status: actor ? 403 : 401 }
    ),
  };
}

export async function enforceRateLimit({
  request,
  route,
  scope,
  maxRequests,
  windowMs,
}: {
  request: Request;
  route: string;
  scope: string;
  maxRequests: number;
  windowMs: number;
}) {
  const traceId = createTraceId(request);
  const result = checkRateLimit({
    key: getClientKey(request, scope),
    maxRequests,
    windowMs,
  });

  if (result.ok) return { ok: true as const, traceId, rateLimit: result };

  await writeSecurityAudit({
    action: "unsafe_execution_attempt",
    route,
    reason: "Rate limit exceeded for protected operational route.",
    traceId,
    source: getExecutionSource(request),
    severity: "WARNING",
    metadata: {
      scope,
      retryAfterSeconds: result.retryAfterSeconds,
    },
  });

  return {
    ok: false as const,
    response: NextResponse.json(
      {
        ok: false,
        error: "Rate limit exceeded.",
        code: "RATE_LIMIT_EXCEEDED",
        traceId,
        retryAfterSeconds: result.retryAfterSeconds,
      },
      { status: 429 }
    ),
  };
}
