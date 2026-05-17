import { getOperationalJobSnapshot, runDueOperationalJobs } from "@/app/lib/infrastructure/operationalJobEngine";

export type OperationalWorkerRuntimeOptions = {
  organizationId: string;
  pollIntervalMs?: number;
  batchSize?: number;
  stopSignal?: AbortSignal;
  onHealth?: (health: OperationalWorkerRuntimeHealth) => void | Promise<void>;
};

export type OperationalWorkerRuntimeHealth = {
  organizationId: string;
  workerStatus: "starting" | "healthy" | "watch" | "stopping" | "stopped" | "failed";
  lastStartedAt: string;
  lastHeartbeatAt: string;
  lastCompletedAt?: string;
  lastError?: string;
  queuePressure: number;
  jobsExecuted: number;
};

function wait(ms: number, stopSignal?: AbortSignal) {
  return new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, ms);
    stopSignal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        resolve();
      },
      { once: true }
    );
  });
}

export async function runOperationalWorkerCycle({
  organizationId,
  batchSize = 5,
}: {
  organizationId: string;
  batchSize?: number;
}) {
  const startedAt = new Date().toISOString();
  const results = await runDueOperationalJobs(organizationId, batchSize);
  const snapshot = await getOperationalJobSnapshot(organizationId);

  return {
    ok: true,
    organizationId,
    startedAt,
    completedAt: new Date().toISOString(),
    jobsExecuted: results.length,
    results,
    health: {
      queuePressure: snapshot.queuePressure,
      workerHealth: snapshot.workerHealth,
      delayedJobs: snapshot.delayedJobs,
      retries: snapshot.retries,
      deadLetterJobs: snapshot.deadLetterJobs,
      providerFailures: snapshot.providerFailures,
    },
  };
}

export async function startOperationalWorkerRuntime({
  organizationId,
  pollIntervalMs = 15_000,
  batchSize = 5,
  stopSignal,
  onHealth,
}: OperationalWorkerRuntimeOptions) {
  const startedAt = new Date().toISOString();
  let status: OperationalWorkerRuntimeHealth["workerStatus"] = "starting";
  let jobsExecuted = 0;
  let lastError: string | undefined;

  while (!stopSignal?.aborted) {
    const heartbeatAt = new Date().toISOString();

    try {
      const cycle = await runOperationalWorkerCycle({ organizationId, batchSize });
      jobsExecuted += cycle.jobsExecuted;
      status = cycle.health.queuePressure >= 55 ? "watch" : "healthy";
      lastError = undefined;

      await onHealth?.({
        organizationId,
        workerStatus: status,
        lastStartedAt: startedAt,
        lastHeartbeatAt: heartbeatAt,
        lastCompletedAt: cycle.completedAt,
        queuePressure: cycle.health.queuePressure,
        jobsExecuted,
      });
    } catch (error) {
      status = "failed";
      lastError = error instanceof Error ? error.message : "Worker cycle failed.";
      await onHealth?.({
        organizationId,
        workerStatus: status,
        lastStartedAt: startedAt,
        lastHeartbeatAt: heartbeatAt,
        lastError,
        queuePressure: 100,
        jobsExecuted,
      });
    }

    await wait(pollIntervalMs, stopSignal);
  }

  status = "stopped";
  await onHealth?.({
    organizationId,
    workerStatus: status,
    lastStartedAt: startedAt,
    lastHeartbeatAt: new Date().toISOString(),
    lastError,
    queuePressure: 0,
    jobsExecuted,
  });

  return {
    ok: true,
    organizationId,
    status,
    jobsExecuted,
  };
}
