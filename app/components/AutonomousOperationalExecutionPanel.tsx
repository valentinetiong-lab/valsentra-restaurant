"use client";

import { useEffect, useMemo, useState } from "react";
import { Activity, BellOff, Clock3, Gauge, ShieldCheck } from "lucide-react";
import type {
  AutonomousOperationalExecutionResult,
  AutonomousOperationalExecutionState,
  SafeOperationalAction,
} from "@/app/lib/autonomousOperationalExecutionEngine";

type AutonomousOperationalExecutionPanelProps = {
  compact?: boolean;
  staffMode?: boolean;
};

function stateClasses(state: AutonomousOperationalExecutionState) {
  if (state === "EXECUTION_RUSH_LOCK") return "border-red-200 bg-red-50 text-red-900";
  if (state === "EXECUTION_THROTTLING" || state === "EXECUTION_SUPPRESSING") return "border-amber-200 bg-amber-50 text-amber-900";
  if (state === "EXECUTION_RECOVERY_MODE" || state === "EXECUTION_COOLDOWN") return "border-blue-200 bg-blue-50 text-blue-900";
  if (state === "EXECUTION_STABILIZING") return "border-emerald-200 bg-emerald-50 text-emerald-900";
  return "border-neutral-200 bg-white text-neutral-900";
}

function stateLabel(state: AutonomousOperationalExecutionState) {
  if (state === "EXECUTION_RUSH_LOCK") return "Rush Protection Active";
  if (state === "EXECUTION_THROTTLING") return "Operational pace reduced";
  if (state === "EXECUTION_SUPPRESSING") return "Notifications reduced";
  if (state === "EXECUTION_RECOVERY_MODE") return "Recovery slowed";
  if (state === "EXECUTION_COOLDOWN") return "Service stabilizing";
  if (state === "EXECUTION_STABILIZING") return "Stabilization active";
  return "No pacing action needed";
}

function iconFor(action: SafeOperationalAction) {
  if (action.actionType.includes("REMINDER") || action.actionType.includes("NOTIFICATION")) {
    return <BellOff className="h-4 w-4" />;
  }
  if (action.actionType.includes("RECOVERY") || action.actionType.includes("WAITLIST")) {
    return <Clock3 className="h-4 w-4" />;
  }
  if (action.actionType.includes("PAYMENT") || action.actionType.includes("ARRIVAL")) {
    return <Gauge className="h-4 w-4" />;
  }
  return <ShieldCheck className="h-4 w-4" />;
}

export default function AutonomousOperationalExecutionPanel({
  compact = false,
  staffMode = false,
}: AutonomousOperationalExecutionPanelProps) {
  const [execution, setExecution] = useState<AutonomousOperationalExecutionResult | null>(null);

  useEffect(() => {
    let mounted = true;

    async function load() {
      try {
        const res = await fetch("/api/operational/execution", { cache: "no-store" });
        const data = await res.json();
        if (mounted && res.ok && data?.execution) setExecution(data.execution);
      } catch (error) {
        console.error(error);
      }
    }

    void load();
    const interval = setInterval(load, 45_000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  const visibleActions = useMemo(
    () => execution?.actionsExecuted.slice(0, compact ? 2 : 5) ?? [],
    [compact, execution]
  );

  if (!execution) {
    return (
      <section className="rounded-[24px] border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-600">
        Checking safe pacing actions...
      </section>
    );
  }

  return (
    <section className={`rounded-[28px] border p-5 shadow-sm md:p-6 ${stateClasses(execution.executionState)}`}>
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="inline-flex items-center gap-2 text-sm font-bold uppercase tracking-[0.14em] opacity-75">
            <Activity className="h-4 w-4" />
            {staffMode ? "Rush Protection" : "Autonomous Pacing"}
          </p>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight">
            {stateLabel(execution.executionState)}
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 opacity-85">
            {staffMode ? execution.staffGuidance[0] : execution.ownerSummary}
          </p>
        </div>
        <div className="rounded-2xl border border-white/75 bg-white/75 px-5 py-4 text-right shadow-sm">
          <p className="text-3xl font-semibold tracking-tight">{execution.actionsExecuted.length}</p>
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] opacity-70">
            active
          </p>
        </div>
      </div>

      {staffMode ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {execution.staffGuidance.slice(0, 5).map((item) => (
            <span key={item} className="rounded-full border border-white/80 bg-white/75 px-3 py-2 text-sm font-bold">
              {item}
            </span>
          ))}
        </div>
      ) : null}

      {visibleActions.length > 0 ? (
        <div className={`mt-4 grid gap-3 ${compact ? "" : "md:grid-cols-2 xl:grid-cols-3"}`}>
          {visibleActions.map((action) => (
            <div key={action.actionType} className="rounded-2xl border border-white/80 bg-white/75 p-4">
              <p className="inline-flex items-center gap-2 text-sm font-semibold">
                {iconFor(action)}
                {action.label}
              </p>
              {!staffMode ? (
                <p className="mt-1 text-sm leading-5 opacity-80">{action.reason}</p>
              ) : null}
              <p className="mt-2 text-xs font-bold uppercase tracking-[0.12em] opacity-65">
                expires automatically
              </p>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-4 rounded-2xl border border-white/80 bg-white/75 p-4 text-sm font-semibold">
          Valsentra is watching service flow. No automatic pacing is active right now.
        </div>
      )}
    </section>
  );
}
