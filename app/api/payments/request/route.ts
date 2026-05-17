import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/admin";
import { mapAndEnrichOrderFromDb, mapOrderToDb } from "@/app/lib/domain/orderMapper";
import { buildIdempotencyKey, checkIdempotencyKey } from "@/app/lib/infrastructure/idempotencyLayer";
import { executeDirectCommunication } from "@/app/lib/providers/communication/communicationExecutionService";
import { createPaymentProvider } from "@/app/lib/providers/payment/paymentProvider";
import { appendOperationalTimelineFromAudit } from "@/app/lib/operationalTimelineMemoryEngine";
import {
  enforceRateLimit,
  requireRouteRole,
} from "@/app/lib/security/routeProtection";
import { actorAuditMeta } from "@/app/lib/security/tenantSupabase";

function getAmountDueNow(order: {
  amount: number;
  depositAmount?: number | null;
  depositRequired: boolean;
  depositPaid: boolean;
  status: string;
}) {
  const depositAmount = Number(order.depositAmount ?? 0);

  if (order.depositRequired && !order.depositPaid) {
    return depositAmount;
  }

  if (order.status !== "PAID") {
    return Math.max(Number(order.amount ?? 0) - depositAmount, 0);
  }

  return 0;
}

function paymentRequestStatus(resultStatus: string) {
  if (resultStatus === "CREATED" || resultStatus === "PENDING") return "created";
  if (resultStatus === "FAILED") return "failed";
  if (resultStatus === "SUPPRESSED") return "provider_not_configured";
  if (resultStatus === "EXPIRED") return "expired";
  if (resultStatus === "CANCELLED") return "cancelled";
  return "pending";
}

function buildPaymentMessage({
  customerName,
  orderId,
  amount,
  currency,
  paymentLink,
  expiresAt,
}: {
  customerName: string;
  orderId: string;
  amount: number;
  currency: string;
  paymentLink: string;
  expiresAt?: string | null;
}) {
  const expiry = expiresAt ? ` This request expires at ${new Date(expiresAt).toLocaleString("en-MY")}.` : "";
  return `Hi ${customerName}, Valsentra payment request for order ${orderId}: ${currency} ${amount.toFixed(2)}. Pay here: ${paymentLink}.${expiry}`;
}

