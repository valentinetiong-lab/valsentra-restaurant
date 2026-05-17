import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/admin";
import { resolveAutonomousExecutionMode } from "@/app/lib/autonomousDecisionEngine";
import { type AutopilotMode } from "@/app/lib/autopilotMode";
import {
  orchestrateRecoveryCommunication,
  type RecoverySequenceDecision,
} from "@/app/lib/communicationOrchestrationEngine";
import { mapAndEnrichOrderFromDb } from "@/app/lib/domain/orderMapper";
import {
  getEventKeySet,
  persistOperationalEvent,
} from "@/app/lib/intelligence/operationalEventModel";
import { buildMultiLocationIntelligenceSnapshot } from "@/app/lib/intelligence/multiLocationIntelligenceEngine";
import { buildOperationalDigitalTwin } from "@/app/lib/operationalDigitalTwinEngine";
import {
  createOperationalMemorySnapshot,
  getAdaptiveDecisionContext,
} from "@/app/lib/operationalMemoryEngine";
import { resolveOperationalPolicy } from "@/app/lib/policyEngine";
import { executeRecoveryCommunication } from "@/app/lib/providers/communication/communicationExecutionService";
import { getWhatsAppProviderStatus } from "@/app/lib/providers/communication/whatsappProvider";
import { requireDevelopmentOnly } from "@/app/lib/security/environment";
import { blockWithSecurityAudit } from "@/app/lib/security/routeProtection";

export const dynamic = "force-dynamic";

const QUIET_HOUR_REASON = "Quiet hours suppress external outreach.";

type Diagnostics = {
  orderFound: boolean;
  orderId: string | null;
  phonePresent: boolean;
  normalizedRecipientMasked: string | null;
  sandboxJoined: boolean;
  twilioProviderConfigured: boolean;
  communicationProvider: string | null;
  selectedChannel: string | null;
  selectedStep: string | null;
  executionMode: string | null;
  suppressionReasons: string[];
  quietHourBypassed: boolean;
  fatigueBlocked: boolean;
  cooldownBlocked: boolean;
  duplicateBlocked: boolean;
  providerAttempted: boolean;
  providerStatus: string | null;
  providerMessageId: string | null;
  realMessageSent: boolean;
  auditEventWritten: boolean;
};

function cleanString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeRecipient(value: string) {
  const withoutPrefix = value.trim().replace(/^whatsapp:/i, "");
  const normalized = withoutPrefix.replace(/[^\d+]/g, "");
  if (!normalized) return withoutPrefix;
  if (normalized.startsWith("+")) return normalized;
  if (normalized.startsWith("00")) return `+${normalized.slice(2)}`;
  if (normalized.startsWith("60")) return `+${normalized}`;
  return normalized;
}

function maskRecipient(value: string) {
  const visible = normalizeRecipient(value);
  if (visible.length <= 4) return "****";
  return `${"*".repeat(Math.max(visible.length - 4, 4))}${visible.slice(-4)}`;
}

function baseDiagnostics(orderId: string | null, sandboxJoined: boolean): Diagnostics {
  const provider = getWhatsAppProviderStatus();
  return {
    orderFound: false,
    orderId,
    phonePresent: false,
    normalizedRecipientMasked: null,
    sandboxJoined,
    twilioProviderConfigured: provider.configured,
    communicationProvider: provider.communicationProvider,
    selectedChannel: null,
    selectedStep: null,
    executionMode: null,
    suppressionReasons: [],
    quietHourBypassed: false,
    fatigueBlocked: false,
    cooldownBlocked: false,
    duplicateBlocked: false,
    providerAttempted: false,
    providerStatus: null,
    providerMessageId: null,
    realMessageSent: false,
    auditEventWritten: false,
  };
}

function jsonError(error: string, status: number, diagnostics: Diagnostics) {
  return NextResponse.json({ ok: false, error, diagnostics }, { status });
}

