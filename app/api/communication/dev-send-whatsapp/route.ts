import { NextResponse } from "next/server";
import { executeDirectCommunication } from "@/app/lib/providers/communication/communicationExecutionService";
import { getWhatsAppProviderStatus } from "@/app/lib/providers/communication/whatsappProvider";
import type { CommunicationSendInput } from "@/app/lib/providers/communication/communicationProviderTypes";

export const dynamic = "force-dynamic";

const REQUIRED_HEADER = "x-dev-whatsapp-test";
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 3;
const PROVIDER_TIMEOUT_MS = 15_000;

const rateLimitState = new Map<string, { count: number; windowStartedAt: number }>();

function cleanString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeWhatsAppRecipient(value: string) {
  const stripped = value.trim().replace(/^whatsapp:/i, "").replace(/[^\d+]/g, "");

  if (!stripped) return "";
  if (stripped.startsWith("+")) return stripped;
  if (stripped.startsWith("00")) return `+${stripped.slice(2)}`;
  if (stripped.startsWith("60")) return `+${stripped}`;
  if (stripped.startsWith("0")) return `+6${stripped}`;

  return `+${stripped}`;
}

function isSandboxCompatibleRecipient(value: string) {
  return /^\+[1-9]\d{7,14}$/.test(value);
}

function getClientKey(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwardedFor || "local-dev";
}

function checkRateLimit(clientKey: string) {
  const now = Date.now();
  const current = rateLimitState.get(clientKey);

  if (!current || now - current.windowStartedAt > RATE_LIMIT_WINDOW_MS) {
    rateLimitState.set(clientKey, { count: 1, windowStartedAt: now });
    return { ok: true, remaining: RATE_LIMIT_MAX_REQUESTS - 1 };
  }

  if (current.count >= RATE_LIMIT_MAX_REQUESTS) {
    return {
      ok: false,
      remaining: 0,
      retryAfterSeconds: Math.ceil(
        (RATE_LIMIT_WINDOW_MS - (now - current.windowStartedAt)) / 1000
      ),
    };
  }

  current.count += 1;
  return { ok: true, remaining: RATE_LIMIT_MAX_REQUESTS - current.count };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Provider execution timed out after ${timeoutMs / 1000} seconds.`));
    }, timeoutMs);

    promise
      .then(resolve)
      .catch(reject)
      .finally(() => clearTimeout(timeout));
  });
}

export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      {
        ok: false,
        error: "Development WhatsApp send endpoint is disabled in production.",
      },
      { status: 403 }
    );
  }

  if (request.headers.get(REQUIRED_HEADER) !== "true") {
    return NextResponse.json(
      {
        ok: false,
        error: `Missing required ${REQUIRED_HEADER}: true header.`,
      },
      { status: 403 }
    );
  }

  const rateLimit = checkRateLimit(getClientKey(request));
  if (!rateLimit.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: "Development WhatsApp test rate limit exceeded.",
        retryAfterSeconds: rateLimit.retryAfterSeconds,
      },
      { status: 429 }
    );
  }

  const body = await request.json().catch(() => null);

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const phone = cleanString((body as Record<string, unknown>).phone);
  const message = cleanString((body as Record<string, unknown>).message);
  const normalizedRecipient = normalizeWhatsAppRecipient(phone);
  const providerStatus = getWhatsAppProviderStatus();

  if (!phone) {
    return NextResponse.json({ ok: false, error: "phone is required." }, { status: 400 });
  }

  if (!isSandboxCompatibleRecipient(normalizedRecipient)) {
    return NextResponse.json(
      {
        ok: false,
        error: "phone must normalize to an E.164 WhatsApp sandbox-compatible number, e.g. +60123456789.",
        normalizedRecipient,
      },
      { status: 400 }
    );
  }

  if (!message) {
    return NextResponse.json({ ok: false, error: "message is required." }, { status: 400 });
  }

  if (!providerStatus.configured || providerStatus.communicationProvider !== "twilio") {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Twilio WhatsApp is not configured for live provider verification. Set COMMUNICATION_PROVIDER=twilio and Twilio sandbox credentials.",
        providerSelected: providerStatus.communicationProvider,
        providerAttempted: false,
        providerStatus,
        normalizedRecipient,
      },
      { status: 503 }
    );
  }

  const input: CommunicationSendInput = {
    channel: "WHATSAPP",
    to: normalizedRecipient,
    message,
    orderId: "DEV_WHATSAPP_PROVIDER_E2E",
    customerName: "Development WhatsApp Test",
    metadata: {
      source: "dev-send-whatsapp",
      infrastructureVerificationOnly: true,
      orchestrationBypassed: true,
    },
  };

  let timedOut = false;

  try {
    const execution = await withTimeout(
      executeDirectCommunication(input),
      PROVIDER_TIMEOUT_MS
    );
    const twilioMetadata =
      execution.providerMetadata &&
      typeof execution.providerMetadata === "object" &&
      "twilio" in execution.providerMetadata
        ? execution.providerMetadata.twilio
        : null;

    return NextResponse.json(
      {
        ok: execution.ok,
        providerSelected: execution.provider,
        providerAttempted: execution.attempted,
        mode: execution.mode,
        status: execution.status,
        success: execution.ok,
        timeout: timedOut,
        normalizedRecipient,
        twilioSid: execution.messageId ?? null,
        providerMessageId: execution.messageId ?? null,
        realMessageSent: execution.realMessageSent,
        error: execution.error ?? null,
        providerResponseMetadata: execution.providerMetadata ?? null,
        twilioResponseMetadata: twilioMetadata,
        providerStatus: execution.providerStatus,
        rateLimitRemaining: rateLimit.remaining,
      },
      { status: execution.ok ? 200 : 502 }
    );
  } catch (error: any) {
    timedOut = error?.message?.includes("timed out") ?? false;

    return NextResponse.json(
      {
        ok: false,
        providerSelected: "twilio-whatsapp",
        providerAttempted: true,
        success: false,
        timeout: timedOut,
        normalizedRecipient,
        twilioSid: null,
        realMessageSent: false,
        error: error?.message ?? "Development WhatsApp provider test failed.",
        providerResponseMetadata: null,
        providerStatus,
        rateLimitRemaining: rateLimit.remaining,
      },
      { status: timedOut ? 504 : 500 }
    );
  }
}