export async function POST(req: Request) {
  const access = await requireRouteRole({
    request: req,
    route: "/api/payments/request",
    allowedRoles: ["staff", "manager", "owner", "admin", "internal"],
  });
  if (!access.ok) return access.response;

  const rateLimit = await enforceRateLimit({
    request: req,
    route: "/api/payments/request",
    scope: "payment-request",
    maxRequests: 30,
    windowMs: 60_000,
  });
  if (!rateLimit.ok) return rateLimit.response;

  const body = await req.json().catch(() => null);
  const orderId = String(body?.orderId ?? "");

  if (!orderId) {
    return NextResponse.json({ ok: false, error: "orderId is required." }, { status: 400 });
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
  const amountDueNow = getAmountDueNow(order);

  if (amountDueNow <= 0) {
    return NextResponse.json(
      { ok: false, error: "There is no payment due for this order right now." },
      { status: 400 }
    );
  }

  const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
  const idempotencyKey = buildIdempotencyKey({
    scope: "PAYMENT_TRANSITION",
    organizationId: access.actor.organizationId,
    orderId,
    action: "create-payment-request",
    bucket: `${amountDueNow}:${order.paymentStage ?? "FINAL"}`,
  });
  const duplicate = await checkIdempotencyKey({
    key: idempotencyKey,
    scope: "PAYMENT_TRANSITION",
    organizationId: access.actor.organizationId,
    locationId: order.locationId ?? access.actor.locationId,
    orderId,
    metadata: { amountDueNow, traceId: access.traceId },
  });

  if (duplicate.duplicate) {
    return NextResponse.json({
      ok: true,
      duplicate: true,
      reason: duplicate.reason,
      traceId: access.traceId,
    });
  }

  const provider = createPaymentProvider();
  const providerReference = `PAY-${access.actor.organizationId}-${orderId}-${Date.now()}`.replace(/[^A-Za-z0-9-]/g, "-");
  const providerResult = await provider.execute({
    action: "CREATE_PAYMENT_LINK",
    organizationId: access.actor.organizationId,
    locationId: order.locationId ?? access.actor.locationId,
    orderId,
    amount: amountDueNow,
    currency: "MYR",
    customerName: order.customerName,
    metadata: {
      providerReference,
      expiresAt,
      customerPhone: order.phone,
      paymentStage: order.depositRequired && !order.depositPaid ? "DEPOSIT" : "FINAL",
      idempotencyKey,
    },
  });

  const finalProviderReference = providerResult.providerReference ?? providerReference;
  const paymentRequestStatusValue = paymentRequestStatus(providerResult.status);
  const { data: paymentRequest, error: requestError } = await supabaseAdmin
    .from("payment_requests")
    .insert({
      organization_id: access.actor.organizationId,
      location_id: order.locationId ?? access.actor.locationId,
      order_id: orderId,
      provider: providerResult.provider,
      provider_reference: finalProviderReference,
      expected_amount: amountDueNow,
      currency: "MYR",
      status: paymentRequestStatusValue,
      expires_at: providerResult.expiresAt ?? expiresAt,
      customer_phone: order.phone,
      metadata: {
        providerMode: providerResult.mode,
        paymentLink: providerResult.paymentLink ?? null,
        paymentQrPayload: providerResult.paymentQrPayload ?? null,
        providerMetadata: providerResult.metadata ?? {},
        providerError: providerResult.error ?? null,
        idempotencyKey,
      },
    })
    .select()
    .single();

  if (requestError) {
    return NextResponse.json({ ok: false, error: requestError.message }, { status: 500 });
  }

  const communication =
    providerResult.paymentLink && order.phone
      ? await executeDirectCommunication({
          channel: "WHATSAPP",
          to: order.phone,
          message: buildPaymentMessage({
            customerName: order.customerName,
            orderId,
            amount: amountDueNow,
            currency: "MYR",
            paymentLink: providerResult.paymentLink,
            expiresAt: providerResult.expiresAt ?? expiresAt,
          }),
          orderId,
          customerName: order.customerName,
          metadata: {
            organizationId: access.actor.organizationId,
            locationId: order.locationId ?? access.actor.locationId,
            paymentRequestId: paymentRequest.id,
            providerReference: finalProviderReference,
            idempotencyKey: `payment-message:${access.actor.organizationId}:${orderId}:${finalProviderReference}`,
          },
        })
      : null;

  const nextStatus = communication?.realMessageSent ? "sent" : paymentRequestStatusValue;

  if (nextStatus !== paymentRequestStatusValue) {
    await supabaseAdmin
      .from("payment_requests")
      .update({
        status: nextStatus,
        updated_at: new Date().toISOString(),
        metadata: {
          ...(paymentRequest.metadata ?? {}),
          communicationStatus: communication?.status ?? null,
          communicationProvider: communication?.provider ?? null,
          realMessageSent: communication?.realMessageSent ?? false,
        },
      })
      .eq("id", paymentRequest.id)
      .eq("organization_id", access.actor.organizationId);
  }

  const { data: updatedOrder, error: updateError } = await supabaseAdmin
    .from("orders")
    .update(
      mapOrderToDb({
        status: "PAYMENT_SENT",
        paymentStage: order.depositRequired && !order.depositPaid ? "DEPOSIT" : "FINAL",
        paymentState: "PENDING",
        paymentVerified: false,
        paymentIntentId: String(paymentRequest.id),
        paymentProviderReference: finalProviderReference,
        paymentExpectedAmount: amountDueNow,
        paymentCurrency: "MYR",
        paymentTruthStatus: "PENDING_PROVIDER",
        paymentTruthSource: "SYSTEM",
        protectionReason: providerResult.paymentLink
          ? "Waiting for customer payment"
          : "Payment provider setup required",
        notes: providerResult.paymentLink
          ? "Payment link sent. Waiting for provider confirmation."
          : "Payment request prepared, but no live payment link was created because provider setup is incomplete.",
      })
    )
    .eq("id", orderId)
    .eq("organization_id", access.actor.organizationId)
    .select()
    .single();

  if (updateError) {
    return NextResponse.json({ ok: false, error: updateError.message }, { status: 500 });
  }

  const auditAction = providerResult.paymentLink ? "Payment link sent" : "Payment request prepared";
  const auditMeta = {
      category: "PAYMENT",
      operationalEvent: "PAYMENT_REQUEST_CREATED",
      idempotencyKey,
      paymentRequestId: paymentRequest.id,
      provider: providerResult.provider,
      providerMode: providerResult.mode,
      providerStatus: providerResult.status,
      providerReference: finalProviderReference,
      expectedAmount: amountDueNow,
      customerMessageSent: communication?.realMessageSent ?? false,
      customerMessageRecorded: communication?.status === "RECORDED",
      providerError: providerResult.error ?? null,
      ...actorAuditMeta(access.actor, access.traceId),
  };

  await supabaseAdmin.from("audit_logs").insert({
    action: auditAction,
    staff: "Payment Provider",
    order_id: orderId,
    organization_id: access.actor.organizationId,
    location_id: order.locationId ?? access.actor.locationId,
    meta: auditMeta,
  });

  await appendOperationalTimelineFromAudit({
    action: auditAction,
    staff: "Payment Provider",
    orderId,
    organizationId: access.actor.organizationId,
    locationId: order.locationId ?? access.actor.locationId,
    meta: auditMeta,
  });

  return NextResponse.json({
    ok: providerResult.ok,
    order: mapAndEnrichOrderFromDb(updatedOrder),
    paymentRequest: {
      id: paymentRequest.id,
      provider: providerResult.provider,
      providerReference: finalProviderReference,
      status: nextStatus,
      expectedAmount: amountDueNow,
      currency: "MYR",
      expiresAt: providerResult.expiresAt ?? expiresAt,
    },
    provider: {
      selected: providerResult.provider,
      mode: providerResult.mode,
      status: providerResult.status,
      paymentLinkCreated: Boolean(providerResult.paymentLink),
      error: providerResult.error ?? null,
    },
    communication,
    traceId: access.traceId,
  });
}
