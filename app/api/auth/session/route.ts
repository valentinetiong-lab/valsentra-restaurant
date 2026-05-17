import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/admin";
import {
  AUTH_COOKIE_NAME,
  ORG_COOKIE_NAME,
  ROLE_COOKIE_NAME,
} from "@/app/lib/security/auth";
import { isProduction } from "@/app/lib/security/environment";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const accessToken =
    body && typeof body === "object" && !Array.isArray(body)
      ? String((body as Record<string, unknown>).accessToken ?? "")
      : "";

  if (!accessToken) {
    return NextResponse.json(
      { ok: false, error: "accessToken is required." },
      { status: 400 }
    );
  }

  const { data, error } = await supabaseAdmin.auth.getUser(accessToken);
  if (error || !data.user) {
    return NextResponse.json(
      { ok: false, error: "Invalid Supabase session." },
      { status: 401 }
    );
  }

  const metadata = {
    ...(data.user.user_metadata ?? {}),
    ...(data.user.app_metadata ?? {}),
  } as Record<string, unknown>;
  const { data: staffRow } = await supabaseAdmin
    .from("staff")
    .select("id, role, organization_id, location_id")
    .eq("user_id", data.user.id)
    .maybeSingle();
  const role = String(staffRow?.role ?? metadata.role ?? "staff");
  const organizationId = String(
    staffRow?.organization_id ??
      metadata.organization_id ??
      metadata.organizationId ??
      "org-valsentra"
  );
  const locationId =
    staffRow?.location_id ??
    metadata.location_id ??
    metadata.locationId ??
    null;
  const cookieStore = await cookies();
  const cookieOptions = {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax" as const,
    path: "/",
    maxAge: 60 * 60 * 8,
  };

  cookieStore.set(AUTH_COOKIE_NAME, accessToken, cookieOptions);
  cookieStore.set(ROLE_COOKIE_NAME, role, { ...cookieOptions, httpOnly: false });
  cookieStore.set(ORG_COOKIE_NAME, organizationId, { ...cookieOptions, httpOnly: false });

  return NextResponse.json({
    ok: true,
    userId: data.user.id,
    staffId: staffRow?.id ?? null,
    role,
    organizationId,
    locationId,
    redirectTo: role === "owner" || role === "manager" ? "/restaurant/owner" : "/restaurant",
  });
}

export async function DELETE() {
  const cookieStore = await cookies();
  cookieStore.delete(AUTH_COOKIE_NAME);
  cookieStore.delete(ROLE_COOKIE_NAME);
  cookieStore.delete(ORG_COOKIE_NAME);

  return NextResponse.json({ ok: true });
}
