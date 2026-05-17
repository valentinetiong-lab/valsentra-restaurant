import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/admin";

function slug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

async function nextRestaurantSettingsId() {
  const { data } = await supabaseAdmin
    .from("restaurant_settings")
    .select("id")
    .order("id", { ascending: false })
    .limit(1);

  const current = Number(data?.[0]?.id ?? 0);
  return Number.isFinite(current) ? current + 1 : 1;
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const accessToken =
    body && typeof body === "object" && !Array.isArray(body)
      ? String((body as Record<string, unknown>).accessToken ?? "")
      : "";
  const organizationName =
    body && typeof body === "object" && !Array.isArray(body)
      ? String((body as Record<string, unknown>).organizationName ?? "Valsentra Restaurant").trim()
      : "Valsentra Restaurant";
  const locationName =
    body && typeof body === "object" && !Array.isArray(body)
      ? String((body as Record<string, unknown>).locationName ?? "Primary Location").trim()
      : "Primary Location";

  if (!accessToken) {
    return NextResponse.json({ ok: false, error: "Supabase session is required." }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin.auth.getUser(accessToken);
  if (error || !data.user) {
    return NextResponse.json({ ok: false, error: "Invalid Supabase session." }, { status: 401 });
  }

  const existing = await supabaseAdmin
    .from("staff")
    .select("organization_id, role")
    .eq("user_id", data.user.id)
    .maybeSingle();

  if (existing.data?.organization_id) {
    return NextResponse.json({
      ok: true,
      organizationId: existing.data.organization_id,
      role: existing.data.role,
      alreadyLinked: true,
    });
  }

  const organizationId = `org-${slug(organizationName) || data.user.id.slice(0, 8)}`;
  const locationId = `loc-${slug(locationName) || "primary"}`;

  const org = await supabaseAdmin
    .from("organizations")
    .upsert({ id: organizationId, name: organizationName || "Valsentra Restaurant" })
    .select("id")
    .single();
  if (org.error) return NextResponse.json({ ok: false, error: org.error.message }, { status: 500 });

  const location = await supabaseAdmin
    .from("locations")
    .upsert({ id: locationId, organization_id: organizationId, name: locationName || "Primary Location" })
    .select("id")
    .single();
  if (location.error) return NextResponse.json({ ok: false, error: location.error.message }, { status: 500 });

  const staffPayload = {
    user_id: data.user.id,
    email: data.user.email,
    name: data.user.email?.split("@")[0] ?? "Owner",
    role: "owner",
    organization_id: organizationId,
    location_id: locationId,
    invite_status: "active",
    accepted_at: new Date().toISOString(),
  };
  const existingStaff = await supabaseAdmin
    .from("staff")
    .select("id")
    .eq("user_id", data.user.id)
    .maybeSingle();
  const staff = existingStaff.data?.id
    ? await supabaseAdmin
        .from("staff")
        .update(staffPayload)
        .eq("id", existingStaff.data.id)
        .select("id")
        .single()
    : await supabaseAdmin
        .from("staff")
        .insert(staffPayload)
        .select("id")
        .single();
  if (staff.error) return NextResponse.json({ ok: false, error: staff.error.message }, { status: 500 });

  const settingsPayload = {
    organization_id: organizationId,
    location_id: locationId,
    dine_in_deposit_guests_threshold: 6,
    pickup_deposit_amount_threshold: 200,
    require_delivery_deposit: false,
    low_reliability_threshold: 55,
    auto_block_high_value_unpaid: true,
    hard_block_terminal_mismatch: true,
    autopilot_mode: "SEMI_AUTO",
    updated_by: data.user.id,
  };
  const existingSettings = await supabaseAdmin
    .from("restaurant_settings")
    .select("id")
    .eq("organization_id", organizationId)
    .maybeSingle();
  const settings = existingSettings.data?.id
    ? await supabaseAdmin
        .from("restaurant_settings")
        .update(settingsPayload)
        .eq("id", existingSettings.data.id)
        .select("organization_id")
        .single()
    : await supabaseAdmin
        .from("restaurant_settings")
        .insert({ id: await nextRestaurantSettingsId(), ...settingsPayload })
        .select("organization_id")
        .single();
  if (settings.error) return NextResponse.json({ ok: false, error: settings.error.message }, { status: 500 });

  await supabaseAdmin.auth.admin.updateUserById(data.user.id, {
    app_metadata: {
      ...(data.user.app_metadata ?? {}),
      role: "owner",
      organization_id: organizationId,
      location_id: locationId,
      staff_id: staff.data.id,
    },
  });

  return NextResponse.json({
    ok: true,
    organizationId,
    locationId,
    role: "owner",
    staffId: staff.data.id,
  });
}
