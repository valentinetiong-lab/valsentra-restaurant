import {
  buildOperationalPartition,
  type OperationalExecutionPartition,
} from "@/app/lib/operationalPartitionEngine";
import {
  publishOperationalCommand,
  subscribeOperationalCommands,
} from "@/app/lib/operationalCommandBus";
import {
  appendOperationalTimelineEvent,
  type OperationalTimelineSeverity,
} from "@/app/lib/operationalTimelineMemoryEngine";
import type { PersistentOperationalRuntimeSnapshot } from "@/app/lib/persistentOperationalRuntime";

export type DistributedWorkerState =
  | "WORKER_HEALTHY"
  | "WORKER_ELEVATED"
  | "WORKER_DEGRADED"
  | "WORKER_STALLED"
  | "WORKER_RECOVERING"
  | "WORKER_FAILED"
  | "WORKER_DRAINING";

export type MeshWorkerLease = {
  workerId: string;
  organizationId: string;
  locationId: string | null;
  state: DistributedWorkerState;
  leaseId: string;
  partitionId: string;
  ownedSince: string;
  heartbeatAt: string;
  load: number;
  executionPressure: number;
  draining: boolean;
  failoverTarget: string | null;
};

export type DistributedOperationalWorkerMeshSnapshot = {
  organizationId: string;
  locationId: string | null;
  meshState: "MESH_HEALTHY" | "MESH_ELEVATED" | "MESH_DEGRADED" | "MESH_FAILOVER";
  meshPressure: number;
  activeWorkers: MeshWorkerLease[];
  degradedWorkers: MeshWorkerLease[];
  partitions: OperationalExecutionPartition[];
  overloadedLocations: Array<{ locationId: string | null; pressure: number; state: string }>;
  failoverState: "IDLE" | "READY" | "ACTIVE";
  queueCongestion: number;
  recoveringWorkers: MeshWorkerLease[];
  ownerSummary: string;
  staffGuidance: string[];
  generatedAt: string;
};

