import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/admin";
import { createWhatsAppProvider } from "@/app/lib/providers/communication/whatsappProvider";
import type { CommunicationSendInput } from "@/app/lib/providers/communication/communicationProviderTypes";

function cleanString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function maskRecipient(value: string) {
  const visible = value.replace(/^whatsapp:/, "");
  if (visible.length <= 4) return "****";
  return `${"*".repeat(Math.max(visible.length - 4, 4))}${visible.slice(-4)}`;
}

function validateSandboxInput(body: Record<string, unknown>): CommunicationSendInput | { error: string } {
  const to = cleanString(body.to);
  const message = cleanString(body.message);
  const orderId = cleanString(body.orderId);
  const customerName = cleanString(body.customerName);
  const metadata =
    body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)
      ? (body.metadata as Record<string, unknown>)
      : {};

  if (!to) {
    return { error: "to is required. Use a WhatsApp sandbox-approved recipient number." };
  }

  if (!message) {
    return { error: "message is required." };
  }

  return {
    channel: "WHATSAPP",
    to,
    message,
    orderId: orderId || "WHATSAPP_SANDBOX_TEST",
    customerName: customerName || undefined,
    metadata: {
      ...metadata,
      sandboxTest: true,
      source: "development-only-test-endpoint",
    },
  };
}

async function writeSandboxAudit(input: CommunicationSendInput, result: {
  ok: boolean;
  provider: string;
  mode: string;
  status: string;
  messageId?: string;
  error?: string;
}) {
  await supabaseAdmin.from("audit_logs").insert({
    action: result.ok
      ? "Development WhatsApp sandbox test sent"
      : "Development WhatsApp sandbox test failed",
    staff: "Valsentra Communication Test",
    order_id: input.orderId ?? "WHATSAPP_SANDBOX_TEST",
    meta: {
      operationalEvent: true,
      category: "AUTONOMOUS_ACTION",
      severity: result.ok ? "INFO" : "WARNING",
      title: result.ok
        ? "WhatsApp sandbox test sent"
        : "WhatsApp sandbox test failed",
      summary: result.ok
        ? "Development-only WhatsApp sandbox message was sent through the provider adapter."
        : "Development-only WhatsApp sandbox message failed before or during provider send.",
      provider: result.provider,
      providerMode: result.mode,
      providerStatus: result.status,
      providerMessageId: result.messageId ?? null,
      providerError: result.error ?? null,
      channel: input.channel,
      maskedRecipient: maskRecipient(input.to),
      orderId: input.orderId ?? null,
      customerName: input.customerName ?? null,
      sandboxTest: true,
      realMessageSent: result.ok && result.mode === "LIVE" && result.status === "SENT",
    },
  });
}

export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { ok: false, error: "WhatsApp sandbox test endpoint is disabled in production." },
      { status: 403 }
    );
  }

  try {
    const body = await request.json().catch(() => null);

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
    }

    const input = validateSandboxInput(body as Record<string, unknown>);

    if ("error" in input) {
      return NextResponse.json({ ok: false, error: input.error }, { status: 400 });
    }

    const provider = createWhatsAppProvider();

    if (!provider.canSend(input)) {
      const result = {
        ok: false,
        provider: provider.name,
        mode: provider.mode,
        status: "SUPPRESSED",
        error:
          "Live WhatsApp provider is not configured. Set COMMUNICATION_PROVIDER=twilio and Twilio sandbox credentials before running this test.",
      };
      await writeSandboxAudit(input, result);

      return NextResponse.json(result, { status: 503 });
    }

    const result = await provider.send(input);
    await writeSandboxAudit(input, result);

    console.info("WhatsApp sandbox test completed", {
      ok: result.ok,
      provider: result.provider,
      status: result.status,
      orderId: input.orderId,
    });

    return NextResponse.json({
      ok: result.ok,
      provider: result.provider,
      mode: result.mode,
      status: result.status,
      messageId: result.messageId ?? null,
      error: result.error ?? null,
      realMessageSent: result.ok && result.mode === "LIVE" && result.status === "SENT",
    }, { status: result.ok ? 200 : 502 });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message ?? "WhatsApp sandbox test failed." },
      { status: 500 }
    );
  }
}
