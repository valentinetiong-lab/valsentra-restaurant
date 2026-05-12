import { calculateQueuePressure, type OperationalQueueJob } from "@/app/lib/infrastructure/operationalQueueSystem";

type AuditRow = Record<string, any>;

function clamp(value: number) {
  return Math.max(0, Math.min(Math.round(value), 100));
}

function includes(row: AuditRow, value: string) {
  return `${row.action ?? ""} ${JSON.stringify(row.meta ?? {})}`.toLowerCase().includes(value);
}

export type InfrastructureHealthSnapshot = {
  queuePressure: number;
  providerLatency: number;
  failedExecutions: number;
  retryStorms: number;
  communicationOutages: number;
  recoveryBottlenecks: number;
  operationalDegradation: number;
  infrastructureStabilityScore: number;
  providerHealth: "HEALTHY" | "DEGRADED" | "OUTAGE_RISK";
  degradedSystems: string[];
  retryActivity: number;
  organizationId: string;
  executionPartitions: Array<{ partitionKey: string; pressure: number }>;
  tenantSafeDiagnostics: string[];
};

export function buildInfrastructureHealthSnapshot({
  auditRows,
  queueJobs = [],
  organizationId = "org-default",
}: {
  auditRows: AuditRow[];
  queueJobs?: OperationalQueueJob[];
  organizationId?: string;
}): InfrastructureHealthSnapshot {
  const failedExecutions = auditRows.filter(
    (row) => includes(row, "failed") || row.meta?.communicationExecution?.ok === false || row.meta?.replyExecution?.ok === false
  ).length;
  const retryActivity = auditRows.filter((row) => includes(row, "retry") || row.meta?.retryTracking).length;
  const deadLetters = queueJobs.filter((job) => job.status === "DEAD_LETTERED").length;
  const communicationOutages = auditRows.filter(
    (row) => includes(row, "provider configuration") || includes(row, "outage") || row.meta?.providerStatus?.configured === false
  ).length;
  const recoveryBottlenecks = auditRows.filter(
    (row) => includes(row, "recovery") && (includes(row, "failed") || includes(row, "suppressed") || includes(row, "blocked"))
  ).length;
  const queuePressure = calculateQueuePressure(queueJobs);
  const providerLatency = clamp(
    auditRows.reduce((sum, row) => sum + Number(row.meta?.providerLatencyMs ?? row.meta?.deliveryLatencyMs ?? 0), 0) /
      Math.max(auditRows.filter((row) => row.meta?.providerLatencyMs || row.meta?.deliveryLatencyMs).length, 1) /
      50
  );
  const retryStorms = retryActivity >= 5 ? clamp(retryActivity * 10) : 0;
  const operationalDegradation = clamp(
    queuePressure * 0.22 +
      failedExecutions * 8 +
      retryStorms * 0.2 +
      communicationOutages * 10 +
      recoveryBottlenecks * 5 +
      deadLetters * 12
  );
  const infrastructureStabilityScore = clamp(100 - operationalDegradation);
  const providerHealth =
    communicationOutages > 0 || failedExecutions >= 8
      ? "OUTAGE_RISK"
      : failedExecutions > 0 || providerLatency >= 60
        ? "DEGRADED"
        : "HEALTHY";

  return {
    queuePressure,
    providerLatency,
    failedExecutions,
    retryStorms,
    communicationOutages,
    recoveryBottlenecks,
    operationalDegradation,
    infrastructureStabilityScore,
    providerHealth,
    degradedSystems: [
      ...(queuePressure >= 70 ? ["Operational queue pressure elevated."] : []),
      ...(failedExecutions > 0 ? ["Failed executions detected."] : []),
      ...(communicationOutages > 0 ? ["Communication provider outage risk detected."] : []),
      ...(recoveryBottlenecks > 0 ? ["Recovery bottlenecks detected."] : []),
    ],
    retryActivity,
    organizationId,
    executionPartitions: queueJobs.map((job) => ({
      partitionKey: job.partitionKey,
      pressure: calculateQueuePressure([job]),
    })),
    tenantSafeDiagnostics: [
      `Organization scope: ${organizationId}.`,
      "Diagnostics are derived from scoped audit metadata and do not expose provider secrets.",
      "Execution partitions are keyed by organization/order partition.",
    ],
  };
}
