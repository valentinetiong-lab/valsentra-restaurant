import { NextResponse } from "next/server";
import { getOperationalJobSnapshot } from "@/app/lib/infrastructure/operationalJobEngine";
import { getProviderHealthSnapshot } from "@/app/lib/providers/providerHealth";
import { validateProductionEnvironment } from "@/app/lib/security/environment";
import { requireRouteRole } from "@/app/lib/security/routeProtection";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const access = await requireRouteRole({
    request,
    route: "/api/operational/health",
    allowedRoles: ["owner", "manager", "admin", "internal"],
  });
  if (!access.ok) return access.response;

  let environmentReady = true;
  let environmentIssue: string | null = null;
  try {
    validateProductionEnvironment();
  } catch (error) {
    environmentReady = false;
    environmentIssue =
      error instanceof Error ? error.message : "Environment validation failed.";
  }

  const [jobs, providers] = await Promise.all([
    getOperationalJobSnapshot(access.actor.organizationId),
    Promise.resolve(getProviderHealthSnapshot()),
  ]);
  const { data: whatsappRows } = await import("@/app/lib/admin").then(({ supabaseAdmin }) =>
    supabaseAdmin
      .from("audit_logs")
      .select("meta, created_at")
      .eq("organization_id", access.actor.organizationId)
      .in("meta->>operationalEvent", ["WHATSAPP_DELIVERY_STATUS", "AUTONOMOUS_OPERATIONAL_EXECUTION"])
      .order("created_at", { ascending: false })
      .limit(100)
  );
  const whatsappDelivery = {
    sent: (whatsappRows ?? []).filter((row) => row.meta?.deliveryState === "SENT" || row.meta?.deliveryState === "QUEUED").length,
    delivered: (whatsappRows ?? []).filter((row) => row.meta?.deliveryState === "DELIVERED").length,
    read: (whatsappRows ?? []).filter((row) => row.meta?.deliveryState === "READ").length,
    failed: (whatsappRows ?? []).filter((row) => row.meta?.deliveryState === "FAILED").length,
    retrying: (whatsappRows ?? []).filter((row) => row.meta?.deliveryState === "RETRYING" || row.meta?.retryState === "RETRYABLE").length,
    suppressed: (whatsappRows ?? []).filter((row) => row.meta?.actionType === "PAUSE_NON_CRITICAL_REMINDERS" || row.meta?.deliveryState === "SUPPRESSED").length,
  };

  const issues = [
    jobs.deadLetterJobs > 0
      ? `${jobs.deadLetterJobs} background task${jobs.deadLetterJobs === 1 ? "" : "s"} need review.`
      : "",
    jobs.delayedJobs > 0
      ? `${jobs.delayedJobs} task${jobs.delayedJobs === 1 ? " is" : "s are"} delayed.`
      : "",
    jobs.providerFailures > 0
      ? "Some provider attempts failed and may retry."
      : "",
    whatsappDelivery.failed > 0
      ? `${whatsappDelivery.failed} WhatsApp message${whatsappDelivery.failed === 1 ? "" : "s"} need retry attention.`
      : "",
    whatsappDelivery.suppressed > 0
      ? "Some non-critical WhatsApp reminders were reduced during rush pressure."
      : "",
    providers.liveCommunicationChannels.length === 0
      ? "No live customer messaging channel is enabled."
      : "",
    !providers.livePaymentsEnabled
      ? "Live payment provider is not enabled yet."
      : "",
    environmentIssue,
  ].filter(Boolean);

  return NextResponse.json({
    ok: true,
    organizationId: access.actor.organizationId,
    locationId: access.actor.locationId,
    status:
      jobs.deadLetterJobs > 0 || !environmentReady
        ? "NEEDS_REVIEW"
        : jobs.queuePressure >= 55 || jobs.delayedJobs > 0
          ? "WATCH"
          : "READY",
    ownerSummary:
      issues.length > 0
        ? issues.slice(0, 3).join(" ")
        : "Core operational systems are ready.",
    environmentReady,
    issues,
    jobs: {
      queuePressure: jobs.queuePressure,
      workerHealth: jobs.workerHealth,
      delayedJobs: jobs.delayedJobs,
      retries: jobs.retries,
      deadLetterJobs: jobs.deadLetterJobs,
      providerFailures: jobs.providerFailures,
    },
    providers,
    whatsappDelivery,
  });
}
