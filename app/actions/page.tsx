"use client";

import Link from "next/link";
import { ReactNode, useEffect, useMemo, useState } from "react";
import AutonomousDecisionPanel, {
  type AutonomousDecision,
  type DecisionRelatedEvent,
  type DecisionSeverity,
} from "../components/AutonomousDecisionPanel";
import {
  AlertTriangle,
  ArrowRight,
  Ban,
  Bot,
  CheckCircle2,
  CircleDot,
  Clock3,
  CreditCard,
  Fingerprint,
  LockKeyhole,
  Radio,
  ShieldCheck,
  Split,
  Users,
  Zap,
} from "lucide-react";

type PaymentState = "UNPAID" | "PENDING" | "VERIFIED" | "FAILED" | "BLOCKED";
type BrainSeverity = "INFO" | "WATCH" | "WARNING" | "CRITICAL";
type BrainCategory =
  | "PAYMENT_TRUTH"
  | "COLLAPSE_PREVENTION"
  | "RECOVERY"
  | "FRAUD_CONTAINMENT"
  | "LEARNING"
  | "AUTOPILOT";

type RestaurantOrder = {
  id: string;
  customerName: string;
  phone?: string;
  amount?: number;
  status?: string;
  paymentState?: PaymentState;
  paymentVerified?: boolean;
  depositRequired?: boolean;
  depositAmount?: number;
  depositPaid?: boolean;
  reliabilityScore?: number;
  terminalMismatch?: boolean;
  riskLevel?: "LOW" | "MED" | "HIGH";
  slotHoldExpiresAt?: string | null;
  collapseProbability?: number;
  collapseRiskTier?: string;
  recommendedIntervention?: string;
  ghostPingUrgency?: string;
  createdAt?: string | null;
};

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

type AutopilotFeedItem = {
  id: string;
  title: string;
  detail: string;
  status: string;
  staff?: string;
  orderId: string;
  confidence?: number | null;
  riskLevel?: string | null;
  recoverableRevenue?: number | null;
  orderAmount?: number | null;
  requiresHumanAction?: boolean;
  createdAt?: string;
};

type TimelineEvent = {
  id: string;
  orderId?: string;
  title?: string;
  summary?: string;
  category?: string;
  severity?: "INFO" | "SUCCESS" | "WARNING" | "CRITICAL";
  createdAt?: string;
};

type ActionKind =
  | "AI_RECOMMENDATION"
  | "PAYMENT_VERIFICATION"
  | "DEPOSIT_REQUEST"
  | "RISK_BLOCK"
  | "AUTO_RELEASE"
  | "WAITLIST_REPLACEMENT";

type ActionStatus = "PENDING" | "COMPLETED" | "BLOCKED" | "WARNING";

type ActionItem = {
  id: string;
  title: string;
  summary: string;
  status: ActionStatus;
  kind: ActionKind;
  severity: BrainSeverity;
  orderId?: string;
  customerName?: string;
  confidence?: number;
  revenueProtected: number;
  recommendedAction: string;
  reasoning: string[];
  createdAt?: string;
  source: "brain" | "audit" | "order";
};

type ActionCenterState = {
  orders: RestaurantOrder[];
  brain: BrainInsight[];
  autopilot: AutopilotFeedItem[];
  timeline: TimelineEvent[];
};

const emptyState: ActionCenterState = {
  orders: [],
  brain: [],
  autopilot: [],
  timeline: [],
};

const filters = ["ALL", "PENDING", "COMPLETED", "BLOCKED", "WARNING"] as const;

