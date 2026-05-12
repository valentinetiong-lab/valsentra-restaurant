"use client";

import type { ReactNode } from "react";
import { Activity, RotateCcw, Server, ShieldCheck, WifiOff } from "lucide-react";

export type InfrastructureHealth = {
  queuePressure: number;
  providerLatency: number;
  failedExecutions: number;
  retryStorms: number;
  communicationOutages: number;
  recoveryBottlenecks: number;
  operationalDegradation: number;
  infrastructureStabilityScore: number;
  providerHealth: "HEALTHY" | "DEGRADED" | "OUTAGE_RISK";
  degradedSystems: string[];
  retryActivity: number;
  organizationId: string;
  executionPartitions: Array<{ partitionKey: string; pressure: number }>;
  tenantSafeDiagnostics: string[];
};

function healthClasses(value?: InfrastructureHealth["providerHealth"]) {
  if (value === "OUTAGE_RISK") return "border-red-100 bg-red-50 text-red-700";
  if (value === "DEGRADED") return "border-amber-100 bg-amber-50 text-amber-700";
  return "border-emerald-100 bg-emerald-50 text-emerald-700";
}

function Bar({ label, value }: { label: string; value: number }) {
  const width = Math.max(0, Math.min(Math.round(value), 100));
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-neutral-500">
        <span>{label}</span>
        <span>{width}/100</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-neutral-100">
        <div className="h-full rounded-full bg-neutral-900 transition-all duration-700" style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

export default function InfrastructureHealthPanel({
  health,
  emptyState = false,
}: {
  health?: InfrastructureHealth | null;
  emptyState?: boolean;
}) {
  if (!health) {
    if (!emptyState) return null;
    return (
      <section className="rounded-[24px] border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-600">
        No infrastructure health snapshot yet. The continuous engine will publish queue, provider, retry, and degradation health after the next pass.
      </section>
    );
  }

  return (
    <section className="rounded-[32px] border border-neutral-200/80 bg-white p-6 shadow-[0_18px_60px_rgba(15,23,42,0.05)] md:p-8">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-500">
            <Server className="h-3.5 w-3.5 text-neutral-700" />
            Production Infrastructure
          </p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-neutral-950">
            Stability {health.infrastructureStabilityScore}/100
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-600">
            Queue, provider, webhook, retry, and recovery execution health for organization scope {health.organizationId}.
          </p>
        </div>
        <span className={`rounded-full border px-3 py-1.5 text-[11px] font-semibold ${healthClasses(health.providerHealth)}`}>
          {health.providerHealth.replaceAll("_", " ")}
        </span>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-4">
        <Metric icon={<Activity className="h-3.5 w-3.5" />} label="Queue pressure" value={`${health.queuePressure}/100`} />
        <Metric icon={<WifiOff className="h-3.5 w-3.5" />} label="Failed executions" value={String(health.failedExecutions)} />
        <Metric icon={<RotateCcw className="h-3.5 w-3.5" />} label="Retry activity" value={String(health.retryActivity)} />
        <Metric icon={<ShieldCheck className="h-3.5 w-3.5" />} label="Bottlenecks" value={String(health.recoveryBottlenecks)} />
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_0.9fr]">
        <div className="rounded-[24px] border border-neutral-200 bg-neutral-50/80 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-500">
            Infrastructure pressure
          </p>
          <div className="mt-3 space-y-3">
            <Bar label="Queue pressure" value={health.queuePressure} />
            <Bar label="Provider latency" value={health.providerLatency} />
            <Bar label="Retry storms" value={health.retryStorms} />
            <Bar label="Operational degradation" value={health.operationalDegradation} />
          </div>
        </div>

        <div className="rounded-[24px] border border-neutral-200 bg-neutral-50/80 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-500">
            Degraded systems
          </p>
          <div className="mt-3 space-y-2">
            {(health.degradedSystems.length > 0
              ? health.degradedSystems
              : ["No degraded infrastructure systems detected."]
            ).map((item) => (
              <div key={item} className="rounded-2xl border border-neutral-200 bg-white px-3 py-2 text-sm leading-5 text-neutral-600">
                {item}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-5 rounded-[24px] border border-neutral-200 bg-neutral-50/80 p-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-500">
          Tenant-safe diagnostics
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {health.tenantSafeDiagnostics.map((item) => (
            <span key={item} className="rounded-full border border-neutral-200 bg-white px-2.5 py-1 text-[11px] font-medium text-neutral-600">
              {item}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

function Metric({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
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
