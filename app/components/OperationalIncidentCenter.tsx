"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock, MessageSquareWarning, ShieldAlert } from "lucide-react";

type OperationalHealth = {
  status: "READY" | "WATCH" | "NEEDS_REVIEW";
  ownerSummary: string;
  issues: string[];
  jobs: {
    queuePressure: number;
    delayedJobs: number;
    retries: number;
    deadLetterJobs: number;
    providerFailures: number;
  };
  providers: {
    liveCommunicationChannels: string[];
    livePaymentsEnabled: boolean;
  };
  whatsappDelivery?: {
    sent: number;
    delivered: number;
    read: number;
    failed: number;
    retrying: number;
    suppressed: number;
  };
};

function statusClasses(status: OperationalHealth["status"]) {
  if (status === "NEEDS_REVIEW") return "border-red-200 bg-red-50 text-red-800";
  if (status === "WATCH") return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-emerald-200 bg-emerald-50 text-emerald-800";
}

export default function OperationalIncidentCenter({ compact = false }: { compact?: boolean }) {
  const [health, setHealth] = useState<OperationalHealth | null>(null);

  useEffect(() => {
    let mounted = true;

    async function load() {
      const res = await fetch("/api/operational/health", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      if (mounted) setHealth(data);
    }

    void load();
    const interval = setInterval(load, 30_000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  const operationalAlerts = useMemo(() => {
    if (!health) return [];
    return [
      health.jobs.deadLetterJobs > 0
        ? {
            icon: <ShieldAlert className="h-4 w-4" />,
            title: "Some work needs review",
            detail: `${health.jobs.deadLetterJobs} background task${health.jobs.deadLetterJobs === 1 ? "" : "s"} could not finish.`,
          }
        : null,
      health.jobs.delayedJobs > 0
        ? {
            icon: <Clock className="h-4 w-4" />,
            title: "Some actions may run late",
            detail: `${health.jobs.delayedJobs} task${health.jobs.delayedJobs === 1 ? " is" : "s are"} delayed.`,
          }
        : null,
      health.jobs.providerFailures > 0
        ? {
            icon: <MessageSquareWarning className="h-4 w-4" />,
            title: "Messages may be delayed",
            detail: "A provider attempt failed. Valsentra will retry safely when allowed.",
          }
        : null,
      health.providers.liveCommunicationChannels.length === 0
        ? {
            icon: <AlertTriangle className="h-4 w-4" />,
            title: "Customer messages are not live",
            detail: "WhatsApp/SMS/email are not fully enabled for this business yet.",
          }
        : null,
      health.whatsappDelivery && health.whatsappDelivery.failed > 0
        ? {
            icon: <MessageSquareWarning className="h-4 w-4" />,
            title: "WhatsApp messages need attention",
            detail: `${health.whatsappDelivery.failed} message${health.whatsappDelivery.failed === 1 ? "" : "s"} failed. Valsentra keeps the event visible for safe retry.`,
          }
        : null,
      health.whatsappDelivery && health.whatsappDelivery.suppressed > 0
        ? {
            icon: <Clock className="h-4 w-4" />,
            title: "Reminders reduced during rush",
            detail: "Non-critical WhatsApp reminders were slowed to protect staff focus.",
          }
        : null,
      !health.providers.livePaymentsEnabled
        ? {
            icon: <AlertTriangle className="h-4 w-4" />,
            title: "Live payment provider not ready",
            detail: "Staff can still use manual payment checks, but live provider verification is not enabled.",
          }
        : null,
    ].filter(Boolean) as Array<{ icon: ReactNode; title: string; detail: string }>;
  }, [health]);

  if (!health) {
    return (
      <section className="rounded-[24px] border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-600">
        Checking operational readiness...
      </section>
    );
  }

  return (
    <section className="rounded-[32px] border border-neutral-200/80 bg-white p-5 shadow-[0_18px_60px_rgba(15,23,42,0.05)] md:p-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-neutral-500">
            Incident Center
          </p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-neutral-950">
            {health.status === "READY" ? "Operation looks ready" : "Needs attention"}
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-600">
            {health.ownerSummary}
          </p>
        </div>
        <span className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${statusClasses(health.status)}`}>
          {health.status.replaceAll("_", " ")}
        </span>
      </div>

      <div className={`mt-4 grid gap-3 ${compact ? "" : "md:grid-cols-2"}`}>
        {operationalAlerts.length > 0 ? (
          operationalAlerts.slice(0, compact ? 3 : 6).map((alert) => (
            <div key={alert.title} className="rounded-2xl border border-neutral-200 bg-neutral-50/80 p-4">
              <p className="inline-flex items-center gap-2 text-sm font-semibold text-neutral-950">
                {alert.icon}
                {alert.title}
              </p>
              <p className="mt-1 text-sm leading-5 text-neutral-600">{alert.detail}</p>
            </div>
          ))
        ) : (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
            <p className="inline-flex items-center gap-2 font-semibold">
              <CheckCircle2 className="h-4 w-4" />
              No operational incidents right now
            </p>
            <p className="mt-1">Background work, provider readiness, and retries look clear.</p>
          </div>
        )}
      </div>
    </section>
  );
}
