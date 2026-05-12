"use client";

import { Brain, CheckCircle2, Gauge, ShieldCheck, ShieldAlert } from "lucide-react";

export type AgentEscalationLevel = "LOW" | "WATCH" | "WARNING" | "CRITICAL";

export type AgentDecision = {
  agentName: string;
  agentDecision: string;
  confidence: number;
  reasoning: string[];
  recommendedActions: string[];
  escalationLevel: AgentEscalationLevel;
  supportingSignals: Record<string, unknown>;
};

export type MultiAgentOperationalBrain = {
  participatingAgents: string[];
  fusionDecision: string;
  dominantSignals: string[];
  conflictingRecommendations: string[];
  finalOperationalReasoning: string[];
  agentDecisions: AgentDecision[];
  escalationLevel: AgentEscalationLevel;
  confidence: number;
  recommendedActions?: string[];
};

type AgentDecisionPanelProps = {
  decision?: MultiAgentOperationalBrain | null;
  compact?: boolean;
  emptyState?: boolean;
};

function levelClasses(level?: AgentEscalationLevel) {
  if (level === "CRITICAL") return "border-red-100 bg-red-50 text-red-700";
  if (level === "WARNING") return "border-amber-100 bg-amber-50 text-amber-700";
  if (level === "WATCH") return "border-blue-100 bg-blue-50 text-blue-700";
  return "border-emerald-100 bg-emerald-50 text-emerald-700";
}

function meterClasses(level?: AgentEscalationLevel) {
  if (level === "CRITICAL") return "bg-red-500";
  if (level === "WARNING") return "bg-amber-500";
  if (level === "WATCH") return "bg-blue-500";
  return "bg-emerald-500";
}

function formatLabel(value?: string) {
  return String(value ?? "NO_DECISION").replaceAll("_", " ");
}

function formatSignalValue(value: unknown) {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(1);
  if (value === null || value === undefined || value === "") return "None";
  if (Array.isArray(value)) return value.slice(0, 3).join(", ");
  return String(value);
}

function ConfidenceMeter({
  value,
  level,
  label = "Confidence",
}: {
  value: number;
  level?: AgentEscalationLevel;
  label?: string;
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
          className={`h-full rounded-full ${meterClasses(level)} transition-all duration-700`}
          style={{ width: `${safeValue}%` }}
        />
      </div>
    </div>
  );
}

