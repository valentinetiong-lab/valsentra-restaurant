"use client";

import { useEffect, useState } from "react";
import { Activity, AlertTriangle, Clock, DatabaseZap, RotateCcw } from "lucide-react";

type JobSnapshot = {
  organizationId: string;
  queuePressure: number;
  queuePressureLabel?: string;
  activeJobs?: number;
  delayedJobs?: number;
  stuckJobs: number;
  retries: number;
  deadLetterJobs: number;
  executionLatencyMs: number;
  providerFailures: number;
  workerHealth?: string;
  ownerSummary?: string;
  degradedSystems: string[];
  providerHealth?: {
    liveCommunicationChannels?: string[];
    livePaymentsEnabled?: boolean;
  };
  jobs: Array<{
    id: string;
    job_type: string;
    status: string;
    priority: string;
    attempt_count: number;
    max_attempts: number;
    last_error?: string | null;
    created_at: string;
  }>;
};

export default function OperationalWorkerPanel() {
  const [snapshot, setSnapshot] = useState<JobSnapshot | null>(null);

  useEffect(() => {
    let mounted = true;

    async function load() {
      const res = await fetch("/api/operational/jobs", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      if (mounted) setSnapshot(data);
    }

    void load();
    const interval = setInterval(load, 30_000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  if (!snapshot) {
    return (
      <section className="rounded-[24px] border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-600">
        Durable worker telemetry will appear after the first job is queued.
      </section>
    );
  }

  return (
    <section className="rounded-[32px] border border-neutral-200/80 bg-white p-6 shadow-[0_18px_60px_rgba(15,23,42,0.05)] md:p-8">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-500">
            <DatabaseZap className="h-3.5 w-3.5 text-neutral-700" />
            Background Work
          </p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-neutral-950">
            {snapshot.workerHealth ?? "Healthy"} · {snapshot.queuePressureLabel ?? "Stable"}
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-600">
            {snapshot.ownerSummary ?? `Background task health for business scope ${snapshot.organizationId}.`}
          </p>
        </div>
        <span className="rounded-full border border-neutral-200 bg-neutral-50 px-3 py-1.5 text-[11px] font-semibold text-neutral-700">
          {snapshot.jobs.length} recent jobs
        </span>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-5">
        <Metric icon={<Activity className="h-3.5 w-3.5" />} label="Workload" value={`${snapshot.queuePressure}/100`} />
        <Metric icon={<Clock className="h-3.5 w-3.5" />} label="Delay" value={String(snapshot.delayedJobs ?? 0)} />
        <Metric icon={<RotateCcw className="h-3.5 w-3.5" />} label="Retrying" value={String(snapshot.retries)} />
        <Metric icon={<AlertTriangle className="h-3.5 w-3.5" />} label="Needs review" value={String(snapshot.deadLetterJobs)} />
        <Metric icon={<AlertTriangle className="h-3.5 w-3.5" />} label="Provider issues" value={String(snapshot.providerFailures)} />
      </div>

      <div className="mt-4 rounded-2xl border border-neutral-200 bg-neutral-50/80 p-4 text-sm text-neutral-600">
        <p className="font-semibold text-neutral-900">Provider readiness</p>
        <p className="mt-1">
          Live message channels:{" "}
          {(snapshot.providerHealth?.liveCommunicationChannels ?? []).length > 0
            ? snapshot.providerHealth?.liveCommunicationChannels?.join(", ")
            : "none configured"}
          . Live payments: {snapshot.providerHealth?.livePaymentsEnabled ? "enabled" : "not enabled"}.
        </p>
      </div>

      <div className="mt-5 overflow-hidden rounded-[24px] border border-neutral-200">
        {snapshot.jobs.slice(0, 8).map((job) => (
          <div key={job.id} className="grid gap-3 border-b border-neutral-100 bg-neutral-50/50 p-4 text-sm last:border-b-0 md:grid-cols-[1.1fr_0.7fr_0.5fr_1fr]">
            <div>
              <p className="font-semibold text-neutral-950">{job.job_type.replaceAll("_", " ")}</p>
              <p className="mt-1 text-xs text-neutral-500">{new Date(job.created_at).toLocaleString()}</p>
            </div>
            <span className="text-neutral-700">{job.status.replaceAll("_", " ")}</span>
            <span className="text-neutral-700">{job.attempt_count}/{job.max_attempts}</span>
            <span className="truncate text-neutral-500">{job.last_error ?? "No issue recorded"}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-neutral-50/80 p-4">
      <p className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-neutral-500">
        {icon}
        {label}
      </p>
      <p className="mt-2 text-lg font-semibold text-neutral-950">{value}</p>
    </div>
  );
}
