"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import AutopilotQueuePanel from "../../components/AutopilotQueuePanel";
import { useAutopilotStore } from "../../store/autopilotStore";
import type { RestaurantOrder as AutopilotOrder } from "../../types/autopilot";
import IntelligenceDashboard from "@/app/components/IntelligenceDashboard";
import AgentDecisionPanel, {
  type MultiAgentOperationalBrain,
} from "@/app/components/AgentDecisionPanel";
import InfrastructureHealthPanel, {
  type InfrastructureHealth,
} from "@/app/components/InfrastructureHealthPanel";
import OperationalBrainPanel from "@/app/components/OperationalBrainPanel";
import OperationalKnowledgeGraphPanel, {
  type OperationalKnowledgeGraph,
} from "@/app/components/OperationalKnowledgeGraphPanel";
import OperationalSimulationPanel, {
  type OperationalSimulation,
} from "@/app/components/OperationalSimulationPanel";
import OperationalTimeline from "@/app/components/OperationalTimeline";
import { calculateRevenueSnapshot } from "@/app/lib/revenueEngine";
import {
  buildReliabilityProfileFromOrders,
  evaluateCustomerReliability,
} from "@/app/lib/reliabilityEngine";
import IntelligenceTimeline from "@/app/components/IntelligenceTimeline";
import type { PaymentState } from "@/app/lib/domain/restaurant";
import {
  MetricCard,
  MiniStat,
  RuleInput,
  RuleToggle,
} from "@/app/components/owner-dashboard/DashboardPrimitives";
import {
  Activity,
  ArrowRight,
  Brain,
  Gauge,
  ShieldCheck,
} from "lucide-react";

type OwnerTab =
  | "overview"
  | "brain"
  | "timeline"
  | "autopilot"
  | "organization"
  | "settings";

const OWNER_TABS: Array<{ id: OwnerTab; label: string; description: string }> = [
  { id: "overview", label: "Overview", description: "Risk, KPIs, revenue, health" },
  { id: "brain", label: "Operational Brain", description: "Reasoning and live pulse" },
  { id: "timeline", label: "Timeline", description: "Audit-backed event stream" },
  { id: "autopilot", label: "Autopilot", description: "Actions and approvals" },
  { id: "organization", label: "Organization", description: "Branches, customers, recovery" },
  { id: "settings", label: "Settings", description: "Owner rules and modes" },
];

type OrderStatus =
  | "UNPAID"
  | "PAYMENT_SENT"
  | "PAID"
  | "CANCELLED"
  | "NO_SHOW";

type OrderType =
  | "DINE_IN_RESERVATION"
  | "PREORDER_PICKUP"
  | "DELIVERY_PREORDER";

type RiskLevel = "LOW" | "MED" | "HIGH";

type RestaurantOrder = {
  id: string;
  organizationId?: string;
  locationId?: string;
  locationName?: string;
  customerName: string;
  phone: string;
  orderType: OrderType;
  amount: number;
  guests: number;
  reservationTime: string;
  itemSummary: string;
  status: OrderStatus;
  paymentState?: PaymentState;
  paymentVerified?: boolean;
  depositRequired: boolean;
  depositAmount?: number;
  depositPaid: boolean;
  reliabilityScore: number;
  terminalMismatch: boolean;
  notes: string;
  assignedStaff: string;
  riskLevel?: RiskLevel;
  protectionReason?: string;
  createdAt?: string;
  slotHoldExpiresAt?: string | null;
  lastReminderSentAt?: string | null;
  autoReleaseEligible?: boolean;
  recoverySourceOrderId?: string;
};

type AuditItem = {
  id: number | string;
  action: string;
  staff: string;
  orderId: string;
  meta?: {
    multiAgentOperationalBrain?: MultiAgentOperationalBrain;
    communicationDiagnostics?: {
      multiAgentOperationalBrain?: MultiAgentOperationalBrain;
    };
    autonomousRecoveryAction?: {
      actionType?: string;
      operationalImpact?: string;
      recommendedStaffReview?: boolean;
      recoveryStateTransition?: {
        to?: string;
      };
    };
    autonomousRecoveryDiagnostics?: {
      safetyScore?: number;
      recoveryConfidence?: number;
      executionAllowed?: boolean;
    };
    operationalSimulation?: OperationalSimulation;
    operationalKnowledgeGraph?: OperationalKnowledgeGraph;
    infrastructureHealth?: InfrastructureHealth;
  };
  createdAt?: string;
};

type AutopilotFeedItem = {
  id: string;
  title: string;
  detail: string;
  status: string;
  staff: string;
  orderId: string;
  timeLabel: string;
  createdAt?: string;
  rule?: string | null;
  reason?: string | null;
  explanation?: string | null;
  confidence?: number | null;
  riskLevel?: string | null;
  recoverableRevenue?: number | null;
  orderAmount?: number | null;
  requiresHumanAction?: boolean;
  humanActionReason?: string | null;
};

type RestaurantSettings = {
  id: number;
  dineInDepositGuestsThreshold: number;
  pickupDepositAmountThreshold: number;
  requireDeliveryDeposit: boolean;
  lowReliabilityThreshold: number;
  autoBlockHighValueUnpaid: boolean;
  hardBlockTerminalMismatch: boolean;
  autopilotMode: "MANUAL" | "SEMI_AUTO" | "FULL_AUTO";
  updatedAt?: string;
};

type WaitlistLead = {
  id: number;
  customerName: string;
  phone: string;
  preferredType: OrderType;
  showProbability: number;
  responseSpeedScore: number;
  reliabilityScore: number;
};

const MONTHLY_MESSAGE_LIMIT = 300;
const EXTRA_MESSAGE_RATE = 0.05;

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-MY", {
    style: "currency",
    currency: "MYR",
    maximumFractionDigits: 2,
  }).format(value);
}

function getOrderTypeLabel(orderType: OrderType) {
  switch (orderType) {
    case "DINE_IN_RESERVATION":
      return "Dine-in";
    case "PREORDER_PICKUP":
      return "Pickup";
    case "DELIVERY_PREORDER":
      return "Delivery";
    default:
      return orderType;
  }
}

function formatDateTime(value?: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function riskBadgeClasses(level: RiskLevel) {
  if (level === "HIGH") return "bg-red-100 text-red-700 border-red-200";
  if (level === "MED") return "bg-yellow-100 text-yellow-700 border-yellow-200";
  return "bg-green-100 text-green-700 border-green-200";
}

function paymentBadgeClasses(state?: PaymentState) {
  if (state === "VERIFIED") return "bg-green-100 text-green-700 border-green-200";
  if (state === "PENDING") return "bg-yellow-100 text-yellow-700 border-yellow-200";
  if (state === "FAILED") return "bg-orange-100 text-orange-700 border-orange-200";
  if (state === "BLOCKED") return "bg-red-100 text-red-700 border-red-200";
  return "bg-neutral-100 text-neutral-700 border-neutral-200";
}

function autopilotFeedBadgeClasses(status: string) {
  if (status.includes("Recovered")) return "bg-green-100 text-green-700 border-green-200";
  if (status.includes("Auto Released")) return "bg-red-100 text-red-700 border-red-200";
  if (status.includes("Final")) return "bg-orange-100 text-orange-700 border-orange-200";
  if (status.includes("Reminder")) return "bg-yellow-100 text-yellow-700 border-yellow-200";
  if (status.includes("Verified")) return "bg-green-100 text-green-700 border-green-200";
  return "bg-neutral-100 text-neutral-700 border-neutral-200";
}

function mapOrderStatusToAutopilotStatus(
  status: OrderStatus
): AutopilotOrder["status"] {
  if (status === "PAID") return "Paid";
  if (status === "CANCELLED") return "Cancelled";
  if (status === "NO_SHOW") return "No-show";
  return "Pending";
}

function mapOrderTypeToAutopilotType(
  orderType: OrderType
): AutopilotOrder["orderType"] {
  if (orderType === "DINE_IN_RESERVATION") return "DINE_IN";
  if (orderType === "DELIVERY_PREORDER") return "DELIVERY";
  return "PICKUP";
}

function getAutopilotDate(value?: string) {
  if (!value) return new Date().toISOString().slice(0, 10);

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString().slice(0, 10);
  }

  return parsed.toISOString().slice(0, 10);
}

