import { heartbeatMeshWorker, registerMeshWorker } from "../app/lib/distributedOperationalWorkerMesh.ts";
import { runDueOperationalJobs } from "../app/lib/infrastructure/operationalJobEngine.ts";
import { publishOperationalCommand } from "../app/lib/operationalCommandBus.ts";
import {
  getPersistentOperationalRuntimeSnapshot,
  runPersistentOperationalRuntimeTick,
} from "../app/lib/persistentOperationalRuntime.ts";

type WorkerMode = "continuous" | "once" | "dry-run" | "health";

type WorkerConfig = {
  mode: WorkerMode;
  workerId: string;
  organizationId: string;
  locationId: string | null;
  pollIntervalMs: number;
  heartbeatIntervalMs: number;
  maxJobsPerTick: number;
};

let shuttingDown = false;

function arg(name: string) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

function numberFromEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function readConfig(): WorkerConfig {
  const mode = (arg("mode") ?? process.env.WORKER_MODE ?? "continuous") as WorkerMode;
  const organizationId = process.env.WORKER_ORGANIZATION_SCOPE ?? arg("organization") ?? "";
  if (!organizationId) {
    throw new Error("WORKER_ORGANIZATION_SCOPE is required so the worker cannot run across businesses accidentally.");
  }

  return {
    mode: ["continuous", "once", "dry-run", "health"].includes(mode) ? mode : "continuous",
    workerId:
      process.env.WORKER_ID ??
      arg("worker") ??
      `external-worker-${Math.random().toString(36).slice(2, 10)}`,
    organizationId,
    locationId: process.env.WORKER_LOCATION_SCOPE ?? arg("location") ?? null,
    pollIntervalMs: numberFromEnv("WORKER_POLL_INTERVAL_MS", 15_000),
    heartbeatIntervalMs: numberFromEnv("WORKER_HEARTBEAT_INTERVAL_MS", 10_000),
    maxJobsPerTick: numberFromEnv("WORKER_MAX_JOBS_PER_TICK", 5),
  };
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function installShutdownHandlers(config: WorkerConfig) {
  async function stop(signal: string) {
    if (shuttingDown) return;
    shuttingDown = true;
    await publishOperationalCommand({
      eventType: "WORKER_HEARTBEAT",
      organizationId: config.organizationId,
      locationId: config.locationId,
      source: "External Operational Worker",
      summary: `External worker ${config.workerId} stopped after ${signal}.`,
      severity: "INFO",
      correlationId: `external-worker-stop:${config.workerId}:${new Date().toISOString().slice(0, 16)}`,
      payload: {
        workerId: config.workerId,
        mode: config.mode,
        signal,
        safetyBoundaries: [
          "Worker never confirms payment truth.",
          "Worker never releases blocked fulfillment outside existing job logic.",
          "Worker only executes durable jobs through existing engines.",
        ],
      },
    });
    process.exit(0);
  }

  process.on("SIGINT", () => void stop("SIGINT"));
  process.on("SIGTERM", () => void stop("SIGTERM"));
}

async function heartbeat(config: WorkerConfig) {
  const runtime = await getPersistentOperationalRuntimeSnapshot({
    organizationId: config.organizationId,
    locationId: config.locationId,
  });
  const lease = await heartbeatMeshWorker({
    organizationId: config.organizationId,
    locationId: config.locationId,
    workerId: config.workerId,
    runtime,
  });

  return { runtime, lease };
}

async function runOneTick(config: WorkerConfig) {
  const { runtime, lease } = await heartbeat(config);
  const overloaded = lease.load >= 85 || runtime.state === "RUNTIME_OVERLOADED";
  const batchSize = overloaded
    ? Math.max(1, Math.floor(config.maxJobsPerTick / 2))
    : config.maxJobsPerTick;

  if (config.mode === "dry-run" || config.mode === "health") {
    return {
      mode: config.mode,
      dryRun: config.mode === "dry-run",
      lease,
      runtime,
      jobsExecuted: 0,
      results: [],
      skippedReason:
        config.mode === "health"
          ? "Health mode only checks runtime and mesh state."
          : "Dry run does not claim or execute jobs.",
    };
  }

  const runtimeTick = await runPersistentOperationalRuntimeTick({
    organizationId: config.organizationId,
    locationId: config.locationId,
    runWorkerBatch: false,
  });
  const results = await runDueOperationalJobs(config.organizationId, batchSize);

  return {
    mode: config.mode,
    lease,
    runtime,
    runtimeTick,
    jobsExecuted: results.length,
    results,
    overloaded,
    batchSize,
  };
}

async function main() {
  const config = readConfig();
  installShutdownHandlers(config);

  await registerMeshWorker({
    organizationId: config.organizationId,
    locationId: config.locationId,
    workerId: config.workerId,
  });

  await publishOperationalCommand({
    eventType: "WORKER_REGISTERED",
    organizationId: config.organizationId,
    locationId: config.locationId,
    source: "External Operational Worker",
    summary: `External worker ${config.workerId} started in ${config.mode} mode.`,
    severity: "INFO",
    correlationId: `external-worker-start:${config.workerId}:${new Date().toISOString().slice(0, 16)}`,
    payload: {
      workerId: config.workerId,
      mode: config.mode,
      pollIntervalMs: config.pollIntervalMs,
      heartbeatIntervalMs: config.heartbeatIntervalMs,
      maxJobsPerTick: config.maxJobsPerTick,
      organizationId: config.organizationId,
      locationId: config.locationId,
    },
  });

  if (config.mode !== "continuous") {
    const result = await runOneTick(config);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  let lastHeartbeat = 0;
  while (!shuttingDown) {
    const now = Date.now();
    try {
      if (now - lastHeartbeat >= config.heartbeatIntervalMs) {
        await heartbeat(config);
        lastHeartbeat = now;
      }

      const result = await runOneTick(config);
      console.log(
        JSON.stringify(
          {
            workerId: config.workerId,
            mode: config.mode,
            jobsExecuted: result.jobsExecuted,
            runtimeState: result.runtime.state,
            meshWorkerState: result.lease.state,
            load: result.lease.load,
            timestamp: new Date().toISOString(),
          },
          null,
          2
        )
      );

      const backoffMs = result.overloaded ? config.pollIntervalMs * 2 : config.pollIntervalMs;
      await wait(backoffMs);
    } catch (error) {
      const message = error instanceof Error ? error.message : "External worker failed safely.";
      await publishOperationalCommand({
        eventType: "MESH_DEGRADED",
        organizationId: config.organizationId,
        locationId: config.locationId,
        source: "External Operational Worker",
        summary: `External worker ${config.workerId} degraded safely.`,
        severity: "WARNING",
        correlationId: `external-worker-error:${config.workerId}:${new Date().toISOString().slice(0, 16)}`,
        payload: {
          workerId: config.workerId,
          mode: config.mode,
          error: message,
        },
      });
      console.error(message);
      await wait(config.pollIntervalMs * 2);
    }
  }
}

main().catch(async (error) => {
  const message = error instanceof Error ? error.message : "External worker failed to start.";
  console.error(message);
  try {
    const organizationId = process.env.WORKER_ORGANIZATION_SCOPE ?? "unknown";
    await publishOperationalCommand({
      eventType: "MESH_DEGRADED",
      organizationId,
      locationId: process.env.WORKER_LOCATION_SCOPE ?? null,
      source: "External Operational Worker",
      summary: "External worker failed before entering runtime loop.",
      severity: "WARNING",
      correlationId: `external-worker-start-failed:${new Date().toISOString().slice(0, 16)}`,
      payload: { error: message },
    });
  } catch {
    // If startup fails before environment is ready, avoid masking the original worker failure.
  }
  process.exit(1);
});
