"use client";

import { useEffect, useMemo, useState } from "react";
import { Activity, Clock3, Gauge, Radio, ShieldCheck } from "lucide-react";
import type {
  PersistentOperationalRuntimeSnapshot,
  PersistentRuntimeState,
} from "@/app/lib/persistentOperationalRuntime";
import type { LiveOperationalSyncSnapshot } from "@/app/lib/liveOperationalSyncEngine";

type OperationalRuntimePanelProps = {
  compact?: boolean;
  staffMode?: boolean;
};

function stateClasses(state: PersistentRuntimeState) {
  if (state === "RUNTIME_OVERLOADED") return "border-red-200 bg-red-50 text-red-900";
  if (state === "RUNTIME_DEGRADED") return "border-amber-200 bg-amber-50 text-amber-900";
  if (state === "RUNTIME_ELEVATED" || state === "RUNTIME_RECOVERING") return "border-blue-200 bg-blue-50 text-blue-900";
  return "border-neutral-200 bg-white text-neutral-900";
}

function stateLabel(state: PersistentRuntimeState) {
  if (state === "RUNTIME_OVERLOADED") return "Runtime pressure high";
  if (state === "RUNTIME_DEGRADED") return "Runtime needs attention";
  if (state === "RUNTIME_ELEVATED") return "Runtime load elevated";
  if (state === "RUNTIME_RECOVERING") return "Runtime recovering";
  if (state === "RUNTIME_RESTARTING") return "Runtime restarting";
  return "Runtime healthy";
}

export default function OperationalRuntimePanel({
  compact = false,
  staffMode = false,
}: OperationalRuntimePanelProps) {
  const [runtime, setRuntime] = useState<PersistentOperationalRuntimeSnapshot | null>(null);
  const [sync, setSync] = useState<LiveOperationalSyncSnapshot | null>(null);

  useEffect(() => {
    let mounted = true;

    async function load() {
      try {
        const [runtimeRes, syncRes] = await Promise.all([
          fetch("/api/operational/runtime", { cache: "no-store" }),
          fetch("/api/operational/live-sync", { cache: "no-store" }),
        ]);
        const [runtimeData, syncData] = await Promise.all([
          runtimeRes.json(),
          syncRes.json(),
        ]);
        if (mounted && runtimeRes.ok && runtimeData?.runtime) setRuntime(runtimeData.runtime);
        if (mounted && syncRes.ok && syncData?.sync) setSync(syncData.sync);
      } catch (error) {
        console.error(error);
      }
    }

    void load();
    const interval = setInterval(load, 20_000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  const visibleEngines = useMemo(
    () => runtime?.engines.slice(0, compact ? 2 : 5) ?? [],
    [compact, runtime]
  );

  if (!runtime) {
    return (
      <section className="rounded-[24px] border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-600">
        Checking live operational runtime...
      </section>
    );
  }

  return (
    <section className={`rounded-[28px] border p-5 shadow-sm md:p-6 ${stateClasses(runtime.state)}`}>
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="inline-flex items-center gap-2 text-sm font-bold uppercase tracking-[0.14em] opacity-75">
            <Radio className="h-4 w-4" />
            {staffMode ? "Live System" : "Persistent Operational Runtime"}
          </p>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight">
            {staffMode
              ? runtime.backoffActive
                ? "System pacing safely"
                : stateLabel(runtime.state)
              : stateLabel(runtime.state)}
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 opacity-85">
            {staffMode
              ? "Valsentra is keeping live service updates synchronized and slowing non-critical work when needed."
              : "Runtime heartbeat, engine cadence, queue pressure, and live sync are being monitored without changing payment truth or release safety."}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 text-right">
          <div className="rounded-2xl border border-white/75 bg-white/75 px-4 py-3 shadow-sm">
            <p className="text-2xl font-semibold tracking-tight">{runtime.runtimePressure}</p>
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] opacity-70">pressure</p>
          </div>
          <div className="rounded-2xl border border-white/75 bg-white/75 px-4 py-3 shadow-sm">
            <p className="text-2xl font-semibold tracking-tight">{Math.round(runtime.averageEngineLatencyMs)}ms</p>
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] opacity-70">latency</p>
          </div>
        </div>
      </div>

      <div className={`mt-4 grid gap-3 ${compact ? "" : "md:grid-cols-3"}`}>
        <div className="rounded-2xl border border-white/80 bg-white/75 p-4">
          <p className="inline-flex items-center gap-2 text-sm font-semibold">
            <Activity className="h-4 w-4" />
            Heartbeat live
          </p>
          <p className="mt-1 text-xs font-bold uppercase tracking-[0.12em] opacity-65">
            {new Date(runtime.heartbeatAt).toLocaleTimeString("en-MY", { hour: "2-digit", minute: "2-digit" })}
          </p>
        </div>
        <div className="rounded-2xl border border-white/80 bg-white/75 p-4">
          <p className="inline-flex items-center gap-2 text-sm font-semibold">
            <Clock3 className="h-4 w-4" />
            {runtime.backoffActive ? "Backoff active" : "Normal cadence"}
          </p>
          <p className="mt-1 text-sm opacity-80">
            {Math.round(runtime.executionCadenceMs / 1000)}s cadence
          </p>
        </div>
        <div className="rounded-2xl border border-white/80 bg-white/75 p-4">
          <p className="inline-flex items-center gap-2 text-sm font-semibold">
            <ShieldCheck className="h-4 w-4" />
            {sync?.throttled ? "Sync throttled safely" : "Sync current"}
          </p>
          <p className="mt-1 text-sm opacity-80">
            {sync?.changed ? "New live state available" : "No live state change"}
          </p>
        </div>
      </div>

      {!staffMode && visibleEngines.length > 0 ? (
        <div className={`mt-4 grid gap-3 ${compact ? "" : "md:grid-cols-2"}`}>
          {visibleEngines.map((engine) => (
            <div key={`${engine.engine}-${engine.startedAt}`} className="rounded-2xl border border-white/80 bg-white/75 p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="inline-flex items-center gap-2 text-sm font-semibold">
                  <Gauge className="h-4 w-4" />
                  {engine.engine}
                </p>
                <span className="rounded-full border border-white/80 bg-white px-2.5 py-1 text-[11px] font-bold">
                  {engine.status}
                </span>
              </div>
              <p className="mt-1 text-sm leading-5 opacity-80">{engine.summary}</p>
              <p className="mt-2 text-xs font-bold uppercase tracking-[0.12em] opacity-65">
                {engine.latencyMs}ms
              </p>
            </div>
          ))}
        </div>
      ) : null}

      {runtime.degradedSystems.length > 0 ? (
        <div className="mt-4 rounded-2xl border border-white/80 bg-white/75 p-4 text-sm font-semibold">
          {runtime.degradedSystems.slice(0, compact ? 2 : 4).join(" ")}
        </div>
      ) : null}
    </section>
  );
}
