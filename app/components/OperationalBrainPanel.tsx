"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Brain,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  Gauge,
  TrendingDown,
  TrendingUp,
  ShieldAlert,
  Zap,
} from "lucide-react";

type BrainSeverity = "INFO" | "WATCH" | "WARNING" | "CRITICAL";

type BrainCategory =
  | "PAYMENT_TRUTH"
  | "COLLAPSE_PREVENTION"
  | "RECOVERY"
  | "FRAUD_CONTAINMENT"
  | "LEARNING"
  | "AUTOPILOT";

type BrainInsight = {
  id: string;
  title: string;
  summary: string;
  severity: BrainSeverity;
  category: BrainCategory;
  orderId?: string;
  customerName?: string;
  confidence: number;
  recommendedAction: string;
  reasoning: string[];
  createdAt: string;
  escalationUrgency?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  recoveryLikelihood?: number;
  automationConfidence?: number;
  whyThisMatters?: string;
  decisionMode?:
    | "INFORMATIONAL"
    | "MONITORING"
    | "INTERVENTION_REQUIRED"
    | "AUTONOMOUS_ACTION_SAFE";
  transition?: {
    label: string;
    from: string;
    to: string;
    direction: "UP" | "DOWN" | "RESTORED" | "UNCHANGED";
  };
  riskPrevented?: number;
  humanReviewBypassedSafely?: boolean;
  autonomousRecommendation?:
    | "INTERVENE_NOW"
    | "SAFE_TO_AUTOMATE"
    | "WAIT_AND_MONITOR"
    | "ESCALATE_TO_OWNER"
    | "TRIGGER_RECOVERY_FLOW"
    | "REQUIRE_VERIFICATION";
  forecast?: {
    unrecoverableLikelihood: number;
    timeToCollapseMinutes: number | null;
    recoverySuccessLikelihood: number;
    projectedRevenueExposureGrowth: number;
    trend: "RISING" | "FALLING" | "STABLE";
  };
  systemPressure?: {
    level: "LOW" | "WATCH" | "ELEVATED" | "CRITICAL";
    score: number;
    reasons: string[];
  };
  drift?: {
    type: string;
    summary: string;
    signals: string[];
  };
  scope?: "ORDER" | "SYSTEM";
  cluster?: {
    label: string;
    orders: string[];
    heat: "LOW" | "WATCH" | "ELEVATED" | "CRITICAL";
  };
  operationalZone?: {
    zone:
      | "STABLE_ZONE"
      | "WATCH_ZONE"
      | "CONGESTED_ZONE"
      | "RECOVERY_ZONE"
      | "CRITICAL_ZONE";
    score: number;
    summary: string;
  };
  revenueStability?: {
    projectedProtectedRevenue: number;
    projectedExposedRevenue: number;
    likelyRecoveryRevenue: number;
    collapseChainProbability: number;
    projectedNoShowImpact: number;
    projectedFraudExposure: number;
  };
  loadDistribution?: {
    paymentExposure: number;
    collapseRisk: number;
    recoveryBacklog: number;
    fraudContainment: number;
    messagingLoad: number;
    reliabilityDegradation: number;
    blockedOrders: number;
  };
  systemNarrative?: string;
  recoveryRecommendation?: {
    actions: Array<
      | "SEND_REMINDER"
      | "ESCALATE_PAYMENT"
      | "REQUIRE_DEPOSIT"
      | "OFFER_WAITLIST_REPLACEMENT"
      | "RELEASE_SLOT"
      | "OWNER_REVIEW"
    >;
    confidence: number;
    estimatedRecoverableRevenue: number;
    urgency: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
    automationSafetyLevel:
      | "SAFE_TO_AUTOMATE"
      | "GUARDED_AUTOMATION"
      | "OWNER_REVIEW_REQUIRED"
      | "BLOCKED";
    expectedRecoveryLikelihood: number;
    state:
      | "MONITORING"
      | "RECOVERY_RECOMMENDED"
      | "RECOVERY_ATTEMPTED"
      | "RECOVERY_SUCCEEDED"
      | "RECOVERY_FAILED";
    attempted: boolean;
    succeeded: boolean;
    humanInterventionAvoided: boolean;
    riskPrevented: number;
  };
  operationalMemory?: {
    memoryConfidence: number;
    customerPatternCount: number;
    learningSignalCount: number;
    adaptiveRecommendations: string[];
  };
  memoryPattern?: {
    id: string;
    type: string;
    title: string;
    summary: string;
    severity: "INFO" | "WATCH" | "WARNING" | "CRITICAL";
    confidence: number;
    signals: string[];
    affectedOrderIds: string[];
    adaptiveRecommendation: string;
  };
  adaptiveExplanation?: string;
  liveEvents?: Array<{
    id: string;
    type: string;
    title: string;
    summary: string;
    orderId?: string;
    severity: BrainSeverity;
    previousState: string;
    nextLikelyState: string;
    preventedOutcome: string;
    operationalImpact: string;
    createdAt: string;
    chainId: string;
  }>;
  operationalPulse?: {
    pressure: number;
    collapseVelocity: number;
    recoveryMomentum: number;
    automationLoad: number;
    interventionFrequency: number;
    stability: "STABLE" | "WATCHING" | "ACTIVE" | "STRAINED";
    protectedRevenue: number;
    exposureGrowth: number;
    autonomousActionCount: number;
    collapseEscalationCount: number;
  };
};