function isDevelopmentOverrideEnabled() {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.DEV_AUTONOMOUS_TEST_OVERRIDE === "true"
  );
}

function isExplicitTestOrder(order: { id: string; notes?: string; protectionReason?: string }) {
  const marker = "DEV_AUTONOMOUS_TEST";
  return (
    order.id.startsWith("DEV-AUTO-WHATSAPP-") ||
    String(order.notes ?? "").includes(marker) ||
    String(order.protectionReason ?? "").includes(marker)
  );
}

function canPreferWhatsAppStep(decision: RecoverySequenceDecision) {
  return (
    decision.step !== "FRAUD_VERIFICATION" &&
    decision.step !== "OWNER_STAFF_INTERVENTION" &&
    decision.step !== "WAITLIST_REPLACEMENT_ACTIVATION"
  );
}

function preferWhatsAppDecision(decision: RecoverySequenceDecision): RecoverySequenceDecision {
  if (decision.channel === "WHATSAPP" || !canPreferWhatsAppStep(decision)) return decision;

  return {
    ...decision,
    channel: "WHATSAPP",
    step: decision.step === "REMINDER" ? "REMINDER" : "ESCALATION",
    message: {
      ...decision.message,
      channel: "WHATSAPP",
      to: decision.message.to === "operations" ? decision.orderId : decision.message.to,
      body:
        decision.step === "REMINDER"
          ? decision.message.body
          : decision.message.body.replace(/^Internal recovery: /, ""),
    },
  };
}

async function getAutopilotMode(): Promise<AutopilotMode> {
  const { data } = await supabaseAdmin
    .from("restaurant_settings")
    .select("autopilot_mode")
    .eq("id", 1)
    .single();

  const mode = data?.autopilot_mode;
  if (mode === "MANUAL" || mode === "SEMI_AUTO" || mode === "FULL_AUTO") return mode;
  return "SEMI_AUTO";
}

