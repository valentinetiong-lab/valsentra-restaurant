"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, AlertTriangle, Clock3, CreditCard, Gauge, Users } from "lucide-react";
import type {
  LiveCoordinationState,
  LiveServiceCoordinationSnapshot,
} from "@/app/lib/liveServiceCoordinationEngine";

type LiveServiceCoordinationPanelProps = {
  compact?: boolean;
  staffMode?: boolean;
};

function stateClasses(state: LiveCoordinationState) {
  if (state === "RUSH_LOCK" || state === "SERVICE_STRAIN") return "border-red-200 bg-red-50 text-red-900";
  if (state === "PAYMENT_BOTTLENECK" || state === "RECOVERY_SATURATION") return "border-amber-200 bg-amber-50 text-amber-900";
  if (state === "ARRIVAL_WAVE" || state === "FULFILLMENT_DELAY") return "border-blue-200 bg-blue-50 text-blue-900";
  if (state === "STABILIZING") return "border-emerald-200 bg-emerald-50 text-emerald-900";
  return "border-neutral-200 bg-white text-neutral-900";
}

function stateLabel(state: LiveCoordinationState) {
  if (state === "NORMAL_FLOW") return "Normal Flow";
  if (state === "ARRIVAL_WAVE") return "Arrival Wave Detected";
  if (state === "PAYMENT_BOTTLENECK") return "Payments Need Attention";
  if (state === "RECOVERY_SATURATION") return "Recovery Slowed During Rush";
  if (state === "FULFILLMENT_DELAY") return "Service Running Late";
  if (state === "SERVICE_STRAIN") return "Rush Pressure High";
  if (state === "RUSH_LOCK") return "Rush Lock Active";
  return "Service Stabilizing";
}

function iconFor(area: string) {
  if (area === "ARRIVALS") return <Users className="h-4 w-4" />;
  if (area === "PAYMENTS") return <CreditCard className="h-4 w-4" />;
  if (area === "RECOVERY" || area === "REMINDERS") return <Clock3 className="h-4 w-4" />;
  if (area === "MANAGER") return <AlertTriangle className="h-4 w-4" />;
  return <Gauge className="h-4 w-4" />;
}

export default function LiveServiceCoordinationPanel({
  compact = false,
  staffMode = false,
}: LiveServiceCoordinationPanelProps) {
  const [snapshot, setSnapshot] = useState<LiveServiceCoordinationSnapshot | null>(null);
  const previousStateRef = useRef<LiveCoordinationState | null>(null);

  useEffect(() => {
    let mounted = true;

    async function load() {
      try {
        const params = previousStateRef.current
          ? `?previousState=${encodeURIComponent(previousStateRef.current)}`
          : "";
        const res = await fetch(`/api/operational/coordination${params}`, { cache: "no-store" });
        const data = await res.json();
        if (mounted && res.ok && data?.coordination) {
          previousStateRef.current = data.coordination.state;
          setSnapshot(data.coordination);
        }
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

  const visibleRecommendations = useMemo(
    () => snapshot?.pacingRecommendations.slice(0, compact ? 2 : 5) ?? [],
    [compact, snapshot]
  );

  if (!snapshot) {
    return (
      <section className="rounded-[24px] border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-600">
        Checking live service coordination...
      </section>
    );
  }

  return (
    <section className={`rounded-[28px] border p-5 shadow-sm md:p-6 ${stateClasses(snapshot.state)}`}>
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="inline-flex items-center gap-2 text-sm font-bold uppercase tracking-[0.14em] opacity-75">
            <Activity className="h-4 w-4" />
            {staffMode ? "Live Coordination" : "Service Coordination"}
          </p>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight">
            {stateLabel(snapshot.state)}
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 opacity-85">
            {staffMode ? snapshot.staffGuidance[0] : snapshot.ownerSummary}
          </p>
        </div>
        <div className="rounded-2xl border border-white/75 bg-white/75 px-5 py-4 text-right shadow-sm">
          <p className="text-3xl font-semibold tracking-tight">{snapshot.coordinationScore}</p>
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] opacity-70">
            pacing
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

      {visibleRecommendations.length > 0 ? (
        <div className={`mt-4 grid gap-3 ${compact ? "" : "md:grid-cols-2 xl:grid-cols-3"}`}>
          {visibleRecommendations.map((item) => (
            <div key={`${item.area}-${item.label}`} className="rounded-2xl border border-white/80 bg-white/75 p-4">
              <p className="inline-flex items-center gap-2 text-sm font-semibold">
                {iconFor(item.area)}
                {item.label}
              </p>
              {!staffMode ? (
                <p className="mt-1 text-sm leading-5 opacity-80">{item.guidance}</p>
              ) : null}
              <p className="mt-2 text-xs font-bold uppercase tracking-[0.12em] opacity-65">
                {item.throttle === "NONE" ? "Normal pace" : `${item.throttle.toLowerCase()} throttle`}
              </p>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
