import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/admin";
import { mapAndEnrichOrderFromDb, mapOrderToDb } from "@/app/lib/domain/orderMapper";
import { buildIdempotencyKey, checkIdempotencyKey } from "@/app/lib/infrastructure/idempotencyLayer";
import {
  normalizePaymentTruthPayload,
  paymentTruthToOrderPatch,
} from "@/app/lib/paymentTruthLayer";
import { appendOperationalTimelineFromAudit } from "@/app/lib/operationalTimelineMemoryEngine";
import { createPaymentProvider } from "@/app/lib/providers/payment/paymentProvider";
import { createTraceId } from "@/app/lib/security/routeProtection";

async function writePaymentAudit({
  action,
  orderId,
  organizationId,
  locationId,
  traceId,
  meta,
}: {
  action: string;
  orderId: string;
  organizationId: string;
  locationId?: string | null;
  traceId: string;
  meta: Record<string, unknown>;
}) {
  const auditMeta = {
    category: "PAYMENT",
    operationalEvent: "PAYMENT_TRUTH",
    requestTraceId: traceId,
    ...meta,
  };

  await supabaseAdmin.from("audit_logs").insert({
    action,
    staff: "Payment Provider",
    order_id: orderId,
    organization_id: organizationId,
    location_id: locationId ?? null,
    meta: auditMeta,
  });

  await appendOperationalTimelineFromAudit({
    action,
    staff: "Payment Provider",
    orderId,
    organizationId,
    locationId,
    meta: auditMeta,
  });
}

