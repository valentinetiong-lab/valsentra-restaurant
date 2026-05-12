"use client";

import { ArrowRight, Gauge, LineChart, ShieldCheck } from "lucide-react";

export type OperationalSimulation = {
  orderId: string;
  predictedOutcome: string;
  confidence: number;
  dominantRisk: string;
  likelyOperationalPath: string[];
  simulatedRecoveryChance: number;
  estimatedRevenueLoss: number;
  recommendedIntervention: string;
  interventionUrgency: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  timelineProjection: Array<{
    label: string;
    minutesFromNow: number;
    projectedState: string;
    riskLevel: "LOW" | "WATCH" | "WARNING" | "CRITICAL";
    explanation: string;
  }>;
  simulationFactorsUsed: string[];
  scenarios: Array<{
    scenario: string;
    predictedOutcome: string;
    recoveryChance: number;
    estimatedRevenueLoss: number;
    revenueProtectionImpact: number;
    confidence: number;
    riskTrajectory: "IMPROVING" | "STABLE" | "WORSENING";
    interventionUrgency: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
    explanation: string[];
  }>;
  diagnostics: {
    simulationConfidence: number;
    simulationConsensus: string;
    dominantSimulationFactors: string[];
    projectionWindow: string;
    interventionComparison: Array<{
      scenario: string;
      recoveryChance: number;
      estimatedRevenueLoss: number;
      riskTrajectory: "IMPROVING" | "STABLE" | "WORSENING";
    }>;
  };
};

type OperationalSimulationPanelProps = {
  simulation?: OperationalSimulation | null;
  compact?: boolean;
  emptyState?: boolean;
};

function formatMoney(value?: number) {
  return `RM ${Math.round(value ?? 0).toLocaleString("en-MY")}`;
}

function formatLabel(value?: string) {
  return String(value ?? "UNKNOWN").replaceAll("_", " ");
}

function urgencyClasses(value?: string) {
  if (value === "CRITICAL") return "border-red-100 bg-red-50 text-red-700";
  if (value === "HIGH" || value === "WARNING") return "border-amber-100 bg-amber-50 text-amber-700";
  if (value === "MEDIUM" || value === "WATCH") return "border-blue-100 bg-blue-50 text-blue-700";
  return "border-emerald-100 bg-emerald-50 text-emerald-700";
}

function trajectoryClasses(value?: string) {
  if (value === "WORSENING") return "border-red-100 bg-red-50 text-red-700";
  if (value === "STABLE") return "border-blue-100 bg-blue-50 text-blue-700";
  return "border-emerald-100 bg-emerald-50 text-emerald-700";
}

function Meter({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: string;
}) {
  const safeValue = Math.max(0, Math.min(Math.round(value || 0), 100));

  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-neutral-500">
        <span>{label}</span>
        <span>{safeValue}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-neutral-100">
        <div
          className={`h-full rounded-full ${tone ?? "bg-neutral-900"} transition-all duration-700`}
          style={{ width: `${safeValue}%` }}
        />
      </div>
    </div>
  );
}