function getAutopilotTime(value?: string) {
  if (!value) return "18:00";

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "18:00";
  }

  return parsed.toTimeString().slice(0, 5);
}

function isMessageAudit(item: AuditItem) {
  const action = item.action.toLowerCase();

  return (
    action.includes("reminder") ||
    action.includes("waitlist") ||
    action.includes("payment link") ||
    action.includes("message") ||
    action.includes("whatsapp")
  );
}

function calculateMessageUsage(audit: AuditItem[]) {
  const used = audit.filter(isMessageAudit).length;
  const included = MONTHLY_MESSAGE_LIMIT;
  const extra = Math.max(used - included, 0);
  const extraCost = extra * EXTRA_MESSAGE_RATE;
  const includedNum = Number(included);
  const percentage =
    includedNum === 0 ? 0 : Math.min((used / includedNum) * 100, 100);

  return {
    used,
    included,
    extra,
    extraCost,
    percentage,
  };
}

function getSystemHealthLabel(score: number) {
  if (score >= 85) return "Healthy";
  if (score >= 70) return "Stable";
  if (score >= 50) return "Watch closely";
  if (score >= 30) return "At risk";
  return "Critical";
}

function getSystemHealthTone(score: number) {
  if (score >= 85) return "text-green-700 bg-green-50 border-green-200";
  if (score >= 70) return "text-blue-700 bg-blue-50 border-blue-200";
  if (score >= 50) return "text-yellow-700 bg-yellow-50 border-yellow-200";
  if (score >= 30) return "text-orange-700 bg-orange-50 border-orange-200";
  return "text-red-700 bg-red-50 border-red-200";
}

function getSystemHealthRecommendation(score: number) {
  if (score >= 85) return "Operations look protected. Keep monitoring autopilot actions.";
  if (score >= 70) return "Stable, but clear the highlighted items before service gets busy.";
  if (score >= 50) return "Risk is building. Prioritize unpaid deposits, fraud alerts, and blocked orders.";
  if (score >= 30) return "Revenue is exposed. Review high-risk bookings and recovery actions now.";
  return "Immediate action required. Clear payment risks, fraud alerts, and recovery gaps before relying on the floor.";
}

