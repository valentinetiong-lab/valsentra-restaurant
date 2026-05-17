import { supabaseAdmin } from "@/app/lib/admin";
import { runContinuousOperationalPass } from "@/app/lib/continuousOperationalEngine";
import { executeDirectCommunication } from "@/app/lib/providers/communication/communicationExecutionService";
import type { CommunicationSendInput } from "@/app/lib/providers/communication/communicationProviderTypes";
import { appendOperationalTimelineFromAudit } from "@/app/lib/operationalTimelineMemoryEngine";
import { getProviderHealthSnapshot } from "@/app/lib/providers/providerHealth";
import {
  executeWaitlistRecoveryAutopilot,
  type WaitlistRecoveryStage,
} from "@/app/lib/waitlistRecoveryAutopilotEngine";
import { runWaitlistCascade } from "@/app/lib/waitlistCascadeService";

export type DurableJobStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "retrying"
  | "dead_letter"
  | "cancelled";

export type DurableJobPriority = "low" | "normal" | "high" | "critical";

export type DurableJobType =
  | "continuous_operational_pass"
  | "waitlist_cascade"
  | "waitlist_recovery_autopilot"
  | "communication_send"
  | "autonomous_recovery_action"
  | "infrastructure_recovery";

export type DurableJobActor = {
  userId?: string | null;
  role?: string | null;
  source?: string | null;
};

export type EnqueueOperationalJobInput = {
  organizationId: string;
  locationId?: string | null;
  jobType: DurableJobType;
  priority?: DurableJobPriority;
  runAfter?: string;
  maxAttempts?: number;
  idempotencyKey: string;
  requestFingerprint?: string | null;
  payload: Record<string, unknown>;
  traceId?: string | null;
  actor?: DurableJobActor;
};

const WORKER_ID = `valsentra-worker-${Math.random().toString(36).slice(2, 10)}`;
const JOB_TIMEOUT_MS = 30_000;
const STALE_RUNNING_MINUTES = 5;

function backoffMinutes(attempt: number) {
  return Math.min(240, Math.max(1, 2 ** Math.max(0, attempt - 1)));
}

function fingerprint(payload: Record<string, unknown>) {
  return Buffer.from(JSON.stringify(payload)).toString("base64").slice(0, 500);
}

export async function enqueueOperationalJob(input: EnqueueOperationalJobInput) {
  const payload = {
    organization_id: input.organizationId,
    location_id: input.locationId ?? null,
    job_type: input.jobType,
    status: "pending",
    priority: input.priority ?? "normal",
    run_after: input.runAfter ?? new Date().toISOString(),
    max_attempts: input.maxAttempts ?? 4,
    idempotency_key: input.idempotencyKey,
    request_fingerprint: input.requestFingerprint ?? fingerprint(input.payload),
    payload: input.payload,
    execution_trace_id: input.traceId ?? null,
    actor_user_id: input.actor?.userId ?? null,
    actor_role: input.actor?.role ?? null,
    source: input.actor?.source ?? "api",
  };

  const { data, error } = await supabaseAdmin
    .from("operational_jobs")
    .upsert(payload, {
      onConflict: "organization_id,idempotency_key",
      ignoreDuplicates: true,
    })
    .select("*")
    .maybeSingle();

  if (error) throw new Error(error.message);

  if (data) return { job: data, duplicate: false };

  const existing = await supabaseAdmin
    .from("operational_jobs")
    .select("*")
    .eq("organization_id", input.organizationId)
    .eq("idempotency_key", input.idempotencyKey)
    .single();

  if (existing.error) throw new Error(existing.error.message);
  return { job: existing.data, duplicate: true };
}

