import {
  resolveQueueFailure,
  type OperationalQueueJob,
} from "@/app/lib/infrastructure/operationalQueueSystem";

export type FailureRecoveryPlan = {
  retryScheduled: boolean;
  fallbackRoute: "INTERNAL_REVIEW" | "PROVIDER_RETRY" | "DEGRADED_MODE" | "DEAD_LETTER";
  degradedMode: boolean;
  providerFailoverPrepared: boolean;
  partialExecutionRecovery: string[];
  incidentAuditTrail: Record<string, unknown>;
  nextJob: OperationalQueueJob;
};

export function planFailureRecovery({
  job,
  error,
  providerConfigured,
}: {
  job: OperationalQueueJob;
  error: string;
  providerConfigured: boolean;
}): FailureRecoveryPlan {
  const nextJob = resolveQueueFailure(job, error);
  const deadLettered = nextJob.status === "DEAD_LETTERED";
  const degradedMode = !providerConfigured || deadLettered;

  return {
    retryScheduled: nextJob.status === "RETRY_SCHEDULED",
    fallbackRoute: deadLettered
      ? "DEAD_LETTER"
      : !providerConfigured
        ? "DEGRADED_MODE"
        : nextJob.status === "RETRY_SCHEDULED"
          ? "PROVIDER_RETRY"
          : "INTERNAL_REVIEW",
    degradedMode,
    providerFailoverPrepared: !providerConfigured || nextJob.attempt >= 2,
    partialExecutionRecovery: [
      "Preserve original idempotency key.",
      "Do not replay irreversible actions automatically.",
      "Route customer-facing uncertainty to internal review if provider state is unclear.",
    ],
    incidentAuditTrail: {
      queueJobId: job.id,
      previousAttempt: job.attempt,
      nextAttempt: nextJob.attempt,
      status: nextJob.status,
      error,
      degradedMode,
    },
    nextJob,
  };
}
