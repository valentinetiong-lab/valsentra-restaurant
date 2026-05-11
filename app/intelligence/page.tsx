"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import AutonomousDecisionPanel, {
  type AutonomousDecision,
  type DecisionRelatedEvent,
  type DecisionSeverity,
} from "../components/AutonomousDecisionPanel";
import {
  Activity,
  ArrowRight,
  Bot,
  Brain,
  CircleDot,
  CreditCard,
  Gauge,
  LineChart,
  LockKeyhole,
  Radar,
  RefreshCw,
  ShieldCheck,
  Siren,
  Users,
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
};

type PaymentState = "UNPAID" | "PENDING" | "VERIFIED" | "FAILED" | "BLOCKED";

type RestaurantOrder = {
  id: string;
  customerName: string;
  orderType?: string;
  amount?: number;
  guests?: number;
  status?: string;
  paymentState?: PaymentState;
  paymentVerified?: boolean;
  depositRequired?: boolean;
  depositAmount?: number;
  depositPaid?: boolean;
  reliabilityScore?: number;
  terminalMismatch?: boolean;
  riskLevel?: "LOW" | "MED" | "HIGH";
  protectionReason?: string;
  slotHoldStartedAt?: string | null;
  slotHoldExpiresAt?: string | null;
  collapseProbability?: number;
  collapseRiskTier?: string;
  recommendedIntervention?: string;
  ghostPingShouldSend?: boolean;
  ghostPingUrgency?: string;
  createdAt?: string | null;
};

type TimelineEvent = {
  id: string;
  orderId?: string;
  title?: string;
  summary?: string;
  action?: string;
  category?: string;
  severity?: "INFO" | "SUCCESS" | "WARNING" | "CRITICAL";
  collapseProbability?: number | null;
  recommendedIntervention?: string | null;
  ghostPingUrgency?: string | null;
  createdAt?: string;
};

type AutopilotFeedItem = {
  id: string;
  title: string;
  detail: string;
  status: string;
  orderId: string;
  confidence?: number | null;
  riskLevel?: string | null;
  recoverableRevenue?: number | null;
  orderAmount?: number | null;
  requiresHumanAction?: boolean;
  createdAt?: string;
};

type WaitlistLead = {
  id: string;
  customerName: string;
  preferredType: string;
  showProbability: number;
  responseSpeedScore: number;
  reliabilityScore: number;
  createdAt?: string;
};

type IntelligenceState = {
  orders: RestaurantOrder[];
  brain: BrainInsight[];
  timeline: TimelineEvent[];
  autopilot: AutopilotFeedItem[];
  waitlist: WaitlistLead[];
};

const emptyState: IntelligenceState = {
  orders: [],
  brain: [],
  timeline: [],
  autopilot: [],
  waitlist: [],
};

const severityRank: Record<BrainSeverity, number> = {
  CRITICAL: 4,
  WARNING: 3,
  WATCH: 2,
  INFO: 1,
};

function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function formatCurrency(value: number) {
  return `RM ${Math.round(value).toLocaleString("en-MY")}`;
}

