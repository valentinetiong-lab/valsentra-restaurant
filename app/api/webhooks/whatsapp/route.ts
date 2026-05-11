import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/admin";

function getPayloadSummary(payload: Record<string, unknown>) {
  const messageId =
    payload.MessageSid ??
    payload.SmsSid ??
    payload.messageId ??
    payload.id ??
    "unknown";
  const from = payload.From ?? payload.from ?? null;
  const body = payload.Body ?? payload.body ?? null;
  const status = payload.MessageStatus ?? payload.SmsStatus ?? payload.status ?? null;

  return { messageId, from, body, status };
}

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") ?? "";
    const payload = contentType.includes("application/json")
      ? await request.json()
      : contentType.includes("form")
      ? await request.formData().then((formData) => Object.fromEntries(formData.entries()))
      : await request.text().then((text) => ({ rawBody: text }));

    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return NextResponse.json({ error: "Invalid webhook payload." }, { status: 400 });
    }

    const summary = getPayloadSummary(payload as Record<string, unknown>);

    // Provider-ready placeholder: accepts Twilio/Meta-style delivery or reply payloads,
    // but does not assume a specific provider contract until live integration is enabled.
    await supabaseAdmin.from("audit_logs").insert({
      action: "WhatsApp webhook received",
      staff: "Valsentra Communication Webhook",
      order_id: "COMMUNICATION",
      meta: {
        operationalEvent: true,
        category: "AUTONOMOUS_ACTION",
        severity: "INFO",
        title: "WhatsApp webhook captured",
        summary: `Webhook payload received for message ${String(summary.messageId)}.`,
        providerReady: true,
        webhookType: summary.status ? "DELIVERY_STATUS" : "INBOUND_OR_REPLY",
        messageId: summary.messageId,
        from: summary.from,
        body: summary.body,
        status: summary.status,
        rawPayload: payload,
      },
    });

    return NextResponse.json({
      ok: true,
      recorded: true,
      providerReady: true,
      messageId: summary.messageId,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message ?? "Failed to process WhatsApp webhook." },
      { status: 500 }
    );
  }
}