function severityClasses(severity: BrainSeverity) {
  if (severity === "CRITICAL") {
    return {
      dot: "bg-red-500",
      badge: "border-red-100 bg-red-50 text-red-700",
      icon: <ShieldAlert className="h-3.5 w-3.5" />,
      rail: "border-l-red-500",
      meter: "bg-red-500",
    };
  }

  if (severity === "WARNING") {
    return {
      dot: "bg-amber-500",
      badge: "border-amber-100 bg-amber-50 text-amber-700",
      icon: <AlertTriangle className="h-3.5 w-3.5" />,
      rail: "border-l-amber-500",
      meter: "bg-amber-500",
    };
  }

  if (severity === "WATCH") {
    return {
      dot: "bg-blue-500",
      badge: "border-blue-100 bg-blue-50 text-blue-700",
      icon: <CircleDot className="h-3.5 w-3.5" />,
      rail: "border-l-blue-500",
      meter: "bg-blue-500",
    };
  }

  return {
    dot: "bg-emerald-500",
    badge: "border-emerald-100 bg-emerald-50 text-emerald-700",
    icon: <CheckCircle2 className="h-3.5 w-3.5" />,
    rail: "border-l-emerald-500",
    meter: "bg-emerald-500",
  };
}

function formatCategory(category: BrainCategory) {
  return category.replaceAll("_", " ");
}

function formatMoney(value?: number) {
  if (!value) return "RM 0";
  return `RM ${Math.round(value).toLocaleString("en-MY")}`;
}

function getGroupLabel(insight: BrainInsight) {
  if (insight.decisionMode === "INTERVENTION_REQUIRED") {
    return "Intervention required";
  }
  if (insight.decisionMode === "AUTONOMOUS_ACTION_SAFE") {
    return "Autonomous action safe";
  }
  if (insight.decisionMode === "MONITORING") {
    return "Monitoring";
  }
  return "Informational";
}

function urgencyClasses(urgency?: BrainInsight["escalationUrgency"]) {
  if (urgency === "CRITICAL") return "border-red-100 bg-red-50 text-red-700";
  if (urgency === "HIGH") return "border-amber-100 bg-amber-50 text-amber-700";
  if (urgency === "MEDIUM") return "border-blue-100 bg-blue-50 text-blue-700";
  return "border-neutral-200 bg-white text-neutral-600";
}

function pressureClasses(level?: NonNullable<BrainInsight["systemPressure"]>["level"]) {
  if (level === "CRITICAL") return "border-red-100 bg-red-50 text-red-700";
  if (level === "ELEVATED") return "border-amber-100 bg-amber-50 text-amber-700";
  if (level === "WATCH") return "border-blue-100 bg-blue-50 text-blue-700";
  return "border-emerald-100 bg-emerald-50 text-emerald-700";
}

function formatRecommendation(value?: BrainInsight["autonomousRecommendation"]) {
  return (value ?? "WAIT_AND_MONITOR").replaceAll("_", " ");
}

function formatRecoveryAction(value: string) {
  return value.replaceAll("_", " ");
}

function formatZone(value?: NonNullable<BrainInsight["operationalZone"]>["zone"]) {
  return (value ?? "STABLE_ZONE").replaceAll("_", " ");
}

