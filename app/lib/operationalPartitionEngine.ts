import { getOperationalJobSnapshot } from "@/app/lib/infrastructure/operationalJobEngine";
import type { PersistentOperationalRuntimeSnapshot } from "@/app/lib/persistentOperationalRuntime";
import { getProviderHealthSnapshot } from "@/app/lib/providers/providerHealth";

export type OperationalPartitionState =
  | "PARTITION_STABLE"
  | "PARTITION_ELEVATED"
  | "PARTITION_REBALANCING"
  | "PARTITION_FAILOVER"
  | "PARTITION_DEGRADED";

export type OperationalExecutionPartition = {
  partitionId: string;
  organizationId: string;
  locationId: string | null;
  ownerWorkerId: string;
  state: OperationalPartitionState;
  stickyOwnershipKey: string;
  executionPressure: number;
  queueLoad: number;
  runtimeLatencyMs: number;
  providerDegraded: boolean;
  failoverCandidateWorkerId: string | null;
  replaySafeRecoveryKey: string;
  signalsUsed: string[];
};

function clamp(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function stableHash(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
}

function partitionId(organizationId: string, locationId?: string | null) {
  return `partition:${organizationId}:${locationId ?? "org"}`;
}

function workerForPartition(organizationId: string, locationId?: string | null) {
  return `worker-${stableHash(`${organizationId}:${locationId ?? "org"}`).slice(0, 8)}`;
}

function failoverWorkerForPartition(organizationId: string, locationId?: string | null) {
  return `worker-failover-${stableHash(`failover:${organizationId}:${locationId ?? "org"}`).slice(0, 8)}`;
}

function resolvePartitionState({
  pressure,
  providerDegraded,
  runtimeLatencyMs,
}: {
  pressure: number;
  providerDegraded: boolean;
  runtimeLatencyMs: number;
}): OperationalPartitionState {
  if (pressure >= 85 || runtimeLatencyMs >= 7000) return "PARTITION_FAILOVER";
  if (providerDegraded || pressure >= 65) return "PARTITION_DEGRADED";
  if (pressure >= 45 || runtimeLatencyMs >= 3500) return "PARTITION_REBALANCING";
  if (pressure >= 25) return "PARTITION_ELEVATED";
  return "PARTITION_STABLE";
}

export async function buildOperationalPartition({
  organizationId,
  locationId = null,
  runtime,
}: {
  organizationId: string;
  locationId?: string | null;
  runtime?: PersistentOperationalRuntimeSnapshot | null;
}): Promise<OperationalExecutionPartition> {
  const [jobs, providers] = await Promise.all([
    getOperationalJobSnapshot(organizationId),
    Promise.resolve(getProviderHealthSnapshot()),
  ]);
  const runtimeLatencyMs = runtime?.averageEngineLatencyMs ?? jobs.executionLatencyMs ?? 0;
  const providerDegraded = providers.degradedCount > 0 || Boolean(runtime?.providerDegraded);
  const executionPressure = clamp(
    jobs.queuePressure * 0.62 +
      (runtime?.runtimePressure ?? 0) * 0.28 +
      providers.degradedCount * 14 +
      Math.min(18, runtimeLatencyMs / 250)
  );
  const state = resolvePartitionState({
    pressure: executionPressure,
    providerDegraded,
    runtimeLatencyMs,
  });
  const ownerWorkerId = workerForPartition(organizationId, locationId);

  return {
    partitionId: partitionId(organizationId, locationId),
    organizationId,
    locationId,
    ownerWorkerId,
    state,
    stickyOwnershipKey: `${organizationId}:${locationId ?? "org"}:${ownerWorkerId}`,
    executionPressure,
    queueLoad: jobs.queuePressure,
    runtimeLatencyMs,
    providerDegraded,
    failoverCandidateWorkerId:
      state === "PARTITION_FAILOVER" || state === "PARTITION_DEGRADED"
        ? failoverWorkerForPartition(organizationId, locationId)
        : null,
    replaySafeRecoveryKey: `partition-recovery:${organizationId}:${locationId ?? "org"}:${new Date().toISOString().slice(0, 13)}`,
    signalsUsed: [
      `Queue pressure: ${jobs.queuePressure}/100.`,
      `Runtime latency: ${runtimeLatencyMs}ms.`,
      `Runtime pressure: ${runtime?.runtimePressure ?? 0}/100.`,
      providerDegraded ? "Provider degradation is affecting this partition." : "Provider health is stable for this partition.",
      `Worker owner: ${ownerWorkerId}.`,
    ],
  };
}

export async function buildOperationalPartitions({
  organizationId,
  locationIds = [],
  runtime,
}: {
  organizationId: string;
  locationIds?: Array<string | null>;
  runtime?: PersistentOperationalRuntimeSnapshot | null;
}) {
  const scopes = locationIds.length > 0 ? locationIds : [runtime?.locationId ?? null];
  const partitions = await Promise.all(
    scopes.map((locationId) => buildOperationalPartition({ organizationId, locationId, runtime }))
  );

  return partitions;
}