export async function POST(request: Request) {
  const guard = requireDevelopmentOnly("Development autonomous WhatsApp test route");
  if (!guard.ok) {
    return blockWithSecurityAudit({
      guard,
      request,
      route: "/api/communication/test-autonomous",
      action: "production_guard_violation",
    });
  }

  if (process.env.NODE_ENV === "production") {
    return jsonError(
      "Development autonomous test override is disabled in production.",
      403,
      baseDiagnostics(null, false)
    );
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return jsonError("Invalid JSON body.", 400, baseDiagnostics(null, false));
  }

  const orderId = cleanString((body as Record<string, unknown>).orderId);
  const sandboxJoined = (body as Record<string, unknown>).sandboxJoined === true;
  const diagnostics = baseDiagnostics(orderId || null, sandboxJoined);

  if (!isDevelopmentOverrideEnabled()) {
    return jsonError(
      "Development autonomous test override is not enabled. Set DEV_AUTONOMOUS_TEST_OVERRIDE=true outside production.",
      403,
      diagnostics
    );
  }

  if (!orderId) {
    return jsonError("orderId is required.", 400, diagnostics);
  }

  if (Array.isArray((body as Record<string, unknown>).orderId)) {
    return jsonError("Only one orderId is allowed.", 400, diagnostics);
  }

  if (!sandboxJoined) {
    return jsonError(
      "sandboxJoined must be true after the recipient phone has joined the Twilio WhatsApp sandbox.",
      400,
      diagnostics
    );
  }

  const [
    { data: orderRaw, error: orderError },
    { data: ordersRaw, error: ordersError },
    { data: auditRaw, error: auditError },
    { data: waitlistRaw, error: waitlistError },
  ] = await Promise.all([
    supabaseAdmin.from("orders").select("*").eq("id", orderId).single(),
    supabaseAdmin.from("orders").select("*").order("created_at", { ascending: false }),
    supabaseAdmin
      .from("audit_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500),
    supabaseAdmin.from("waitlist_leads").select("id").limit(200),
  ]);

  if (orderError || !orderRaw) {
    return jsonError(orderError?.message ?? "Order not found.", 404, diagnostics);
  }
  if (ordersError) return jsonError(ordersError.message, 500, diagnostics);
  if (auditError) return jsonError(auditError.message, 500, diagnostics);
  if (waitlistError) return jsonError(waitlistError.message, 500, diagnostics);

  const order = mapAndEnrichOrderFromDb(orderRaw);
  diagnostics.orderFound = true;
  diagnostics.phonePresent = Boolean(order.phone);
  diagnostics.normalizedRecipientMasked = order.phone ? maskRecipient(order.phone) : null;

  if (!order.id.startsWith("DEV-AUTO-WHATSAPP-")) {
    return jsonError("order id must start with DEV-AUTO-WHATSAPP-.", 403, diagnostics);
  }

  if (!isExplicitTestOrder(order)) {
    return jsonError("order is not marked as a development autonomous WhatsApp test order.", 403, diagnostics);
  }

  if (!order.phone) {
    return jsonError("phone is missing for the test order.", 400, diagnostics);
  }

  const providerStatus = getWhatsAppProviderStatus();
  diagnostics.twilioProviderConfigured = providerStatus.configured;
  diagnostics.communicationProvider = providerStatus.communicationProvider;
  if (!providerStatus.configured) {
    return jsonError("Twilio env is missing or COMMUNICATION_PROVIDER is not twilio.", 503, diagnostics);
  }

  const orders = (ordersRaw ?? []).map(mapAndEnrichOrderFromDb);
  const waitlistAvailability = waitlistRaw?.length ?? 0;
  const memory = createOperationalMemorySnapshot({ orders, auditRows: auditRaw ?? [] });
  const organization = buildMultiLocationIntelligenceSnapshot({ orders, auditRows: auditRaw ?? [] });
  const digitalTwin = buildOperationalDigitalTwin({
    orders,
    auditRows: auditRaw ?? [],
    memory,
    organization,
    waitlistCount: waitlistAvailability,
  });
  const learningContext = getAdaptiveDecisionContext({
    snapshot: memory,
    action: "SEND_REMINDER",
    locationId: order.locationId,
    customerKey: order.phone || order.customerName,
  });
  const policy = resolveOperationalPolicy({
    organizationId: order.organizationId,
    locationId: order.locationId,
    memory,
    learningContext,
    digitalTwin,
  });
  const orderAuditRows = (auditRaw ?? []).filter(
    (row) => String(row.order_id ?? row.orderId ?? "") === order.id
  );
  const originalDecision = orchestrateRecoveryCommunication({
    order,
    auditRows: orderAuditRows,
    memory,
    digitalTwin,
    policy,
    waitlistAvailability,
  });
  const decision = preferWhatsAppDecision(originalDecision);
  const autopilotMode = await getAutopilotMode();
  const executionMode = resolveAutonomousExecutionMode(autopilotMode);
  diagnostics.executionMode = executionMode;
  diagnostics.selectedChannel = decision.channel;
  diagnostics.selectedStep = decision.step;
  diagnostics.suppressionReasons = decision.suppressionReasons;
  diagnostics.fatigueBlocked = decision.suppressionReasons.some((reason) =>
    reason.toLowerCase().includes("fatigue")
  );
  diagnostics.cooldownBlocked = decision.suppressionReasons.some((reason) =>
    reason.toLowerCase().includes("cooldown")
  );

  if (executionMode !== "SAFE_AUTONOMOUS" && executionMode !== "FULL_AUTONOMOUS") {
    return jsonError(`Autonomous execution mode is ${executionMode}; test route will not send.`, 409, diagnostics);
  }

  if (decision.channel !== "WHATSAPP") {
    return jsonError("selected step is INTERNAL only; the test route will not force a customer message.", 409, diagnostics);
  }

  const nonQuietSuppressions = decision.suppressionReasons.filter(
    (reason) => reason !== QUIET_HOUR_REASON
  );
  diagnostics.quietHourBypassed = decision.suppressionReasons.includes(QUIET_HOUR_REASON);

  if (nonQuietSuppressions.length > 0) {
    return jsonError("Autonomous test blocked by non-quiet-hour safety guardrails.", 409, diagnostics);
  }

  const eventKey = `dev-autonomous-test:${order.id}`;
  const eventKeys = getEventKeySet(auditRaw ?? []);
  diagnostics.duplicateBlocked = eventKeys.has(eventKey);

  if (diagnostics.duplicateBlocked) {
    return jsonError("This explicit autonomous WhatsApp test has already been attempted for this order.", 409, diagnostics);
  }

  const adjustedDecision: RecoverySequenceDecision = {
    ...decision,
    shouldPrepareMessage: true,
    suppressed: false,
    responseState: "PREPARED",
    suppressionReasons: nonQuietSuppressions,
    message: {
      ...decision.message,
      channel: "WHATSAPP",
      to: order.phone,
    },
    explainability: [
      ...decision.explainability,
      ...(diagnostics.quietHourBypassed
        ? ["Development-only test override bypassed quiet-hour suppression for this explicitly flagged test order."]
        : []),
    ],
  };

  const execution = await executeRecoveryCommunication({
    decision: adjustedDecision,
    orderId: order.id,
    customerName: order.customerName,
    eventKey,
  });
  diagnostics.providerAttempted = true;
  diagnostics.providerStatus = execution.status;
  diagnostics.providerMessageId = execution.messageId ?? null;
  diagnostics.realMessageSent = execution.realMessageSent;

  const auditResult = await persistOperationalEvent({
    eventKey,
    category: "AUTONOMOUS_ACTION",
    severity: execution.realMessageSent ? "INFO" : "WARNING",
    action: "DEV_AUTONOMOUS_OVERRIDE_USED",
    staff: "Valsentra Development Test",
    orderId: order.id,
    organizationId: order.organizationId,
    locationId: order.locationId,
    locationName: order.locationName,
    title: execution.realMessageSent
      ? "Development autonomous WhatsApp test sent"
      : "Development autonomous WhatsApp test attempted",
    summary: execution.realMessageSent
      ? "One explicit development-only autonomous WhatsApp test was sent through the normal provider path."
      : "One explicit development-only autonomous WhatsApp test was attempted but did not send.",
    reasoning: adjustedDecision.explainability,
    recommendedAction: "Confirm sandbox delivery, then remove or stop using the flagged test order.",
    confidence: adjustedDecision.recoveryConfidence,
    meta: {
      communicationOutcome: execution.realMessageSent ? "SENT" : "FAILED",
      diagnostics,
      devAutonomousOverride: {
        enabled: true,
        quietHourBypassed: diagnostics.quietHourBypassed,
        originalSuppressionReasons: decision.suppressionReasons,
        remainingSuppressionReasons: nonQuietSuppressions,
        sandboxJoinedConfirmed: true,
        cannotMassSend: true,
      },
      communicationOrchestration: adjustedDecision,
      communicationExecution: {
        attempted: execution.attempted,
        provider: execution.provider,
        providerMode: execution.mode,
        status: execution.status,
        ok: execution.ok,
        messageId: execution.messageId ?? null,
        error: execution.error ?? null,
        realMessageSent: execution.realMessageSent,
        maskedRecipient: execution.maskedRecipient,
        attemptedAt: execution.attemptedAt,
        providerStatus: execution.providerStatus,
      },
      maskedRecipient: maskRecipient(order.phone),
    },
  });
  diagnostics.auditEventWritten = auditResult.ok;

  return NextResponse.json(
    {
      ok: execution.ok,
      error: execution.ok ? null : execution.error ?? "Provider send failed.",
      diagnostics,
    },
    { status: execution.ok ? 200 : 502 }
  );
}