export default function RestaurantOwnerPage() {
  const [orders, setOrders] = useState<RestaurantOrder[]>([]);
  const [audit, setAudit] = useState<AuditItem[]>([]);
  const [autopilotFeed, setAutopilotFeed] = useState<AutopilotFeedItem[]>([]);
  const [settings, setSettings] = useState<RestaurantSettings | null>(null);
  const [waitlist, setWaitlist] = useState<WaitlistLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);
  const [activeTab, setActiveTab] = useState<OwnerTab>("overview");

  const { evaluateOrders, syncRulesFromSettings } = useAutopilotStore();

  useEffect(() => {
    async function boot() {
      try {
        await Promise.all([loadOrders(), loadAudit(), loadAutopilotFeed(), loadSettings(), loadWaitlist()]);
      } finally {
        setLoading(false);
      }
    }

    boot();
  }, []);


  async function loadOrders() {
    const res = await fetch("/api/orders", { cache: "no-store" });
    const data = await res.json();
    if (res.ok) setOrders(data);
  }

  async function loadAudit() {
    const res = await fetch("/api/audit", { cache: "no-store" });
    const data = await res.json();
    if (res.ok) setAudit(data);
  }

  async function loadAutopilotFeed() {
    const res = await fetch("/api/autopilot/feed", { cache: "no-store" });
    const data = await res.json();
    if (res.ok) setAutopilotFeed(data);
  }

  async function loadSettings() {
    const res = await fetch("/api/settings", { cache: "no-store" });
    const data = await res.json();
    if (res.ok) setSettings(data);
  }

  async function loadWaitlist() {
    const res = await fetch("/api/waitlist", { cache: "no-store" });
    const data = await res.json();
    if (res.ok) setWaitlist(data);
  }

  function isBlacklisted(score: number) {
    return score <= 10;
  }

  const requiresProtection = useCallback((order: RestaurantOrder) => {
    if (!settings) return order.depositRequired;

    if (
      order.orderType === "DINE_IN_RESERVATION" &&
      order.guests >= settings.dineInDepositGuestsThreshold
    ) {
      return true;
    }

    if (
      order.orderType === "PREORDER_PICKUP" &&
      order.amount >= settings.pickupDepositAmountThreshold
    ) {
      return true;
    }

    if (
      order.orderType === "DELIVERY_PREORDER" &&
      settings.requireDeliveryDeposit
    ) {
      return true;
    }

    if (order.reliabilityScore <= settings.lowReliabilityThreshold) {
      return true;
    }

    return order.depositRequired;
  }, [settings]);

  const isBlocked = useCallback((order: RestaurantOrder) => {
    if (!settings) return false;
    if (order.status === "PAID") return false;
    if (order.status === "CANCELLED" || order.status === "NO_SHOW") return false;
    if (settings.hardBlockTerminalMismatch && order.terminalMismatch) return true;
    if (order.paymentState === "BLOCKED" || order.paymentState === "FAILED")
      return true;
    if (order.depositRequired && !order.depositPaid) return true;
    if (settings.autoBlockHighValueUnpaid && requiresProtection(order)) return true;
    if (isBlacklisted(order.reliabilityScore)) return true;
    return false;
  }, [requiresProtection, settings]);

  async function saveSettings(next: Partial<RestaurantSettings>) {
    if (!settings) return;

    const previous = settings;
    const optimistic = { ...settings, ...next };
    setSettings(optimistic);
    setSavingSettings(true);

    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(next),
      });

      const data = await res.json();

      if (!res.ok) {
        alert(data.error || "Failed to save settings.");
        setSettings(previous);
        return;
      }

      setSettings(data);
    } catch (error) {
      console.error(error);
      alert("Failed to save settings.");
      setSettings(previous);
    } finally {
      setSavingSettings(false);
    }
  }

  const revenueSnapshot = useMemo(() => {
    return calculateRevenueSnapshot({
      orders,
      autopilotFeed,
      isBlocked,
    });
  }, [orders, autopilotFeed, isBlocked]);

  const metrics = revenueSnapshot.metrics;
  const revenueIntelligence = revenueSnapshot.revenueIntelligence;

  const fraudAlerts = useMemo(() => {
    return orders.filter(
      (order) =>
        order.terminalMismatch ||
        order.paymentState === "PENDING" ||
        order.paymentState === "FAILED" ||
        order.reliabilityScore <= 20 ||
        isBlacklisted(order.reliabilityScore) ||
        (order.riskLevel ?? "LOW") === "HIGH"
    );
  }, [orders]);

  const dailyRiskReport = useMemo(() => {
    const highRisk = orders.filter((o) => (o.riskLevel ?? "LOW") === "HIGH").length;
    const mediumRisk = orders.filter((o) => (o.riskLevel ?? "LOW") === "MED").length;
    const unpaid = orders.filter(
      (o) => o.status === "UNPAID" || o.status === "PAYMENT_SENT"
    ).length;

    return { highRisk, mediumRisk, unpaid };
  }, [orders]);

  const customerProfiles = useMemo(() => {
    const map = new Map<string, RestaurantOrder[]>();

    for (const order of orders) {
      const key = order.phone || order.customerName || order.id;

      if (!map.has(key)) {
        map.set(key, []);
      }

      map.get(key)!.push(order);
    }

    return Array.from(map.values())
      .map((ordersForCustomer) => {
        const profile = buildReliabilityProfileFromOrders(ordersForCustomer);
        const decision = evaluateCustomerReliability(profile);

        return {
          ...profile,
          decision,
        };
      })
      .sort((a, b) => a.decision.score - b.decision.score);
  }, [orders]);

  const autopilotOrders = useMemo<AutopilotOrder[]>(() => {
    return orders.map((order) => ({
      id: order.id,
      customerName: order.customerName,
      date: getAutopilotDate(order.reservationTime),
      time: getAutopilotTime(order.reservationTime),
      amount: order.amount,
      status: mapOrderStatusToAutopilotStatus(order.status),
      risk: (order.riskLevel ?? "LOW") as "LOW" | "MED" | "HIGH",
      orderType: mapOrderTypeToAutopilotType(order.orderType),
      partySize: order.guests,
      reliabilityScore: order.reliabilityScore,
      depositRequired: order.depositRequired,
      depositPaid: order.depositPaid,
      paymentVerified: order.paymentVerified || order.status === "PAID",
      suspiciousPaymentScreenshot:
        order.paymentState === "PENDING" ||
        order.paymentState === "FAILED" ||
        order.terminalMismatch,
      blocked: isBlocked(order),
    }));
  }, [orders, isBlocked]);

  const messageUsage = useMemo(() => calculateMessageUsage(audit), [audit]);

  const autopilotSummary = useMemo(() => {
    const reminders = autopilotFeed.filter((item) => item.status.includes("Reminder")).length;
    const releases = autopilotFeed.filter((item) => item.status.includes("Auto Released")).length;
    const recoveries = autopilotFeed.filter((item) => item.status.includes("Recovered")).length;
    const autopilotHandled = autopilotFeed.filter(
      (item) =>
        item.staff.toLowerCase() === "autopilot" ||
        item.status.includes("Recovered") ||
        item.status.includes("Reminder")
    ).length;

    return { reminders, releases, recoveries, autopilotHandled };
  }, [autopilotFeed]);

  const latestAgentDecision = useMemo(() => {
    return (
      audit
        .map(
          (item) =>
            item.meta?.multiAgentOperationalBrain ??
            item.meta?.communicationDiagnostics?.multiAgentOperationalBrain ??
            null
        )
        .find(Boolean) ?? null
    );
  }, [audit]);

  const latestAutonomousRecovery = useMemo(() => {
    return audit.find((item) => item.meta?.autonomousRecoveryDiagnostics) ?? null;
  }, [audit]);

  const latestOperationalSimulation = useMemo(() => {
    return audit.find((item) => item.meta?.operationalSimulation)?.meta?.operationalSimulation ?? null;
  }, [audit]);

  const latestOperationalKnowledgeGraph = useMemo(() => {
    return audit.find((item) => item.meta?.operationalKnowledgeGraph)?.meta?.operationalKnowledgeGraph ?? null;
  }, [audit]);

  const latestInfrastructureHealth = useMemo(() => {
    return audit.find((item) => item.meta?.infrastructureHealth)?.meta?.infrastructureHealth ?? null;
  }, [audit]);

  const organizationSummary = useMemo(() => {
    const locations = new Set(
      orders.map((order) => order.locationId ?? order.locationName ?? "loc-primary")
    );
    const activeOrders = orders.filter(
      (order) => order.status !== "CANCELLED" && order.status !== "NO_SHOW"
    ).length;

    return {
      locations: Math.max(locations.size, 1),
      activeOrders,
      waitlistLeads: waitlist.length,
      customerProfiles: customerProfiles.length,
    };
  }, [customerProfiles.length, orders, waitlist.length]);

  const riskOrders = useMemo(() => {
    return orders.filter((order) => {
      if (!order.slotHoldExpiresAt) return false;

      const expiry = new Date(order.slotHoldExpiresAt).getTime();
      if (Number.isNaN(expiry)) return false;

      const minutesLeft = (expiry - Date.now()) / 60000;
      const isUnpaid = order.paymentState !== "VERIFIED";
      const isActive = order.status !== "CANCELLED" && order.status !== "NO_SHOW" && order.status !== "PAID";
      const isSoon = minutesLeft <= 15 && minutesLeft > 0;
      const isRisky = (order.riskLevel ?? "LOW") === "HIGH" || (order.riskLevel ?? "LOW") === "MED";

      return isUnpaid && isActive && isSoon && isRisky;
    });
  }, [orders]);

  const systemHealth = useMemo(() => {
    const totalExposure = Math.max(
      metrics.revenueProtected + metrics.revenueAtRisk + metrics.noShowLoss,
      1
    );

    let score = 100;

    if (metrics.revenueAtRisk > 0) {
      score -= Math.min((metrics.revenueAtRisk / totalExposure) * 35, 35);
    }

    if (metrics.noShowLoss > 0) {
      score -= Math.min((metrics.noShowLoss / totalExposure) * 20, 20);
    }

    if (dailyRiskReport.highRisk > 0) {
      score -= Math.min(dailyRiskReport.highRisk * 8, 24);
    }

    if (dailyRiskReport.unpaid > 0) {
      score -= Math.min(dailyRiskReport.unpaid * 4, 16);
    }

    if (metrics.blockedOrders > 0) {
      score -= Math.min(metrics.blockedOrders * 5, 15);
    }

    if (fraudAlerts.length > 0) {
      score -= Math.min(fraudAlerts.length * 7, 21);
    }

    if (messageUsage.percentage >= 100) {
      score -= 15;
    } else if (messageUsage.percentage >= 80) {
      score -= 8;
    }

    if (metrics.preventedLoss > 0) {
      score += 5;
    }

    score = Math.round(Math.max(0, Math.min(score, 100)));

    const issues: string[] = [];

    if (orders.length === 0) {
      issues.push("No live orders loaded yet. System is ready for demo data or real bookings.");
    }

    if (metrics.revenueAtRisk > 0) {
      issues.push(`${formatCurrency(metrics.revenueAtRisk)} is still exposed right now.`);
    }

    if (dailyRiskReport.highRisk > 0) {
      issues.push(`${dailyRiskReport.highRisk} high-risk order${dailyRiskReport.highRisk === 1 ? "" : "s"} need review.`);
    }

    if (dailyRiskReport.unpaid > 0) {
      issues.push(`${dailyRiskReport.unpaid} unpaid order${dailyRiskReport.unpaid === 1 ? "" : "s"} need payment follow-up.`);
    }

    if (metrics.blockedOrders > 0) {
      issues.push(`${metrics.blockedOrders} blocked order${metrics.blockedOrders === 1 ? "" : "s"} must not be released yet.`);
    }

    if (fraudAlerts.length > 0) {
      issues.push(`${fraudAlerts.length} payment or fraud alert${fraudAlerts.length === 1 ? "" : "s"} detected.`);
    }

    if (metrics.noShowLoss > 0) {
      issues.push(`${formatCurrency(metrics.noShowLoss)} lost to no-shows/cancellations.`);
    }

    if (messageUsage.percentage >= 80) {
      issues.push(`Message usage is at ${Math.round(messageUsage.percentage)}% of the included monthly limit.`);
    }

    if (issues.length === 0) {
      issues.push("No urgent revenue protection issues detected.");
    }

    return {
      score,
      label: getSystemHealthLabel(score),
      tone: getSystemHealthTone(score),
      recommendation: getSystemHealthRecommendation(score),
      issues,
    };
  }, [orders.length, metrics, dailyRiskReport, fraudAlerts.length, messageUsage.percentage]);

  const attentionItems = useMemo(() => {
    const items: string[] = [];

    if (dailyRiskReport.highRisk > 0) {
      items.push(`${dailyRiskReport.highRisk} high-risk order${dailyRiskReport.highRisk === 1 ? "" : "s"} need review.`);
    }

    if (dailyRiskReport.unpaid > 0) {
      items.push(`${dailyRiskReport.unpaid} unpaid order${dailyRiskReport.unpaid === 1 ? "" : "s"} still exposed.`);
    }

    if (fraudAlerts.length > 0) {
      items.push(`${fraudAlerts.length} fraud/risk alert${fraudAlerts.length === 1 ? "" : "s"} detected.`);
    }

    if (messageUsage.percentage >= 80) {
      items.push(`Message usage is at ${Math.round(messageUsage.percentage)}% of the monthly included limit.`);
    }

    if (items.length === 0) {
      items.push("No urgent issues. Valsentra is currently protecting this operation normally.");
    }

    return items;
  }, [dailyRiskReport, fraudAlerts.length, messageUsage.percentage]);

  useEffect(() => {
    evaluateOrders(autopilotOrders);
  }, [autopilotOrders, evaluateOrders]);

  useEffect(() => {
    if (settings) {
      syncRulesFromSettings({
        dineInDepositGuestsThreshold: settings.dineInDepositGuestsThreshold,
        pickupDepositAmountThreshold: settings.pickupDepositAmountThreshold,
        lowReliabilityThreshold: settings.lowReliabilityThreshold,
        autoBlockHighValueUnpaid: settings.autoBlockHighValueUnpaid,
        hardBlockTerminalMismatch: settings.hardBlockTerminalMismatch,
      });
    }
  }, [settings, syncRulesFromSettings]);

  if (loading || !settings) {
    return <div className="min-h-screen bg-[#f7f6f3] p-6 text-neutral-700">Loading owner dashboard...</div>;
  }

  return (
    <div className="min-h-screen bg-[#f7f6f3] text-neutral-950">
      <div className="mx-auto max-w-7xl px-4 py-8 md:px-6 md:py-10">
        <div className="space-y-7">
          <section className="rounded-[32px] border border-neutral-200/80 bg-white p-6 shadow-[0_18px_60px_rgba(15,23,42,0.05)] md:p-8">
            <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full border border-neutral-200 bg-neutral-50 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-neutral-600">
                  <ShieldCheck className="h-3.5 w-3.5 text-neutral-800" />
                  Valsentra Restaurant
                </div>
                <h1 className="mt-5 text-4xl font-semibold tracking-tight text-neutral-950 md:text-5xl">
                  Owner Control Center
                </h1>
                <p className="mt-3 max-w-3xl text-sm leading-6 text-neutral-600 md:text-base">
                  One control room for what Valsentra handled, what still needs attention,
                  and how protected the restaurant is right now.
                </p>
              </div>

              <Link
                href="/restaurant"
                className="inline-flex items-center gap-2 rounded-full border border-neutral-300 bg-white px-5 py-3 text-sm font-semibold text-neutral-900 shadow-sm transition hover:border-neutral-400 hover:bg-neutral-50"
              >
                Back to Staff View
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </section>

          <div className="sticky top-0 z-20 -mx-4 border-y border-neutral-200/70 bg-[#f7f6f3]/90 px-4 py-3 backdrop-blur md:-mx-6 md:px-6">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex gap-2 overflow-x-auto pb-1">
                {OWNER_TABS.map((tab) => {
                  const selected = activeTab === tab.id;

                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setActiveTab(tab.id)}
                      className={`min-w-fit rounded-full border px-4 py-2 text-left text-sm font-semibold transition ${
                        selected
                          ? "border-neutral-900 bg-neutral-950 text-white shadow-sm"
                          : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300 hover:text-neutral-950"
                      }`}
                    >
                      {tab.label}
                    </button>
                  );
                })}
              </div>

              <div className="grid gap-2 text-xs text-neutral-600 md:grid-cols-4 xl:min-w-[640px]">
                <div className="rounded-2xl border border-neutral-200 bg-white/80 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-neutral-500">Urgent Risks</span>
                    <span className="font-semibold text-neutral-950">{riskOrders.length}</span>
                  </div>
                  <p className="mt-1 text-[11px] text-neutral-400">Orders needing owner attention</p>
                </div>
                <div className="rounded-2xl border border-neutral-200 bg-white/80 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-neutral-500">Revenue Exposed</span>
                    <span className="font-semibold text-neutral-950">{formatCurrency(metrics.revenueAtRisk)}</span>
                  </div>
                  <p className="mt-1 text-[11px] text-neutral-400">Unpaid value still due</p>
                </div>
                <div className="rounded-2xl border border-neutral-200 bg-white/80 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-neutral-500">System Health</span>
                    <span className="font-semibold text-neutral-950">{systemHealth.score}/100</span>
                  </div>
                  <p className="mt-1 text-[11px] text-neutral-400">Current protection score</p>
                </div>
                <div className="rounded-2xl border border-neutral-200 bg-white/80 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-neutral-500">Autonomous Actions</span>
                    <span className="font-semibold text-neutral-950">{autopilotSummary.autopilotHandled}</span>
                  </div>
                  <p className="mt-1 text-[11px] text-neutral-400">Decisions handled by Valsentra</p>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-[28px] border border-neutral-200/80 bg-white/70 p-4 shadow-sm">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-neutral-500">
              {OWNER_TABS.find((tab) => tab.id === activeTab)?.label}
            </p>
            <p className="mt-1 text-sm text-neutral-600">
              {OWNER_TABS.find((tab) => tab.id === activeTab)?.description}
            </p>
          </div>

          <div className={activeTab === "overview" ? "space-y-7" : "hidden"}>
          <section
            className={`rounded-[30px] border p-5 shadow-[0_14px_40px_rgba(15,23,42,0.04)] md:p-6 ${
              riskOrders.length > 0
                ? "border-red-200 bg-red-50/90 text-red-900"
                : "border-emerald-200 bg-emerald-50/90 text-emerald-900"
            }`}
          >
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="flex gap-4">
                <div className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-current/15 bg-white/70">
                  <Activity className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] opacity-75">
                    Live Risk Alert
                  </p>
                  <h2 className="mt-1 text-xl font-semibold tracking-tight md:text-2xl">
                    {riskOrders.length > 0
                      ? `${riskOrders.length} high-risk order${riskOrders.length === 1 ? "" : "s"} may be lost in the next 15 minutes`
                      : "No immediate risk detected"}
                  </h2>
                  <p className="mt-2 max-w-3xl text-sm leading-6 opacity-80">
                    Valsentra watches unpaid, time-sensitive, medium/high-risk orders so the owner can intervene only when needed.
                  </p>
                </div>
              </div>

              <div className="rounded-2xl border border-white/80 bg-white/75 px-5 py-4 text-right shadow-sm">
                <p className="text-3xl font-semibold tracking-tight">{riskOrders.length}</p>
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] opacity-70">
                  urgent risk{riskOrders.length === 1 ? "" : "s"}
                </p>
              </div>
            </div>

            {riskOrders.length > 0 && (
              <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                {riskOrders.slice(0, 6).map((order) => (
                  <div key={order.id} className="rounded-2xl border border-white/80 bg-white/80 px-4 py-3 text-sm shadow-sm">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-semibold">{order.customerName}</p>
                      <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${riskBadgeClasses((order.riskLevel ?? "LOW") as RiskLevel)}`}>
                        {(order.riskLevel ?? "LOW")} RISK
                      </span>
                    </div>
                    <p className="mt-1 opacity-80">{order.id} • {formatCurrency(order.amount)}</p>
                    <p className="mt-1 text-xs opacity-70">Payment not verified and slot hold is close to expiry.</p>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
            <MetricCard
              title="Revenue Protected"
              value={formatCurrency(metrics.revenueProtected)}
              subtitle="Already secured"
            />
            <MetricCard
              title="Revenue At Risk"
              value={formatCurrency(metrics.revenueAtRisk)}
              subtitle="Still exposed"
            />
            <MetricCard
              title="No-Show Loss"
              value={formatCurrency(metrics.noShowLoss)}
              subtitle="Lost from no-shows"
            />
            <MetricCard
              title="Prevented Loss"
              value={formatCurrency(metrics.preventedLoss)}
              subtitle="Risk currently blocked"
            />
            <MetricCard
              title="Blocked Orders"
              value={String(metrics.blockedOrders)}
              subtitle="Protection enforced"
            />
            <MetricCard
              title="Recovery Score"
              value={`${metrics.recoveryScore}/100`}
              subtitle="Current defense quality"
            />
          </section>

          <section className="rounded-[32px] border border-neutral-200/80 bg-white p-6 shadow-[0_18px_60px_rgba(15,23,42,0.05)] md:p-8">
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div>
                <p className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-700">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Revenue Intelligence
                </p>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight text-neutral-950">
                  Money Valsentra is protecting
                </h2>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-600">
                  Owner-level financial view of what is protected, what is still exposed,
                  and how much risk the system is actively blocking.
                </p>
              </div>

              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 shadow-sm">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em]">
                  Estimated impact
                </p>
                <p className="mt-1 text-2xl font-semibold tracking-tight">
                  {formatCurrency(revenueIntelligence.estimatedAutopilotImpact)}
                </p>
              </div>
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
              <MiniStat
                title="Protected + Blocked"
                value={formatCurrency(revenueIntelligence.estimatedAutopilotImpact)}
              />
              <MiniStat
                title="At Risk Now"
                value={formatCurrency(revenueIntelligence.atRiskNow)}
              />
              <MiniStat
                title="Prevented Loss"
                value={formatCurrency(revenueIntelligence.preventedLoss)}
              />
              <MiniStat
                title="Recovered Drafts"
                value={String(revenueIntelligence.recoveredDrafts)}
              />
              <MiniStat
                title="Reminders Sent"
                value={String(revenueIntelligence.remindersSent)}
              />
            </div>
          </section>

          <section className="rounded-[32px] border border-neutral-200/80 bg-white p-6 shadow-[0_18px_60px_rgba(15,23,42,0.05)] md:p-8">
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div>
                <p className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-neutral-500">
                  <Brain className="h-3.5 w-3.5 text-neutral-700" />
                  Autonomous Operator
                </p>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight text-neutral-950">
                  What Valsentra already handled
                </h2>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-600">
                  A quick owner summary of automatic work already completed: reminders, auto-release decisions, waitlist recovery, and payment protection events.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
                <MiniStat title="Handled" value={String(autopilotSummary.autopilotHandled)} />
                <MiniStat title="Reminders" value={String(autopilotSummary.reminders)} />
                <MiniStat title="Released" value={String(autopilotSummary.releases)} />
                <MiniStat title="Recovered" value={String(autopilotSummary.recoveries)} />
              </div>
            </div>
          </section>

          <section className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
            <div className={`rounded-[32px] border p-6 shadow-[0_18px_60px_rgba(15,23,42,0.05)] md:p-8 ${systemHealth.tone}`}>
              <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
                <div>
                  <p className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] opacity-80">
                    <Gauge className="h-3.5 w-3.5" />
                    System Health
                  </p>
                  <div className="mt-4 flex items-end gap-3">
                    <p className="text-5xl font-semibold tracking-tight">{systemHealth.score}</p>
                    <p className="pb-1 text-sm font-semibold opacity-80">/100</p>
                  </div>
                  <p className="mt-2 text-lg font-semibold">{systemHealth.label}</p>
                  <p className="mt-2 max-w-md text-sm leading-6 opacity-85">
                    {systemHealth.recommendation}
                  </p>
                </div>

                <div className="rounded-2xl border border-current/20 bg-white/75 px-4 py-3 text-sm shadow-sm">
                  <p className="font-semibold">Health factors</p>
                  <p className="mt-1 opacity-80">Revenue exposure</p>
                  <p className="opacity-80">Risk + fraud pressure</p>
                  <p className="opacity-80">Recovery + message usage</p>
                </div>
              </div>

              <div className="mt-5 h-2 overflow-hidden rounded-full bg-white/70">
                <div
                  className="h-full rounded-full bg-current transition-all"
                  style={{ width: `${systemHealth.score}%` }}
                />
              </div>

              <div className="mt-5 rounded-2xl border border-current/20 bg-white/75 p-4 shadow-sm">
                <p className="text-sm font-semibold">What this means</p>
                <ul className="mt-3 space-y-2 text-sm leading-5 opacity-90">
                  {systemHealth.issues.map((issue, index) => (
                    <li key={index} className="flex gap-2">
                      <span>•</span>
                      <span>{issue}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="rounded-[32px] border border-neutral-200/80 bg-white p-6 shadow-[0_18px_60px_rgba(15,23,42,0.05)] md:p-8">
              <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div>
                  <p className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-neutral-500">
                    <Activity className="h-3.5 w-3.5 text-neutral-700" />
                    Operator Brief
                  </p>
                  <h2 className="mt-2 text-2xl font-semibold tracking-tight text-neutral-950">
                    Owner Briefing
                  </h2>
                  <p className="mt-2 text-sm text-neutral-600">
                    What the owner needs to know before checking operations.
                  </p>
                </div>
                <div className="rounded-2xl border border-neutral-200/80 bg-neutral-50/80 px-4 py-3 text-sm shadow-sm">
                  <p className="text-neutral-500">Messages</p>
                  <p className="font-semibold text-neutral-900">
                    {messageUsage.used} / {messageUsage.included}
                  </p>
                </div>
              </div>

              <div className="mt-5 space-y-3">
                {attentionItems.map((item) => (
                  <div
                    key={item}
                    className="rounded-2xl border border-neutral-200/80 bg-neutral-50/80 p-4 text-sm leading-6 text-neutral-700"
                  >
                    {item}
                  </div>
                ))}
              </div>

              {messageUsage.extra > 0 ? (
                <div className="mt-4 rounded-2xl border border-yellow-200 bg-yellow-50 p-4 text-sm text-yellow-800">
                  Extra messages this month: {messageUsage.extra} • Estimated extra cost: RM {messageUsage.extraCost.toFixed(2)}
                </div>
              ) : null}
            </div>
          </section>

          </div>

          <div className={activeTab === "brain" ? "space-y-7" : "hidden"}>
            <OperationalBrainPanel />
            <OperationalTimeline />
            <InfrastructureHealthPanel health={latestInfrastructureHealth} emptyState />
            <OperationalKnowledgeGraphPanel graph={latestOperationalKnowledgeGraph} emptyState />
            <AgentDecisionPanel decision={latestAgentDecision} emptyState />
            <OperationalSimulationPanel simulation={latestOperationalSimulation} emptyState />
            {latestAutonomousRecovery ? (
              <section className="rounded-[32px] border border-neutral-200/80 bg-white p-6 shadow-[0_18px_60px_rgba(15,23,42,0.05)] md:p-8">
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-700">
                      Autonomous Recovery State
                    </p>
                    <h2 className="mt-2 text-2xl font-semibold tracking-tight text-neutral-950">
                      {latestAutonomousRecovery.meta?.autonomousRecoveryAction?.recoveryStateTransition?.to?.replaceAll("_", " ") ??
                        latestAutonomousRecovery.meta?.autonomousRecoveryAction?.actionType?.replaceAll("_", " ") ??
                        "Recovery monitored"}
                    </h2>
                    <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-600">
                      {latestAutonomousRecovery.meta?.autonomousRecoveryAction?.operationalImpact ??
                        "Valsentra recorded a safe autonomous recovery action from customer reply intelligence."}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2 md:justify-end">
                    <span className="rounded-full border border-emerald-100 bg-emerald-50 px-3 py-1.5 text-[11px] font-semibold text-emerald-700">
                      Safety {latestAutonomousRecovery.meta?.autonomousRecoveryDiagnostics?.safetyScore ?? 0}/100
                    </span>
                    <span className="rounded-full border border-emerald-100 bg-emerald-50 px-3 py-1.5 text-[11px] font-semibold text-emerald-700">
                      Recovery {latestAutonomousRecovery.meta?.autonomousRecoveryDiagnostics?.recoveryConfidence ?? 0}/100
                    </span>
                    {latestAutonomousRecovery.meta?.autonomousRecoveryAction?.recommendedStaffReview ? (
                      <span className="rounded-full border border-amber-100 bg-amber-50 px-3 py-1.5 text-[11px] font-semibold text-amber-700">
                        Staff review protected
                      </span>
                    ) : null}
                  </div>
                </div>
              </section>
            ) : null}
          </div>

          <div className={activeTab === "organization" ? "space-y-7" : "hidden"}>
            <section className="rounded-[32px] border border-neutral-200/80 bg-white p-6 shadow-[0_18px_60px_rgba(15,23,42,0.05)] md:p-8">
              <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div>
                  <p className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-neutral-500">
                    <ShieldCheck className="h-3.5 w-3.5 text-neutral-700" />
                    Organization Pulse
                  </p>
                  <h2 className="mt-2 text-2xl font-semibold tracking-tight text-neutral-950">
                    Enterprise operating context
                  </h2>
                  <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-600">
                    Real operational scope from current orders, customer memory, waitlist recovery, and location-aware order data.
                  </p>
                </div>
              </div>

              <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <MiniStat title="Locations" value={String(organizationSummary.locations)} />
                <MiniStat title="Active Orders" value={String(organizationSummary.activeOrders)} />
                <MiniStat title="Waitlist Leads" value={String(organizationSummary.waitlistLeads)} />
                <MiniStat title="Customer Profiles" value={String(organizationSummary.customerProfiles)} />
              </div>
            </section>

            <IntelligenceDashboard />
          </div>

          <div className={activeTab === "timeline" ? "space-y-7" : "hidden"}>
            <IntelligenceTimeline />
            <OperationalTimeline />
          </div>

          <div className={activeTab === "settings" ? "space-y-7" : "hidden"}>
          <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
            <div className="rounded-[32px] border border-neutral-200/80 bg-white p-6 shadow-[0_18px_60px_rgba(15,23,42,0.05)] md:p-8">
              <div className="mb-5 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-2xl font-semibold tracking-tight">Rules Engine</h2>
                  <p className="mt-2 text-sm text-neutral-600">
                    Define how the restaurant protects itself.
                  </p>
                </div>
                {savingSettings && (
                  <span className="text-xs text-neutral-500">Saving...</span>
                )}
              </div>


              <div className="grid gap-4 md:grid-cols-2">
                <RuleInput
                  label="Dine-in deposit starts at (guests)"
                  value={settings.dineInDepositGuestsThreshold}
                  onCommit={(value) =>
                    saveSettings({ dineInDepositGuestsThreshold: Number(value) })
                  }
                />
                <RuleInput
                  label="Pickup deposit starts at (RM)"
                  value={settings.pickupDepositAmountThreshold}
                  onCommit={(value) =>
                    saveSettings({ pickupDepositAmountThreshold: Number(value) })
                  }
                />
                <RuleInput
                  label="Low reliability threshold"
                  value={settings.lowReliabilityThreshold}
                  onCommit={(value) =>
                    saveSettings({ lowReliabilityThreshold: Number(value) })
                  }
                />
              </div>

              <div className="mt-5 space-y-3">
                <RuleToggle
                  label="Require delivery deposit"
                  checked={settings.requireDeliveryDeposit}
                  onChange={(checked) =>
                    saveSettings({ requireDeliveryDeposit: checked })
                  }
                />
                <RuleToggle
                  label="Auto-block high-value unpaid orders"
                  checked={settings.autoBlockHighValueUnpaid}
                  onChange={(checked) =>
                    saveSettings({ autoBlockHighValueUnpaid: checked })
                  }
                />
                <RuleToggle
                  label="Hard block terminal mismatch"
                  checked={settings.hardBlockTerminalMismatch}
                  onChange={(checked) =>
                    saveSettings({ hardBlockTerminalMismatch: checked })
                  }
                />
              </div>

                <div className="rounded-[22px] border border-neutral-200 bg-neutral-50 p-4 text-sm">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      <p className="font-medium text-neutral-900">Autopilot Mode</p>
                      <p className="mt-1 max-w-xl text-xs leading-5 text-neutral-500">
                        Choose how much control Valsentra has over automatic release, recovery, and background actions.
                      </p>
                    </div>

                    <select
                      className="w-full rounded-2xl border border-neutral-300 bg-white px-4 py-3 text-sm font-medium text-neutral-900 outline-none focus:border-neutral-500 md:w-[260px]"
                      value={settings.autopilotMode ?? "SEMI_AUTO"}
                      onChange={(e) =>
                        saveSettings({
                          autopilotMode: e.target.value as
                            | "MANUAL"
                            | "SEMI_AUTO"
                            | "FULL_AUTO",
                        })
                      }
                    >
                      <option value="MANUAL">Manual — suggestions only</option>
                      <option value="SEMI_AUTO">Semi Auto — recommended</option>
                      <option value="FULL_AUTO">Full Auto — minimal interruption</option>
                    </select>
                  </div>

                  <div className="mt-3 rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-xs leading-5 text-neutral-600">
                    {(settings.autopilotMode ?? "SEMI_AUTO") === "MANUAL" && (
                      <p>
                        Valsentra will detect risks and recommend actions, but it will not auto-release slots or auto-fill waitlist recovery.
                      </p>
                    )}
                    {(settings.autopilotMode ?? "SEMI_AUTO") === "SEMI_AUTO" && (
                      <p>
                        Valsentra will act automatically for safe revenue-protection cases, then log and explain every action in the Activity Timeline.
                      </p>
                    )}
                    {(settings.autopilotMode ?? "SEMI_AUTO") === "FULL_AUTO" && (
                      <p>
                        Valsentra will run as quietly as possible in the background with minimal owner or staff interruption. Use this only after testing.
                      </p>
                    )}
                  </div>
                </div>
            </div>

            <div className="rounded-[32px] border border-neutral-200/80 bg-white p-6 shadow-[0_18px_60px_rgba(15,23,42,0.05)] md:p-8">
              <div className="mb-5">
                <h2 className="text-2xl font-semibold tracking-tight">Daily Risk Report</h2>
                <p className="mt-2 text-sm text-neutral-600">
                  What needs attention today.
                </p>
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                <MiniStat title="High Risk" value={String(dailyRiskReport.highRisk)} />
                <MiniStat title="Medium Risk" value={String(dailyRiskReport.mediumRisk)} />
                <MiniStat title="Unpaid" value={String(dailyRiskReport.unpaid)} />
              </div>

              <div className="mt-5 rounded-[22px] border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-700">
                <p>
                  <span className="font-medium text-neutral-900">
                    Revenue protected today:
                  </span>{" "}
                  {formatCurrency(metrics.revenueProtected)}
                </p>
                <p className="mt-2">
                  <span className="font-medium text-neutral-900">
                    Revenue at risk today:
                  </span>{" "}
                  {formatCurrency(metrics.revenueAtRisk)}
                </p>
                <p className="mt-2">
                  <span className="font-medium text-neutral-900">
                    Recovery opportunities:
                  </span>{" "}
                  {metrics.recoveredOpportunities}
                </p>
              </div>
            </div>
          </section>
          </div>

          <div className={activeTab === "overview" ? "space-y-7" : "hidden"}>
          <section className="rounded-[32px] border border-neutral-200/80 bg-white p-6 shadow-[0_18px_60px_rgba(15,23,42,0.05)] md:p-8">
            <div className="mb-5">
              <h2 className="text-2xl font-semibold tracking-tight">Fraud / Risk Alerts</h2>
            </div>

            <div className="space-y-4">
              {fraudAlerts.length === 0 ? (
                <div className="rounded-2xl border border-green-200 bg-green-50 p-4 text-sm text-green-700">
                  No major fraud alerts right now.
                </div>
              ) : (
                fraudAlerts.map((order) => (
                  <article
                    key={order.id}
                    className="rounded-[22px] border border-red-200 bg-red-50 p-4"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold">{order.id}</p>

                      {order.paymentState ? (
                        <span
                          className={`rounded-full border px-3 py-1 text-xs font-semibold ${paymentBadgeClasses(
                            order.paymentState
                          )}`}
                        >
                          {order.paymentState}
                        </span>
                      ) : null}

                      <span
                        className={`rounded-full border px-3 py-1 text-xs font-semibold ${riskBadgeClasses(
                          (order.riskLevel ?? "LOW") as RiskLevel
                        )}`}
                      >
                        {(order.riskLevel ?? "LOW")} RISK
                      </span>
                    </div>

                    <div className="mt-3 space-y-1 text-sm text-neutral-700">
                      <p>
                        <span className="font-medium text-neutral-900">Customer:</span>{" "}
                        {order.customerName}
                      </p>
                      <p>
                        <span className="font-medium text-neutral-900">Type:</span>{" "}
                        {getOrderTypeLabel(order.orderType)}
                      </p>
                      <p>
                        <span className="font-medium text-neutral-900">Amount:</span>{" "}
                        {formatCurrency(order.amount)}
                      </p>
                      <p>
                        <span className="font-medium text-neutral-900">
                          Protection reason:
                        </span>{" "}
                        {order.protectionReason || "Standard protection"}
                      </p>
                    </div>
                  </article>
                ))
              )}
            </div>
          </section>
          </div>

          <div className={activeTab === "autopilot" ? "space-y-7" : "hidden"}>
          <section className="rounded-[32px] border border-neutral-200/80 bg-white p-6 shadow-[0_18px_60px_rgba(15,23,42,0.05)] md:p-8">
            <div className="mb-5 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
              <div>
                <p className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-amber-700">
                  <Activity className="h-3.5 w-3.5" />
                  Needs Attention
                </p>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight text-neutral-950">
                  Pending actions Valsentra recommends
                </h2>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-600">
                  This is the action queue. These are items the rules engine thinks should be reviewed, executed, or skipped by the owner or staff.
                </p>
              </div>
            </div>

            <AutopilotQueuePanel />
          </section>
          </div>

          <div className={activeTab === "autopilot" ? "space-y-7" : "hidden"}>
          <section className="rounded-[32px] border border-neutral-200/80 bg-white p-6 shadow-[0_18px_60px_rgba(15,23,42,0.05)] md:p-8">
            <div className="mb-5 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div>
                <p className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-700">
                  <Activity className="h-3.5 w-3.5" />
                  Activity Timeline
                </p>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight text-neutral-950">
                  What Valsentra handled automatically
                </h2>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-600">
                  Audit-backed history of completed actions. This is where the owner can see what the autonomous operator actually did.
                </p>
              </div>
              <div className="rounded-2xl border border-neutral-200/80 bg-neutral-50/80 px-4 py-3 text-center text-sm shadow-sm">
                <p className="text-2xl font-semibold tracking-tight text-neutral-950">{autopilotFeed.length}</p>
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-500">events</p>
              </div>
            </div>

            <div className="space-y-3">
              {autopilotFeed.length === 0 ? (
                <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-600">
                  No completed automation yet. When Valsentra sends reminders, releases unsafe slots, or recovers waitlist revenue, it will appear here.
                </div>
              ) : (
                autopilotFeed.slice(0, 10).map((item) => (
                  <article
                    key={item.id}
                    className={`rounded-[22px] border p-4 ${
                      item.status.includes("Recovered")
                        ? "border-green-200 bg-green-50"
                        : "border-neutral-200 bg-neutral-50"
                    }`}
                  >
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-semibold text-neutral-900">{item.title}</p>
                          <span
                            className={`rounded-full border px-3 py-1 text-xs font-semibold ${autopilotFeedBadgeClasses(
                              item.status
                            )}`}
                          >
                            {item.status}
                          </span>
                        </div>
                        <p className="mt-2 text-sm text-neutral-600">{item.detail}</p>

                        <div className="mt-3 grid gap-2 text-xs text-neutral-700 md:grid-cols-2 xl:grid-cols-3">
                          {item.rule ? (
                            <div className="rounded-xl border border-blue-100 bg-white px-3 py-2">
                              <p className="font-semibold text-blue-700">Rule</p>
                              <p className="mt-1 break-words text-neutral-600">{item.rule}</p>
                            </div>
                          ) : null}

                          {item.confidence !== null && item.confidence !== undefined ? (
                            <div className="rounded-xl border border-green-100 bg-white px-3 py-2">
                              <p className="font-semibold text-green-700">Confidence</p>
                              <p className="mt-1 text-neutral-600">{item.confidence}%</p>
                            </div>
                          ) : null}

                          {item.riskLevel ? (
                            <div className="rounded-xl border border-orange-100 bg-white px-3 py-2">
                              <p className="font-semibold text-orange-700">Risk</p>
                              <p className="mt-1 text-neutral-600">{item.riskLevel}</p>
                            </div>
                          ) : null}

                          {item.recoverableRevenue !== null && item.recoverableRevenue !== undefined ? (
                            <div className="rounded-xl border border-green-100 bg-white px-3 py-2">
                              <p className="font-semibold text-green-700">Recoverable Revenue</p>
                              <p className="mt-1 text-neutral-600">{formatCurrency(Number(item.recoverableRevenue))}</p>
                            </div>
                          ) : null}

                          {item.orderAmount !== null && item.orderAmount !== undefined ? (
                            <div className="rounded-xl border border-neutral-200 bg-white px-3 py-2">
                              <p className="font-semibold text-neutral-700">Order Value</p>
                              <p className="mt-1 text-neutral-600">{formatCurrency(Number(item.orderAmount))}</p>
                            </div>
                          ) : null}

                          {item.requiresHumanAction ? (
                            <div className="rounded-xl border border-red-100 bg-white px-3 py-2">
                              <p className="font-semibold text-red-700">Human Action</p>
                              <p className="mt-1 text-neutral-600">Required</p>
                            </div>
                          ) : null}
                        </div>

                        {item.reason ? (
                          <div className="mt-3 rounded-2xl border border-neutral-200 bg-white p-3 text-xs text-neutral-600">
                            <p className="font-semibold text-neutral-900">Why Valsentra acted</p>
                            <p className="mt-1 leading-5">{item.reason}</p>
                          </div>
                        ) : null}

                        {item.explanation ? (
                          <div className="mt-3 rounded-2xl border border-neutral-200 bg-white p-3 text-xs text-neutral-600">
                            <p className="font-semibold text-neutral-900">System explanation</p>
                            <p className="mt-1 leading-5">{item.explanation}</p>
                          </div>
                        ) : null}

                        {item.humanActionReason ? (
                          <div className="mt-3 rounded-2xl border border-red-100 bg-white p-3 text-xs text-red-700">
                            <p className="font-semibold">Staff follow-up needed</p>
                            <p className="mt-1 leading-5">{item.humanActionReason}</p>
                          </div>
                        ) : null}
                      </div>
                      <div className="text-sm text-neutral-700 md:text-right">
                        <p className="font-medium">{item.timeLabel}</p>
                        <p className="mt-1 text-xs text-neutral-500">
                          {item.staff} • {item.orderId}
                        </p>
                      </div>
                    </div>
                  </article>
                ))
              )}
            </div>
          </section>
          </div>

          <div className={activeTab === "organization" ? "space-y-7" : "hidden"}>
          <section className="rounded-[32px] border border-neutral-200/80 bg-white p-6 shadow-[0_18px_60px_rgba(15,23,42,0.05)] md:p-8">
            <div className="mb-5">
              <h2 className="text-2xl font-semibold tracking-tight">
                Customer Reliability
              </h2>
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {customerProfiles.length === 0 ? (
                <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-600">
                  No customer reliability profiles yet.
                </div>
              ) : (
              customerProfiles.map((profile) => (
                <article
                  key={profile.phone || profile.customerName || profile.decision.score}
                  className="rounded-[22px] border border-neutral-200 bg-neutral-50 p-4"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold">{profile.customerName || "Unknown customer"}</p>

                    <span className="rounded-full bg-neutral-900 px-3 py-1 text-xs font-semibold text-white">
                      {profile.decision.band}
                    </span>

                    {profile.decision.shouldBlock && (
                      <span className="rounded-full bg-red-700 px-3 py-1 text-xs font-semibold text-white">
                        BLOCKED
                      </span>
                    )}

                    {profile.decision.shouldRequireDeposit && !profile.decision.shouldBlock && (
                      <span className="rounded-full bg-yellow-500 px-3 py-1 text-xs font-semibold text-white">
                        DEPOSIT REQUIRED
                      </span>
                    )}
                  </div>

                  <div className="mt-3 space-y-1 text-sm text-neutral-700">
                    <p>
                      <span className="font-medium text-neutral-900">Phone:</span>{" "}
                      {profile.phone || "—"}
                    </p>
                    <p>
                      <span className="font-medium text-neutral-900">Score:</span>{" "}
                      {profile.decision.score}%
                    </p>
                    <p>
                      <span className="font-medium text-neutral-900">Completed:</span>{" "}
                      {profile.completed}
                    </p>
                    <p>
                      <span className="font-medium text-neutral-900">No-shows:</span>{" "}
                      {profile.noShows}
                    </p>
                    <p>
                      <span className="font-medium text-neutral-900">Cancelled:</span>{" "}
                      {profile.cancelled}
                    </p>
                    <p>
                      <span className="font-medium text-neutral-900">Deposits paid:</span>{" "}
                      {profile.depositsPaid}
                    </p>
                    <p>
                      <span className="font-medium text-neutral-900">Payment failures:</span>{" "}
                      {profile.paymentFailed ?? 0}
                    </p>
                    <p>
                      <span className="font-medium text-neutral-900">Fraud flags:</span>{" "}
                      {profile.fraudAttempts ?? 0}
                    </p>
                  </div>

                  <div className="mt-3 rounded-2xl border border-neutral-200 bg-white p-3 text-xs text-neutral-600">
                    <p className="font-semibold text-neutral-900">System decision</p>
                    <p className="mt-1 leading-5">{profile.decision.explanation}</p>
                  </div>
                </article>
              ))
              )}
            </div>
          </section>
          </div>

          <div className={activeTab === "organization" ? "space-y-7" : "hidden"}>
          <section className="rounded-[32px] border border-neutral-200/80 bg-white p-6 shadow-[0_18px_60px_rgba(15,23,42,0.05)] md:p-8">
            <div className="mb-5">
              <h2 className="text-2xl font-semibold tracking-tight">Waitlist Recovery</h2>
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {waitlist.length === 0 ? (
                <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-600">
                  No waitlist leads available right now.
                </div>
              ) : (
              waitlist.map((lead) => (
                <article
                  key={lead.id}
                  className="rounded-[22px] border border-neutral-200 bg-neutral-50 p-4"
                >
                  <p className="font-semibold">{lead.customerName}</p>
                  <div className="mt-3 space-y-1 text-sm text-neutral-700">
                    <p>
                      <span className="font-medium text-neutral-900">Type:</span>{" "}
                      {getOrderTypeLabel(lead.preferredType)}
                    </p>
                    <p>
                      <span className="font-medium text-neutral-900">
                        Show probability:
                      </span>{" "}
                      {lead.showProbability}%
                    </p>
                    <p>
                      <span className="font-medium text-neutral-900">
                        Response speed:
                      </span>{" "}
                      {lead.responseSpeedScore}
                    </p>
                    <p>
                      <span className="font-medium text-neutral-900">
                        Reliability:
                      </span>{" "}
                      {lead.reliabilityScore}%
                    </p>
                  </div>
                </article>
              ))
              )}
            </div>
          </section>
          </div>

          <div className={activeTab === "organization" ? "space-y-7" : "hidden"}>
          <section className="rounded-[32px] border border-neutral-200/80 bg-white p-6 shadow-[0_18px_60px_rgba(15,23,42,0.05)] md:p-8">
            <div className="mb-5">
              <h2 className="text-2xl font-semibold tracking-tight">Recent Orders</h2>
              <p className="mt-2 text-sm text-neutral-600">
                Quick owner view of the latest operational activity.
              </p>
            </div>

            <div className="space-y-3">
              {orders.length === 0 ? (
                <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-600">
                  No orders yet.
                </div>
              ) : (
                orders.slice(0, 8).map((order) => (
                  <article
                    key={order.id}
                    className="rounded-[22px] border border-neutral-200 bg-neutral-50 p-4"
                  >
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div>
                        <p className="font-semibold">{order.customerName}</p>
                        <p className="mt-1 text-sm text-neutral-600">
                          {order.id} • {getOrderTypeLabel(order.orderType)} •{" "}
                          {formatDateTime(order.reservationTime)}
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        {order.paymentState ? (
                          <span
                            className={`rounded-full border px-3 py-1 text-xs font-semibold ${paymentBadgeClasses(
                              order.paymentState
                            )}`}
                          >
                            {order.paymentState}
                          </span>
                        ) : null}

                        <span
                          className={`rounded-full border px-3 py-1 text-xs font-semibold ${riskBadgeClasses(
                            (order.riskLevel ?? "LOW") as RiskLevel
                          )}`}
                        >
                          {(order.riskLevel ?? "LOW")} RISK
                        </span>

                        <div className="text-sm text-neutral-700">
                          <p className="font-medium">{formatCurrency(order.amount)}</p>
                          <p>{order.status}</p>
                        </div>
                      </div>
                    </div>
                  </article>
                ))
              )}
            </div>
          </section>
          </div>

          <div className={activeTab === "timeline" ? "space-y-7" : "hidden"}>
          <section className="rounded-[32px] border border-neutral-200/80 bg-white p-6 shadow-[0_18px_60px_rgba(15,23,42,0.05)] md:p-8">
            <div className="mb-5">
              <h2 className="text-2xl font-semibold tracking-tight">Audit Log</h2>
            </div>

            <div className="space-y-3">
              {audit.length === 0 ? (
                <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-600">
                  No audit items yet.
                </div>
              ) : (
                audit.map((item) => (
                  <article
                    key={item.id}
                    className="rounded-[22px] border border-neutral-200 bg-neutral-50 p-4"
                  >
                    <p className="font-semibold">{item.action}</p>
                    <p className="mt-1 text-sm text-neutral-600">
                      {item.staff} • {item.orderId}
                    </p>
                    <p className="mt-1 text-xs text-neutral-500">
                      {formatDateTime(item.createdAt)}
                    </p>
                  </article>
                ))
              )}
            </div>
          </section>
          </div>
        </div>
      </div>
    </div>
  );
}

