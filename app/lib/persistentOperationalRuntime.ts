import { runAutonomousOperationalExecution } from "@/app/lib/autonomousOperationalExecutionEngine";
import { buildDistributedWorkerMeshSnapshot } from "@/app/lib/distributedOperationalWorkerMesh";
import { getOperationalJobSnapshot, runDueOperationalJobs } from "@/app/lib/infrastructure/operationalJobEngine";
import { buildLiveServiceCoordinationSnapshot } from "@/app/lib/liveServiceCoordinationEngine";
import {
  publishOperationalCommand,
  type OperationalCommandBusEventType,
} from "@/app/lib/operationalCommandBus";
import { resolveOperationalPolicyState } from "@/app/lib/operationalPolicyOrchestrator";
import { getProviderHealthSnapshot } from "@/app/lib/providers/providerHealth";

export type PersistentRuntimeState =
  | "RUNTIME_HEALTHY"
  | "RUNTIME_ELEVATED"
  | "RUNTIME_DEGRADED"
  | "RUNTIME_OVERLOADED"
  | "RUNTIME_RECOVERING"
  | "RUNTIME_RESTARTING";

export type RuntimeEngineExecution = {
  engine: string;
  status: "OK" | "DELAYED" | "FAILED" | "SKIPPED";
  latencyMs: number;
  summary: string;
  startedAt: string;
  completedAt: string;
  error?: string | null;
};

export type PersistentOperationalRuntimeSnapshot = {
  organizationId: string;
  locationId: string | null;
  state: PersistentRuntimeState;
  heartbeatAt: string;
  executionCadenceMs: number;
  pollingWindowMs: number;
  runtimePressure: number;
  averageEngineLatencyMs: number;
  backoffActive: boolean;
  backoffUntil: string | null;
  degradedSystems: string[];
  engines: RuntimeEngineExecution[];
  providerDegraded: boolean;
  queuePressure: number;
  workerHealth: string;
  policyState: string;
  coordinationState: string;
  gracefulDegradation: string[];
  safetyBoundaries: string[];
};

const DEFAULT_CADENCE_MS = 30_000;
const RUNTIME_MEMORY = new Map<
  string,
  {
    lastHeartbeatAt: string;
    lastState: PersistentRuntimeState;
    backoffUntil: string | null;
    averageEngineLatencyMs: number;
  }
>();

function runtimeKey(organizationId: string, locationId?: string | null) {
  return `${organizationId}:${locationId ?? "org"}`;
}