function formatClock(value?: string | null) {
  if (!value) return "Live";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Live";

  return parsed.toLocaleTimeString("en-MY", {
    timeZone: "Asia/Kuala_Lumpur",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function isToday(value?: string | null) {
  if (!value) return false;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return false;

  const malaysiaDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  return malaysiaDate.format(parsed) === malaysiaDate.format(new Date());
}

function isClosed(order: RestaurantOrder) {
  return order.status === "CANCELLED" || order.status === "NO_SHOW";
}

function isVerified(order: RestaurantOrder) {
  return (
    order.status === "PAID" ||
    order.paymentState === "VERIFIED" ||
    Boolean(order.paymentVerified)
  );
}

function getProtectedValue(order: RestaurantOrder) {
  const amount = Number(order.amount ?? 0);

  if (isVerified(order)) return amount;
  if (order.depositPaid) return Number(order.depositAmount ?? 0);

  return 0;
}

function getAtRiskValue(order: RestaurantOrder) {
  if (isClosed(order) || isVerified(order)) return 0;
  return Number(order.amount ?? 0);
}

function isSuspicious(order: RestaurantOrder) {
  return (
    Boolean(order.terminalMismatch) ||
    order.paymentState === "FAILED" ||
    order.paymentState === "BLOCKED" ||
    Number(order.reliabilityScore ?? 70) <= 35 ||
    Number(order.collapseProbability ?? 0) >= 70 ||
    order.riskLevel === "HIGH"
  );
}

function hasSlotProtection(order: RestaurantOrder) {
  return (
    !isClosed(order) &&
    Boolean(
      order.slotHoldExpiresAt ||
        (order.depositRequired && !order.depositPaid) ||
        !isVerified(order)
    )
  );
}

function minutesUntil(value?: string | null) {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  if (Number.isNaN(parsed)) return null;

  return Math.ceil((parsed - Date.now()) / 60000);
}

async function fetchJson<T>(path: string, fallback: T): Promise<T> {
  try {
    const response = await fetch(path, { cache: "no-store" });
    if (!response.ok) return fallback;
    return (await response.json()) as T;
  } catch {
    return fallback;
  }
}

function severityTone(severity: BrainSeverity | TimelineEvent["severity"]) {
  if (severity === "CRITICAL") {
    return {
      dot: "bg-rose-400 shadow-[0_0_18px_rgba(251,113,133,0.55)]",
      text: "text-rose-100",
      ring: "border-rose-400/25 bg-rose-500/10",
    };
  }

  if (severity === "WARNING") {
    return {
      dot: "bg-amber-300 shadow-[0_0_18px_rgba(252,211,77,0.45)]",
      text: "text-amber-100",
      ring: "border-amber-300/25 bg-amber-400/10",
    };
  }

  if (severity === "WATCH") {
    return {
      dot: "bg-cyan-300 shadow-[0_0_18px_rgba(103,232,249,0.35)]",
      text: "text-cyan-100",
      ring: "border-cyan-300/25 bg-cyan-400/10",
    };
  }

  if (severity === "SUCCESS") {
    return {
      dot: "bg-emerald-300 shadow-[0_0_18px_rgba(110,231,183,0.42)]",
      text: "text-emerald-100",
      ring: "border-emerald-300/25 bg-emerald-400/10",
    };
  }

  return {
    dot: "bg-slate-300 shadow-[0_0_18px_rgba(203,213,225,0.25)]",
    text: "text-slate-100",
    ring: "border-white/10 bg-white/[0.05]",
  };
}

function categoryLabel(category: string) {
  return category.toLowerCase().replaceAll("_", " ");
}

function toDecisionSeverity(
  value?: BrainSeverity | TimelineEvent["severity"]
): DecisionSeverity {
  if (value === "CRITICAL") return "CRITICAL";
  if (value === "WARNING") return "WARNING";
  if (value === "WATCH") return "WATCH";
  if (value === "SUCCESS") return "SUCCESS";
  return "INFO";
}

export default function OperationalIntelligencePage() {
  const [state, setState] = useState<IntelligenceState>(emptyState);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [openDecision, setOpenDecision] = useState<AutonomousDecision | null>(null);

  useEffect(() => {
    let active = true;

    async function load() {
      const [orders, brain, timeline, autopilot, waitlist] = await Promise.all([
        fetchJson<RestaurantOrder[]>("/api/orders", []),
        fetchJson<BrainInsight[]>("/api/intelligence/brain", []),
        fetchJson<TimelineEvent[]>("/api/intelligence/timeline", []),
        fetchJson<AutopilotFeedItem[]>("/api/autopilot/feed", []),
        fetchJson<WaitlistLead[]>("/api/waitlist", []),
      ]);

      if (!active) return;

      setState({ orders, brain, timeline, autopilot, waitlist });
      setLastUpdated(new Date());
      setLoading(false);
    }

    load();
    const timer = window.setInterval(load, 12000);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  const intelligence = useMemo(() => {
    const activeOrders = state.orders.filter((order) => !isClosed(order));
    const todayOrders = state.orders.filter((order) => isToday(order.createdAt));
    const protectedToday = todayOrders.reduce(
      (total, order) => total + getProtectedValue(order),
      0
    );
    const protectedTotal = state.orders.reduce(
      (total, order) => total + getProtectedValue(order),
      0
    );
    const revenueAtRisk = activeOrders.reduce(
      (total, order) => total + getAtRiskValue(order),
      0
    );
    const slotProtected = activeOrders.filter(hasSlotProtection);
    const expiredSlots = slotProtected.filter((order) => {
      const remaining = minutesUntil(order.slotHoldExpiresAt);
      return remaining !== null && remaining <= 0;
    });
    const suspiciousOrders = activeOrders.filter(isSuspicious);
    const paymentWatch = activeOrders.filter(
      (order) => !isVerified(order) || order.paymentState === "PENDING"
    );
    const criticalBrain = state.brain.filter(
      (insight) => insight.severity === "CRITICAL"
    );
    const warningBrain = state.brain.filter(
      (insight) => insight.severity === "WARNING"
    );
    const autonomousDecisions = state.brain.filter(
      (insight) => insight.category === "AUTOPILOT"
    );
    const recoverySignals = state.brain.filter(
      (insight) => insight.category === "RECOVERY"
    );
    const verifiedRatio =
      activeOrders.length === 0
        ? 100
        : (activeOrders.filter(isVerified).length / activeOrders.length) * 100;
    const atRiskRatio =
      protectedTotal + revenueAtRisk === 0
        ? 0
        : (revenueAtRisk / (protectedTotal + revenueAtRisk)) * 100;
    const healthScore = clamp(
      96 -
        criticalBrain.length * 8 -
        warningBrain.length * 5 -
        suspiciousOrders.length * 4 -
        expiredSlots.length * 7 -
        atRiskRatio * 0.25 +
        verifiedRatio * 0.08
    );

    const nextAction =
      state.brain
        .slice()
        .sort((a, b) => {
          const severityDelta = severityRank[b.severity] - severityRank[a.severity];
          if (severityDelta !== 0) return severityDelta;
          return b.confidence - a.confidence;
        })[0]?.recommendedAction ?? "No intervention required from current signals.";

    return {
      activeOrders,
      protectedToday,
      revenueAtRisk,
      slotProtected,
      expiredSlots,
      suspiciousOrders,
      paymentWatch,
      criticalBrain,
      warningBrain,
      autonomousDecisions,
      recoverySignals,
      healthScore,
      nextAction,
    };
  }, [state]);

  const leadInsight = state.brain[0];
  const leadTone = severityTone(leadInsight?.severity ?? "INFO");
  const orderById = useMemo(
    () => new Map(state.orders.map((order) => [order.id, order])),
    [state.orders]
  );
  const highestRiskOrders = intelligence.suspiciousOrders
    .slice()
    .sort((a, b) => Number(b.collapseProbability ?? 0) - Number(a.collapseProbability ?? 0))
    .slice(0, 4);

  function buildTimelineDecision(event: TimelineEvent): AutonomousDecision {
    const order = event.orderId ? orderById.get(event.orderId) : undefined;
    const brainInsight = event.orderId
      ? state.brain.find((insight) => insight.orderId === event.orderId)
      : undefined;
    const relatedEvents: DecisionRelatedEvent[] = state.timeline
      .filter((candidate) => !event.orderId || candidate.orderId === event.orderId)
      .slice(0, 8)
      .map((candidate) => ({
        id: String(candidate.id),
        title: candidate.title ?? candidate.action ?? "Operational event",
        summary: candidate.summary ?? candidate.action,
        category: candidate.category,
        severity: toDecisionSeverity(candidate.severity),
        createdAt: candidate.createdAt,
      }));
    const reliabilityScore = order?.reliabilityScore;
    const confidence = brainInsight?.confidence ?? event.collapseProbability ?? 68;
    const noShowProbability = clamp(
      Math.max(
        Number(order?.collapseProbability ?? event.collapseProbability ?? 0),
        reliabilityScore === undefined ? 0 : 100 - reliabilityScore
      )
    );
    const reasoning = [
      ...(brainInsight?.reasoning ?? []),
      event.summary ?? event.action ?? "",
      order?.terminalMismatch ? "Terminal mismatch detected." : "",
      order && !isVerified(order) ? "Payment is not verified." : "",
      order?.depositRequired && !order.depositPaid ? "Deposit is required but unpaid." : "",
      event.ghostPingUrgency ? `Ghost Ping urgency is ${event.ghostPingUrgency}.` : "",
    ].filter(Boolean);

    return {
      id: `timeline-${event.id}`,
      title: event.title ?? event.action ?? "Operational decision",
      summary: event.summary ?? event.action ?? "Valsentra recorded an operational decision.",
      severity: toDecisionSeverity(event.severity),
      category: categoryLabel(event.category ?? "audit"),
      confidence,
      orderId: event.orderId,
      customerName: order?.customerName ?? brainInsight?.customerName,
      createdAt: event.createdAt,
      riskFactors: reasoning,
      reliabilityScore,
      reliabilityAnalysis:
        reliabilityScore === undefined
          ? "No customer reliability score was attached to this timeline event."
          : `Customer reliability is ${reliabilityScore}/100 and is evaluated beside payment state, collapse probability, and audit history.`,
      paymentState: order?.paymentState,
      paymentVerified: order?.paymentVerified,
      depositRequired: order?.depositRequired,
      depositPaid: order?.depositPaid,
      relatedEvents,
      revenueImpact: Number(order?.amount ?? 0),
      noShowProbability,
      recommendedActions: [
        brainInsight?.recommendedAction ??
          event.recommendedIntervention?.replaceAll("_", " ") ??
          "Continue monitoring this operational signal.",
      ],
      reasoning,
      nextSteps: [
        order && !isVerified(order)
          ? "Capacity remains protected while payment truth is unresolved."
          : "Valsentra will keep this event in the operational audit trail.",
        event.recommendedIntervention
          ? `The current intervention path is ${event.recommendedIntervention.replaceAll("_", " ")}.`
          : "",
        event.ghostPingUrgency
          ? "Ghost Ping timing remains available to the intervention layer."
          : "",
      ].filter(Boolean),
    };
  }

  return (
    <main className="min-h-screen overflow-hidden bg-[#02040a] text-slate-100">
      <div className="pointer-events-none fixed inset-0">
        <div className="absolute left-[-10%] top-[-20%] h-[520px] w-[520px] rounded-full bg-cyan-500/10 blur-[110px]" />
        <div className="absolute right-[-12%] top-[10%] h-[620px] w-[620px] rounded-full bg-blue-500/10 blur-[130px]" />
        <div className="absolute bottom-[-22%] left-[18%] h-[520px] w-[760px] rounded-full bg-emerald-400/8 blur-[130px]" />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(148,163,184,0.045)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.035)_1px,transparent_1px)] bg-[size:68px_68px]" />
      </div>

      <div className="relative mx-auto flex max-w-[1560px] flex-col gap-6 px-5 py-5 sm:px-8 lg:px-10">
        <header className="flex flex-col gap-4 border-b border-white/10 pb-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-4">
            <div className="relative flex h-13 w-13 items-center justify-center rounded-2xl border border-cyan-300/20 bg-cyan-300/10 shadow-[0_0_45px_rgba(34,211,238,0.12)]">
              <Brain className="h-6 w-6 text-cyan-100" />
              <span className="absolute -right-1 -top-1 h-3 w-3 rounded-full bg-emerald-300 shadow-[0_0_18px_rgba(110,231,183,0.75)]" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-cyan-100/70">
                <span>Valsentra AGaaS</span>
                <span className="h-1 w-1 rounded-full bg-cyan-200/50" />
                <span>Operational Brain</span>
              </div>
              <h1 className="mt-2 text-3xl font-semibold tracking-[-0.03em] text-white sm:text-5xl">
                Operational Intelligence
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300">
                A live control layer for payment truth, collapse prevention,
                slot protection, recovery automation, and revenue defense.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 rounded-full border border-emerald-300/20 bg-emerald-300/10 px-3 py-2 text-xs font-medium text-emerald-100">
              <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-300 shadow-[0_0_16px_rgba(110,231,183,0.85)]" />
              Live intelligence running
            </div>
            <div className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-slate-300">
              Synced {lastUpdated ? formatClock(lastUpdated.toISOString()) : "now"}
            </div>
            <Link
              href="/restaurant/owner"
              className="group flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-3 py-2 text-xs font-medium text-slate-200 transition hover:border-cyan-200/30 hover:bg-cyan-200/10"
            >
              Owner Control Center
              <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
            </Link>
          </div>
        </header>

        <section className="grid gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(360px,0.85fr)]">
          <div className="relative overflow-hidden rounded-[32px] border border-white/10 bg-white/[0.045] p-5 shadow-[0_28px_90px_rgba(0,0,0,0.35)] backdrop-blur-xl sm:p-7">
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-200/50 to-transparent" />
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`h-2.5 w-2.5 rounded-full ${leadTone.dot}`} />
                  <span className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">
                    Current system judgement
                  </span>
                </div>

                <h2 className="mt-5 max-w-3xl text-2xl font-semibold tracking-[-0.03em] text-white sm:text-4xl">
                  {leadInsight?.title ?? "No critical intervention required"}
                </h2>

                <p className="mt-4 max-w-3xl text-sm leading-6 text-slate-300">
                  {leadInsight?.summary ??
                    "The operational brain is online and waiting for live order, audit, and recovery signals."}
                </p>

                <div className="mt-6 flex flex-wrap gap-3">
                  <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
                    <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-slate-500">
                      Recommended next action
                    </div>
                    <div className="mt-1 max-w-2xl text-sm font-medium text-slate-100">
                      {intelligence.nextAction}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
                    <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-slate-500">
                      Decision confidence
                    </div>
                    <div className="mt-1 text-sm font-semibold text-cyan-100">
                      {leadInsight ? `${leadInsight.confidence}%` : "Standby"}
                    </div>
                  </div>
                </div>
              </div>

              <div className="relative overflow-hidden rounded-[28px] border border-cyan-200/15 bg-[#04111f]/80 p-5">
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(34,211,238,0.18),transparent_42%)]" />
                <div className="relative flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-100/70">
                    Business health
                  </span>
                  <Gauge className="h-4 w-4 text-cyan-100/70" />
                </div>
                <div className="relative mt-7 flex items-end gap-3">
                  <span className="text-6xl font-semibold tracking-[-0.08em] text-white">
                    {intelligence.healthScore}
                  </span>
                  <span className="mb-2 text-sm text-slate-400">/100</span>
                </div>
                <div className="relative mt-5 h-2 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-cyan-200 via-emerald-200 to-white transition-all duration-700"
                    style={{ width: `${intelligence.healthScore}%` }}
                  />
                </div>
                <div className="relative mt-5 grid grid-cols-2 gap-3 text-xs">
                  <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                    <div className="text-slate-500">Critical</div>
                    <div className="mt-1 text-lg font-semibold text-white">
                      {intelligence.criticalBrain.length}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                    <div className="text-slate-500">Watching</div>
                    <div className="mt-1 text-lg font-semibold text-white">
                      {intelligence.warningBrain.length + intelligence.paymentWatch.length}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-1">
            <MetricPanel
              icon={<ShieldCheck className="h-4 w-4" />}
              label="Revenue protected today"
              value={formatCurrency(intelligence.protectedToday)}
              detail={`${intelligence.activeOrders.length} live orders monitored`}
              accent="emerald"
            />
            <MetricPanel
              icon={<LockKeyhole className="h-4 w-4" />}
              label="Active slot protection"
              value={`${intelligence.slotProtected.length}`}
              detail={`${intelligence.expiredSlots.length} expired holds need control`}
              accent="cyan"
            />
          </div>
        </section>

        <section className="grid gap-5 lg:grid-cols-4">
          <SignalTile
            icon={<Bot className="h-4 w-4" />}
            label="Autonomous decisions"
            value={String(intelligence.autonomousDecisions.length + state.autopilot.length)}
            detail="From brain and audit feed"
          />
          <SignalTile
            icon={<CreditCard className="h-4 w-4" />}
            label="Payment truth watch"
            value={String(intelligence.paymentWatch.length)}
            detail="Unverified, pending, or exposed"
          />
          <SignalTile
            icon={<Siren className="h-4 w-4" />}
            label="Suspicious customers"
            value={String(intelligence.suspiciousOrders.length)}
            detail="Terminal, reliability, risk signals"
          />
          <SignalTile
            icon={<Users className="h-4 w-4" />}
            label="Waitlist automation"
            value={String(state.waitlist.length)}
            detail={`${intelligence.recoverySignals.length} recovery signals`}
          />
        </section>

        <section className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(380px,0.9fr)]">
          <div className="grid gap-5">
            <PanelShell
              title="Live Operational Brain"
              eyebrow="Autonomous AI decisions"
              icon={<Brain className="h-4 w-4" />}
              action={`${state.brain.length} explainable insights`}
            >
              {loading ? (
                <EmptyMessage label="Synchronizing intelligence layer..." />
              ) : state.brain.length === 0 ? (
                <EmptyMessage label="No active operational brain insights from current data." />
              ) : (
                <div className="space-y-3">
                  {state.brain.slice(0, 6).map((insight) => (
                    <BrainRow key={insight.id} insight={insight} />
                  ))}
                </div>
              )}
            </PanelShell>

            <PanelShell
              title="Operational Timeline"
              eyebrow="System activity"
              icon={<Activity className="h-4 w-4" />}
              action={`${state.timeline.length} audit-derived events`}
            >
              {state.timeline.length === 0 ? (
                <EmptyMessage label="No timeline events are available yet." />
              ) : (
                <div className="space-y-1">
                  {state.timeline.slice(0, 8).map((event, index) => (
                    <TimelineRow
                      key={event.id}
                      event={event}
                      isLast={index === Math.min(state.timeline.length, 8) - 1}
                      onOpen={() => setOpenDecision(buildTimelineDecision(event))}
                    />
                  ))}
                </div>
              )}
            </PanelShell>
          </div>

          <div className="grid gap-5">
            <PanelShell
              title="Risk Field"
              eyebrow="Live risk analysis"
              icon={<Radar className="h-4 w-4" />}
              action={`${highestRiskOrders.length} visible signals`}
            >
              {highestRiskOrders.length === 0 ? (
                <EmptyMessage label="No suspicious active customers detected." />
              ) : (
                <div className="space-y-3">
                  {highestRiskOrders.map((order) => (
                    <RiskRow key={order.id} order={order} />
                  ))}
                </div>
              )}
            </PanelShell>

            <PanelShell
              title="Payment Verification Intelligence"
              eyebrow="Payment truth layer"
              icon={<CreditCard className="h-4 w-4" />}
              action={`${intelligence.paymentWatch.length} watched`}
            >
              <div className="grid grid-cols-3 gap-2">
                <MiniStat
                  label="Verified"
                  value={String(state.orders.filter(isVerified).length)}
                />
                <MiniStat
                  label="Pending"
                  value={
                    String(state.orders.filter((order) => order.paymentState === "PENDING").length)
                  }
                />
                <MiniStat
                  label="Blocked"
                  value={
                    String(
                      state.orders.filter(
                        (order) =>
                          order.paymentState === "BLOCKED" ||
                          order.paymentState === "FAILED"
                      ).length
                    )
                  }
                />
              </div>
              <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4 text-sm leading-6 text-slate-300">
                {intelligence.paymentWatch.length > 0
                  ? "Unverified payment states are being held inside the protection layer before capacity is released."
                  : "Current payment truth state has no unresolved live exposure."}
              </div>
            </PanelShell>

            <PanelShell
              title="Waitlist Replacement Automation"
              eyebrow="Recovery layer"
              icon={<RefreshCw className="h-4 w-4" />}
              action={`${state.waitlist.length} candidates`}
            >
              {state.waitlist.length === 0 ? (
                <EmptyMessage label="No active waitlist candidates returned by the live waitlist API." />
              ) : (
                <div className="space-y-3">
                  {state.waitlist.slice(0, 4).map((lead) => (
                    <div
                      key={lead.id}
                      className="rounded-2xl border border-white/10 bg-white/[0.035] p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-medium text-white">{lead.customerName}</div>
                          <div className="mt-1 text-xs text-slate-500">
                            {lead.preferredType?.replaceAll("_", " ") ?? "Preferred slot"}
                          </div>
                        </div>
                        <div className="rounded-full border border-emerald-300/20 bg-emerald-300/10 px-2.5 py-1 text-xs font-semibold text-emerald-100">
                          {Math.round(lead.showProbability)}% show
                        </div>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-400">
                        <span>Response {Math.round(lead.responseSpeedScore)}</span>
                        <span>Reliability {Math.round(lead.reliabilityScore)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </PanelShell>
          </div>
        </section>
      </div>

      <style jsx global>{`
        @keyframes intelligenceSweep {
          0% {
            transform: translateX(-100%);
            opacity: 0;
          }
          18% {
            opacity: 0.35;
          }
          100% {
            transform: translateX(100%);
            opacity: 0;
          }
        }
      `}</style>
      <AutonomousDecisionPanel
        decision={openDecision}
        onClose={() => setOpenDecision(null)}
      />
    </main>
  );
}

function MetricPanel({
  icon,
  label,
  value,
  detail,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail: string;
  accent: "emerald" | "cyan";
}) {
  const accentClass =
    accent === "emerald"
      ? "text-emerald-100 border-emerald-300/20 bg-emerald-300/10"
      : "text-cyan-100 border-cyan-300/20 bg-cyan-300/10";

  return (
    <div className="group relative overflow-hidden rounded-[28px] border border-white/10 bg-white/[0.045] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.28)] backdrop-blur-xl transition duration-300 hover:-translate-y-0.5 hover:border-white/20 hover:bg-white/[0.065]">
      <div className="absolute inset-y-0 left-0 w-1/2 bg-gradient-to-r from-white/[0.04] to-transparent opacity-0 transition group-hover:opacity-100" />
      <div className="relative flex items-center justify-between">
        <div className={`rounded-2xl border p-2.5 ${accentClass}`}>{icon}</div>
        <LineChart className="h-4 w-4 text-slate-600" />
      </div>
      <div className="relative mt-7 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
        {label}
      </div>
      <div className="relative mt-2 text-3xl font-semibold tracking-[-0.05em] text-white">
        {value}
      </div>
      <div className="relative mt-3 text-sm text-slate-400">{detail}</div>
    </div>
  );
}

function SignalTile({
  icon,
  label,
  value,
  detail,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-[24px] border border-white/10 bg-white/[0.035] p-4 backdrop-blur-xl">
      <div className="flex items-center justify-between">
        <div className="rounded-xl border border-white/10 bg-white/[0.05] p-2 text-slate-300">
          {icon}
        </div>
        <div className="h-2 w-2 rounded-full bg-cyan-200/70 shadow-[0_0_16px_rgba(103,232,249,0.42)]" />
      </div>
      <div className="mt-5 text-2xl font-semibold tracking-[-0.04em] text-white">{value}</div>
      <div className="mt-1 text-xs font-medium uppercase tracking-[0.16em] text-slate-500">
        {label}
      </div>
      <div className="mt-2 text-xs text-slate-400">{detail}</div>
    </div>
  );
}

function PanelShell({
  title,
  eyebrow,
  icon,
  action,
  children,
}: {
  title: string;
  eyebrow: string;
  icon: React.ReactNode;
  action: string;
  children: React.ReactNode;
}) {
  return (
    <section className="relative overflow-hidden rounded-[30px] border border-white/10 bg-white/[0.045] p-5 shadow-[0_24px_90px_rgba(0,0,0,0.28)] backdrop-blur-xl">
      <div className="absolute left-0 right-0 top-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent" />
      <div className="mb-5 flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="rounded-2xl border border-white/10 bg-white/[0.055] p-2.5 text-cyan-100">
            {icon}
          </div>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
              {eyebrow}
            </div>
            <h2 className="mt-1 text-lg font-semibold tracking-[-0.03em] text-white">
              {title}
            </h2>
          </div>
        </div>
        <div className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs text-slate-400">
          {action}
        </div>
      </div>
      {children}
    </section>
  );
}

function BrainRow({ insight }: { insight: BrainInsight }) {
  const tone = severityTone(insight.severity);

  return (
    <div className="group relative overflow-hidden rounded-[24px] border border-white/10 bg-black/20 p-4 transition duration-300 hover:border-cyan-200/25 hover:bg-cyan-200/[0.055]">
      <div className="pointer-events-none absolute inset-y-0 left-0 w-full -translate-x-full bg-gradient-to-r from-transparent via-cyan-200/10 to-transparent group-hover:[animation:intelligenceSweep_1.6s_ease-out]" />
      <div className="relative flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full ${tone.dot}`} />
            <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${tone.ring} ${tone.text}`}>
              {insight.severity}
            </span>
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] font-medium text-slate-400">
              {categoryLabel(insight.category)}
            </span>
            {insight.orderId ? (
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] text-slate-400">
                {insight.orderId}
              </span>
            ) : null}
          </div>
          <h3 className="mt-3 text-base font-semibold tracking-[-0.02em] text-white">
            {insight.title}
          </h3>
          <p className="mt-2 text-sm leading-6 text-slate-400">{insight.summary}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {insight.reasoning.slice(0, 3).map((reason) => (
              <span
                key={reason}
                className="rounded-full border border-white/10 bg-white/[0.035] px-3 py-1 text-xs text-slate-400"
              >
                {reason}
              </span>
            ))}
          </div>
        </div>
        <div className="flex shrink-0 flex-row gap-2 sm:flex-col sm:items-end">
          <span className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1.5 text-xs font-semibold text-cyan-100">
            {insight.confidence}% confidence
          </span>
          <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-slate-300">
            {formatClock(insight.createdAt)}
          </span>
        </div>
      </div>
      <div className="relative mt-4 rounded-2xl border border-white/10 bg-white/[0.035] px-4 py-3 text-sm font-medium text-slate-200">
        {insight.recommendedAction}
      </div>
    </div>
  );
}

function TimelineRow({
  event,
  isLast,
  onOpen,
}: {
  event: TimelineEvent;
  isLast: boolean;
  onOpen: () => void;
}) {
  const tone = severityTone(event.severity ?? "INFO");

  return (
    <button
      type="button"
      onClick={onOpen}
      className="grid w-full grid-cols-[70px_22px_minmax(0,1fr)] gap-3 text-left"
    >
      <div className="pt-3 text-right text-xs text-slate-500">{formatClock(event.createdAt)}</div>
      <div className="relative flex justify-center pt-3">
        <span className={`z-10 h-2.5 w-2.5 rounded-full ${tone.dot}`} />
        {!isLast ? <span className="absolute bottom-0 top-6 w-px bg-white/10" /> : null}
      </div>
      <div className="rounded-2xl border border-white/10 bg-black/20 p-4 transition hover:border-cyan-200/25 hover:bg-cyan-200/[0.045]">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
            {categoryLabel(event.category ?? "audit")}
          </span>
          {event.orderId ? (
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[11px] text-slate-400">
              {event.orderId}
            </span>
          ) : null}
        </div>
        <div className="mt-2 font-medium text-white">
          {event.title ?? event.action ?? "Operational event"}
        </div>
        <div className="mt-1 text-sm leading-6 text-slate-400">
          {event.summary ?? event.action}
        </div>
      </div>
    </button>
  );
}

function RiskRow({ order }: { order: RestaurantOrder }) {
  const probability = Number(order.collapseProbability ?? 0);
  const remaining = minutesUntil(order.slotHoldExpiresAt);

  return (
    <div className="rounded-[22px] border border-white/10 bg-black/20 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-medium text-white">{order.customerName}</div>
          <div className="mt-1 text-xs text-slate-500">{order.id}</div>
        </div>
        <div className="rounded-full border border-rose-300/20 bg-rose-300/10 px-2.5 py-1 text-xs font-semibold text-rose-100">
          {probability}% collapse
        </div>
      </div>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full bg-gradient-to-r from-cyan-200 via-amber-200 to-rose-300"
          style={{ width: `${clamp(probability)}%` }}
        />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-400">
        <span>Reliability {Math.round(Number(order.reliabilityScore ?? 70))}</span>
        <span>
          Slot {remaining === null ? "not timed" : remaining <= 0 ? "expired" : `${remaining}m`}
        </span>
      </div>
      <div className="mt-3 rounded-2xl border border-white/10 bg-white/[0.035] px-3 py-2 text-xs text-slate-300">
        {order.recommendedIntervention?.replaceAll("_", " ") ?? "Monitor"}
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
      <div className="text-xl font-semibold tracking-[-0.04em] text-white">{value}</div>
      <div className="mt-1 text-[11px] uppercase tracking-[0.14em] text-slate-500">
        {label}
      </div>
    </div>
  );
}

function EmptyMessage({ label }: { label: string }) {
  return (
    <div className="flex min-h-28 items-center justify-center rounded-[24px] border border-dashed border-white/10 bg-black/20 p-6 text-center text-sm text-slate-500">
      <div>
        <CircleDot className="mx-auto mb-3 h-5 w-5 text-slate-600" />
        {label}
      </div>
    </div>
  );
}