export async function POST(req: Request) {
  const traceId = createTraceId(req);
  const rawBody = await req.text();
  const provider = createPaymentProvider();
  const signatureCheck = provider.verifyWebhookSignature(rawBody, req.headers);

  if (!signatureCheck.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: signatureCheck.reason,
        code: "PAYMENT_WEBHOOK_SIGNATURE_REJECTED",
        traceId,
      },
      { status: 401 }
    );
  }

  let body: Record<string, any>;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json(
      { ok: false, error: "Malformed payment callback payload.", traceId },
      { status: 400 }
    );
  }

  const providerCallback = provider.normalizeCallbackPayload(body);
  const truth = normalizePaymentTruthPayload(providerCallback as Record<string, any>);

  if (!truth.orderId) {
    return NextResponse.json(
      { ok: false, error: "Payment callback is missing orderId.", traceId },
      { status: 400 }
    );
  }

  const { data: paymentRequest } = await supabaseAdmin
    .from("payment_requests")
    .select("*")
    .or(
      [
        `provider_reference.eq.${truth.providerReference ?? "__missing__"}`,
        `order_id.eq.${truth.orderId}`,
      ].join(",")
    )
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const organizationIdFromRequest = paymentRequest?.organization_id ?? truth.organizationId ?? "org-valsentra";
  const { data: orderRow, error: orderError } = await supabaseAdmin
    .from("orders")
    .select("*")
    .eq("id", truth.orderId || paymentRequest?.order_id)
    .eq("organization_id", organizationIdFromRequest)
    .maybeSingle();

  if (orderError) {
    return NextResponse.json({ ok: false, error: orderError.message, traceId }, { status: 500 });
  }

  if (!orderRow) {
    return NextResponse.json(
      { ok: false, error: "Order was not found for this payment callback.", traceId },
      { status: 404 }
    );
  }

  const order = mapAndEnrichOrderFromDb(orderRow);
  const organizationId = order.organizationId ?? organizationIdFromRequest;
  const locationId = order.locationId ?? paymentRequest?.location_id ?? truth.locationId ?? null;
  const expectedAmount = Number(
    (paymentRequest?.expected_amount ?? truth.expectedAmount) ||
      (order.depositRequired && !order.depositPaid ? order.depositAmount : order.amount)
  );
  const providerEventId =
    truth.providerReference ?? truth.paymentIntentId ?? paymentRequest?.id ?? body.eventId ?? body.id ?? truth.paymentStatus;
  const idempotencyKey = buildIdempotencyKey({
    scope: "WEBHOOK",
    organizationId,
    orderId: truth.orderId,
    action: "payment-callback",
    providerMessageId: providerEventId,
  });

  const duplicate = await checkIdempotencyKey({
    key: idempotencyKey,
    scope: "WEBHOOK",
    organizationId,
    locationId,
    orderId: truth.orderId,
    metadata: {
      provider: truth.callbackSource,
      providerReference: truth.providerReference,
      paymentIntentId: truth.paymentIntentId,
      paymentStatus: truth.paymentStatus,
      traceId,
    },
  });

  if (duplicate.duplicate) {
    return NextResponse.json({
      ok: true,
      duplicate: true,
      idempotencyKey,
      reason: duplicate.reason,
      traceId,
    });
  }

  const patch = paymentTruthToOrderPatch({
    ...truth,
    expectedAmount,
  });

  const remainingBalance =
    order.depositRequired && !order.depositPaid && patch.paymentState === "VERIFIED"
      ? Math.max(order.amount - Number(order.depositAmount ?? 0), 0)
      : 0;

  const orderPatch = mapOrderToDb({
    ...patch,
    status:
      patch.paymentState === "VERIFIED"
        ? remainingBalance > 0
          ? "PAYMENT_SENT"
          : "PAID"
        : order.status,
    paymentStage:
      patch.paymentState === "VERIFIED" && remainingBalance > 0 ? "FINAL" : order.paymentStage,
    paymentVerified: patch.paymentState === "VERIFIED" && remainingBalance === 0,
    depositPaid: patch.paymentState === "VERIFIED" ? true : order.depositPaid,
    notes:
      patch.paymentState === "VERIFIED"
        ? "Provider confirmed payment."
        : patch.paymentTruthStatus === "AMOUNT_MISMATCH"
          ? `Amount mismatch. ${truth.mismatchReason ?? ""}`.trim()
          : "Waiting for provider payment confirmation.",
  });

  const { data: updated, error: updateError } = await supabaseAdmin
    .from("orders")
    .update(orderPatch)
    .eq("id", truth.orderId)
    .eq("organization_id", organizationId)
    .select()
    .single();

  if (updateError) {
    return NextResponse.json({ ok: false, error: updateError.message, traceId }, { status: 500 });
  }

  if (paymentRequest) {
    await supabaseAdmin
      .from("payment_requests")
      .update({
        status:
          patch.paymentTruthStatus === "PROVIDER_CONFIRMED"
            ? "confirmed"
            : patch.paymentTruthStatus === "AMOUNT_MISMATCH"
              ? "amount_mismatch"
              : patch.paymentTruthStatus === "FAILED"
                ? "failed"
                : "pending",
        updated_at: new Date().toISOString(),
        metadata: {
          ...(paymentRequest.metadata ?? {}),
          callbackReceivedAt: new Date().toISOString(),
          callbackTraceId: traceId,
          paidAmount: truth.paidAmount,
          expectedAmount,
          paymentTruthStatus: patch.paymentTruthStatus,
          providerMetadata: truth.providerMetadata ?? {},
        },
      })
      .eq("id", paymentRequest.id)
      .eq("organization_id", organizationId);
  }

  const action =
    patch.paymentTruthStatus === "PROVIDER_CONFIRMED"
      ? "Provider payment confirmed"
      : patch.paymentTruthStatus === "AMOUNT_MISMATCH"
        ? "Amount mismatch"
        : "Payment provider update received";

  await writePaymentAudit({
    action,
    orderId: truth.orderId,
    organizationId,
    locationId,
    traceId,
    meta: {
      idempotencyKey,
      paymentTruth: {
        status: patch.paymentTruthStatus,
        source: patch.paymentTruthSource,
        provider: truth.callbackSource,
        paymentRequestId: paymentRequest?.id ?? null,
        expectedAmount,
        paidAmount: truth.paidAmount,
        currency: truth.currency,
        mismatchReason: truth.mismatchReason,
      },
      signatureConfigured: signatureCheck.configured,
    },
  });

  return NextResponse.json({
    ok: true,
    traceId,
    paymentTruthStatus: patch.paymentTruthStatus,
    paymentState: patch.paymentState,
    order: mapAndEnrichOrderFromDb(updated),
  });
}
