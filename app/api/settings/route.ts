import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "../../lib/admin";

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

export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from("restaurant_settings")
      .select("*")
      .eq("id", 1)
      .single();

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
  try {
    const body = await request.json();

    const payload: Record<string, any> = { id: 1 };

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

    const { data, error } = await supabaseAdmin
      .from("restaurant_settings")
      .upsert(payload)
      .select("*")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(mapSettingsFromDb(data));
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Failed to save settings" },
      { status: 500 }
    );
  }
}