function clamp(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function bucket(minutes = 1) {
  return String(Math.floor(Date.now() / (minutes * 60_000)));
}

function workerStateForPartition(partition: OperationalExecutionPartition): DistributedWorkerState {
  if (partition.state === "PARTITION_FAILOVER") return "WORKER_STALLED";
  if (partition.state === "PARTITION_DEGRADED") return "WORKER_DEGRADED";
  if (partition.state === "PARTITION_REBALANCING") return "WORKER_ELEVATED";
  if (partition.state === "PARTITION_ELEVATED") return "WORKER_ELEVATED";
  return "WORKER_HEALTHY";
}

function meshStateFor(workers: MeshWorkerLease[]): DistributedOperationalWorkerMeshSnapshot["meshState"] {
  if (workers.some((worker) => worker.state === "WORKER_STALLED" || worker.state === "WORKER_FAILED")) return "MESH_FAILOVER";
  if (workers.some((worker) => worker.state === "WORKER_DEGRADED")) return "MESH_DEGRADED";
  if (workers.some((worker) => worker.state === "WORKER_ELEVATED" || worker.load >= 55)) return "MESH_ELEVATED";
  return "MESH_HEALTHY";
}

function summaryFor(state: DistributedOperationalWorkerMeshSnapshot["meshState"]) {
  if (state === "MESH_FAILOVER") return "Worker failover is ready. Valsentra is isolating overloaded execution safely.";
  if (state === "MESH_DEGRADED") return "Worker mesh is degraded. Critical safety paths remain protected while load is isolated.";
  if (state === "MESH_ELEVATED") return "Worker mesh load is elevated. Execution ownership is being watched closely.";
  return "Worker mesh is healthy.";
}

function guidanceFor(state: DistributedOperationalWorkerMeshSnapshot["meshState"]) {
  if (state === "MESH_FAILOVER") return ["System rerouting work", "Manager visibility", "Critical work first"];
  if (state === "MESH_DEGRADED") return ["System slower", "Retries protected", "Watch payments"];
  if (state === "MESH_ELEVATED") return ["Load elevated", "System watching", "Normal service safe"];
  return ["System healthy"];
}

async function writeMeshTimeline({
  organizationId,
  locationId,
  eventType,
  summary,
  severity,
  metadata,
}: {
  organizationId: string;
  locationId?: string | null;
  eventType:
    | "WORKER_REGISTERED"
    | "WORKER_HEARTBEAT"
    | "WORKER_OVERLOADED"
    | "WORKER_FAILOVER_STARTED"
    | "EXECUTION_REASSIGNED"
    | "PARTITION_REBALANCED"
    | "MESH_DEGRADED"
    | "MESH_RECOVERED";
  summary: string;
  severity: OperationalTimelineSeverity;
  metadata: Record<string, unknown>;
}) {
  const idempotencyKey = `mesh:${organizationId}:${locationId ?? "org"}:${eventType}:${bucket(1)}`;
  await appendOperationalTimelineEvent({
    organizationId,
    locationId,
    orderId: "OPERATION",
    actorSource: "Distributed Worker Mesh",
    eventType,
    summary,
    severity,
    category: "WORKER",
    correlationId: idempotencyKey,
    idempotencyKey: `timeline:${idempotencyKey}`,
    metadata,
  });
  await publishOperationalCommand({
    eventType,
    organizationId,
    locationId,
    source: "Distributed Worker Mesh",
    summary,
    severity,
    correlationId: idempotencyKey,
    payload: metadata,
  });
}

export async function registerMeshWorker({
  organizationId,
  locationId = null,
  workerId,
  runtime,
}: {
  organizationId: string;
  locationId?: string | null;
  workerId?: string | null;
  runtime?: PersistentOperationalRuntimeSnapshot | null;
}) {
  const partition = await buildOperationalPartition({ organizationId, locationId, runtime });
  const resolvedWorkerId = workerId ?? partition.ownerWorkerId;
  const heartbeatAt = new Date().toISOString();
  const lease: MeshWorkerLease = {
    workerId: resolvedWorkerId,
    organizationId,
    locationId,
    state: workerStateForPartition(partition),
    leaseId: `lease:${partition.partitionId}:${resolvedWorkerId}:${heartbeatAt.slice(0, 16)}`,
    partitionId: partition.partitionId,
    ownedSince: heartbeatAt,
    heartbeatAt,
    load: partition.executionPressure,
    executionPressure: partition.executionPressure,
    draining: partition.state === "PARTITION_FAILOVER",
    failoverTarget: partition.failoverCandidateWorkerId,
  };

  const meta = {
    operationalEvent: "DISTRIBUTED_WORKER_MESH",
    meshEvent: "WORKER_REGISTERED",
    workerId: resolvedWorkerId,
    lease,
    partition,
    replaySafe: true,
    reversible: true,
  };

  await writeMeshTimeline({
    organizationId,
    locationId,
    eventType: "WORKER_REGISTERED",
    summary: `Worker registered for ${locationId ?? "organization"} execution partition.`,
    severity: "INFO",
    metadata: meta,
  });

  return lease;
}

export async function heartbeatMeshWorker({
  organizationId,
  locationId = null,
  workerId,
  runtime,
}: {
  organizationId: string;
  locationId?: string | null;
  workerId?: string | null;
  runtime?: PersistentOperationalRuntimeSnapshot | null;
}) {
  const partition = await buildOperationalPartition({ organizationId, locationId, runtime });
  const resolvedWorkerId = workerId ?? partition.ownerWorkerId;
  const lease: MeshWorkerLease = {
    workerId: resolvedWorkerId,
    organizationId,
    locationId,
    state: workerStateForPartition(partition),
    leaseId: `lease:${partition.partitionId}:${resolvedWorkerId}`,
    partitionId: partition.partitionId,
    ownedSince: new Date().toISOString(),
    heartbeatAt: new Date().toISOString(),
    load: partition.executionPressure,
    executionPressure: partition.executionPressure,
    draining: partition.state === "PARTITION_FAILOVER",
    failoverTarget: partition.failoverCandidateWorkerId,
  };
  const eventType =
    lease.state === "WORKER_STALLED"
      ? "WORKER_FAILOVER_STARTED"
      : lease.state === "WORKER_DEGRADED" || lease.load >= 75
        ? "WORKER_OVERLOADED"
        : "WORKER_HEARTBEAT";
  const meta = {
    operationalEvent: "DISTRIBUTED_WORKER_MESH",
    meshEvent: eventType,
    workerId: resolvedWorkerId,
    lease,
    partition,
    replaySafe: true,
    reversible: true,
  };

  await writeMeshTimeline({
    organizationId,
    locationId,
    eventType,
    summary:
      eventType === "WORKER_FAILOVER_STARTED"
        ? "Worker failover started for overloaded execution partition."
        : eventType === "WORKER_OVERLOADED"
          ? "Worker overloaded. Execution load is being isolated safely."
          : "Worker heartbeat received.",
    severity: eventType === "WORKER_FAILOVER_STARTED" ? "WARNING" : eventType === "WORKER_OVERLOADED" ? "WARNING" : "INFO",
    metadata: meta,
  });

  return lease;
}

export async function buildDistributedWorkerMeshSnapshot({
  organizationId,
  locationId = null,
  runtime = null,
}: {
  organizationId: string;
  locationId?: string | null;
  runtime?: PersistentOperationalRuntimeSnapshot | null;
}): Promise<DistributedOperationalWorkerMeshSnapshot> {
  const partition = await buildOperationalPartition({ organizationId, locationId, runtime });
  const currentLease = await heartbeatMeshWorker({ organizationId, locationId, runtime });
  const commandResult = await subscribeOperationalCommands({
    eventType: "ALL",
    organizationId,
    locationId,
    limit: 50,
  });
  const meshCommands = commandResult.ok
    ? commandResult.events.filter((event) =>
        [
          "WORKER_REGISTERED",
          "WORKER_HEARTBEAT",
          "WORKER_OVERLOADED",
          "WORKER_FAILOVER_STARTED",
          "EXECUTION_REASSIGNED",
          "PARTITION_REBALANCED",
          "MESH_DEGRADED",
          "MESH_RECOVERED",
        ].includes(event.eventType)
      )
    : [];
  const activeWorkers = [currentLease];
  const degradedWorkers = activeWorkers.filter((worker) =>
    ["WORKER_DEGRADED", "WORKER_STALLED", "WORKER_FAILED"].includes(worker.state)
  );
  const meshPressure = clamp(
    partition.executionPressure * 0.75 +
      degradedWorkers.length * 20 +
      meshCommands.filter((event) => event.eventType === "WORKER_FAILOVER_STARTED").length * 6
  );
  const meshState = meshStateFor(activeWorkers);
  const failoverState =
    meshState === "MESH_FAILOVER"
      ? "ACTIVE"
      : partition.failoverCandidateWorkerId
        ? "READY"
        : "IDLE";

  if (meshState === "MESH_FAILOVER" || meshState === "MESH_DEGRADED") {
    await writeMeshTimeline({
      organizationId,
      locationId,
      eventType: meshState === "MESH_FAILOVER" ? "EXECUTION_REASSIGNED" : "MESH_DEGRADED",
      summary:
        meshState === "MESH_FAILOVER"
          ? "Execution ownership reassigned to protect overloaded partition."
          : "Worker mesh degraded. Runtime remains isolated and retry-safe.",
      severity: "WARNING",
      metadata: {
        meshState,
        meshPressure,
        partition,
        currentLease,
        failoverState,
      },
    });
  } else if (meshState === "MESH_HEALTHY") {
    await writeMeshTimeline({
      organizationId,
      locationId,
      eventType: "MESH_RECOVERED",
      summary: "Worker mesh recovered or remains healthy.",
      severity: "INFO",
      metadata: {
        meshState,
        meshPressure,
        partition,
      },
    });
  } else {
    await writeMeshTimeline({
      organizationId,
      locationId,
      eventType: "PARTITION_REBALANCED",
      summary: "Execution partition rebalanced for elevated load.",
      severity: "WATCH",
      metadata: {
        meshState,
        meshPressure,
        partition,
      },
    });
  }

  return {
    organizationId,
    locationId,
    meshState,
    meshPressure,
    activeWorkers,
    degradedWorkers,
    partitions: [partition],
    overloadedLocations:
      partition.executionPressure >= 65
        ? [{ locationId, pressure: partition.executionPressure, state: partition.state }]
        : [],
    failoverState,
    queueCongestion: partition.queueLoad,
    recoveringWorkers: activeWorkers.filter((worker) => worker.state === "WORKER_RECOVERING"),
    ownerSummary: summaryFor(meshState),
    staffGuidance: guidanceFor(meshState),
    generatedAt: new Date().toISOString(),
  };
}