export default function OperationalSimulationPanel({
  simulation,
  compact = false,
  emptyState = false,
}: OperationalSimulationPanelProps) {
  if (!simulation) {
    if (!emptyState) return null;

    return (
      <section className="rounded-[24px] border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-600">
        No operational simulation yet. Valsentra will project operational futures after the continuous engine evaluates live risk.
      </section>
    );
  }

  const scenarios = simulation.scenarios.slice(0, compact ? 3 : 5);

  return (
    <section className="rounded-[28px] border border-neutral-200/80 bg-white p-5 shadow-[0_12px_36px_rgba(15,23,42,0.04)] md:p-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-500">
            <LineChart className="h-3.5 w-3.5 text-neutral-700" />
            Operational Simulation
          </p>
          <h3 className="mt-2 text-lg font-semibold tracking-tight text-neutral-950">
            {simulation.predictedOutcome}
          </h3>
          <p className="mt-1 text-sm leading-6 text-neutral-600">
            Projection window: {simulation.diagnostics.projectionWindow}
          </p>
        </div>

        <div className="flex flex-wrap gap-2 md:justify-end">
          <span className={`rounded-full border px-3 py-1.5 text-[11px] font-semibold ${urgencyClasses(simulation.interventionUrgency)}`}>
            {simulation.interventionUrgency} urgency
          </span>
          <span className="rounded-full border border-neutral-200 bg-neutral-50 px-3 py-1.5 text-[11px] font-semibold text-neutral-700">
            {simulation.confidence}% confidence
          </span>
        </div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-neutral-200 bg-neutral-50/80 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-500">
            Dominant risk
          </p>
          <p className="mt-2 text-sm font-semibold text-neutral-950">
            {formatLabel(simulation.dominantRisk)}
          </p>
          <p className="mt-2 text-xs leading-5 text-neutral-600">
            Recommended: {simulation.recommendedIntervention}
          </p>
        </div>

        <div className="rounded-2xl border border-neutral-200 bg-neutral-50/80 p-4">
          <Meter
            label="Recovery chance"
            value={simulation.simulatedRecoveryChance}
            tone="bg-emerald-500"
          />
          <p className="mt-3 text-xs leading-5 text-neutral-600">
            Best simulated recovery path compared against no intervention.
          </p>
        </div>

        <div className="rounded-2xl border border-neutral-200 bg-neutral-50/80 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-500">
            Estimated loss if unmanaged
          </p>
          <p className="mt-2 text-sm font-semibold text-neutral-950">
            {formatMoney(simulation.estimatedRevenueLoss)}
          </p>
          <p className="mt-2 text-xs leading-5 text-neutral-600">
            Simulation only. Execution still requires recovery/orchestration guardrails.
          </p>
        </div>
      </div>

      <div className="mt-4 rounded-2xl border border-neutral-200 bg-neutral-50/80 p-4">
        <p className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-500">
          <Gauge className="h-3.5 w-3.5" />
          Intervention comparison
        </p>
        <div className="mt-3 grid gap-3 lg:grid-cols-5">
          {scenarios.map((scenario) => (
            <article
              key={scenario.scenario}
              className="rounded-2xl border border-neutral-200 bg-white p-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${trajectoryClasses(scenario.riskTrajectory)}`}>
                  {scenario.riskTrajectory}
                </span>
              </div>
              <p className="mt-2 text-sm font-semibold leading-5 text-neutral-950">
                {scenario.scenario}
              </p>
              <div className="mt-3 space-y-2">
                <Meter label="Recovery" value={scenario.recoveryChance} tone="bg-emerald-500" />
                <p className="text-xs leading-5 text-neutral-600">
                  Loss {formatMoney(scenario.estimatedRevenueLoss)}
                </p>
              </div>
            </article>
          ))}
        </div>
      </div>

      {!compact ? (
        <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_0.9fr]">
          <div className="rounded-2xl border border-neutral-200 bg-neutral-50/80 p-4">
            <p className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-500">
              <ArrowRight className="h-3.5 w-3.5" />
              Likely recovery path
            </p>
            <ul className="mt-3 space-y-2 text-sm leading-5 text-neutral-600">
              {simulation.likelyOperationalPath.slice(0, 5).map((item, index) => (
                <li key={`${item}-${index}`} className="flex gap-2">
                  <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-neutral-400" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-2xl border border-neutral-200 bg-neutral-50/80 p-4">
            <p className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-500">
              <ShieldCheck className="h-3.5 w-3.5" />
              Factors used
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {simulation.diagnostics.dominantSimulationFactors.slice(0, 5).map((factor) => (
                <span
                  key={factor}
                  className="rounded-full border border-neutral-200 bg-white px-2.5 py-1 text-[11px] font-medium text-neutral-600"
                >
                  {factor}
                </span>
              ))}
            </div>
            <p className="mt-3 text-xs leading-5 text-neutral-600">
              {simulation.diagnostics.simulationConsensus}
            </p>
          </div>
        </div>
      ) : null}
    </section>
  );
}
