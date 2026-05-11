import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../lib/admin";

function futureDate(hoursFromNow: number) {
  return new Date(Date.now() + hoursFromNow * 60 * 60 * 1000).toISOString();
}

export async function POST() {
  try {
    // Clear dependent/history data first
    await supabaseAdmin.from("audit_logs").delete().not("id", "is", null);

    // Then clear orders
    await supabaseAdmin.from("orders").delete().not("id", "is", null);

    const demoOrders = [
      {
        id: "DEMO-001",
        customer_name: "John Tan",
        phone: "60123456789",
        order_type: "DINE_IN_RESERVATION",
        amount: 300,
        guests: 4,
        reservation_time: futureDate(24),
        item_summary: "Family dinner reservation",
        status: "UNPAID",
        deposit_required: true,
        deposit_amount: 90,
        deposit_paid: false,
        payment_state: "PENDING",
        payment_stage: "DEPOSIT",
        payment_verified: false,
        reliability_score: 35,
        terminal_mismatch: false,
        notes: "Demo: high-risk dine-in booking with unpaid deposit.",
        assigned_staff: "Aiman",
        risk_level: "HIGH",
        protection_reason: "Large dine-in booking",
        awaiting_details: false,
      },
      {
        id: "DEMO-002",
        customer_name: "Sarah Lim",
        phone: "60111111111",
        order_type: "PREORDER_PICKUP",
        amount: 80,
        guests: 1,
        reservation_time: futureDate(12),
        item_summary: "Pickup order",
        status: "UNPAID",
        deposit_required: false,
        deposit_amount: 0,
        deposit_paid: false,
        payment_state: "PENDING",
        payment_stage: "FINAL",
        payment_verified: false,
        reliability_score: 85,
        terminal_mismatch: false,
        notes: "Demo: normal low-risk pickup order.",
        assigned_staff: "Aiman",
        risk_level: "LOW",
        protection_reason: "Standard protection",
        awaiting_details: false,
      },
      {
        id: "DEMO-003",
        customer_name: "Ahmad",
        phone: "60122222222",
        order_type: "PREORDER_PICKUP",
        amount: 220,
        guests: 1,
        reservation_time: futureDate(-1),
        item_summary: "Missed pickup order",
        status: "NO_SHOW",
        deposit_required: true,
        deposit_amount: 66,
        deposit_paid: false,
        payment_state: "PENDING",
        payment_stage: "DEPOSIT",
        payment_verified: false,
        reliability_score: 20,
        terminal_mismatch: false,
        notes: "Demo: no-show order for waitlist recovery.",
        assigned_staff: "Aiman",
        risk_level: "HIGH",
        protection_reason: "No-show recovery opportunity",
        awaiting_details: false,
      },
    ];

    const { error } = await supabaseAdmin.from("orders").insert(demoOrders);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    await supabaseAdmin.from("audit_logs").insert({
      action: "Demo data reset",
      staff: "System",
      order_id: "DEMO",
      meta: {
        type: "demo",
      },
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Demo reset failed" },
      { status: 500 }
    );
  }
}