export default function AgentDecisionPanel({
  decision,
  compact = false,
  emptyState = false,
}: AgentDecisionPanelProps) {
  if (!decision) {
    if (!emptyState) return null;

    return (
      <section className="rounded-[24px] border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-600">
        No agent decision yet. Valsentra will expose agent reasoning after the continuous engine evaluates live order signals.
      </section>
    );
  }

  const recommendedAction =
    decision.recommendedActions?.[0] ??
    decision.agentDecisions.flatMap((agent) => agent.recommendedActions)[0] ??
    "Continue monitoring with current safety guardrails.";
  const guardrails = [
    ...(decision.fusionDecision === "SAFETY_REVIEW_REQUIRED"
      ? ["Safety review required before autonomous execution."]
      : []),
    ...decision.conflictingRecommendations,
    "Existing execution mode, cooldown, fatigue, fraud, and payment-truth guardrails remain active.",
  ];

  return (
    <section className="rounded-[28px] border border-neutral-200/80 bg-white p-5 shadow-[0_12px_36px_rgba(15,23,42,0.04)] md:p-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-500">
            <Brain className="h-3.5 w-3.5 text-neutral-700" />
            Agent Decision Visibility
          </p>
          <h3 className="mt-2 text-lg font-semibold tracking-tight text-neutral-950">
            What Valsentra decided
          </h3>
          <p className="mt-1 text-sm leading-6 text-neutral-600">
            {formatLabel(decision.fusionDecision)}
          </p>
        </div>

        <div className="flex flex-wrap gap-2 md:justify-end">
          <span className={`rounded-full border px-3 py-1.5 text-[11px] font-semibold ${levelClasses(decision.escalationLevel)}`}>
            {decision.escalationLevel}
          </span>
          <span className="rounded-full border border-neutral-200 bg-neutral-50 px-3 py-1.5 text-[11px] font-semibold text-neutral-700">
            {Math.round(decision.confidence ?? 0)}% confidence
          </span>
        </div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="rounded-2xl border border-neutral-200 bg-neutral-50/80 p-4">
          <p className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-500">
            <ShieldCheck className="h-3.5 w-3.5" />
            Why it decided this
          </p>
          <ul className="mt-3 space-y-2 text-sm leading-5 text-neutral-600">
            {decision.finalOperationalReasoning.slice(0, compact ? 3 : 6).map((reason, index) => (
              <li key={`${reason}-${index}`} className="flex gap-2">
                <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-neutral-400" />
                <span>{reason}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-2xl border border-neutral-200 bg-neutral-50/80 p-4">
          <p className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-500">
            <Gauge className="h-3.5 w-3.5" />
            Agent signals
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {decision.participatingAgents.map((agent) => (
              <span
                key={agent}
                className="rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-neutral-700"
              >
                {agent}
              </span>
            ))}
          </div>
          <div className="mt-4">
            <ConfidenceMeter
              value={decision.confidence}
              level={decision.escalationLevel}
              label="Fusion confidence"
            />
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-3">
        {decision.agentDecisions.slice(0, compact ? 3 : 5).map((agent) => (
          <article
            key={`${agent.agentName}-${agent.agentDecision}-${agent.escalationLevel}`}
            className="rounded-2xl border border-neutral-200 bg-neutral-50/70 p-4"
          >
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold text-neutral-950">{agent.agentName}</p>
                  <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${levelClasses(agent.escalationLevel)}`}>
                    {agent.escalationLevel}
                  </span>
                </div>
                <p className="mt-1 text-sm leading-6 text-neutral-600">{agent.agentDecision}</p>
              </div>
              <div className="min-w-[160px]">
                <ConfidenceMeter value={agent.confidence} level={agent.escalationLevel} />
              </div>
            </div>

            <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_1fr]">
              <div className="rounded-xl border border-neutral-200 bg-white p-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-neutral-500">
                  Recommendation
                </p>
                <p className="mt-1 text-sm leading-5 text-neutral-700">
                  {agent.recommendedActions[0] ?? "Continue monitoring."}
                </p>
              </div>

              <div className="rounded-xl border border-neutral-200 bg-white p-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-neutral-500">
                  Supporting signals
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {Object.entries(agent.supportingSignals)
                    .slice(0, 4)
                    .map(([key, value]) => (
                      <span
                        key={key}
                        className="rounded-full border border-neutral-200 bg-neutral-50 px-2.5 py-1 text-[11px] font-medium text-neutral-600"
                      >
                        {formatLabel(key)}: {formatSignalValue(value)}
                      </span>
                    ))}
                </div>
              </div>
            </div>
          </article>
        ))}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_0.9fr]">
        <div className="rounded-2xl border border-neutral-200 bg-neutral-50/80 p-4">
          <p className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-500">
            <ShieldAlert className="h-3.5 w-3.5" />
            Conflicts / guardrails
          </p>
          <ul className="mt-3 space-y-2 text-sm leading-5 text-neutral-600">
            {guardrails.slice(0, compact ? 3 : 6).map((guardrail, index) => (
              <li key={`${guardrail}-${index}`} className="flex gap-2">
                <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-neutral-400" />
                <span>{guardrail}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-2xl border border-neutral-200 bg-neutral-50/80 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-500">
            Recommended next action
          </p>
          <p className="mt-3 inline-flex rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-xs font-semibold leading-5 text-neutral-700">
            {recommendedAction}
          </p>
          {decision.dominantSignals.length > 0 ? (
            <div className="mt-3 rounded-xl border border-neutral-200 bg-white p-3">
              <p className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-neutral-500">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Dominant signal
              </p>
              <p className="mt-1 text-xs leading-5 text-neutral-600">
                {decision.dominantSignals[0]}
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
