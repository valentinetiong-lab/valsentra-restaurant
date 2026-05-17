"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, CircleAlert } from "lucide-react";

type Health = {
  status: "READY" | "WATCH" | "NEEDS_REVIEW";
  environmentReady: boolean;
  providers: {
    liveCommunicationChannels: string[];
    livePaymentsEnabled: boolean;
  };
  jobs: {
    deadLetterJobs: number;
    retries: number;
    delayedJobs: number;
  };
};

export default function PilotReadinessChecklist() {
  const [health, setHealth] = useState<Health | null>(null);

  useEffect(() => {
    let mounted = true;
    async function load() {
      const res = await fetch("/api/operational/health", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      if (mounted) setHealth(data);
    }
    void load();
    return () => {
      mounted = false;
    };
  }, []);

  if (!health) return null;

  const checks = [
    {
      label: "Business account ready",
      ok: health.environmentReady,
      detail: health.environmentReady ? "Core environment is valid." : "Missing required production configuration.",
    },
    {
      label: "Customer messaging ready",
      ok: health.providers.liveCommunicationChannels.length > 0,
      detail:
        health.providers.liveCommunicationChannels.length > 0
          ? `${health.providers.liveCommunicationChannels.join(", ")} enabled.`
          : "Enable WhatsApp/SMS/email before relying on live reminders.",
    },
    {
      label: "Payment provider ready",
      ok: health.providers.livePaymentsEnabled,
      detail: health.providers.livePaymentsEnabled
        ? "Live payment provider is enabled."
        : "Manual payment checks are available; provider verification is not live yet.",
    },
    {
      label: "Background work clear",
      ok: health.jobs.deadLetterJobs === 0,
      detail:
        health.jobs.deadLetterJobs === 0
          ? "No stuck failed work needs review."
          : `${health.jobs.deadLetterJobs} failed task${health.jobs.deadLetterJobs === 1 ? "" : "s"} need review.`,
    },
  ];

  return (
    <section className="rounded-[32px] border border-neutral-200/80 bg-white p-5 shadow-[0_18px_60px_rgba(15,23,42,0.05)] md:p-6">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-neutral-500">
        Pilot Readiness
      </p>
      <h2 className="mt-2 text-2xl font-semibold tracking-tight text-neutral-950">
        First-run safety checks
      </h2>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {checks.map((check) => (
          <div key={check.label} className="rounded-2xl border border-neutral-200 bg-neutral-50/80 p-4">
            <p className="inline-flex items-center gap-2 text-sm font-semibold text-neutral-950">
              {check.ok ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              ) : (
                <CircleAlert className="h-4 w-4 text-amber-600" />
              )}
              {check.label}
            </p>
            <p className="mt-1 text-sm leading-5 text-neutral-600">{check.detail}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
