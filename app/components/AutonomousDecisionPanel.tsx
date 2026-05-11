"use client";

import { useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Ban,
  Brain,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  CreditCard,
  Gauge,
  LockKeyhole,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";

export type DecisionSeverity = "INFO" | "WATCH" | "WARNING" | "CRITICAL" | "SUCCESS";

export type DecisionRelatedEvent = {
  id: string;
  title: string;
  summary?: string;
  category?: string;
  severity?: DecisionSeverity;
  createdAt?: string;
};

export type AutonomousDecision = {
  id: string;
  title: string;
  summary: string;
  severity: DecisionSeverity;
  category: string;
  status?: string;
  confidence?: number;
  orderId?: string;
  customerName?: string;
  createdAt?: string;
  riskFactors: string[];
  reliabilityScore?: number;
  reliabilityAnalysis: string;
  paymentState?: string;
  paymentVerified?: boolean;
  depositRequired?: boolean;
  depositPaid?: boolean;
  relatedEvents: DecisionRelatedEvent[];
  revenueImpact: number;
  noShowProbability?: number;
  recommendedActions: string[];
  reasoning: string[];
  nextSteps: string[];
};

function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function formatCurrency(value: number) {
  return `RM ${Math.round(value).toLocaleString("en-MY")}`;
}

function formatClock(value?: string) {
  if (!value) return "Live";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Live";

  return parsed.toLocaleTimeString("en-MY", {
    timeZone: "Asia/Kuala_Lumpur",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function severityTone(severity: DecisionSeverity) {
  if (severity === "CRITICAL") {
    return {
      dot: "bg-rose-400 shadow-[0_0_24px_rgba(251,113,133,0.75)]",
      badge: "border-rose-300/25 bg-rose-300/10 text-rose-100",
      glow: "from-rose-400/18 via-cyan-400/6 to-transparent",
    };
  }

  if (severity === "WARNING") {
    return {
      dot: "bg-amber-300 shadow-[0_0_24px_rgba(252,211,77,0.6)]",
      badge: "border-amber-300/25 bg-amber-300/10 text-amber-100",
      glow: "from-amber-300/16 via-cyan-400/6 to-transparent",
    };
  }

  if (severity === "SUCCESS") {
    return {
      dot: "bg-emerald-300 shadow-[0_0_24px_rgba(110,231,183,0.6)]",
      badge: "border-emerald-300/25 bg-emerald-300/10 text-emerald-100",
      glow: "from-emerald-300/16 via-cyan-400/6 to-transparent",
    };
  }

  if (severity === "WATCH") {
    return {
      dot: "bg-cyan-300 shadow-[0_0_24px_rgba(103,232,249,0.55)]",
      badge: "border-cyan-300/25 bg-cyan-300/10 text-cyan-100",
      glow: "from-cyan-300/16 via-blue-400/6 to-transparent",
    };
  }

  return {
    dot: "bg-slate-300 shadow-[0_0_18px_rgba(203,213,225,0.35)]",
    badge: "border-white/10 bg-white/[0.06] text-slate-100",
    glow: "from-white/10 via-cyan-400/5 to-transparent",
  };
}

function paymentTone(state?: string, verified?: boolean) {
  if (verified || state === "VERIFIED") return "border-emerald-300/20 bg-emerald-300/10 text-emerald-100";
  if (state === "BLOCKED" || state === "FAILED") return "border-rose-300/20 bg-rose-300/10 text-rose-100";
  if (state === "PENDING") return "border-amber-300/20 bg-amber-300/10 text-amber-100";
  return "border-white/10 bg-white/[0.05] text-slate-300";
}

function reliabilityLabel(score?: number) {
  if (score === undefined) return "Unscored";
  if (score >= 80) return "Trusted";
  if (score >= 55) return "Stable";
  if (score >= 35) return "Watch";
  return "High risk";
}

export default function AutonomousDecisionPanel({
  decision,
  onClose,
}: {
  decision: AutonomousDecision | null;
  onClose: () => void;
}) {
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    risk: true,
    reasoning: true,
    timeline: true,
    next: true,
  });

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    if (!decision) return;
    window.addEventListener("keydown", handleKeyDown);

    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [decision, onClose]);

  if (!decision) return null;

  const tone = severityTone(decision.severity);
  const confidence = clamp(decision.confidence ?? 72);
  const noShow = clamp(decision.noShowProbability ?? 0);
  const reliability = decision.reliabilityScore;

  function toggle(section: string) {
    setOpenSections((current) => ({
      ...current,
      [section]: !current[section],
    }));
  }

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-[#010308]/80 text-slate-100 backdrop-blur-xl">
      <div className="pointer-events-none absolute inset-0">
        <div className={`absolute left-1/2 top-[-20%] h-[720px] w-[920px] -translate-x-1/2 rounded-full bg-gradient-to-br ${tone.glow} blur-[110px]`} />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(148,163,184,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.035)_1px,transparent_1px)] bg-[size:64px_64px]" />
      </div>

      <div className="relative flex h-full items-center justify-center p-3 sm:p-6">
        <section className="relative flex max-h-[94vh] w-full max-w-[1380px] flex-col overflow-hidden rounded-[34px] border border-white/10 bg-[#06101c]/86 shadow-[0_40px_140px_rgba(0,0,0,0.62)] backdrop-blur-2xl">
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-200/50 to-transparent" />

          <header className="flex flex-col gap-5 border-b border-white/10 p-5 sm:p-7 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex gap-4">
              <div className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-cyan-300/20 bg-cyan-300/10">
                <Brain className="h-6 w-6 text-cyan-100" />
                <span className={`absolute -right-1 -top-1 h-3 w-3 rounded-full ${tone.dot}`} />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${tone.badge}`}>
                    {decision.severity}
                  </span>
                  <span className="rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-1 text-[11px] font-medium text-slate-400">
                    {decision.category.replaceAll("_", " ")}
                  </span>
                  {decision.orderId ? (
                    <span className="rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-1 text-[11px] text-slate-400">
                      {decision.orderId}
                    </span>
                  ) : null}
                </div>
                <h2 className="mt-4 text-2xl font-semibold tracking-[-0.04em] text-white sm:text-4xl">
                  {decision.title}
                </h2>
                <p className="mt-3 max-w-4xl text-sm leading-6 text-slate-300">
                  {decision.summary}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-slate-300 transition hover:border-cyan-200/30 hover:bg-cyan-200/10 hover:text-white"
              aria-label="Close decision panel"
            >
              <X className="h-4 w-4" />
            </button>
          </header>

          <div className="min-h-0 overflow-y-auto p-5 sm:p-7">
            <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_380px]">
              <div className="grid gap-5">
                <div className="grid gap-4 lg:grid-cols-3">
                  <MeterCard
                    icon={<Gauge className="h-4 w-4" />}
                    label="Confidence score"
                    value={`${confidence}%`}
                    meter={confidence}
                  />
                  <MeterCard
                    icon={<AlertTriangle className="h-4 w-4" />}
                    label="No-show probability"
                    value={`${noShow}%`}
                    meter={noShow}
                  />
                  <MetricCard
                    icon={<ShieldCheck className="h-4 w-4" />}
                    label="Predicted revenue impact"
                    value={formatCurrency(decision.revenueImpact)}
                  />
                </div>

                <ExpandableSection
                  id="risk"
                  title="Detected risk factors"
                  icon={<AlertTriangle className="h-4 w-4" />}
                  open={openSections.risk}
                  onToggle={() => toggle("risk")}
                >
                  <div className="grid gap-3 md:grid-cols-2">
                    {(decision.riskFactors.length > 0
                      ? decision.riskFactors
                      : ["No explicit risk factors were attached to this decision."]
                    ).map((factor) => (
                      <SignalLine key={factor} label={factor} />
                    ))}
                  </div>
                </ExpandableSection>

                <ExpandableSection
                  id="reasoning"
                  title="Why the system made this decision"
                  icon={<Sparkles className="h-4 w-4" />}
                  open={openSections.reasoning}
                  onToggle={() => toggle("reasoning")}
                >
                  <div className="space-y-3">
                    {(decision.reasoning.length > 0
                      ? decision.reasoning
                      : ["Decision was generated from the live operational state."]
                    ).map((reason, index) => (
                      <div
                        key={`${reason}-${index}`}
                        className="flex gap-3 rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm leading-6 text-slate-300"
                      >
                        <CircleDot className="mt-1 h-4 w-4 shrink-0 text-cyan-200/70" />
                        <span>{reason}</span>
                      </div>
                    ))}
                  </div>
                </ExpandableSection>

                <ExpandableSection
                  id="timeline"
                  title="Timeline of related events"
                  icon={<Activity className="h-4 w-4" />}
                  open={openSections.timeline}
                  onToggle={() => toggle("timeline")}
                >
                  <div className="space-y-1">
                    {decision.relatedEvents.length === 0 ? (
                      <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-slate-500">
                        No related timeline events were returned for this decision.
                      </div>
                    ) : (
                      decision.relatedEvents.slice(0, 7).map((event, index) => (
                        <div
                          key={event.id}
                          className="grid grid-cols-[64px_20px_minmax(0,1fr)] gap-3"
                        >
                          <div className="pt-3 text-right text-xs text-slate-500">
                            {formatClock(event.createdAt)}
                          </div>
                          <div className="relative flex justify-center pt-3">
                            <span className={`z-10 h-2.5 w-2.5 rounded-full ${severityTone(event.severity ?? "INFO").dot}`} />
                            {index < decision.relatedEvents.length - 1 ? (
                              <span className="absolute bottom-0 top-6 w-px bg-white/10" />
                            ) : null}
                          </div>
                          <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                              {(event.category ?? "audit").replaceAll("_", " ")}
                            </div>
                            <div className="mt-2 text-sm font-medium text-white">
                              {event.title}
                            </div>
                            {event.summary ? (
                              <div className="mt-1 text-sm leading-6 text-slate-400">
                                {event.summary}
                              </div>
                            ) : null}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </ExpandableSection>
              </div>

              <aside className="grid gap-5 xl:self-start">
                <div className="rounded-[28px] border border-white/10 bg-white/[0.045] p-5">
                  <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                    <CreditCard className="h-4 w-4" />
                    Payment verification state
                  </div>
                  <div className={`mt-4 rounded-2xl border px-4 py-3 text-sm font-semibold ${paymentTone(decision.paymentState, decision.paymentVerified)}`}>
                    {decision.paymentVerified ? "VERIFIED" : decision.paymentState ?? "UNPAID"}
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-400">
                    <span>Deposit required: {decision.depositRequired ? "Yes" : "No"}</span>
                    <span>Deposit paid: {decision.depositPaid ? "Yes" : "No"}</span>
                  </div>
                </div>

                <div className="rounded-[28px] border border-white/10 bg-white/[0.045] p-5">
                  <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                    <LockKeyhole className="h-4 w-4" />
                    Customer reliability analysis
                  </div>
                  <div className="mt-5 flex items-end gap-2">
                    <span className="text-5xl font-semibold tracking-[-0.08em] text-white">
                      {reliability === undefined ? "--" : clamp(reliability)}
                    </span>
                    <span className="mb-2 text-sm text-slate-500">/100</span>
                  </div>
                  <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-rose-300 via-amber-200 to-emerald-200 transition-all duration-700"
                      style={{ width: `${reliability === undefined ? 0 : clamp(reliability)}%` }}
                    />
                  </div>
                  <div className="mt-3 text-sm font-medium text-slate-200">
                    {reliabilityLabel(reliability)}
                  </div>
                  <p className="mt-2 text-sm leading-6 text-slate-400">
                    {decision.reliabilityAnalysis}
                  </p>
                </div>

                <ExpandableSection
                  id="actions"
                  title="Recommended autonomous actions"
                  icon={<CheckCircle2 className="h-4 w-4" />}
                  open
                  onToggle={() => undefined}
                  locked
                >
                  <div className="space-y-2">
                    {decision.recommendedActions.map((action) => (
                      <SignalLine key={action} label={action} icon={<ArrowRight className="h-3.5 w-3.5" />} />
                    ))}
                  </div>
                </ExpandableSection>

                <ExpandableSection
                  id="next"
                  title="What happens next automatically"
                  icon={<Ban className="h-4 w-4" />}
                  open={openSections.next}
                  onToggle={() => toggle("next")}
                >
                  <div className="space-y-2">
                    {(decision.nextSteps.length > 0
                      ? decision.nextSteps
                      : ["Valsentra will continue monitoring this signal until the underlying state changes."]
                    ).map((step) => (
                      <SignalLine key={step} label={step} />
                    ))}
                  </div>
                </ExpandableSection>
              </aside>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function MeterCard({
  icon,
  label,
  value,
  meter,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  meter: number;
}) {
  return (
    <div className="rounded-[24px] border border-white/10 bg-white/[0.045] p-4">
      <div className="flex items-center justify-between text-slate-500">
        <span className="text-[11px] font-semibold uppercase tracking-[0.16em]">
          {label}
        </span>
        {icon}
      </div>
      <div className="mt-4 text-3xl font-semibold tracking-[-0.06em] text-white">
        {value}
      </div>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full bg-gradient-to-r from-cyan-200 via-emerald-200 to-white transition-all duration-700"
          style={{ width: `${clamp(meter)}%` }}
        />
      </div>
    </div>
  );
}

function MetricCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-[24px] border border-white/10 bg-white/[0.045] p-4">
      <div className="flex items-center justify-between text-slate-500">
        <span className="text-[11px] font-semibold uppercase tracking-[0.16em]">
          {label}
        </span>
        {icon}
      </div>
      <div className="mt-4 text-3xl font-semibold tracking-[-0.06em] text-white">
        {value}
      </div>
      <div className="mt-4 rounded-full border border-emerald-300/20 bg-emerald-300/10 px-3 py-1.5 text-xs font-semibold text-emerald-100">
        Revenue protection model
      </div>
    </div>
  );
}

function ExpandableSection({
  title,
  icon,
  open,
  onToggle,
  children,
  locked = false,
}: {
  id: string;
  title: string;
  icon: React.ReactNode;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  locked?: boolean;
}) {
  return (
    <section className="rounded-[28px] border border-white/10 bg-white/[0.045] p-4">
      <button
        type="button"
        onClick={locked ? undefined : onToggle}
        className="flex w-full items-center justify-between gap-4 text-left"
      >
        <span className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          {icon}
          {title}
        </span>
        {!locked ? (
          <ChevronDown
            className={`h-4 w-4 text-slate-500 transition ${open ? "rotate-180" : ""}`}
          />
        ) : null}
      </button>
      {open ? <div className="mt-4">{children}</div> : null}
    </section>
  );
}

function SignalLine({
  label,
  icon,
}: {
  label: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex gap-3 rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm leading-5 text-slate-300">
      <span className="mt-0.5 shrink-0 text-cyan-200/70">
        {icon ?? <CircleDot className="h-4 w-4" />}
      </span>
      <span>{label}</span>
    </div>
  );
}