function clamp(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function bucket(minutes = 1) {
  return String(Math.floor(Date.now() / (minutes * 60_000)));
}

function resolveRuntimeState({
  queuePressure,
  providerDegraded,
  averageEngineLatencyMs,
  failedEngines,
  delayedEngines,
}: {
  queuePressure: number;
  providerDegraded: boolean;
  averageEngineLatencyMs: number;
  failedEngines: number;
  delayedEngines: number;
}): PersistentRuntimeState {
  if (queuePressure >= 85 || failedEngines >= 2) return "RUNTIME_OVERLOADED";
  if (providerDegraded || failedEngines > 0 || queuePressure >= 65) return "RUNTIME_DEGRADED";
  if (delayedEngines > 0 || averageEngineLatencyMs >= 3500 || queuePressure >= 40) return "RUNTIME_ELEVATED";
  return "RUNTIME_HEALTHY";
}

function eventForRuntimeState(state: PersistentRuntimeState): OperationalCommandBusEventType {
  if (state === "RUNTIME_OVERLOADED") return "RUNTIME_PRESSURE_HIGH";
  if (state === "RUNTIME_DEGRADED") return "RUNTIME_DEGRADED";
  if (state === "RUNTIME_RECOVERING" || state === "RUNTIME_HEALTHY") return "RUNTIME_RECOVERED";
  return "RUNTIME_HEARTBEAT";
}

function runtimeSummary(state: PersistentRuntimeState) {
  if (state === "RUNTIME_OVERLOADED") return "Runtime pressure is high. Valsentra is backing off non-critical work safely.";
  if (state === "RUNTIME_DEGRADED") return "Runtime is degraded. Critical payment and release safety remain protected.";
  if (state === "RUNTIME_ELEVATED") return "Runtime load is elevated. Valsentra is watching engine latency and queue pressure.";
  if (state === "RUNTIME_RECOVERING") return "Runtime is recovering and restoring normal operating cadence.";
  if (state === "RUNTIME_RESTARTING") return "Runtime is restarting safely.";
  return "Runtime heartbeat healthy.";
}

async function measureEngine(
  engine: string,
  fn: () => Promise<{ summary: string; delayed?: boolean }>
): Promise<RuntimeEngineExecution> {
  const startedAt = new Date().toISOString();
  const start = Date.now();
  try {
    const result = await fn();
    const latencyMs = Date.now() - start;
    return {
      engine,
      status: result.delayed || latencyMs > 4500 ? "DELAYED" : "OK",
      latencyMs,
      summary: result.summary,
      startedAt,
      completedAt: new Date().toISOString(),
      error: null,
    };
  } catch (error) {
    return {
      engine,
      status: "FAILED",
      latencyMs: Date.now() - start,
      summary: `${engine} failed safely.`,
      startedAt,
      completedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : "Engine execution failed.",
    };
  }
}

async function publishRuntimeEvent({
  organizationId,
  locationId,
  state,
  snapshot,
}: {
  organizationId: string;
  locationId?: string | null;
  state: PersistentRuntimeState;
  snapshot: Pick<
    PersistentOperationalRuntimeSnapshot,
    "runtimePressure" | "averageEngineLatencyMs" | "degradedSystems" | "queuePressure" | "backoffActive"
  >;
}) {
  const eventType = snapshot.backoffActive ? "RUNTIME_BACKOFF_ENABLED" : eventForRuntimeState(state);
  await publishOperationalCommand({
    eventType,
    organizationId,
    locationId,
    source: "Persistent Operational Runtime",
    summary: runtimeSummary(state),
    severity:
      state === "RUNTIME_OVERLOADED"
        ? "CRITICAL"
        : state === "RUNTIME_DEGRADED"
          ? "WARNING"
          : state === "RUNTIME_ELEVATED"
            ? "WATCH"
            : "INFO",
    correlationId: `runtime:${eventType}:${bucket(1)}`,
    payload: {
      runtimeState: state,
      runtimePressure: snapshot.runtimePressure,
      averageEngineLatencyMs: snapshot.averageEngineLatencyMs,
      queuePressure: snapshot.queuePressure,
      degradedSystems: snapshot.degradedSystems,
      backoffActive: snapshot.backoffActive,
    },
  });
}

export async function getPersistentOperationalRuntimeSnapshot({
  organizationId,
  locationId = null,
}: {
  organizationId: string;
  locationId?: string | null;
}): Promise<PersistentOperationalRuntimeSnapshot> {
  const key = runtimeKey(organizationId, locationId);
  const previous = RUNTIME_MEMORY.get(key);
  const providers = getProviderHealthSnapshot();
  const jobSnapshot = await getOperationalJobSnapshot(organizationId);

  const engines: RuntimeEngineExecution[] = [];
  engines.push(
    await measureEngine("Capacity + Coordination", async () => {
      const coordination = await buildLiveServiceCoordinationSnapshot({ organizationId, locationId });
      return { summary: coordination.ownerSummary, delayed: coordination.state === "FULFILLMENT_DELAY" };
    })
  );
  engines.push(
    await measureEngine("Policy Orchestrator", async () => {
      const policy = await resolveOperationalPolicyState({ organizationId, locationId });
      return { summary: policy.ownerSummary, delayed: policy.providerDegraded };
    })
  );
  engines.push(
    await measureEngine("Worker Mesh", async () => {
      const mesh = await buildDistributedWorkerMeshSnapshot({ organizationId, locationId });
      return { summary: mesh.ownerSummary, delayed: mesh.meshState !== "MESH_HEALTHY" };
    })
  );

  const failedEngines = engines.filter((engine) => engine.status === "FAILED").length;
  const delayedEngines = engines.filter((engine) => engine.status === "DELAYED").length;
  const averageEngineLatencyMs =
    engines.length > 0
      ? Math.round(engines.reduce((sum, engine) => sum + engine.latencyMs, 0) / engines.length)
      : previous?.averageEngineLatencyMs ?? 0;
  const runtimePressure = clamp(
    jobSnapshot.queuePressure * 0.55 +
      providers.degradedCount * 18 +
      failedEngines * 25 +
      delayedEngines * 10 +
      Math.min(25, averageEngineLatencyMs / 180)
  );
  const state = resolveRuntimeState({
    queuePressure: jobSnapshot.queuePressure,
    providerDegraded: providers.degradedCount > 0,
    averageEngineLatencyMs,
    failedEngines,
    delayedEngines,
  });
  const backoffActive = runtimePressure >= 70 || state === "RUNTIME_OVERLOADED";
  const backoffUntil = backoffActive
    ? new Date(Date.now() + (state === "RUNTIME_OVERLOADED" ? 120_000 : 60_000)).toISOString()
    : null;
  const degradedSystems = [
    ...jobSnapshot.degradedSystems.map((system) => `${system} needs review.`),
    ...engines.filter((engine) => engine.status !== "OK").map((engine) => `${engine.engine}: ${engine.summary}`),
    ...(providers.degradedCount > 0 ? ["Customer messaging provider needs attention."] : []),
  ];
  const coordinationState =
    engines.find((engine) => engine.engine === "Capacity + Coordination")?.summary ?? "Live coordination checked.";
  const policySnapshot = await resolveOperationalPolicyState({ organizationId, locationId });

  const snapshot: PersistentOperationalRuntimeSnapshot = {
    organizationId,
    locationId,
    state,
    heartbeatAt: new Date().toISOString(),
    executionCadenceMs: backoffActive ? DEFAULT_CADENCE_MS * 2 : DEFAULT_CADENCE_MS,
    pollingWindowMs: backoffActive ? 60_000 : 20_000,
    runtimePressure,
    averageEngineLatencyMs,
    backoffActive,
    backoffUntil,
    degradedSystems,
    engines,
    providerDegraded: providers.degradedCount > 0,
    queuePressure: jobSnapshot.queuePressure,
    workerHealth: jobSnapshot.workerHealth,
    policyState: policySnapshot.activePolicyState,
    coordinationState,
    gracefulDegradation: [
      ...(backoffActive ? ["Non-critical runtime polling slows temporarily."] : []),
      ...(providers.degradedCount > 0 ? ["Provider failures stay retry-safe and visible."] : []),
      ...(jobSnapshot.deadLetterJobs > 0 ? ["Dead-letter background work stays isolated for manager review."] : []),
    ],
    safetyBoundaries: [
      "Runtime never confirms payment truth.",
      "Runtime never releases blocked fulfillment.",
      "Runtime only coordinates reversible pacing and visibility.",
    ],
  };

  RUNTIME_MEMORY.set(key, {
    lastHeartbeatAt: snapshot.heartbeatAt,
    lastState: state,
    backoffUntil,
    averageEngineLatencyMs,
  });

  await publishRuntimeEvent({ organizationId, locationId, state, snapshot });
  return snapshot;
}

export async function runPersistentOperationalRuntimeTick({
  organizationId,
  locationId = null,
  runWorkerBatch = false,
}: {
  organizationId: string;
  locationId?: string | null;
  runWorkerBatch?: boolean;
}) {
  const startedAt = new Date().toISOString();
  await publishOperationalCommand({
    eventType: "ENGINE_EXECUTION_STARTED",
    organizationId,
    locationId,
    source: "Persistent Operational Runtime",
    summary: "Runtime engine execution started.",
    severity: "INFO",
    correlationId: `runtime-tick:${bucket(1)}`,
    payload: { startedAt, runWorkerBatch },
  });

  const engines: RuntimeEngineExecution[] = [];
  engines.push(
    await measureEngine("Autonomous Pacing", async () => {
      const execution = await runAutonomousOperationalExecution({ organizationId, locationId });
      return { summary: execution.ownerSummary, delayed: execution.executionState === "EXECUTION_THROTTLING" };
    })
  );

  if (runWorkerBatch) {
    engines.push(
      await measureEngine("Durable Worker", async () => {
        const results = await runDueOperationalJobs(organizationId, 5);
        return { summary: `${results.length} background task${results.length === 1 ? "" : "s"} checked.` };
      })
    );
  }

  const snapshot = await getPersistentOperationalRuntimeSnapshot({ organizationId, locationId });
  const failed = engines.filter((engine) => engine.status === "FAILED").length;
  const delayed = engines.filter((engine) => engine.status === "DELAYED").length;

  await publishOperationalCommand({
    eventType: failed > 0 ? "RUNTIME_DEGRADED" : delayed > 0 ? "ENGINE_EXECUTION_DELAYED" : "ENGINE_EXECUTION_COMPLETED",
    organizationId,
    locationId,
    source: "Persistent Operational Runtime",
    summary:
      failed > 0
        ? "Runtime execution degraded safely."
        : delayed > 0
          ? "Runtime execution completed with delayed systems."
          : "Runtime execution completed.",
    severity: failed > 0 ? "WARNING" : delayed > 0 ? "WATCH" : "INFO",
    correlationId: `runtime-tick:${bucket(1)}`,
    payload: {
      startedAt,
      completedAt: new Date().toISOString(),
      engines,
      snapshotState: snapshot.state,
      runtimePressure: snapshot.runtimePressure,
    },
  });

  return {
    ok: failed === 0,
    startedAt,
    completedAt: new Date().toISOString(),
    engines,
    snapshot,
  };
}
