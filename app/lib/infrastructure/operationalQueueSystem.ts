export type OperationalQueuePriority = "LOW" | "NORMAL" | "HIGH" | "CRITICAL";
export type OperationalQueueStatus =
  | "QUEUED"
  | "RUNNING"
  | "SUCCEEDED"
  | "FAILED"
  | "RETRY_SCHEDULED"
  | "DEAD_LETTERED"
  | "SKIPPED_DUPLICATE";

export type OperationalQueueJob = {
  id: string;
  queueName: string;
  organizationId: string;
  partitionKey: string;
  priority: OperationalQueuePriority;
  status: OperationalQueueStatus;
  attempt: number;
  maxAttempts: number;
  idempotencyKey: string;
  runAfter: string;
  deadLetterReason?: string;
  safeReplay: boolean;
  payloadSummary: Record<string, unknown>;
};

const priorityWeight: Record<OperationalQueuePriority, number> = {
  LOW: 1,
  NORMAL: 2,
  HIGH: 3,
  CRITICAL: 4,
};

export function calculateExponentialBackoffMinutes(attempt: number) {
  return Math.min(240, Math.max(1, 2 ** Math.max(0, attempt - 1)));
}

export function createOperationalQueueJob({
  queueName,
  organizationId = "org-default",
  partitionKey,
  priority = "NORMAL",
  idempotencyKey,
  attempt = 0,
  maxAttempts = 4,
  payloadSummary,
}: {
  queueName: string;
  organizationId?: string;
  partitionKey: string;
  priority?: OperationalQueuePriority;
  idempotencyKey: string;
  attempt?: number;
  maxAttempts?: number;
  payloadSummary: Record<string, unknown>;
}): OperationalQueueJob {
  return {
    id: `queue:${queueName}:${partitionKey}:${idempotencyKey}`,
    queueName,
    organizationId,
    partitionKey,
    priority,
    status: "QUEUED",
    attempt,
    maxAttempts,
    idempotencyKey,
    runAfter: new Date(Date.now() + calculateExponentialBackoffMinutes(attempt) * 60000).toISOString(),
    safeReplay: true,
    payloadSummary,
  };
}

export function resolveQueueFailure(job: OperationalQueueJob, error: string): OperationalQueueJob {
  const nextAttempt = job.attempt + 1;

  if (nextAttempt >= job.maxAttempts) {
    return {
      ...job,
      attempt: nextAttempt,
      status: "DEAD_LETTERED",
      deadLetterReason: error,
      safeReplay: false,
    };
  }

  return {
    ...job,
    attempt: nextAttempt,
    status: "RETRY_SCHEDULED",
    runAfter: new Date(Date.now() + calculateExponentialBackoffMinutes(nextAttempt) * 60000).toISOString(),
    deadLetterReason: error,
  };
}

export function calculateQueuePressure(jobs: OperationalQueueJob[]) {
  if (jobs.length === 0) return 0;

  const score = jobs.reduce((sum, job) => {
    const statusPressure =
      job.status === "DEAD_LETTERED"
        ? 35
        : job.status === "FAILED" || job.status === "RETRY_SCHEDULED"
          ? 22
          : job.status === "RUNNING"
            ? 12
            : 6;

    return sum + statusPressure + priorityWeight[job.priority] * 4 + job.attempt * 5;
  }, 0);

  return Math.max(0, Math.min(Math.round(score / Math.max(jobs.length, 1)), 100));
}