function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function money(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
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

function isPaymentIssue(order: RestaurantOrder) {
  return (
    !isClosed(order) &&
    (!isVerified(order) ||
      order.paymentState === "PENDING" ||
      order.paymentState === "FAILED" ||
      order.paymentState === "BLOCKED")
  );
}

function isBlockedRisk(order: RestaurantOrder) {
  return (
    !isClosed(order) &&
    (order.paymentState === "BLOCKED" ||
      order.paymentState === "FAILED" ||
      Boolean(order.terminalMismatch) ||
      order.riskLevel === "HIGH" ||
      Number(order.collapseProbability ?? 0) >= 75)
  );
}

function hasDepositAction(order: RestaurantOrder) {
  return (
    !isClosed(order) &&
    Boolean(order.depositRequired) &&
    !order.depositPaid &&
    !isVerified(order)
  );
}

function hasReleaseWarning(order: RestaurantOrder) {
  if (isClosed(order) || isVerified(order)) return false;
  const expiresAt = order.slotHoldExpiresAt ? new Date(order.slotHoldExpiresAt).getTime() : null;
  const expired = expiresAt !== null && !Number.isNaN(expiresAt) && expiresAt <= Date.now();

  return (
    expired ||
    order.recommendedIntervention === "RELEASE_AND_RECOVER" ||
    Number(order.collapseProbability ?? 0) >= 80
  );
}

function severityRank(severity: BrainSeverity) {
  if (severity === "CRITICAL") return 4;
  if (severity === "WARNING") return 3;
  if (severity === "WATCH") return 2;
  return 1;
}

function toDecisionSeverity(
  value?: BrainSeverity | TimelineEvent["severity"] | ActionStatus
): DecisionSeverity {
  if (value === "CRITICAL") return "CRITICAL";
  if (value === "WARNING") return "WARNING";
  if (value === "WATCH") return "WATCH";
  if (value === "SUCCESS" || value === "COMPLETED") return "SUCCESS";
  if (value === "BLOCKED") return "CRITICAL";
  return "INFO";
}

function statusTone(status: ActionStatus) {
  if (status === "BLOCKED") {
    return {
      dot: "bg-rose-400 shadow-[0_0_18px_rgba(251,113,133,0.65)]",
      badge: "border-rose-300/25 bg-rose-300/10 text-rose-100",
      panel: "border-rose-300/20 bg-rose-300/[0.055]",
    };
  }

  if (status === "WARNING") {
    return {
      dot: "bg-amber-300 shadow-[0_0_18px_rgba(252,211,77,0.5)]",
      badge: "border-amber-300/25 bg-amber-300/10 text-amber-100",
      panel: "border-amber-300/20 bg-amber-300/[0.055]",
    };
  }

  if (status === "COMPLETED") {
    return {
      dot: "bg-emerald-300 shadow-[0_0_18px_rgba(110,231,183,0.5)]",
      badge: "border-emerald-300/25 bg-emerald-300/10 text-emerald-100",
      panel: "border-emerald-300/20 bg-emerald-300/[0.055]",
    };
  }

  return {
    dot: "bg-cyan-300 shadow-[0_0_18px_rgba(103,232,249,0.5)]",
    badge: "border-cyan-300/25 bg-cyan-300/10 text-cyan-100",
    panel: "border-cyan-300/20 bg-cyan-300/[0.055]",
  };
}

function kindIcon(kind: ActionKind) {
  if (kind === "PAYMENT_VERIFICATION") return <CreditCard className="h-4 w-4" />;
  if (kind === "DEPOSIT_REQUEST") return <Fingerprint className="h-4 w-4" />;
  if (kind === "RISK_BLOCK") return <Ban className="h-4 w-4" />;
  if (kind === "AUTO_RELEASE") return <LockKeyhole className="h-4 w-4" />;
  if (kind === "WAITLIST_REPLACEMENT") return <Users className="h-4 w-4" />;
  return <Bot className="h-4 w-4" />;
}

function kindLabel(kind: ActionKind) {
  return kind.toLowerCase().replaceAll("_", " ");
}

function categoryToKind(category: BrainCategory): ActionKind {
  if (category === "PAYMENT_TRUTH") return "PAYMENT_VERIFICATION";
  if (category === "FRAUD_CONTAINMENT") return "RISK_BLOCK";
  if (category === "RECOVERY") return "WAITLIST_REPLACEMENT";
  if (category === "COLLAPSE_PREVENTION") return "AUTO_RELEASE";
  return "AI_RECOMMENDATION";
}

function brainStatus(insight: BrainInsight): ActionStatus {
  if (insight.category === "FRAUD_CONTAINMENT" || insight.severity === "CRITICAL") {
    return "BLOCKED";
  }
  if (insight.severity === "WARNING") return "WARNING";
  return "PENDING";
}

function buildOrderAction(
  order: RestaurantOrder,
  kind: ActionKind,
  title: string,
  summary: string,
  status: ActionStatus,
  recommendedAction: string,
  reasoning: string[]
): ActionItem {
  return {
    id: `order-${kind}-${order.id}`,
    title,
    summary,
    status,
    kind,
    severity: status === "BLOCKED" ? "CRITICAL" : status === "WARNING" ? "WARNING" : "WATCH",
    orderId: order.id,
    customerName: order.customerName,
    confidence: clamp(Number(order.collapseProbability ?? 70)),
    revenueProtected: money(order.amount),
    recommendedAction,
    reasoning,
    createdAt: order.createdAt ?? undefined,
    source: "order",
  };
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

export default function AiActionCenterPage() {
  const [state, setState] = useState<ActionCenterState>(emptyState);
  const [loading, setLoading] = useState(true);
  const [selectedFilter, setSelectedFilter] =
    useState<(typeof filters)[number]>("ALL");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [openDecision, setOpenDecision] = useState<AutonomousDecision | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  useEffect(() => {
    let active = true;

    async function load() {
      const [orders, brain, autopilot, timeline] = await Promise.all([
        fetchJson<RestaurantOrder[]>("/api/orders", []),
        fetchJson<BrainInsight[]>("/api/intelligence/brain", []),
        fetchJson<AutopilotFeedItem[]>("/api/autopilot/feed", []),
        fetchJson<TimelineEvent[]>("/api/intelligence/timeline", []),
      ]);

      if (!active) return;

      setState({ orders, brain, autopilot, timeline });
      setLastUpdated(new Date());
      setLoading(false);
    }

    load();
    const interval = window.setInterval(load, 12000);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  const orderById = useMemo(
    () => new Map(state.orders.map((order) => [order.id, order])),
    [state.orders]
  );

  const actions = useMemo(() => {
    const brainActions: ActionItem[] = state.brain.map((insight) => {
      const order = insight.orderId ? orderById.get(insight.orderId) : undefined;
      const kind = categoryToKind(insight.category);
      const status = brainStatus(insight);

      return {
        id: `brain-${insight.id}`,
        title: insight.title,
        summary: insight.summary,
        status,
        kind,
        severity: insight.severity,
        orderId: insight.orderId,
        customerName: insight.customerName,
        confidence: insight.confidence,
        revenueProtected: money(order?.amount),
        recommendedAction: insight.recommendedAction,
        reasoning: insight.reasoning,
        createdAt: insight.createdAt,
        source: "brain",
      };
    });

    const orderActions: ActionItem[] = state.orders.flatMap((order) => {
      const items: ActionItem[] = [];

      if (isBlockedRisk(order)) {
        items.push(
          buildOrderAction(
            order,
            "RISK_BLOCK",
            "Risk booking contained",
            `${order.customerName} is inside the protection layer until risk clears.`,
            "BLOCKED",
            "Keep this booking contained until payment and reliability signals resolve.",
            [
              order.terminalMismatch ? "Terminal mismatch is present." : "Risk score is elevated.",
              `Payment state is ${order.paymentState ?? "UNPAID"}.`,
              `Collapse probability is ${Number(order.collapseProbability ?? 0)}%.`,
            ]
          )
        );
      }

      if (hasDepositAction(order)) {
        items.push(
          buildOrderAction(
            order,
            "DEPOSIT_REQUEST",
            "Deposit request required",
            `${order.customerName} needs deposit protection before capacity is committed.`,
            "PENDING",
            "Send or verify the required deposit request.",
            [
              `Deposit due: ${formatCurrency(money(order.depositAmount) || money(order.amount) * 0.3)}.`,
              "Deposit is required but not paid.",
              `Order value is ${formatCurrency(money(order.amount))}.`,
            ]
          )
        );
      }

      if (isPaymentIssue(order)) {
        items.push(
          buildOrderAction(
            order,
            "PAYMENT_VERIFICATION",
            "Payment verification issue",
            `${order.customerName} has an unresolved payment truth state.`,
            order.paymentState === "FAILED" || order.paymentState === "BLOCKED"
              ? "BLOCKED"
              : "PENDING",
            "Verify payment before releasing operational capacity.",
            [
              `Payment state is ${order.paymentState ?? "UNPAID"}.`,
              order.paymentVerified ? "Payment flag is verified." : "Payment flag is not verified.",
              order.depositPaid ? "Deposit is paid." : "Deposit is not paid.",
            ]
          )
        );
      }

      if (hasReleaseWarning(order)) {
        items.push(
          buildOrderAction(
            order,
            "AUTO_RELEASE",
            "Auto-release warning active",
            `${order.id} may need capacity release and recovery protection.`,
            "WARNING",
            "Review release eligibility and prepare waitlist recovery.",
            [
              order.slotHoldExpiresAt
                ? `Slot hold expires at ${formatClock(order.slotHoldExpiresAt)}.`
                : "No slot expiry timestamp is available.",
              `Recommended intervention is ${order.recommendedIntervention ?? "MONITOR"}.`,
              `Collapse probability is ${Number(order.collapseProbability ?? 0)}%.`,
            ]
          )
        );
      }

      return items;
    });

    const completedActions: ActionItem[] = state.autopilot.map((item) => {
      const order = orderById.get(item.orderId);
      const lower = `${item.status} ${item.title} ${item.detail}`.toLowerCase();
      const kind: ActionKind = lower.includes("waitlist") || lower.includes("recovered")
        ? "WAITLIST_REPLACEMENT"
        : lower.includes("release")
          ? "AUTO_RELEASE"
          : lower.includes("payment") || lower.includes("reminder")
            ? "PAYMENT_VERIFICATION"
            : lower.includes("block")
              ? "RISK_BLOCK"
              : "AI_RECOMMENDATION";

      return {
        id: `feed-${item.id}`,
        title: item.title,
        summary: item.detail,
        status: item.requiresHumanAction ? "WARNING" : "COMPLETED",
        kind,
        severity: item.requiresHumanAction ? "WARNING" : "INFO",
        orderId: item.orderId,
        customerName: order?.customerName,
        confidence: item.confidence ? Number(item.confidence) : undefined,
        revenueProtected: money(item.recoverableRevenue ?? item.orderAmount ?? order?.amount),
        recommendedAction: item.requiresHumanAction
          ? "Review this autonomous action before execution continues."
          : "Action is recorded in the operational audit trail.",
        reasoning: [
          item.status,
          item.riskLevel ? `Risk level: ${item.riskLevel}.` : "Signal came from autopilot feed.",
          item.staff ? `Actor: ${item.staff}.` : "Actor: Valsentra.",
        ],
        createdAt: item.createdAt,
        source: "audit",
      };
    });

    const deduped = new Map<string, ActionItem>();
    for (const action of [...brainActions, ...orderActions, ...completedActions]) {
      const key = `${action.kind}-${action.status}-${action.orderId ?? action.id}-${action.title}`;
      if (!deduped.has(key)) deduped.set(key, action);
    }

    return Array.from(deduped.values()).sort((a, b) => {
      const statusDelta =
        Number(a.status === "COMPLETED") - Number(b.status === "COMPLETED");
      if (statusDelta !== 0) return statusDelta;

      const severityDelta = severityRank(b.severity) - severityRank(a.severity);
      if (severityDelta !== 0) return severityDelta;

      return new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime();
    });
  }, [orderById, state.autopilot, state.brain, state.orders]);

  const filteredActions = useMemo(() => {
    if (selectedFilter === "ALL") return actions;
    return actions.filter((action) => action.status === selectedFilter);
  }, [actions, selectedFilter]);

  const selectedAction = useMemo(() => {
    return (
      actions.find((action) => action.id === selectedId) ??
      filteredActions[0] ??
      actions[0] ??
      null
    );
  }, [actions, filteredActions, selectedId]);

  const metrics = useMemo(() => {
    const pending = actions.filter((action) => action.status === "PENDING");
    const completed = actions.filter((action) => action.status === "COMPLETED");
    const blocked = actions.filter((action) => action.status === "BLOCKED");
    const warnings = actions.filter((action) => action.status === "WARNING");
    const revenueProtected = actions.reduce(
      (sum, action) => sum + money(action.revenueProtected),
      0
    );
    const depositRequests = actions.filter(
      (action) => action.kind === "DEPOSIT_REQUEST"
    );
    const paymentIssues = actions.filter(
      (action) => action.kind === "PAYMENT_VERIFICATION" && action.status !== "COMPLETED"
    );
    const waitlistActions = actions.filter(
      (action) => action.kind === "WAITLIST_REPLACEMENT"
    );

    return {
      pending,
      completed,
      blocked,
      warnings,
      revenueProtected,
      depositRequests,
      paymentIssues,
      waitlistActions,
    };
  }, [actions]);

  function buildDecision(action: ActionItem): AutonomousDecision {
    const order = action.orderId ? orderById.get(action.orderId) : undefined;
    const relatedEvents: DecisionRelatedEvent[] = state.timeline
      .filter((event) => !action.orderId || event.orderId === action.orderId)
      .slice(0, 8)
      .map((event) => ({
        id: String(event.id),
        title: event.title ?? "Operational event",
        summary: event.summary,
        category: event.category,
        severity: toDecisionSeverity(event.severity),
        createdAt: event.createdAt,
      }));

    const reliabilityScore = order?.reliabilityScore;
    const noShowProbability = clamp(
      Math.max(
        Number(order?.collapseProbability ?? action.confidence ?? 0),
        reliabilityScore === undefined ? 0 : 100 - reliabilityScore
      )
    );
    const riskFactors = [
      ...action.reasoning,
      order?.terminalMismatch ? "Terminal mismatch detected." : "",
      order?.riskLevel === "HIGH" ? "Order risk level is HIGH." : "",
      order?.depositRequired && !order.depositPaid ? "Deposit protection is still unresolved." : "",
      order && !isVerified(order) ? "Payment is not verified." : "",
    ].filter(Boolean);

    return {
      id: action.id,
      title: action.title,
      summary: action.summary,
      severity: toDecisionSeverity(action.severity),
      category: kindLabel(action.kind),
      status: action.status,
      confidence: action.confidence,
      orderId: action.orderId,
      customerName: action.customerName ?? order?.customerName,
      createdAt: action.createdAt,
      riskFactors,
      reliabilityScore,
      reliabilityAnalysis:
        reliabilityScore === undefined
          ? "No customer reliability score was attached to this action."
          : `Customer reliability is ${reliabilityScore}/100. Valsentra uses this with payment truth and collapse probability before releasing capacity.`,
      paymentState: order?.paymentState,
      paymentVerified: order?.paymentVerified,
      depositRequired: order?.depositRequired,
      depositPaid: order?.depositPaid,
      relatedEvents,
      revenueImpact: action.revenueProtected,
      noShowProbability,
      recommendedActions: [action.recommendedAction],
      reasoning: action.reasoning,
      nextSteps: [
        action.status === "COMPLETED"
          ? "The result remains in the audit trail for future learning."
          : "Valsentra continues monitoring payment, risk, and slot expiry signals.",
        action.kind === "AUTO_RELEASE"
          ? "If release conditions remain true, waitlist recovery becomes the next protection path."
          : "",
        action.kind === "PAYMENT_VERIFICATION"
          ? "Capacity stays protected until payment truth resolves."
          : "",
        action.kind === "RISK_BLOCK"
          ? "Risk containment remains active until review or verified payment clears the block."
          : "",
      ].filter(Boolean),
    };
  }

  return (
    <main className="min-h-screen overflow-hidden bg-[#02040a] text-slate-100">
      <div className="pointer-events-none fixed inset-0">
        <div className="absolute left-[-14%] top-[-18%] h-[560px] w-[640px] rounded-full bg-cyan-500/10 blur-[130px]" />
        <div className="absolute right-[-18%] top-[8%] h-[700px] w-[700px] rounded-full bg-indigo-500/10 blur-[150px]" />
        <div className="absolute bottom-[-26%] left-[24%] h-[520px] w-[760px] rounded-full bg-emerald-400/[0.08] blur-[140px]" />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(148,163,184,0.045)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.035)_1px,transparent_1px)] bg-[size:72px_72px]" />
      </div>

      <div className="relative mx-auto flex max-w-[1560px] flex-col gap-6 px-5 py-5 sm:px-8 lg:px-10">
        <header className="flex flex-col gap-5 border-b border-white/10 pb-5 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex items-start gap-4">
            <div className="relative flex h-13 w-13 items-center justify-center rounded-2xl border border-cyan-300/20 bg-cyan-300/10 shadow-[0_0_45px_rgba(34,211,238,0.14)]">
              <Bot className="h-6 w-6 text-cyan-100" />
              <span className="absolute -right-1 -top-1 h-3 w-3 rounded-full bg-emerald-300 shadow-[0_0_18px_rgba(110,231,183,0.75)]" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-cyan-100/70">
                <span>Valsentra AGaaS</span>
                <span className="h-1 w-1 rounded-full bg-cyan-200/50" />
                <span>Autonomous action layer</span>
              </div>
              <h1 className="mt-2 text-3xl font-semibold tracking-[-0.03em] text-white sm:text-5xl">
                AI Action Center
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300">
                The execution room for Valsentra decisions: pending interventions,
                completed protections, blocked risk, release warnings, deposits,
                payment truth, and waitlist recovery.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 rounded-full border border-emerald-300/20 bg-emerald-300/10 px-3 py-2 text-xs font-medium text-emerald-100">
              <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-300 shadow-[0_0_16px_rgba(110,231,183,0.85)]" />
              Queue monitor live
            </div>
            <div className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-slate-300">
              Synced {lastUpdated ? formatClock(lastUpdated.toISOString()) : "now"}
            </div>
            <Link
              href="/intelligence"
              className="group flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-3 py-2 text-xs font-medium text-slate-200 transition hover:border-cyan-200/30 hover:bg-cyan-200/10"
            >
              Operational Intelligence
              <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
            </Link>
          </div>
        </header>

        <section className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(360px,0.8fr)]">
          <div className="relative overflow-hidden rounded-[32px] border border-white/10 bg-white/[0.045] p-5 shadow-[0_28px_90px_rgba(0,0,0,0.36)] backdrop-blur-xl sm:p-7">
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-200/50 to-transparent" />
            <div className="relative flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                  <Radio className="h-3.5 w-3.5 text-cyan-200" />
                  Live operations queue
                </div>
                <h2 className="mt-4 max-w-3xl text-2xl font-semibold tracking-[-0.03em] text-white sm:text-4xl">
                  {metrics.pending.length + metrics.warnings.length + metrics.blocked.length > 0
                    ? "Valsentra has active decisions in motion."
                    : "No active intervention is required right now."}
                </h2>
                <p className="mt-4 max-w-3xl text-sm leading-6 text-slate-300">
                  Every row below is derived from real orders, operational brain
                  insights, audit history, and autopilot feed events.
                </p>
              </div>

              <div className="grid min-w-[280px] grid-cols-2 gap-3">
                <HeroStat
                  label="Pending"
                  value={String(metrics.pending.length)}
                  icon={<Clock3 className="h-4 w-4" />}
                />
                <HeroStat
                  label="Completed"
                  value={String(metrics.completed.length)}
                  icon={<CheckCircle2 className="h-4 w-4" />}
                />
                <HeroStat
                  label="Blocked"
                  value={String(metrics.blocked.length)}
                  icon={<Ban className="h-4 w-4" />}
                />
                <HeroStat
                  label="Protected"
                  value={formatCurrency(metrics.revenueProtected)}
                  icon={<ShieldCheck className="h-4 w-4" />}
                />
              </div>
            </div>
          </div>

          <div className="relative overflow-hidden rounded-[32px] border border-cyan-200/15 bg-[#04111f]/85 p-5 shadow-[0_28px_90px_rgba(0,0,0,0.36)] backdrop-blur-xl">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(34,211,238,0.18),transparent_44%)]" />
            <div className="relative flex items-center justify-between">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-100/70">
                  Protection yield
                </div>
                <div className="mt-4 text-4xl font-semibold tracking-[-0.06em] text-white">
                  {formatCurrency(metrics.revenueProtected)}
                </div>
              </div>
              <Zap className="h-5 w-5 text-cyan-100/70" />
            </div>
            <div className="relative mt-6 grid gap-3">
              <RailMetric label="Deposit requests" value={metrics.depositRequests.length} />
              <RailMetric label="Payment issues" value={metrics.paymentIssues.length} />
              <RailMetric label="Waitlist actions" value={metrics.waitlistActions.length} />
              <RailMetric label="Auto-release warnings" value={actions.filter((a) => a.kind === "AUTO_RELEASE" && a.status !== "COMPLETED").length} />
            </div>
          </div>
        </section>

        <section className="grid gap-5 xl:grid-cols-[300px_minmax(0,1fr)_420px]">
          <aside className="grid gap-3 xl:self-start">
            <ControlStrip
              icon={<AlertTriangle className="h-4 w-4" />}
              label="Auto-release warnings"
              value={actions.filter((a) => a.kind === "AUTO_RELEASE" && a.status !== "COMPLETED").length}
            />
            <ControlStrip
              icon={<CreditCard className="h-4 w-4" />}
              label="Payment verification issues"
              value={metrics.paymentIssues.length}
            />
            <ControlStrip
              icon={<Fingerprint className="h-4 w-4" />}
              label="Deposit requests sent or due"
              value={metrics.depositRequests.length}
            />
            <ControlStrip
              icon={<Users className="h-4 w-4" />}
              label="Waitlist replacement actions"
              value={metrics.waitlistActions.length}
            />
          </aside>

          <section className="relative overflow-hidden rounded-[32px] border border-white/10 bg-white/[0.045] p-5 shadow-[0_28px_90px_rgba(0,0,0,0.32)] backdrop-blur-xl">
            <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                  Action queue
                </div>
                <h2 className="mt-1 text-xl font-semibold tracking-[-0.03em] text-white">
                  Autonomous protection workstream
                </h2>
              </div>
              <div className="flex flex-wrap gap-2">
                {filters.map((filter) => (
                  <button
                    key={filter}
                    onClick={() => setSelectedFilter(filter)}
                    className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                      selectedFilter === filter
                        ? "border-cyan-300/35 bg-cyan-300/12 text-cyan-100"
                        : "border-white/10 bg-white/[0.04] text-slate-400 hover:border-white/20 hover:text-slate-200"
                    }`}
                  >
                    {filter}
                  </button>
                ))}
              </div>
            </div>

            {loading ? (
              <EmptyState label="Synchronizing autonomous action queue..." />
            ) : filteredActions.length === 0 ? (
              <EmptyState label="No actions match this queue filter." />
            ) : (
              <div className="space-y-3">
                {filteredActions.map((action) => (
                  <ActionRow
                    key={action.id}
                    action={action}
                    selected={selectedAction?.id === action.id}
                    onSelect={() => {
                      setSelectedId(action.id);
                      setOpenDecision(buildDecision(action));
                    }}
                  />
                ))}
              </div>
            )}
          </section>

          <aside className="relative overflow-hidden rounded-[32px] border border-white/10 bg-white/[0.045] p-5 shadow-[0_28px_90px_rgba(0,0,0,0.32)] backdrop-blur-xl xl:self-start">
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-200/40 to-transparent" />
            {selectedAction ? (
              <ActionDetail action={selectedAction} />
            ) : (
              <EmptyState label="Select an action to inspect its reasoning." />
            )}
          </aside>
        </section>
      </div>
      <AutonomousDecisionPanel
        decision={openDecision}
        onClose={() => setOpenDecision(null)}
      />
    </main>
  );
}

function HeroStat({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
      <div className="flex items-center justify-between text-slate-500">
        <span className="text-[11px] font-semibold uppercase tracking-[0.16em]">
          {label}
        </span>
        {icon}
      </div>
      <div className="mt-3 text-2xl font-semibold tracking-[-0.05em] text-white">
        {value}
      </div>
    </div>
  );
}

function RailMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm">
      <span className="text-slate-400">{label}</span>
      <span className="font-semibold text-white">{value}</span>
    </div>
  );
}

function ControlStrip({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: number;
}) {
  return (
    <div className="group rounded-[24px] border border-white/10 bg-white/[0.04] p-4 backdrop-blur-xl transition duration-300 hover:-translate-y-0.5 hover:border-cyan-200/25 hover:bg-cyan-200/[0.055]">
      <div className="flex items-start justify-between gap-3">
        <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-2.5 text-cyan-100">
          {icon}
        </div>
        <span className="h-2 w-2 rounded-full bg-cyan-200/70 shadow-[0_0_16px_rgba(103,232,249,0.5)]" />
      </div>
      <div className="mt-5 text-3xl font-semibold tracking-[-0.06em] text-white">
        {value}
      </div>
      <div className="mt-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
        {label}
      </div>
    </div>
  );
}

function ActionRow({
  action,
  selected,
  onSelect,
}: {
  action: ActionItem;
  selected: boolean;
  onSelect: () => void;
}) {
  const tone = statusTone(action.status);

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`group w-full rounded-[24px] border p-4 text-left transition duration-300 ${
        selected
          ? `${tone.panel} shadow-[0_0_0_1px_rgba(103,232,249,0.12)]`
          : "border-white/10 bg-black/20 hover:border-cyan-200/25 hover:bg-cyan-200/[0.04]"
      }`}
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_160px] lg:items-start">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full ${tone.dot}`} />
            <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${tone.badge}`}>
              {action.status}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] font-medium text-slate-400">
              {kindIcon(action.kind)}
              {kindLabel(action.kind)}
            </span>
            {action.orderId ? (
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] text-slate-400">
                {action.orderId}
              </span>
            ) : null}
          </div>
          <h3 className="mt-3 text-base font-semibold tracking-[-0.02em] text-white">
            {action.title}
          </h3>
          <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-400">
            {action.summary}
          </p>
        </div>
        <div className="flex flex-row gap-2 lg:flex-col lg:items-end">
          <span className="rounded-full border border-emerald-300/20 bg-emerald-300/10 px-3 py-1.5 text-xs font-semibold text-emerald-100">
            {formatCurrency(action.revenueProtected)}
          </span>
          <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-slate-400">
            {formatClock(action.createdAt)}
          </span>
        </div>
      </div>
    </button>
  );
}

function ActionDetail({ action }: { action: ActionItem }) {
  const tone = statusTone(action.status);

  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <div className={`rounded-2xl border p-3 ${tone.badge}`}>{kindIcon(action.kind)}</div>
        <div className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5 text-xs text-slate-400">
          {action.source}
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <span className={`h-2.5 w-2.5 rounded-full ${tone.dot}`} />
        <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${tone.badge}`}>
          {action.status}
        </span>
        <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] text-slate-400">
          {kindLabel(action.kind)}
        </span>
      </div>

      <h2 className="mt-4 text-2xl font-semibold tracking-[-0.04em] text-white">
        {action.title}
      </h2>
      <p className="mt-3 text-sm leading-6 text-slate-400">{action.summary}</p>

      <div className="mt-5 grid grid-cols-2 gap-3">
        <MiniDetail label="Revenue protected" value={formatCurrency(action.revenueProtected)} />
        <MiniDetail
          label="Confidence"
          value={action.confidence ? `${action.confidence}%` : "Recorded"}
        />
      </div>

      <div className="mt-5 rounded-[22px] border border-white/10 bg-black/20 p-4">
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          <Split className="h-3.5 w-3.5" />
          Recommended action
        </div>
        <p className="mt-3 text-sm leading-6 text-slate-200">
          {action.recommendedAction}
        </p>
      </div>

      <div className="mt-5">
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          Reasoning
        </div>
        <div className="mt-3 space-y-2">
          {action.reasoning.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-white/[0.035] px-4 py-3 text-sm text-slate-500">
              No additional reasoning was attached.
            </div>
          ) : (
            action.reasoning.slice(0, 6).map((reason) => (
              <div
                key={reason}
                className="flex gap-3 rounded-2xl border border-white/10 bg-white/[0.035] px-4 py-3 text-sm leading-5 text-slate-300"
              >
                <CircleDot className="mt-0.5 h-4 w-4 shrink-0 text-cyan-200/70" />
                <span>{reason}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function MiniDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
        {label}
      </div>
      <div className="mt-2 text-lg font-semibold tracking-[-0.03em] text-white">
        {value}
      </div>
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="flex min-h-32 items-center justify-center rounded-[24px] border border-dashed border-white/10 bg-black/20 p-6 text-center text-sm text-slate-500">
      <div>
        <CircleDot className="mx-auto mb-3 h-5 w-5 text-slate-600" />
        {label}
      </div>
    </div>
  );
}
