"use client";

import type { ReactNode } from "react";
import { GitBranch, RadioTower, ShieldAlert, Waves } from "lucide-react";

export type OperationalKnowledgeGraph = {
  operationalPressureScore: number;
  collapsePropagationRisk: number;
  serviceWaveRisk: number;
  congestionSeverity: number;
  clusterType: string;
  linkedOrders: string[];
  dominantOperationalSignals: string[];
  systemicRevenueRisk: number;
  operationalStability: "STABLE" | "WATCH" | "ELEVATED" | "CRITICAL";
  chainReactionProbability: number;
  hotspotReasoning: string[];
  graphSignalsUsed: string[];
  clusters: Array<{
    id: string;
    clusterType: string;
    label: string;
    operationalPressureScore: number;
    collapsePropagationRisk: number;
    serviceWaveRisk: number;
    congestionSeverity: number;
    linkedOrders: string[];
    serviceWindow: string;
    systemicRevenueRisk: number;
    operationalStability: "STABLE" | "WATCH" | "ELEVATED" | "CRITICAL";
    chainReactionProbability: number;
    hotspotReasoning: string[];
  }>;
  relationshipSummary: {
    orderLinks: number;
    customerLinks: number;
    serviceWaveLinks: number;
    paymentBottleneckLinks: number;
    waitlistDependencyLinks: number;
    escalationClusterLinks: number;
    hotspotCount: number;
  };
  visibility: {
    operationalHeatZones: Array<{ label: string; score: number; orderIds: string[] }>;
    liveCongestionClusters: Array<{ label: string; congestionSeverity: number; linkedOrders: string[] }>;
    recoveryPressureMap: Array<{ label: string; pressure: number; orderIds: string[] }>;
    serviceWaveHealth: Array<{ serviceWindow: string; health: number; orderIds: string[] }>;
    chainReactionWarnings: string[];
    operationalStabilityIndicators: string[];
  };
};

type Props = {
  graph?: OperationalKnowledgeGraph | null;
  emptyState?: boolean;
};

function formatMoney(value?: number) {
  return `RM ${Math.round(value ?? 0).toLocaleString("en-MY")}`;
}

function label(value?: string) {
  return String(value ?? "STABLE_OPERATION").replaceAll("_", " ");
}

function stabilityClasses(value?: string) {
  if (value === "CRITICAL") return "border-red-100 bg-red-50 text-red-700";
  if (value === "ELEVATED") return "border-amber-100 bg-amber-50 text-amber-700";
  if (value === "WATCH") return "border-blue-100 bg-blue-50 text-blue-700";
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

export default function OperationalKnowledgeGraphPanel({ graph, emptyState = false }: Props) {
  if (!graph) {
    if (!emptyState) return null;
    return (
      <section className="rounded-[24px] border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-600">
        No operational knowledge graph yet. Valsentra will surface service-wave relationships after the continuous engine links live operational signals.
      </section>
    );
  }

  return (
    <section className="rounded-[32px] border border-neutral-200/80 bg-white p-6 shadow-[0_18px_60px_rgba(15,23,42,0.05)] md:p-8">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-500">
            <GitBranch className="h-3.5 w-3.5 text-neutral-700" />
            Operational Knowledge Graph
          </p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-neutral-950">
            {label(graph.clusterType)}
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-600">
            Valsentra linked {graph.relationshipSummary.orderLinks} orders across {graph.relationshipSummary.serviceWaveLinks} service-wave cluster{graph.relationshipSummary.serviceWaveLinks === 1 ? "" : "s"} to detect systemic pressure before it becomes isolated firefighting.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 md:justify-end">
          <span className={`rounded-full border px-3 py-1.5 text-[11px] font-semibold ${stabilityClasses(graph.operationalStability)}`}>
            {graph.operationalStability}
          </span>
          <span className="rounded-full border border-neutral-200 bg-neutral-50 px-3 py-1.5 text-[11px] font-semibold text-neutral-700">
            {formatMoney(graph.systemicRevenueRisk)} at graph risk
          </span>
        </div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-4">
        <Metric icon={<RadioTower className="h-3.5 w-3.5" />} label="Pressure" value={`${graph.operationalPressureScore}/100`} />
        <Metric icon={<ShieldAlert className="h-3.5 w-3.5" />} label="Propagation" value={`${graph.collapsePropagationRisk}/100`} />
        <Metric icon={<Waves className="h-3.5 w-3.5" />} label="Service wave" value={`${graph.serviceWaveRisk}/100`} />
        <Metric icon={<GitBranch className="h-3.5 w-3.5" />} label="Chain reaction" value={`${graph.chainReactionProbability}/100`} />
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-[1fr_0.9fr]">
        <div className="rounded-[24px] border border-neutral-200 bg-neutral-50/80 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-500">
            Operational heat zones
          </p>
          <div className="mt-3 space-y-3">
            {(graph.visibility.operationalHeatZones.length > 0
              ? graph.visibility.operationalHeatZones
              : [{ label: "Stable operation", score: graph.operationalPressureScore, orderIds: graph.linkedOrders }]
            ).slice(0, 5).map((zone) => (
              <div key={zone.label} className="rounded-2xl border border-neutral-200 bg-white p-3">
                <Bar label={zone.label} value={zone.score} />
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {zone.orderIds.slice(0, 5).map((orderId) => (
                    <span key={orderId} className="rounded-full border border-neutral-200 bg-neutral-50 px-2 py-0.5 text-[11px] text-neutral-600">
                      {orderId}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-[24px] border border-neutral-200 bg-neutral-50/80 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-500">
            Chain reaction warnings
          </p>
          <div className="mt-3 space-y-2">
            {(graph.visibility.chainReactionWarnings.length > 0
              ? graph.visibility.chainReactionWarnings
              : graph.hotspotReasoning
            ).slice(0, 5).map((reason, index) => (
              <div key={`${reason}-${index}`} className="rounded-2xl border border-neutral-200 bg-white px-3 py-2 text-sm leading-5 text-neutral-600">
                {reason}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <div className="rounded-[24px] border border-neutral-200 bg-neutral-50/80 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-500">
            Service-wave health
          </p>
          <div className="mt-3 space-y-3">
            {graph.visibility.serviceWaveHealth.slice(0, 4).map((wave) => (
              <Bar key={wave.serviceWindow} label={wave.serviceWindow} value={wave.health} />
            ))}
          </div>
        </div>

        <div className="rounded-[24px] border border-neutral-200 bg-neutral-50/80 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-500">
            Graph signals used
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {graph.graphSignalsUsed.slice(0, 8).map((signal) => (
              <span key={signal} className="rounded-full border border-neutral-200 bg-white px-2.5 py-1 text-[11px] font-medium text-neutral-600">
                {signal}
              </span>
            ))}
          </div>
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
