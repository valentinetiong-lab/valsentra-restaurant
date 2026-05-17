import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/admin";
import { requireRouteRole } from "@/app/lib/security/routeProtection";

const ROLES = ["owner", "manager", "staff"] as const;

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: Request) {
  const access = await requireRouteRole({
    request,
    route: "/api/staff/invite",
    allowedRoles: ["owner", "admin"],
  });
  if (!access.ok) return access.response;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const email = clean((body as Record<string, unknown>).email).toLowerCase();
  const name = clean((body as Record<string, unknown>).name) || email.split("@")[0] || "Staff";
  const role = clean((body as Record<string, unknown>).role) as (typeof ROLES)[number];
  const locationId = clean((body as Record<string, unknown>).locationId) || access.actor.locationId || "loc-primary";

  if (!email || !email.includes("@")) {
    return NextResponse.json({ ok: false, error: "Enter a valid staff email." }, { status: 400 });
  }

  if (!ROLES.includes(role)) {
    return NextResponse.json({ ok: false, error: "Role must be owner, manager, or staff." }, { status: 400 });
  }

  const invite = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
    data: {
      role,
      organization_id: access.actor.organizationId,
      location_id: locationId,
    },
  });

  if (invite.error || !invite.data.user) {
    return NextResponse.json(
      { ok: false, error: invite.error?.message ?? "Supabase invite failed." },
      { status: 500 }
    );
  }

  const staffPayload = {
    user_id: invite.data.user.id,
    email,
    name,
    role,
    organization_id: access.actor.organizationId,
    location_id: locationId,
    invite_status: "invited",
    invited_at: new Date().toISOString(),
    created_by:
      access.actor.userId !== "development-user" &&
      access.actor.userId !== "internal-system"
        ? access.actor.userId
        : null,
  };
  const existingStaff = await supabaseAdmin
    .from("staff")
    .select("id")
    .eq("user_id", invite.data.user.id)
    .maybeSingle();
  const staff = existingStaff.data?.id
    ? await supabaseAdmin
        .from("staff")
        .update(staffPayload)
        .eq("id", existingStaff.data.id)
        .select("id, name, email, role, organization_id, location_id, invite_status")
        .single()
    : await supabaseAdmin
        .from("staff")
        .insert(staffPayload)
        .select("id, name, email, role, organization_id, location_id, invite_status")
        .single();

  if (staff.error) {
    return NextResponse.json({ ok: false, error: staff.error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    staff: staff.data,
    invitedUserId: invite.data.user.id,
  });
}