function zoneClasses(value?: NonNullable<BrainInsight["operationalZone"]>["zone"]) {
  if (value === "CRITICAL_ZONE") return "border-red-100 bg-red-50 text-red-700";
  if (value === "RECOVERY_ZONE" || value === "CONGESTED_ZONE") {
    return "border-amber-100 bg-amber-50 text-amber-700";
  }
  if (value === "WATCH_ZONE") return "border-blue-100 bg-blue-50 text-blue-700";
  return "border-emerald-100 bg-emerald-50 text-emerald-700";
}

function SystemMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-neutral-500">
        {label}
      </p>
      <p className="mt-1 text-sm font-semibold text-neutral-950">{value}</p>
    </div>
  );
}

function LoadBar({
  label,
  value,
  max,
  money = false,
}: {
  label: string;
  value: number;
  max: number;
  money?: boolean;
}) {
  const width = Math.max(0, Math.min((value / Math.max(max, 1)) * 100, 100));

  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-neutral-500">
        <span>{label}</span>
        <span>{money ? formatMoney(value) : value}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-neutral-100">
        <div
          className="h-full rounded-full bg-neutral-800 transition-all duration-700"
          style={{ width: `${width}%` }}
        />
      </div>
    </div>
  );
}

function formatTime(value?: string) {
  if (!value) return "Live";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Live";
  return parsed.toLocaleTimeString("en-MY", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function insightRenderKey(insight: BrainInsight, scope: string, index: number) {
  return [
    insight.id,
    insight.category,
    insight.orderId ?? "system",
    insight.createdAt ?? "live",
    scope,
    index,
  ].join("-");
}

function ForecastTrendIcon({ trend }: { trend?: NonNullable<BrainInsight["forecast"]>["trend"] }) {
  if (trend === "RISING") return <TrendingUp className="h-3.5 w-3.5 text-red-600" />;
  if (trend === "FALLING") return <TrendingDown className="h-3.5 w-3.5 text-emerald-600" />;
  return <ArrowRight className="h-3.5 w-3.5 text-neutral-500" />;
}

function ConfidenceMeter({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-neutral-500">
        <span>{label}</span>
        <span>{value}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-neutral-100">
        <div
          className={`h-full rounded-full ${color} transition-all duration-700`}
          style={{ width: `${Math.max(0, Math.min(value, 100))}%` }}
        />
      </div>
    </div>
  );
}

export default function OperationalBrainPanel() {
  const [insights, setInsights] = useState<BrainInsight[]>([]);
  const [loading, setLoading] = useState(true);

  async function loadInsights() {
    try {
      const res = await fetch("/api/intelligence/brain", {
        cache: "no-store",
      });

      const data = await res.json();

      if (res.ok && Array.isArray(data)) {
        setInsights(data);
      }
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadInsights();

    const interval = setInterval(loadInsights, 10000);

    return () => clearInterval(interval);
  }, []);

  const systemInsight = insights.find(
    (insight) => insight.scope === "SYSTEM" && insight.operationalZone
  );
  const loadDistribution = systemInsight?.loadDistribution;
  const revenueStability = systemInsight?.revenueStability;
  const recoveryInsights = insights.filter((insight) => insight.recoveryRecommendation);
  const memoryInsight = insights.find((insight) => insight.operationalMemory);
  const memoryPatterns = insights.filter((insight) => insight.memoryPattern);
  const liveEvents = systemInsight?.liveEvents ?? [];
  const operationalPulse = systemInsight?.operationalPulse;

  return (
    <section className="rounded-[32px] border border-neutral-200/80 bg-white p-6 shadow-[0_18px_60px_rgba(15,23,42,0.05)] md:p-8">
      <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-500">
            <Brain className="h-3.5 w-3.5 text-neutral-700" />
            Live Operational Brain
          </p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-neutral-950">
            Reasoning Valsentra is using right now
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-600">
            Explainable signals from real orders, payment state, collapse risk, Ghost Ping urgency, reliability, recovery, and audit history.
          </p>
        </div>

        <div className="rounded-2xl border border-neutral-200/80 bg-neutral-50/80 px-4 py-3 text-center text-sm shadow-sm">
          <p className="text-2xl font-semibold tracking-tight text-neutral-950">
            {insights.length}
          </p>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-500">
            insights
          </p>
        </div>
      </div>

      {loading ? (
        <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-600">
          Loading operational reasoning...
        </div>
      ) : null}

      {!loading && insights.length === 0 ? (
        <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-600">
          No operational brain insights yet. Valsentra will surface reasoning when real order or audit signals appear.
        </div>
      ) : null}

      {systemInsight ? (
        <div className="mb-6 rounded-[28px] border border-neutral-200/80 bg-neutral-50/80 p-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-500">
                Whole-operation intelligence
              </p>
              <h3 className="mt-2 text-xl font-semibold tracking-tight text-neutral-950">
                {systemInsight.systemNarrative ?? systemInsight.summary}
              </h3>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-600">
                {systemInsight.operationalZone?.summary}
              </p>
            </div>

            <div className="flex flex-wrap gap-2 lg:justify-end">
              <span className={`rounded-full border px-3 py-1.5 text-[11px] font-semibold ${zoneClasses(systemInsight.operationalZone?.zone)}`}>
                {formatZone(systemInsight.operationalZone?.zone)}
              </span>
              <span className={`rounded-full border px-3 py-1.5 text-[11px] font-semibold ${pressureClasses(systemInsight.systemPressure?.level)}`}>
                Pressure {systemInsight.systemPressure?.score ?? 0}/100
              </span>
            </div>
          </div>

          {revenueStability ? (
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <SystemMetric label="Projected protected" value={formatMoney(revenueStability.projectedProtectedRevenue)} />
              <SystemMetric label="Projected exposed" value={formatMoney(revenueStability.projectedExposedRevenue)} />
              <SystemMetric label="Likely recovery" value={formatMoney(revenueStability.likelyRecoveryRevenue)} />
              <SystemMetric label="Chain probability" value={`${revenueStability.collapseChainProbability}%`} />
              <SystemMetric label="No-show impact" value={formatMoney(revenueStability.projectedNoShowImpact)} />
              <SystemMetric label="Fraud exposure" value={formatMoney(revenueStability.projectedFraudExposure)} />
            </div>
          ) : null}

          {loadDistribution ? (
            <div className="mt-4 rounded-2xl border border-neutral-200 bg-white p-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-500">
                Operational load distribution
              </p>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <LoadBar label="Payment exposure" value={loadDistribution.paymentExposure} max={Math.max(loadDistribution.paymentExposure, 1)} money />
                <LoadBar label="Collapse risk" value={loadDistribution.collapseRisk} max={8} />
                <LoadBar label="Recovery backlog" value={loadDistribution.recoveryBacklog} max={8} />
                <LoadBar label="Fraud containment" value={loadDistribution.fraudContainment} max={8} />
                <LoadBar label="Messaging load" value={loadDistribution.messagingLoad} max={12} />
                <LoadBar label="Reliability degradation" value={loadDistribution.reliabilityDegradation} max={8} />
              </div>
            </div>
          ) : null}

          {operationalPulse ? (
            <div className="mt-4 rounded-2xl border border-neutral-200 bg-white p-3">
              <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <p className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-500">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
                  Operational pulse
                </p>
                <span className="rounded-full border border-neutral-200 bg-neutral-50 px-3 py-1.5 text-[11px] font-semibold text-neutral-700">
                  {operationalPulse.stability}
                </span>
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                <LoadBar label="Live pressure" value={operationalPulse.pressure} max={100} />
                <LoadBar label="Collapse velocity" value={operationalPulse.collapseVelocity} max={8} />
                <LoadBar label="Recovery momentum" value={operationalPulse.recoveryMomentum} max={100} />
                <LoadBar label="Automation load" value={operationalPulse.automationLoad} max={12} />
                <LoadBar label="Intervention frequency" value={operationalPulse.interventionFrequency} max={12} />
                <LoadBar label="Collapse escalations" value={operationalPulse.collapseEscalationCount} max={8} />
              </div>
            </div>
          ) : null}

          {liveEvents.length > 0 ? (
            <div className="mt-4 rounded-2xl border border-neutral-200 bg-white p-3">
              <div className="mb-3 flex items-center justify-between gap-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-500">
                  Live operational event stream
                </p>
                <span className="rounded-full border border-emerald-100 bg-emerald-50 px-3 py-1.5 text-[11px] font-semibold text-emerald-700">
                  System watching
                </span>
              </div>
              <div className="space-y-2">
                {liveEvents.slice(0, 5).map((event, index) => {
                  const visual = severityClasses(event.severity);
                  return (
                    <div
                      key={event.id}
                      className="grid grid-cols-[64px_18px_minmax(0,1fr)] gap-3"
                    >
                      <div className="pt-2 text-right text-[11px] font-medium text-neutral-500">
                        {formatTime(event.createdAt)}
                      </div>
                      <div className="relative flex justify-center pt-2">
                        <span className={`z-10 h-2.5 w-2.5 rounded-full ${visual.dot}`} />
                        {index < Math.min(liveEvents.length, 5) - 1 ? (
                          <span className="absolute bottom-[-16px] top-5 w-px bg-neutral-200" />
                        ) : null}
                      </div>
                      <div className="rounded-2xl border border-neutral-200 bg-neutral-50 px-3 py-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-semibold text-neutral-950">
                            {event.title}
                          </p>
                          {event.orderId ? (
                            <span className="rounded-full border border-neutral-200 bg-white px-2 py-0.5 text-[11px] font-medium text-neutral-600">
                              {event.orderId}
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-1 text-xs leading-5 text-neutral-600">
                          {event.previousState} {"->"} {event.nextLikelyState}. {event.preventedOutcome}. {event.operationalImpact}.
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {recoveryInsights.length > 0 ? (
        <div className="mb-6 rounded-[28px] border border-neutral-200/80 bg-neutral-50/80 p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-500">
                Autonomous Recovery Engine
              </p>
              <h3 className="mt-2 text-xl font-semibold tracking-tight text-neutral-950">
                Endangered revenue recovery paths
              </h3>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-600">
                Valsentra is recommending recovery actions before collapse using payment delay, collapse risk, Ghost Ping urgency, reliability, timing, value, and waitlist availability.
              </p>
            </div>
            <span className="rounded-full border border-emerald-100 bg-emerald-50 px-3 py-1.5 text-[11px] font-semibold text-emerald-700">
              {recoveryInsights.length} live paths
            </span>
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            {recoveryInsights.slice(0, 4).map((insight, index) => {
              const recovery = insight.recoveryRecommendation!;
              const visual = severityClasses(insight.severity);

              return (
                <div
                  key={insightRenderKey(insight, "recovery", index)}
                  className={`rounded-2xl border border-l-4 border-neutral-200 bg-white p-4 ${visual.rail}`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`h-2.5 w-2.5 rounded-full ${visual.dot}`} />
                    <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${urgencyClasses(recovery.urgency)}`}>
                      {recovery.urgency} urgency
                    </span>
                    <span className="rounded-full border border-neutral-200 bg-neutral-50 px-2.5 py-1 text-[11px] font-semibold text-neutral-600">
                      {recovery.state.replaceAll("_", " ")}
                    </span>
                    {insight.orderId ? (
                      <span className="rounded-full border border-neutral-200 bg-neutral-50 px-2.5 py-1 text-[11px] font-medium text-neutral-600">
                        {insight.orderId}
                      </span>
                    ) : null}
                  </div>

                  <p className="mt-3 text-sm font-semibold text-neutral-950">
                    {insight.title}
                  </p>
                  <p className="mt-1 text-sm leading-6 text-neutral-600">
                    {insight.summary}
                  </p>

                  <div className="mt-3 flex flex-wrap gap-2">
                    {recovery.actions.map((action) => (
                      <span
                        key={action}
                        className="rounded-full border border-neutral-200 bg-neutral-50 px-2.5 py-1 text-[11px] font-semibold text-neutral-700"
                      >
                        {formatRecoveryAction(action)}
                      </span>
                    ))}
                  </div>

                  <div className="mt-3 grid gap-3 md:grid-cols-3">
                    <ConfidenceMeter
                      label="Recovery confidence"
                      value={recovery.confidence}
                      color={visual.meter}
                    />
                    <ConfidenceMeter
                      label="Expected recovery"
                      value={recovery.expectedRecoveryLikelihood}
                      color="bg-emerald-500"
                    />
                    <div className="rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-neutral-500">
                        Recoverable revenue
                      </p>
                      <p className="mt-1 text-sm font-semibold text-neutral-950">
                        {formatMoney(recovery.estimatedRecoverableRevenue)}
                      </p>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <span className="rounded-full border border-neutral-200 bg-neutral-50 px-3 py-1.5 text-[11px] font-semibold text-neutral-600">
                      {recovery.automationSafetyLevel.replaceAll("_", " ")}
                    </span>
                    <span className="rounded-full border border-neutral-200 bg-neutral-50 px-3 py-1.5 text-[11px] font-semibold text-neutral-600">
                      {recovery.humanInterventionAvoided
                        ? "Human intervention avoided"
                        : "Human guardrail active"}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {memoryInsight?.operationalMemory ? (
        <div className="mb-6 rounded-[28px] border border-neutral-200/80 bg-neutral-50/80 p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-500">
                Operational Memory + Learning
              </p>
              <h3 className="mt-2 text-xl font-semibold tracking-tight text-neutral-950">
                Pattern detected: Valsentra is adapting future recommendations
              </h3>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-600">
                {memoryInsight.adaptiveExplanation ??
                  "Historical behavior is now part of recovery timing, prediction quality, and automation confidence."}
              </p>
            </div>
            <span className="rounded-full border border-blue-100 bg-blue-50 px-3 py-1.5 text-[11px] font-semibold text-blue-700">
              Memory confidence {memoryInsight.operationalMemory.memoryConfidence}%
            </span>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <SystemMetric
              label="Customer patterns"
              value={String(memoryInsight.operationalMemory.customerPatternCount)}
            />
            <SystemMetric
              label="Learning signals"
              value={String(memoryInsight.operationalMemory.learningSignalCount)}
            />
            <SystemMetric
              label="Adaptive rules"
              value={String(memoryInsight.operationalMemory.adaptiveRecommendations.length)}
            />
          </div>

          {memoryInsight.operationalMemory.adaptiveRecommendations.length > 0 ? (
            <div className="mt-4 rounded-2xl border border-neutral-200 bg-white p-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-500">
                Adaptive recommendation explanations
              </p>
              <div className="mt-3 grid gap-2">
                {memoryInsight.operationalMemory.adaptiveRecommendations.slice(0, 4).map((recommendation, index) => (
                  <div
                    key={`${recommendation}-${index}`}
                    className="rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm leading-5 text-neutral-700"
                  >
                    {recommendation}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {memoryPatterns.length > 0 ? (
            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              {memoryPatterns.slice(0, 4).map((insight, index) => {
                const pattern = insight.memoryPattern!;
                return (
                  <div
                    key={insightRenderKey(insight, "memory", index)}
                    className="rounded-2xl border border-neutral-200 bg-white p-4"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full border border-neutral-200 bg-neutral-50 px-2.5 py-1 text-[11px] font-semibold text-neutral-600">
                        {pattern.type.replaceAll("_", " ")}
                      </span>
                      <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${urgencyClasses(pattern.severity === "CRITICAL" ? "CRITICAL" : pattern.severity === "WARNING" ? "HIGH" : "MEDIUM")}`}>
                        {pattern.severity}
                      </span>
                      <span className="rounded-full border border-neutral-200 bg-neutral-50 px-2.5 py-1 text-[11px] font-semibold text-neutral-600">
                        {pattern.confidence}% confidence
                      </span>
                    </div>
                    <p className="mt-3 text-sm font-semibold text-neutral-950">
                      {pattern.title}
                    </p>
                    <p className="mt-1 text-sm leading-6 text-neutral-600">
                      {pattern.summary}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {pattern.signals.slice(0, 3).map((signal) => (
                        <span
                          key={signal}
                          className="rounded-full border border-neutral-200 bg-neutral-50 px-2.5 py-1 text-[11px] font-medium text-neutral-600"
                        >
                          {signal}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="space-y-6">
        {["Intervention required", "Autonomous action safe", "Monitoring", "Informational"].map((group) => {
          const groupInsights = insights
            .filter((insight) => getGroupLabel(insight) === group)
            .slice(0, group === "Informational" ? 3 : 5);

          if (groupInsights.length === 0) return null;

          return (
            <div key={group}>
              <div className="mb-3 flex items-center gap-2">
                <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-500">
                  {group}
                </p>
              </div>

              <div className="space-y-3">
                {groupInsights.map((insight, index) => {
          const visual = severityClasses(insight.severity);

          return (
            <article
              key={insightRenderKey(insight, group, index)}
                      className={`rounded-[24px] border border-l-4 border-neutral-200/80 bg-neutral-50/80 p-4 ${visual.rail}`}
            >
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`h-2.5 w-2.5 rounded-full ${visual.dot}`} />
                    {insight.scope === "SYSTEM" ? (
                      <span className="rounded-full border border-neutral-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-neutral-600">
                        SYSTEM
                      </span>
                    ) : null}
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-500">
                      {formatCategory(insight.category)}
                    </p>
                    {insight.orderId ? (
                      <span className="rounded-full border border-neutral-200 bg-white px-2.5 py-1 text-[11px] font-medium text-neutral-600">
                        {insight.orderId}
                      </span>
                    ) : null}
                    {insight.customerName ? (
                      <span className="rounded-full border border-neutral-200 bg-white px-2.5 py-1 text-[11px] font-medium text-neutral-600">
                        {insight.customerName}
                      </span>
                    ) : null}
                    {insight.transition ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-2.5 py-1 text-[11px] font-medium text-neutral-600">
                        {insight.transition.from}
                        <ArrowRight className="h-3 w-3" />
                        {insight.transition.to}
                      </span>
                    ) : null}
                    {insight.cluster ? (
                      <span className="rounded-full border border-neutral-200 bg-white px-2.5 py-1 text-[11px] font-medium text-neutral-600">
                        {insight.cluster.label} - {insight.cluster.heat}
                      </span>
                    ) : null}
                  </div>

                  <h3 className="mt-2 text-sm font-semibold text-neutral-950">
                    {insight.title}
                  </h3>
                  <p className="mt-1 text-sm leading-6 text-neutral-600">
                    {insight.summary}
                  </p>
                </div>

                <div className="flex shrink-0 flex-wrap gap-2 md:justify-end">
                  <span
                    className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-semibold ${visual.badge}`}
                  >
                    {visual.icon}
                    {insight.severity}
                  </span>
                  <span className="rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-neutral-600">
                    {insight.confidence}% confidence
                  </span>
                  <span className={`rounded-full border px-3 py-1.5 text-[11px] font-semibold ${urgencyClasses(insight.escalationUrgency)}`}>
                    {insight.escalationUrgency ?? "LOW"} urgency
                  </span>
                </div>
              </div>

              <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_0.9fr]">
                <div className="rounded-2xl border border-neutral-200 bg-white p-3">
                  <p className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-500">
                    <ChevronRight className="h-3.5 w-3.5" />
                    Reasoning tree
                  </p>
                  <ul className="mt-2 space-y-1.5 text-sm leading-5 text-neutral-600">
                    {insight.reasoning.slice(0, 4).map((reason) => (
                      <li key={reason} className="flex gap-2">
                        <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-neutral-400" />
                        <span>{reason}</span>
                      </li>
                    ))}
                  </ul>
                  {insight.cluster ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {insight.cluster.orders.slice(0, 6).map((orderId) => (
                        <span
                          key={orderId}
                          className="rounded-full border border-neutral-200 bg-neutral-50 px-2.5 py-1 text-[11px] font-medium text-neutral-600"
                        >
                          {orderId}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>

                <div className="rounded-2xl border border-neutral-200 bg-white p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-500">
                    Recommended Action
                  </p>
                  <p className="mt-2 inline-flex rounded-full border border-neutral-200 bg-neutral-50 px-3 py-1.5 text-xs font-semibold leading-5 text-neutral-700">
                    {insight.recommendedAction}
                  </p>
                  {insight.whyThisMatters ? (
                    <div className="mt-3 rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-neutral-500">
                        Why this matters
                      </p>
                      <p className="mt-1 text-xs leading-5 text-neutral-600">
                        {insight.whyThisMatters}
                      </p>
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="mt-3 grid gap-3 rounded-2xl border border-neutral-200 bg-white p-3 lg:grid-cols-3">
                <ConfidenceMeter
                  label="Recovery likelihood"
                  value={insight.forecast?.recoverySuccessLikelihood ?? insight.recoveryLikelihood ?? 55}
                  color="bg-emerald-500"
                />
                <ConfidenceMeter
                  label="Unrecoverable risk"
                  value={insight.forecast?.unrecoverableLikelihood ?? Math.max(0, 100 - (insight.recoveryLikelihood ?? 55))}
                  color={visual.meter}
                />
                <div className="rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2">
                  <p className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-neutral-500">
                    <Gauge className="h-3.5 w-3.5" />
                    Time to collapse
                  </p>
                  <p className="mt-1 text-sm font-semibold text-neutral-950">
                    {insight.forecast?.timeToCollapseMinutes === null ||
                    insight.forecast?.timeToCollapseMinutes === undefined
                      ? "Not imminent"
                      : `${insight.forecast.timeToCollapseMinutes} min`}
                  </p>
                </div>
              </div>

              <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_1fr_1fr]">
                <div className="rounded-2xl border border-neutral-200 bg-white p-3">
                  <p className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-neutral-500">
                    <ForecastTrendIcon trend={insight.forecast?.trend} />
                    Predictive forecast
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <span className="rounded-full border border-neutral-200 bg-neutral-50 px-3 py-1.5 text-[11px] font-semibold text-neutral-700">
                      {insight.forecast?.trend ?? "STABLE"}
                    </span>
                    <span className="rounded-full border border-neutral-200 bg-neutral-50 px-3 py-1.5 text-[11px] font-semibold text-neutral-700">
                      +{formatMoney(insight.forecast?.projectedRevenueExposureGrowth)} exposure
                    </span>
                  </div>
                </div>

                <div className="rounded-2xl border border-neutral-200 bg-white p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-neutral-500">
                    System pressure
                  </p>
                  <span className={`mt-2 inline-flex rounded-full border px-3 py-1.5 text-[11px] font-semibold ${pressureClasses(insight.systemPressure?.level)}`}>
                    {insight.systemPressure?.level ?? "LOW"} {insight.systemPressure ? `${insight.systemPressure.score}/100` : ""}
                  </span>
                </div>

                <div className="rounded-2xl border border-neutral-200 bg-white p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-neutral-500">
                    Autonomous recommendation
                  </p>
                  <p className="mt-2 inline-flex rounded-full border border-neutral-200 bg-neutral-50 px-3 py-1.5 text-[11px] font-semibold text-neutral-700">
                    {formatRecommendation(insight.autonomousRecommendation)}
                  </p>
                </div>
              </div>

              {insight.drift ? (
                <div className="mt-3 rounded-2xl border border-amber-100 bg-amber-50/70 p-3">
                  <p className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-700">
                    <TrendingUp className="h-3.5 w-3.5" />
                    Operational drift alert
                  </p>
                  <p className="mt-2 text-sm font-medium text-amber-950">
                    {insight.drift.summary}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {insight.drift.signals.slice(0, 4).map((signal) => (
                      <span
                        key={signal}
                        className="rounded-full border border-amber-100 bg-white px-2.5 py-1 text-[11px] font-medium text-amber-800"
                      >
                        {signal}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
            </article>
          );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {insights.some((insight) => insight.category === "AUTOPILOT" || insight.humanReviewBypassedSafely !== undefined) ? (
        <div className="mt-6 rounded-[24px] border border-neutral-200/80 bg-neutral-50/80 p-4">
          <p className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-500">
            <Zap className="h-3.5 w-3.5 text-neutral-700" />
            Autonomous Decision Feed
          </p>

          <div className="mt-3 space-y-2">
            {insights
              .filter((insight) => insight.category === "AUTOPILOT" || insight.humanReviewBypassedSafely !== undefined)
              .concat(recoveryInsights.filter((insight) => insight.recoveryRecommendation?.attempted))
              .slice(0, 4)
              .map((insight, index) => (
                <div
                  key={insightRenderKey(insight, "decision", index)}
                  className="rounded-2xl border border-neutral-200 bg-white px-4 py-3"
                >
                  <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-neutral-950">
                        {insight.title}
                      </p>
                      <p className="mt-1 text-xs leading-5 text-neutral-600">
                        {insight.reasoning[0] ?? insight.summary}
                      </p>
                    </div>
                    <span className="rounded-full border border-neutral-200 bg-neutral-50 px-3 py-1.5 text-[11px] font-semibold text-neutral-600">
                      {insight.humanReviewBypassedSafely
                        ? "Human review bypassed safely"
                        : "Human review protected"}
                    </span>
                  </div>
                </div>
              ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