export async function recoverStaleOperationalJobs(organizationId: string) {
  const staleBefore = new Date(Date.now() - STALE_RUNNING_MINUTES * 60_000).toISOString();

  await supabaseAdmin
    .from("operational_jobs")
    .update({
      status: "retrying",
      locked_at: null,
      locked_by: null,
      heartbeat_at: null,
      last_error: "Recovered stale running job after abandoned lock.",
      updated_at: new Date().toISOString(),
    })
    .eq("organization_id", organizationId)
    .eq("status", "running")
    .lt("heartbeat_at", staleBefore);

  await supabaseAdmin
    .from("operational_jobs")
    .update({
      status: "pending",
      updated_at: new Date().toISOString(),
    })
    .eq("organization_id", organizationId)
    .eq("status", "retrying")
    .lte("run_after", new Date().toISOString());
}

async function markRunning(job: Record<string, any>) {
  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from("operational_jobs")
    .update({
      status: "running",
      locked_at: now,
      locked_by: WORKER_ID,
      heartbeat_at: now,
      started_at: now,
      attempt_count: Number(job.attempt_count ?? 0) + 1,
      updated_at: now,
    })
    .eq("id", job.id)
    .in("status", ["pending", "retrying"])
    .select("*")
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data;
}

async function executePayload(job: Record<string, any>) {
  const payload = (job.payload ?? {}) as Record<string, any>;

  if (job.job_type === "continuous_operational_pass") {
    return runContinuousOperationalPass({
      organizationId: job.organization_id,
    });
  }

  if (job.job_type === "waitlist_cascade") {
    return runWaitlistCascade({
      orderId: String(payload.orderId),
      staffName: String(payload.staffName ?? "Staff"),
      organizationId: job.organization_id,
      actorUserId: job.actor_user_id ?? undefined,
    });
  }

  if (job.job_type === "waitlist_recovery_autopilot") {
    return executeWaitlistRecoveryAutopilot({
      orderId: String(payload.orderId),
      organizationId: job.organization_id,
      stage: payload.stage as WaitlistRecoveryStage,
    });
  }

  if (job.job_type === "communication_send") {
    const rawInput = payload.input as CommunicationSendInput;
    const input: CommunicationSendInput = {
      ...rawInput,
      metadata: {
        ...(rawInput.metadata ?? {}),
        organizationId: job.organization_id,
        locationId: job.location_id,
        executionId: job.id,
        traceId: job.execution_trace_id,
      },
    };
    const result = await executeDirectCommunication(input);

    const auditAction =
        result.mode === "LIVE"
          ? `Communication sent via ${result.provider}`
          : `Communication prepared via ${result.provider}`;
    const auditMeta = {
      operationalEvent: true,
      category: "AUTONOMOUS_ACTION",
      severity: result.ok ? "INFO" : "WARNING",
      title:
        result.mode === "LIVE"
          ? "Provider communication sent"
          : "Provider-ready communication recorded",
      summary:
        result.mode === "LIVE"
          ? `${input.channel} message sent for ${input.orderId ?? "COMMUNICATION"}.`
          : `${input.channel} message recorded; no real customer message was sent.`,
      provider: result.provider,
      providerMode: result.mode,
      providerStatus: result.status,
      providerMessageId: result.messageId ?? null,
      providerError: result.error ?? null,
      providerLatencyMs: result.providerMetadata?.latencyMs ?? null,
      providerRetryable: Boolean(result.providerMetadata?.retryable),
      providerDegraded: Boolean(result.providerMetadata?.degraded),
      realMessageSent: result.realMessageSent,
      maskedRecipient: result.maskedRecipient,
      organizationId: job.organization_id,
      locationId: job.location_id,
      executionId: job.id,
      traceId: job.execution_trace_id,
      actorUserId: job.actor_user_id,
      actorRole: job.actor_role,
    };

    await supabaseAdmin.from("audit_logs").insert({
      action: auditAction,
      staff: "Valsentra Durable Worker",
      order_id: input.orderId ?? "COMMUNICATION",
      organization_id: job.organization_id,
      location_id: job.location_id,
      meta: auditMeta,
    });

    await appendOperationalTimelineFromAudit({
      action: auditAction,
      staff: "Valsentra Durable Worker",
      orderId: input.orderId ?? "COMMUNICATION",
      organizationId: job.organization_id,
      locationId: job.location_id,
      meta: auditMeta,
    });

    if (!result.ok && result.providerMetadata?.retryable) {
      throw new Error(
        result.error ?? `${result.provider} delivery failed and will retry safely.`
      );
    }

    return result;
  }

  return {
    ok: true,
    skipped: true,
    reason: `${job.job_type} is recorded as durable infrastructure but has no executor yet.`,
  };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs = JOB_TIMEOUT_MS): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Operational job timed out after ${timeoutMs / 1000} seconds.`));
    }, timeoutMs);

    promise.then(resolve).catch(reject).finally(() => clearTimeout(timeout));
  });
}

export async function executeOperationalJob(jobId: string) {
  const { data: queuedJob, error: loadError } = await supabaseAdmin
    .from("operational_jobs")
    .select("*")
    .eq("id", jobId)
    .single();

  if (loadError) throw new Error(loadError.message);

  const runningJob = await markRunning(queuedJob);
  if (!runningJob) {
    return {
      ok: true,
      skipped: true,
      reason: "Job was already claimed or completed.",
      jobId,
    };
  }

  const started = Date.now();

  try {
    const result = await withTimeout(executePayload(runningJob));
    const completedAt = new Date().toISOString();

    await supabaseAdmin
      .from("operational_jobs")
      .update({
        status: "completed",
        completed_at: completedAt,
        heartbeat_at: completedAt,
        locked_at: null,
        locked_by: null,
        execution_metadata: {
          result,
          durationMs: Date.now() - started,
          workerId: WORKER_ID,
        },
        updated_at: completedAt,
      })
      .eq("id", jobId);

    await writeJobAudit(runningJob, "completed", null, Date.now() - started);

    return { ok: true, jobId, result };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Operational job failed.";
    const attempt = Number(runningJob.attempt_count ?? 1);
    const maxAttempts = Number(runningJob.max_attempts ?? 4);
    const exhausted = attempt >= maxAttempts;
    const now = new Date().toISOString();

    await supabaseAdmin
      .from("operational_jobs")
      .update({
        status: exhausted ? "dead_letter" : "retrying",
        last_error: message,
        dead_letter_reason: exhausted ? message : null,
        run_after: new Date(Date.now() + backoffMinutes(attempt) * 60_000).toISOString(),
        locked_at: null,
        locked_by: null,
        heartbeat_at: null,
        execution_metadata: {
          durationMs: Date.now() - started,
          workerId: WORKER_ID,
          failureReason: message,
          recoveryAction: exhausted ? "dead_letter" : "retry_scheduled",
        },
        updated_at: now,
      })
      .eq("id", jobId);

    await writeJobAudit(runningJob, exhausted ? "dead_letter" : "retrying", message, Date.now() - started);

    return {
      ok: false,
      jobId,
      status: exhausted ? "dead_letter" : "retrying",
      error: message,
    };
  }
}

export async function runDueOperationalJobs(organizationId: string, limit = 5) {
  await recoverStaleOperationalJobs(organizationId);

  const { data, error } = await supabaseAdmin
    .from("operational_jobs")
    .select("id")
    .eq("organization_id", organizationId)
    .in("status", ["pending", "retrying"])
    .lte("run_after", new Date().toISOString())
    .order("priority", { ascending: false })
    .order("run_after", { ascending: true })
    .limit(limit);

  if (error) throw new Error(error.message);

  const results = [];
  for (const job of data ?? []) {
    results.push(await executeOperationalJob(job.id));
  }

  return results;
}

export async function getOperationalJobSnapshot(organizationId: string) {
  const { data, error } = await supabaseAdmin
    .from("operational_jobs")
    .select("*")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) throw new Error(error.message);

  const jobs = data ?? [];
  const now = Date.now();
  const providerHealth = getProviderHealthSnapshot();
  const latencySamples = jobs
    .filter((job) => job.started_at && job.completed_at)
    .map((job) => new Date(job.completed_at).getTime() - new Date(job.started_at).getTime())
    .filter(Number.isFinite);

  const delayedJobs = jobs.filter(
    (job) =>
      ["pending", "retrying"].includes(job.status) &&
      job.run_after &&
      now - new Date(job.run_after).getTime() > 5 * 60_000
  ).length;
  const activeJobs = jobs.filter((job) => ["pending", "retrying", "running"].includes(job.status)).length;
  const deadLetterJobs = jobs.filter((job) => job.status === "dead_letter").length;
  const retries = jobs.filter((job) => job.status === "retrying").length;
  const stuckJobs = jobs.filter((job) => job.status === "running" && job.heartbeat_at && now - new Date(job.heartbeat_at).getTime() > STALE_RUNNING_MINUTES * 60_000).length;
  const queuePressure = Math.min(
    100,
    activeJobs * 12 +
      deadLetterJobs * 25 +
      delayedJobs * 15 +
      providerHealth.degradedCount * 20
  );

  return {
    organizationId,
    jobs,
    queuePressure,
    queuePressureLabel:
      queuePressure >= 80 ? "Critical" : queuePressure >= 55 ? "Needs attention" : queuePressure >= 25 ? "Watch" : "Stable",
    activeJobs,
    delayedJobs,
    stuckJobs,
    retries,
    deadLetterJobs,
    executionLatencyMs:
      latencySamples.length > 0
        ? Math.round(latencySamples.reduce((sum, value) => sum + value, 0) / latencySamples.length)
        : 0,
    providerFailures: jobs.filter((job) => String(job.last_error ?? "").toLowerCase().includes("provider")).length,
    providerHealth,
    workerHealth:
      stuckJobs > 0 || deadLetterJobs > 0
        ? "Needs attention"
        : retries > 0 || delayedJobs > 0
          ? "Watch"
          : "Healthy",
    ownerSummary:
      deadLetterJobs > 0
        ? `${deadLetterJobs} background task${deadLetterJobs === 1 ? "" : "s"} need review.`
        : retries > 0
          ? `${retries} background task${retries === 1 ? " is" : "s are"} retrying safely.`
          : activeJobs > 0
            ? `${activeJobs} background task${activeJobs === 1 ? " is" : "s are"} waiting or running.`
            : "Background work is clear.",
    degradedSystems: Array.from(
      new Set(
        jobs
          .filter((job) => job.status === "dead_letter" || job.status === "retrying")
          .map((job) => String(job.job_type))
      )
    ),
  };
}

async function writeJobAudit(
  job: Record<string, any>,
  status: DurableJobStatus,
  failureReason: string | null,
  durationMs: number
) {
  const auditAction = `Operational job ${status}: ${job.job_type}`;
  const auditMeta = {
    operationalEvent: true,
    category: "AUTONOMOUS_ACTION",
    severity: status === "dead_letter" ? "CRITICAL" : status === "retrying" ? "WARNING" : "INFO",
    title: `Operational job ${status.replaceAll("_", " ")}`,
    summary: failureReason ?? `${job.job_type} completed through durable worker execution.`,
    organizationId: job.organization_id,
    locationId: job.location_id,
    executionId: job.id,
    traceId: job.execution_trace_id,
    actorUserId: job.actor_user_id,
    actorRole: job.actor_role,
    retryCount: job.attempt_count,
    durationMs,
    failureReason,
    recoveryAction: status === "dead_letter" ? "dead_letter_queue" : status === "retrying" ? "retry_scheduled" : "none",
    idempotencyKey: job.idempotency_key,
  };

  await supabaseAdmin.from("audit_logs").insert({
    action: auditAction,
    staff: "Valsentra Durable Worker",
    order_id: String(job.payload?.orderId ?? "OPERATIONAL_JOB"),
    organization_id: job.organization_id,
    location_id: job.location_id,
    meta: auditMeta,
  });

  await appendOperationalTimelineFromAudit({
    action: auditAction,
    staff: "Valsentra Durable Worker",
    orderId: String(job.payload?.orderId ?? "OPERATIONAL_JOB"),
    organizationId: job.organization_id,
    locationId: job.location_id,
    meta: auditMeta,
  });
}
