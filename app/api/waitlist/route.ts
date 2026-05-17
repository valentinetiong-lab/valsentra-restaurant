import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../lib/admin";
import { requireRouteRole } from "@/app/lib/security/routeProtection";

function mapLead(row: Record<string, any>) {
  return {
    id: row.id,
    customerName: row.customer_name,
    phone: row.phone,
    preferredType: row.preferred_type,
    showProbability: Number(row.show_probability),
    responseSpeedScore: Number(row.response_speed_score),
    reliabilityScore: Number(row.reliability_score),
    createdAt: row.created_at,
  };
}

export async function GET(request: Request) {
  const access = await requireRouteRole({
    request,
    route: "/api/waitlist",
    allowedRoles: ["staff", "manager", "owner", "admin", "internal"],
  });
  if (!access.ok) return access.response;

  try {
    const { data, error } = await supabaseAdmin
      .from("waitlist_leads")
      .select("*")
      .eq("organization_id", access.actor.organizationId)
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json((data ?? []).map(mapLead));
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Failed to fetch waitlist" },
      { status: 500 }
    );
  }
}
