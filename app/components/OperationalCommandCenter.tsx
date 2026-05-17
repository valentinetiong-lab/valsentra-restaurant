"use client";

import { useEffect, useMemo, useState } from "react";
import { Activity, BellOff, Gauge, ShieldAlert, TimerReset } from "lucide-react";
import type { OperationalPolicyResolution, OperationalPolicyState } from "@/app/lib/operationalPolicyOrchestrator";

type OperationalCommandCenterProps = {
  compact?: boolean;
  staffMode?: boolean;
};

function stateClasses(state: OperationalPolicyState) {
  if (state === "POLICY_COLLAPSE_PROTECTION") return "border-red-200 bg-red-50 text-red-900";
  if (state === "POLICY_PAYMENT_CRITICAL" || state === "POLICY_PROVIDER_DEGRADED") return "border-amber-200 bg-amber-50 text-amber-900";
  if (state === "POLICY_RECOVERY_LIMITED" || state === "POLICY_RUSH_PRIORITY") return "border-blue-200 bg-blue-50 text-blue-900";
  return "border-neutral-200 bg-white text-neutral-900";
}

function labelFor(state: OperationalPolicyState) {
  if (state === "POLICY_COLLAPSE_PROTECTION") return "Rush protection active";
  if (state === "POLICY_PAYMENT_CRITICAL") return "Payments first";
  if (state === "POLICY_RECOVERY_LIMITED") return "Recovery slowed";
  if (state === "POLICY_PROVIDER_DEGRADED") return "Messages delayed";
  if (state === "POLICY_RUSH_PRIORITY") return "Rush priority";
  return "Normal policy";
}

function iconFor(value: string) {
  if (value.includes("reminder") || value.includes("notification")) return <BellOff className="h-4 w-4" />;
  if (value.includes("Recovery")) return <TimerReset className="h-4 w-4" />;
  if (value.includes("Payment")) return <ShieldAlert className="h-4 w-4" />;
  return <Gauge className="h-4 w-4" />;
}

export default function OperationalCommandCenter({
  compact = false,
  staffMode = false,
}: OperationalCommandCenterProps) {
  const [snapshot, setSnapshot] = useState<OperationalPolicyResolution | null>(null);

  useEffect(() => {
    let mounted = true;

    async function load() {
      try {
        const res = await fetch("/api/operational/command-center", { cache: "no-store" });
        const data = await res.json();
        if (mounted && res.ok && data?.commandCenter) setSnapshot(data.commandCenter);
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

  const visibleRules = useMemo(() => {
    if (!snapshot) return [];
    return [
      ...snapshot.activeSuppressions,
      ...snapshot.activeThrottles,
      ...snapshot.conflictResolutions,
    ].slice(0, compact ? 3 : 8);
  }, [compact, snapshot]);

  if (!snapshot) {
    return (
      <section className="rounded-[24px] border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-600">
        Checking operational command center...
      </section>
    );
  }

  return (
    <section className={`rounded-[28px] border p-5 shadow-sm md:p-6 ${stateClasses(snapshot.activePolicyState)}`}>
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="inline-flex items-center gap-2 text-sm font-bold uppercase tracking-[0.14em] opacity-75">
            <Activity className="h-4 w-4" />
            {staffMode ? "Command Center" : "Operational Command Center"}
          </p>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight">
            {staffMode ? snapshot.staffGuidance[0] : labelFor(snapshot.activePolicyState)}
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 opacity-85">
            {staffMode ? snapshot.staffGuidance.join(" · ") : snapshot.ownerSummary}
          </p>
        </div>
        <div className="rounded-2xl border border-white/75 bg-white/75 px-5 py-4 text-right shadow-sm">
          <p className="text-xl font-semibold tracking-tight">{snapshot.recoveryPacingState}</p>
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] opacity-70">
            recovery pace
          </p>
        </div>
      </div>

      {visibleRules.length > 0 ? (
        <div className={`mt-4 grid gap-3 ${compact ? "" : "md:grid-cols-2 xl:grid-cols-3"}`}>
          {visibleRules.map((item) => (
            <div key={item} className="rounded-2xl border border-white/80 bg-white/75 p-4">
              <p className="inline-flex items-center gap-2 text-sm font-semibold">
                {iconFor(item)}
                {item}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-4 rounded-2xl border border-white/80 bg-white/75 p-4 text-sm font-semibold">
          No command overrides are active right now.
        </div>
      )}

      {!compact && snapshot.commandStream.length > 0 ? (
        <div className="mt-4 rounded-2xl border border-white/80 bg-white/75 p-4">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] opacity-70">
            Command stream
          </p>
          <div className="mt-3 space-y-2">
            {snapshot.commandStream.slice(0, 5).map((event) => (
              <div key={event.id} className="flex items-start justify-between gap-3 rounded-xl border border-white/80 bg-white/70 px-3 py-2 text-sm">
                <div>
                  <p className="font-semibold">{event.eventType.replaceAll("_", " ")}</p>
                  <p className="mt-0.5 opacity-75">{event.summary}</p>
                </div>
                <span className="shrink-0 text-xs font-bold opacity-60">
                  {new Date(event.timestamp).toLocaleTimeString("en-MY", { hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
