import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/admin";
import { requireRouteRole } from "@/app/lib/security/routeProtection";

function mapStaffFromDb(row: any) {
  return {
    id: String(row.id),
    name: row.name ?? "Staff",
    email: row.email ?? null,
    role: row.role ?? "staff",
    organizationId: row.organization_id ?? null,
    locationId: row.location_id ?? null,
    userId: row.user_id ?? null,
    inviteStatus: row.invite_status ?? "active",
    createdAt: row.created_at ?? undefined,
  };
}

export async function GET(request: Request) {
  const access = await requireRouteRole({
    request,
    route: "/api/staff",
    allowedRoles: ["staff", "manager", "owner", "admin", "internal"],
  });
  if (!access.ok) return access.response;

  const { data, error } = await supabaseAdmin
    .from("staff")
    .select("id, name, email, role, organization_id, location_id, user_id, invite_status, created_at")
    .eq("organization_id", access.actor.organizationId)
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json((data ?? []).map(mapStaffFromDb));
}
