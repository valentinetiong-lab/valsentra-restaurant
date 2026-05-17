"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Gauge, MessageSquareWarning, ShieldAlert, Users } from "lucide-react";
import type { OperationalCapacitySnapshot, OperationalPressureState } from "@/app/lib/operationalCapacityEngine";

type OperationalCapacityPanelProps = {
  compact?: boolean;
  staffMode?: boolean;
};

function stateClasses(state: OperationalPressureState) {
  if (state === "COLLAPSE_RISK") return "border-red-300 bg-red-50 text-red-900";
  if (state === "CRITICAL") return "border-red-200 bg-red-50 text-red-800";
  if (state === "HIGH_PRESSURE") return "border-amber-200 bg-amber-50 text-amber-900";
  if (state === "ELEVATED") return "border-blue-200 bg-blue-50 text-blue-900";
  return "border-emerald-200 bg-emerald-50 text-emerald-900";
}

function stateLabel(state: OperationalPressureState) {
  if (state === "COLLAPSE_RISK") return "Service Pressure High";
  if (state === "CRITICAL") return "Manager Attention Needed";
  if (state === "HIGH_PRESSURE") return "Rush Pressure High";
  if (state === "ELEVATED") return "Pressure Rising";
  return "Service Stable";
}

function iconFor(type: string) {
  if (type === "ARRIVAL_PRESSURE") return <Users className="h-4 w-4" />;
  if (type === "PAYMENT_PRESSURE") return <ShieldAlert className="h-4 w-4" />;
  if (type === "MESSAGE_PRESSURE") return <MessageSquareWarning className="h-4 w-4" />;
  if (type === "PROVIDER_PRESSURE" || type === "WORKER_PRESSURE") return <AlertTriangle className="h-4 w-4" />;
  return <Gauge className="h-4 w-4" />;
}

export default function OperationalCapacityPanel({
  compact = false,
  staffMode = false,
}: OperationalCapacityPanelProps) {
  const [snapshot, setSnapshot] = useState<OperationalCapacitySnapshot | null>(null);

  useEffect(() => {
    let mounted = true;

    async function load() {
      try {
        const res = await fetch("/api/operational/capacity", { cache: "no-store" });
        const data = await res.json();
        if (mounted && res.ok && data?.capacity) setSnapshot(data.capacity);
      } catch (error) {
        console.error(error);
      }
    }

    void load();
    const interval = setInterval(load, 30_000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  const visibleSignals = useMemo(
    () => snapshot?.signals.slice(0, compact ? 2 : 4) ?? [],
    [compact, snapshot]
  );

  if (!snapshot) {
    return (
      <section className="rounded-[24px] border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-600">
        Checking service pressure...
      </section>
    );
  }

  return (
    <section className={`rounded-[28px] border p-5 shadow-sm md:p-6 ${stateClasses(snapshot.state)}`}>
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.14em] opacity-75">
            {staffMode ? "Live Service Pressure" : "Operational Capacity"}
          </p>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight">
            {stateLabel(snapshot.state)}
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 opacity-85">
            {staffMode ? snapshot.staffGuidance[0] : snapshot.ownerSummary}
          </p>
        </div>
        <div className="rounded-2xl border border-white/70 bg-white/70 px-5 py-4 text-right shadow-sm">
          <p className="text-3xl font-semibold tracking-tight">{snapshot.score}</p>
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] opacity-70">
            pressure
          </p>
        </div>
      </div>

      {staffMode ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {snapshot.staffGuidance.slice(0, 5).map((item) => (
            <span key={item} className="rounded-full border border-white/80 bg-white/75 px-3 py-2 text-sm font-bold">
              {item}
            </span>
          ))}
        </div>
      ) : null}

      {visibleSignals.length > 0 ? (
        <div className={`mt-4 grid gap-3 ${compact ? "" : "md:grid-cols-2"}`}>
          {visibleSignals.map((signal) => (
            <div key={signal.type} className="rounded-2xl border border-white/80 bg-white/75 p-4">
              <p className="inline-flex items-center gap-2 text-sm font-semibold">
                {iconFor(signal.type)}
                {signal.label}
              </p>
              <p className="mt-1 text-sm leading-5 opacity-80">{signal.summary}</p>
              {!staffMode ? (
                <p className="mt-2 text-xs font-semibold opacity-70">{signal.recommendation}</p>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-4 rounded-2xl border border-white/80 bg-white/75 p-4 text-sm font-semibold">
          No capacity warnings right now.
        </div>
      )}

      {!compact && snapshot.safetyActions.length > 0 ? (
        <div className="mt-4 rounded-2xl border border-white/80 bg-white/75 p-4">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] opacity-70">
            System guidance
          </p>
          <ul className="mt-2 space-y-1.5 text-sm leading-5">
            {snapshot.safetyActions.map((action) => (
              <li key={action}>- {action}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
