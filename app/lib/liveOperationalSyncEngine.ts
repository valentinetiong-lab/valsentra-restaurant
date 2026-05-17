import { subscribeOperationalCommands } from "@/app/lib/operationalCommandBus";
import { buildOperationalPartition } from "@/app/lib/operationalPartitionEngine";
import { resolveOperationalPolicyState } from "@/app/lib/operationalPolicyOrchestrator";

export type LiveOperationalSyncSnapshot = {
  organizationId: string;
  locationId: string | null;
  syncId: string;
  replaySafeFrom: string | null;
  generatedAt: string;
  throttled: boolean;
  throttleWindowMs: number;
  changed: boolean;
  changedFields: string[];
  stateVersion: string;
  tenantScope: {
    organizationId: string;
    locationId: string | null;
  };
  dashboardState: {
    policyState: string;
    recoveryPacingState: string;
    providerDegraded: boolean;
    activeSuppressions: string[];
    activeThrottles: string[];
    latestCommandAt: string | null;
    commandCount: number;
    workerPartitionState: string;
    workerOwner: string;
  };
};

const LAST_SYNC = new Map<
  string,
  {
    hash: string;
    generatedAt: number;
    syncId: string;
  }
>();

function keyFor(organizationId: string, locationId?: string | null) {
  return `${organizationId}:${locationId ?? "org"}`;
}

function stableHash(value: unknown) {
  let hash = 0;
  const input = JSON.stringify(value);
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 31 + input.charCodeAt(index)) >>> 0;
  }
  return hash.toString(16);
}

function buildSyncId(organizationId: string, locationId: string | null, hash: string) {
  return [
    "sync",
    organizationId,
    locationId ?? "org",
    new Date().toISOString().slice(0, 19),
    hash,
  ].join(":");
}

function changedFields(previous: Record<string, unknown> | null, next: Record<string, unknown>) {
  if (!previous) return Object.keys(next);
  return Object.keys(next).filter((key) => JSON.stringify(previous[key]) !== JSON.stringify(next[key]));
}

export async function buildLiveOperationalSyncSnapshot({
  organizationId,
  locationId = null,
  throttleWindowMs = 10_000,
}: {
  organizationId: string;
  locationId?: string | null;
  throttleWindowMs?: number;
}): Promise<LiveOperationalSyncSnapshot> {
  const [policy, commandResult, partition] = await Promise.all([
    resolveOperationalPolicyState({ organizationId, locationId }),
    subscribeOperationalCommands({ eventType: "ALL", organizationId, locationId, limit: 40 }),
    buildOperationalPartition({ organizationId, locationId }),
  ]);
  const commands = commandResult.ok ? commandResult.events : [];
  const latestCommandAt = commands[0]?.timestamp ?? null;
  const dashboardState = {
    policyState: policy.activePolicyState,
    recoveryPacingState: policy.recoveryPacingState,
    providerDegraded: policy.providerDegraded,
    activeSuppressions: policy.activeSuppressions,
    activeThrottles: policy.activeThrottles,
    latestCommandAt,
    commandCount: commands.length,
    workerPartitionState: partition.state,
    workerOwner: partition.ownerWorkerId,
  };
  const hash = stableHash(dashboardState);
  const key = keyFor(organizationId, locationId);
  const previous = LAST_SYNC.get(key);
  const now = Date.now();
  const throttled = Boolean(previous && previous.hash === hash && now - previous.generatedAt < throttleWindowMs);
  const syncId = throttled && previous ? previous.syncId : buildSyncId(organizationId, locationId, hash);
  const changed = !previous || previous.hash !== hash;
  const previousState = previous?.hash === hash ? dashboardState : null;

  LAST_SYNC.set(key, {
    hash,
    generatedAt: now,
    syncId,
  });

  return {
    organizationId,
    locationId,
    syncId,
    replaySafeFrom: latestCommandAt,
    generatedAt: new Date().toISOString(),
    throttled,
    throttleWindowMs,
    changed,
    changedFields: changedFields(previousState, dashboardState),
    stateVersion: hash,
    tenantScope: {
      organizationId,
      locationId,
    },
    dashboardState,
  };
}
