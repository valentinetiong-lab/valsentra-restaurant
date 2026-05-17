import "server-only";
import type { User } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/app/lib/admin";
import { isDevelopment } from "@/app/lib/security/environment";

export type AuthRole = "owner" | "manager" | "staff" | "admin" | "internal";

export type RequestActor = {
  userId: string;
  staffId: string | null;
  role: AuthRole;
  organizationId: string;
  locationId: string | null;
  source: "supabase-session" | "internal-key" | "development";
};

export const AUTH_COOKIE_NAME = "valsentra_access_token";
export const ROLE_COOKIE_NAME = "valsentra_role";
export const ORG_COOKIE_NAME = "valsentra_org";

function normalizeRole(value: unknown): AuthRole {
  if (
    value === "owner" ||
    value === "manager" ||
    value === "staff" ||
    value === "admin" ||
    value === "internal"
  ) {
    return value;
  }

  return "staff";
}

function userMetadata(user: User) {
  return {
    ...((user.user_metadata ?? {}) as Record<string, unknown>),
    ...((user.app_metadata ?? {}) as Record<string, unknown>),
  };
}

async function staffActorFromUser(user: User): Promise<RequestActor | null> {
  const { data } = await supabaseAdmin
    .from("staff")
    .select("id, role, organization_id, location_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!data) return null;

  return {
    userId: user.id,
    staffId: String(data.id),
    role: normalizeRole(data.role),
    organizationId: String(data.organization_id ?? "org-valsentra"),
    locationId: data.location_id ? String(data.location_id) : null,
    source: "supabase-session",
  };
}

async function actorFromUser(user: User): Promise<RequestActor> {
  const staffActor = await staffActorFromUser(user);
  if (staffActor) return staffActor;

  const metadata = userMetadata(user);

  return {
    userId: user.id,
    staffId: String(metadata.staff_id ?? metadata.staffId ?? user.id),
    role: normalizeRole(metadata.role),
    organizationId: String(
      metadata.organization_id ?? metadata.organizationId ?? "org-valsentra"
    ),
    locationId:
      metadata.location_id || metadata.locationId
        ? String(metadata.location_id ?? metadata.locationId)
        : null,
    source: "supabase-session",
  };
}

function bearerToken(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
}

function cookieToken(request: Request) {
  const cookie = request.headers.get("cookie") ?? "";
  const match = cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${AUTH_COOKIE_NAME}=`));

  return match ? decodeURIComponent(match.slice(AUTH_COOKIE_NAME.length + 1)) : null;
}

function internalActor(request: Request): RequestActor | null {
  const expectedInternalKey = process.env.VALSENTRA_INTERNAL_API_KEY;
  const suppliedInternalKey = request.headers.get("x-valsentra-internal-key");

  if (!expectedInternalKey || suppliedInternalKey !== expectedInternalKey) {
    return null;
  }

  return {
    userId: "internal-system",
    staffId: null,
    role: "internal",
    organizationId:
      request.headers.get("x-valsentra-organization-id") ?? "org-valsentra",
    locationId: request.headers.get("x-valsentra-location-id"),
    source: "internal-key",
  };
}

export async function resolveRequestActor(request: Request): Promise<RequestActor | null> {
  const internal = internalActor(request);
  if (internal) return internal;

  const token = bearerToken(request) ?? cookieToken(request);
  if (!token) {
    if (isDevelopment) {
      return {
        userId: "development-user",
        staffId: "development-staff",
        role: "admin",
        organizationId: "org-valsentra",
        locationId: "loc-primary",
        source: "development",
      };
    }

    return null;
  }

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) return null;

  return actorFromUser(data.user);
}

export function roleAllowed(role: AuthRole, allowedRoles: AuthRole[]) {
  if (role === "internal") return allowedRoles.includes("internal");
  if (role === "admin") return allowedRoles.includes("admin");
  if (role === "owner") return allowedRoles.includes("owner");
  if (role === "manager") {
    return allowedRoles.includes("manager") || allowedRoles.includes("owner");
  }

  return allowedRoles.includes("staff");
}
