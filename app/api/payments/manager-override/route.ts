import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/admin";
import { mapAndEnrichOrderFromDb, mapOrderToDb } from "@/app/lib/domain/orderMapper";
import { buildIdempotencyKey, checkIdempotencyKey } from "@/app/lib/infrastructure/idempotencyLayer";
import { appendOperationalTimelineFromAudit } from "@/app/lib/operationalTimelineMemoryEngine";
import { canReleaseOrder } from "@/app/lib/paymentTruthLayer";
import { requireRouteRole } from "@/app/lib/security/routeProtection";
import { actorAuditMeta } from "@/app/lib/security/tenantSupabase";

export async function POST(req: Request) {
  const access = await requireRouteRole({
    request: req,
    route: "/api/payments/manager-override",
    allowedRoles: ["manager", "owner", "admin"],
  });
  if (!access.ok) return access.response;

  const body = await req.json();
  const orderId = String(body.orderId ?? "");
  const reason = String(body.reason ?? "").trim();

  if (!orderId || reason.length < 8) {
    return NextResponse.json(
      { ok: false, error: "Manager override requires an order and a clear reason." },
      { status: 400 }
    );
  }

  const { data: orderRow, error: orderError } = await supabaseAdmin
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .eq("organization_id", access.actor.organizationId)
    .maybeSingle();

  if (orderError) {
    return NextResponse.json({ ok: false, error: orderError.message }, { status: 500 });
  }

  if (!orderRow) {
    return NextResponse.json({ ok: false, error: "Order not found." }, { status: 404 });
  }

  const order = mapAndEnrichOrderFromDb(orderRow);
  const idempotencyKey = buildIdempotencyKey({
    scope: "PAYMENT_TRANSITION",
    organizationId: access.actor.organizationId,
    orderId,
    action: "manager-payment-override",
    providerMessageId: access.actor.userId,
    bucket: reason.slice(0, 32),
  });

  const duplicate = await checkIdempotencyKey({
    key: idempotencyKey,
    scope: "PAYMENT_TRANSITION",
    organizationId: access.actor.organizationId,
    locationId: order.locationId ?? access.actor.locationId,
    orderId,
    metadata: { reason, traceId: access.traceId },
  });

  if (duplicate.duplicate) {
    return NextResponse.json({ ok: true, duplicate: true, reason: duplicate.reason });
  }

  const now = new Date().toISOString();
  const { data: updated, error: updateError } = await supabaseAdmin
    .from("orders")
    .update(
      mapOrderToDb({
        paymentTruthStatus: "MANAGER_OVERRIDE",
        paymentTruthSource: "MANAGER_OVERRIDE",
        paymentManagerOverrideBy: access.actor.userId,
        paymentManagerOverrideAt: now,
        paymentManagerOverrideReason: reason,
        paymentState: "VERIFIED",
        paymentVerified: true,
        terminalMismatch: false,
        protectionReason: "Manager approved payment override",
        notes: `Manager override used. ${reason}`,
      })
    )
    .eq("id", orderId)
    .eq("organization_id", access.actor.organizationId)
    .select()
    .single();

  if (updateError) {
    return NextResponse.json({ ok: false, error: updateError.message }, { status: 500 });
  }

  const mapped = mapAndEnrichOrderFromDb(updated);
  const releaseGate = canReleaseOrder(mapped);

  const auditStaff = access.actor.role === "owner" ? "Owner" : "Manager";
  const auditMeta = {
      category: "PAYMENT",
      operationalEvent: "MANAGER_PAYMENT_OVERRIDE",
      idempotencyKey,
      reason,
      releaseGate,
      ...actorAuditMeta(access.actor, access.traceId),
  };

  await supabaseAdmin.from("audit_logs").insert({
    action: "Manager override used",
    staff: auditStaff,
    order_id: orderId,
    organization_id: access.actor.organizationId,
    location_id: mapped.locationId ?? access.actor.locationId,
    meta: auditMeta,
  });

  await appendOperationalTimelineFromAudit({
    action: "Manager override used",
    staff: auditStaff,
    orderId,
    organizationId: access.actor.organizationId,
    locationId: mapped.locationId ?? access.actor.locationId,
    meta: auditMeta,
  });

  return NextResponse.json({ ok: true, order: mapped, releaseGate });
}
