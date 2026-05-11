import { supabaseAdmin } from "@/app/lib/admin";
import { buildOperationalEvent } from "@/app/lib/intelligence/operationalEventModel";
import { findBestWaitlistLead } from "@/app/lib/waitlistEngine";

function createOrderId() {
  return `ORD-${Date.now().toString().slice(-6)}`;
}

export async function runWaitlistCascade({
  orderId,
  staffName = "System",
}: {
  orderId: string;
  staffName?: string;
}) {
  const { data: order, error: orderError } = await supabaseAdmin
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .single();

  if (orderError || !order) {
    return { ok: false, error: "Order not found" };
  }

  const { data: existingRecovery, error: existingRecoveryError } =
    await supabaseAdmin
      .from("orders")
      .select("id, customer_name, status")
      .eq("recovery_source_order_id", orderId)
      .maybeSingle();

  if (existingRecoveryError) {
    return { ok: false, error: existingRecoveryError.message };
  }

  if (existingRecovery) {
    return {
      ok: false,
      error: `This slot has already been recovered as ${existingRecovery.id} for ${existingRecovery.customer_name}.`,
      duplicate: true,
    };
  }

  const { data: waitlist, error: waitlistError } = await supabaseAdmin
    .from("waitlist_leads")
    .select("*");

  if (waitlistError) {
    return { ok: false, error: waitlistError.message };
  }

  const mappedWaitlist = (waitlist ?? []).map((row) => ({
    id: row.id,
    customerName: row.customer_name,
    phone: row.phone,
    preferredType: row.preferred_type,
    showProbability: Number(row.show_probability),
    responseSpeedScore: Number(row.response_speed_score),
    reliabilityScore: Number(row.reliability_score),
  }));

  const result = findBestWaitlistLead(
    {
      id: order.id,
      orderType: order.order_type,
      amount: Number(order.amount ?? 0),
    },
    mappedWaitlist
  );

  if (!result.bestLead) {
    await supabaseAdmin.from("audit_logs").insert(buildOperationalEvent({
      eventKey: `waitlist-failed:${order.id}:no-match`,
      category: "WAITLIST",
      severity: "WARNING",
      action: `Waitlist cascade failed for ${order.id}. Rule: NO_MATCHING_WAITLIST_LEAD. Reason: No suitable waitlist lead found for ${order.order_type}.`,
      staff: staffName,
      orderId: order.id,
      title: "Waitlist recovery failed",
      summary: `No suitable waitlist lead found for ${order.order_type}.`,
      recommendedAction: "Owner review required for unrecovered revenue.",
      confidence: 55,
      meta: {
        organizationId: order.organization_id ?? order.organizationId,
        locationId: order.location_id ?? order.locationId,
        locationName: order.location_name ?? order.locationName,
        rule: "NO_MATCHING_WAITLIST_LEAD",
        reason: "No suitable waitlist lead found",
        originalOrderId: order.id,
        orderType: order.order_type,
        recoverableRevenue: Number(order.amount ?? 0),
        requiresHumanAction: true,
      },
    }));

    return {
      ok: false,
      error: "No suitable waitlist lead",
      rule: "NO_MATCHING_WAITLIST_LEAD",
    };
  }

  const lead = result.bestLead;
  const newOrderId = createOrderId();
  const recoverableRevenue = Number(order.amount ?? 0);
  const confidence = result.recoveryScore;

  const decisionReason =
    `Selected ${lead.customerName} because they matched ${order.order_type} ` +
    `with ${lead.showProbability}% show probability, ${lead.responseSpeedScore}% response speed, ` +
    `and ${lead.reliabilityScore}% reliability.`;

  const { data: newOrder, error: createError } = await supabaseAdmin
    .from("orders")
    .insert({
      id: newOrderId,
      customer_name: lead.customerName,
      phone: lead.phone,
      order_type: order.order_type,
      amount: 0,
      guests: order.guests ?? 1,
      reservation_time: order.reservation_time,
      item_summary: "",
      status: "UNPAID",
      payment_state: "UNPAID",
      payment_stage: "AWAITING_DETAILS",
      payment_verified: false,
      deposit_required: false,
      deposit_amount: 0,
      deposit_paid: false,
      awaiting_details: true,
      reliability_score: lead.reliabilityScore,
      terminal_mismatch: false,
      notes: `Recovered from ${order.id}. ${decisionReason} Actual order value/details still need to be entered.`,
      assigned_staff: staffName,
      risk_level: "LOW",
      protection_reason: "Recovered slot • awaiting actual order details",
      recovery_source_order_id: order.id,
    })
    .select()
    .single();

  if (createError) {
    return { ok: false, error: createError.message };
  }

  await supabaseAdmin.from("audit_logs").insert(buildOperationalEvent({
    eventKey: `waitlist-success:${order.id}:${newOrder.id}`,
    category: "WAITLIST",
    severity: "INFO",
    action: `Waitlist cascade: recovered ${order.id} with ${lead.customerName}. Rule: BEST_WAITLIST_MATCH. Confidence: ${confidence}%. Recoverable revenue: RM${recoverableRevenue}.`,
    staff: staffName,
    orderId: newOrder.id,
    title: "Waitlist recovery activated",
    summary: `Recovered ${order.id} with ${lead.customerName}.`,
    reasoning: [decisionReason],
    recommendedAction:
      "Complete recovered order details before payment actions continue.",
    confidence,
    meta: {
      organizationId: order.organization_id ?? order.organizationId,
      locationId: order.location_id ?? order.locationId,
      locationName: order.location_name ?? order.locationName,
      rule: "BEST_WAITLIST_MATCH",
      reason: decisionReason,
      confidence,
      originalOrderId: order.id,
      recoveredOrderId: newOrder.id,
      selectedLeadId: lead.id,
      selectedLeadName: lead.customerName,
      recoverableRevenue,
      recoveryScore: result.recoveryScore,
      requiresHumanAction: true,
      humanActionReason:
        "Recovered order is a draft. Staff must enter actual order amount and summary before payment actions continue.",
    },
  }));

  return {
    ok: true,
    newOrder,
    lead,
    rule: "BEST_WAITLIST_MATCH",
    reason: decisionReason,
    confidence,
    recoverableRevenue,
  };
}
