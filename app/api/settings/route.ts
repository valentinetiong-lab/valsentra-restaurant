import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "../../lib/admin";
import {
  enforceRateLimit,
  requireRouteRole,
} from "@/app/lib/security/routeProtection";
import { actorAuditMeta } from "@/app/lib/security/tenantSupabase";

function mapSettingsFromDb(row: Record<string, any>) {
  return {
    id: row.id,
    dineInDepositGuestsThreshold: row.dine_in_deposit_guests_threshold,
    pickupDepositAmountThreshold: Number(row.pickup_deposit_amount_threshold),
    requireDeliveryDeposit: row.require_delivery_deposit,
    lowReliabilityThreshold: row.low_reliability_threshold,
    autoBlockHighValueUnpaid: row.auto_block_high_value_unpaid,
    hardBlockTerminalMismatch: row.hard_block_terminal_mismatch,
    autopilotMode: row.autopilot_mode ?? "SEMI_AUTO",
    updatedAt: row.updated_at,
  };
}

function defaultSettingsPayload({
  organizationId,
  locationId,
  actorUserId,
}: {
  organizationId: string;
  locationId: string | null;
  actorUserId?: string | null;
}) {
  return {
    organization_id: organizationId,
    location_id: locationId,
    dine_in_deposit_guests_threshold: 6,
    pickup_deposit_amount_threshold: 200,
    require_delivery_deposit: false,
    low_reliability_threshold: 55,
    auto_block_high_value_unpaid: true,
    hard_block_terminal_mismatch: true,
    autopilot_mode: "SEMI_AUTO",
    updated_by: actorUserId ?? null,
  };
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

export async function GET(request: Request) {
  const access = await requireRouteRole({
    request,
    route: "/api/settings",
    allowedRoles: ["owner", "manager", "admin", "internal"],
  });
  if (!access.ok) return access.response;

  try {
    const { data, error } = await supabaseAdmin
      .from("restaurant_settings")
      .select("*")
      .eq("organization_id", access.actor.organizationId)
      .single();

    if (error && error.code === "PGRST116") {
      const created = await supabaseAdmin
        .from("restaurant_settings")
        .insert({
          id: await nextRestaurantSettingsId(),
          ...defaultSettingsPayload({
            organizationId: access.actor.organizationId,
            locationId: access.actor.locationId,
            actorUserId:
              access.actor.userId !== "development-user" &&
              access.actor.userId !== "internal-system"
                ? access.actor.userId
                : null,
          }),
        })
        .select("*")
        .single();

      if (created.error) {
        return NextResponse.json({ error: created.error.message }, { status: 500 });
      }

      return NextResponse.json(mapSettingsFromDb(created.data));
    }

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(mapSettingsFromDb(data));
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Failed to fetch settings" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  const access = await requireRouteRole({
    request,
    route: "/api/settings",
    allowedRoles: ["owner", "manager", "admin"],
  });
  if (!access.ok) return access.response;

  const rateLimit = await enforceRateLimit({
    request,
    route: "/api/settings",
    scope: "settings-patch",
    maxRequests: 30,
    windowMs: 60_000,
  });
  if (!rateLimit.ok) return rateLimit.response;

  try {
    const body = await request.json();

    const payload: Record<string, any> = {
      organization_id: access.actor.organizationId,
      location_id: access.actor.locationId,
      updated_by:
        access.actor.userId !== "development-user" &&
        access.actor.userId !== "internal-system"
          ? access.actor.userId
          : null,
    };

    if (body.dineInDepositGuestsThreshold !== undefined) {
      payload.dine_in_deposit_guests_threshold =
        body.dineInDepositGuestsThreshold;
    }

    if (body.pickupDepositAmountThreshold !== undefined) {
      payload.pickup_deposit_amount_threshold =
        body.pickupDepositAmountThreshold;
    }

    if (body.requireDeliveryDeposit !== undefined) {
      payload.require_delivery_deposit = body.requireDeliveryDeposit;
    }

    if (body.lowReliabilityThreshold !== undefined) {
      payload.low_reliability_threshold = body.lowReliabilityThreshold;
    }

    if (body.autoBlockHighValueUnpaid !== undefined) {
      payload.auto_block_high_value_unpaid = body.autoBlockHighValueUnpaid;
    }

    if (body.hardBlockTerminalMismatch !== undefined) {
      payload.hard_block_terminal_mismatch = body.hardBlockTerminalMismatch;
    }

    if (body.autopilotMode !== undefined) {
      payload.autopilot_mode = body.autopilotMode;
    }

    const existing = await supabaseAdmin
      .from("restaurant_settings")
      .select("id")
      .eq("organization_id", access.actor.organizationId)
      .maybeSingle();

    const { data, error } = existing.data?.id
      ? await supabaseAdmin
          .from("restaurant_settings")
          .update(payload)
          .eq("id", existing.data.id)
          .select("*")
          .single()
      : await supabaseAdmin
          .from("restaurant_settings")
          .insert({ id: await nextRestaurantSettingsId(), ...payload })
          .select("*")
          .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      ...mapSettingsFromDb(data),
      security: actorAuditMeta(access.actor, access.traceId),
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Failed to save settings" },
      { status: 500 }
    );
  }
}
