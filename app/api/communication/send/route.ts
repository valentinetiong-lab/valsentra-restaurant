import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/admin";
import { createInternalCommunicationProvider } from "@/app/lib/providers/communication/internalProvider";
import { createWhatsAppProvider } from "@/app/lib/providers/communication/whatsappProvider";
import type {
  CommunicationChannel,
  CommunicationProvider,
  CommunicationProviderResult,
  CommunicationSendInput,
} from "@/app/lib/providers/communication/communicationProviderTypes";

const CHANNELS: CommunicationChannel[] = ["WHATSAPP", "SMS", "EMAIL", "INTERNAL"];

function isChannel(value: unknown): value is CommunicationChannel {
  return typeof value === "string" && CHANNELS.includes(value as CommunicationChannel);
}

function cleanString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function maskRecipient(value: string) {
  const normalized = value.replace(/^whatsapp:/, "");
  if (normalized.length <= 4) return "****";
  return `${"*".repeat(Math.max(normalized.length - 4, 4))}${normalized.slice(-4)}`;
}

function validateInput(body: Record<string, unknown>): CommunicationSendInput | { error: string } {
  const channel = body.channel;
  const to = cleanString(body.to);
  const message = cleanString(body.message);
  const orderId = cleanString(body.orderId);
  const customerName = cleanString(body.customerName);
  const metadata =
    body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)
      ? (body.metadata as Record<string, unknown>)
      : {};

  if (!isChannel(channel)) {
    return { error: "channel must be WHATSAPP, SMS, EMAIL, or INTERNAL." };
  }

  if (!to) {
    return { error: "to is required." };
  }

  if (!message) {
    return { error: "message is required." };
  }

  return {
    channel,
    to,
    message,
    orderId: orderId || undefined,
    customerName: customerName || undefined,
    metadata,
  };
}

function selectProvider(input: CommunicationSendInput): CommunicationProvider {
  const whatsappProvider = createWhatsAppProvider();

  if (input.channel === "WHATSAPP" && whatsappProvider.canSend(input)) {
    return whatsappProvider;
  }

  return createInternalCommunicationProvider();
}

async function writeCommunicationAudit(
  input: CommunicationSendInput,
  result: CommunicationProviderResult
) {
  const orderId = input.orderId ?? "COMMUNICATION";

  await supabaseAdmin.from("audit_logs").insert({
    action:
      result.mode === "LIVE"
        ? `Communication sent via ${result.provider}`
        : `Communication prepared via ${result.provider}`,
    staff: "Valsentra Communication Provider",
    order_id: orderId,
    meta: {
      operationalEvent: true,
      category: "AUTONOMOUS_ACTION",
      severity: result.ok ? "INFO" : "WARNING",
      title:
        result.mode === "LIVE"
          ? "Provider communication sent"
          : "Provider-ready communication recorded",
      summary:
        result.mode === "LIVE"
          ? `${input.channel} message sent for ${orderId}.`
          : `${input.channel} message recorded for ${orderId}; no real customer message was sent.`,
      channel: input.channel,
      to: maskRecipient(input.to),
      orderId: input.orderId ?? null,
      customerName: input.customerName ?? null,
      provider: result.provider,
      providerMode: result.mode,
      providerStatus: result.status,
      providerMessageId: result.messageId ?? null,
      providerError: result.error ?? null,
      communicationMetadata: input.metadata ?? {},
      providerMetadata: result.metadata ?? {},
      realMessageSent: result.mode === "LIVE" && result.status === "SENT",
    },
  });
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }

    const input = validateInput(body as Record<string, unknown>);

    if ("error" in input) {
      return NextResponse.json({ error: input.error }, { status: 400 });
    }

    const provider = selectProvider(input);
    const result = await provider.send(input);
    await writeCommunicationAudit(input, result);

    return NextResponse.json({
      ...result,
      liveSendingEnabled: result.mode === "LIVE",
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message ?? "Failed to send communication." },
      { status: 500 }
    );
  }
}
