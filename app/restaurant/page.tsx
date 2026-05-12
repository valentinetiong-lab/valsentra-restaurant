"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import AgentDecisionPanel, {
  type MultiAgentOperationalBrain,
} from "../components/AgentDecisionPanel";
import OperationalSimulationPanel, {
  type OperationalSimulation,
} from "../components/OperationalSimulationPanel";
import OperationalTimeline from "../components/OperationalTimeline";
import { useAutopilotStore } from "../store/autopilotStore";
import type { RestaurantOrder as AutopilotOrder } from "../types/autopilot";
import { applyReliabilityEvent } from "../lib/reliabilityEngine";
import { calculateDepositDecision } from "../lib/depositEngine";
import {
  buildReservationTimeForServiceSlot,
  parseReservationTimeForServiceDate,
  SERVICE_PERIOD_AMBIGUOUS_TIME_MESSAGE,
  type ServicePeriod,
} from "../lib/domain/reservationTimeParser";
import { findBestWaitlistLead } from "../lib/waitlistEngine";
import type { PaymentState } from "../lib/paymentVerificationEngine";
import {
  sendPaymentLinkTransition,
  submitScreenshotTransition,
  verifyPaymentAmount,
} from "../lib/paymentVerificationEngine";

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
type PaymentStage = "DEPOSIT" | "FINAL" | "AWAITING_DETAILS";

type RestaurantOrder = {
  id: string;
  customerName: string;
  phone: string;
  orderType: OrderType;
  amount: number;
  guests: number;
  reservationTime: string;
  itemSummary: string;
  status: OrderStatus;
  paymentState?: PaymentState;
  paymentStage?: PaymentStage;
  paymentVerified?: boolean;
  depositRequired: boolean;
  depositAmount: number;
  depositPaid: boolean;
  reliabilityScore: number;
  terminalMismatch: boolean;
  notes: string;
  assignedStaff: string;
  riskLevel?: RiskLevel;
  protectionReason?: string;
  createdAt?: string;
  recoverySourceOrderId?: string;
  awaitingDetails?: boolean;

  collapseProbability?: number;
  collapseRiskTier?: string;
  recommendedIntervention?: string;
  instabilityFactors?: string[];
  collapseExplanation?: string;
};

type RestaurantSettings = {
  id: number;
  dineInDepositGuestsThreshold: number;
  pickupDepositAmountThreshold: number;
  requireDeliveryDeposit: boolean;
  lowReliabilityThreshold: number;
  autoBlockHighValueUnpaid: boolean;
  hardBlockTerminalMismatch: boolean;
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

type StaffMember = {
  id: string;
  name: string;
  role: string;
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
      actionReason?: string;
      operationalImpact?: string;
      confidence?: number;
      recommendedStaffReview?: boolean;
      recoveryStateTransition?: {
        from?: string;
        to?: string;
        reason?: string;
      };
      blockedBy?: string[];
    };
    autonomousRecoveryDiagnostics?: {
      safetyScore?: number;
      trustScore?: number;
      recoveryConfidence?: number;
      executionAllowed?: boolean;
      guardrailsApplied?: string[];
    };
    operationalSimulation?: OperationalSimulation;
  };
  createdAt?: string;
};

type StaffTab = "today" | "orders" | "recovery" | "payment" | "autopilot";
type ServiceDatePreset = "TODAY" | "TOMORROW" | "THIS_FRIDAY" | "THIS_SATURDAY" | "CUSTOM";

type ServiceSlot = {
  id: string;
  label: string;
  hour: number;
  minute: number;
};

const STAFF_TABS: Array<{ id: StaffTab; label: string; description: string }> = [
  { id: "today", label: "Today", description: "Guidance, quick add, immediate work" },
  { id: "orders", label: "Orders", description: "Active orders and staff actions" },
  { id: "recovery", label: "Recovery", description: "Waitlist fills and recovered orders" },
  { id: "payment", label: "Payment Truth", description: "Unverified, blocked, and fraud signals" },
  { id: "autopilot", label: "Autopilot", description: "What Valsentra handled" },
];

const DEFAULT_STAFF_MEMBERS: StaffMember[] = [
  { id: "aiman", name: "Aiman", role: "staff" },
  { id: "sarah", name: "Sarah", role: "staff" },
  { id: "manager", name: "Manager", role: "owner" },
];

const STAFF_STORAGE_KEY = "valsentra_current_staff_id";
const SHOW_DEV_ORDER_ID_OVERRIDE = process.env.NODE_ENV !== "production";

const SERVICE_DATE_PRESETS: Array<{ id: ServiceDatePreset; label: string }> = [
  { id: "TODAY", label: "Today" },
  { id: "TOMORROW", label: "Tomorrow" },
  { id: "THIS_FRIDAY", label: "This Friday" },
  { id: "THIS_SATURDAY", label: "This Saturday" },
  { id: "CUSTOM", label: "Custom Date" },
];

const SERVICE_PERIODS: Array<{ id: ServicePeriod; label: string; helper: string }> = [
  { id: "LUNCH", label: "Lunch", helper: "12:00-2:00 PM" },
  { id: "DINNER", label: "Dinner", helper: "6:00-9:00 PM" },
  { id: "LATE_NIGHT", label: "Late Night", helper: "9:30-10:30 PM" },
  { id: "CUSTOM", label: "Custom", helper: "Manual time" },
];

const SERVICE_SLOTS: Record<Exclude<ServicePeriod, "CUSTOM">, ServiceSlot[]> = {
  LUNCH: [
    { id: "1200", label: "12:00 PM", hour: 12, minute: 0 },
    { id: "1230", label: "12:30 PM", hour: 12, minute: 30 },
    { id: "1300", label: "1:00 PM", hour: 13, minute: 0 },
    { id: "1330", label: "1:30 PM", hour: 13, minute: 30 },
    { id: "1400", label: "2:00 PM", hour: 14, minute: 0 },
  ],
  DINNER: [
    { id: "1800", label: "6:00 PM", hour: 18, minute: 0 },
    { id: "1830", label: "6:30 PM", hour: 18, minute: 30 },
    { id: "1900", label: "7:00 PM", hour: 19, minute: 0 },
    { id: "1930", label: "7:30 PM", hour: 19, minute: 30 },
    { id: "2000", label: "8:00 PM", hour: 20, minute: 0 },
    { id: "2030", label: "8:30 PM", hour: 20, minute: 30 },
    { id: "2100", label: "9:00 PM", hour: 21, minute: 0 },
  ],
  LATE_NIGHT: [
    { id: "2130", label: "9:30 PM", hour: 21, minute: 30 },
    { id: "2200", label: "10:00 PM", hour: 22, minute: 0 },
    { id: "2230", label: "10:30 PM", hour: 22, minute: 30 },
  ],
};


function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-MY", {
    style: "currency",
    currency: "MYR",
    maximumFractionDigits: 2,
  }).format(value);
}

function getMalaysiaDateKey(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value])
  );

  return `${parts.year}-${parts.month}-${parts.day}`;
}

function addDaysToDateKey(dateKey: string, days: number) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));

  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(
    date.getUTCDate()
  ).padStart(2, "0")}`;
}

function getWeekdayFromDateKey(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function getUpcomingWeekdayDateKey(targetWeekday: number, fromDateKey = getMalaysiaDateKey()) {
  const currentWeekday = getWeekdayFromDateKey(fromDateKey);
  const daysUntil = (targetWeekday - currentWeekday + 7) % 7;

  return addDaysToDateKey(fromDateKey, daysUntil);
}

function getServiceDateKey(preset: ServiceDatePreset, customServiceDate: string) {
  const today = getMalaysiaDateKey();

  if (preset === "TODAY") return today;
  if (preset === "TOMORROW") return addDaysToDateKey(today, 1);
  if (preset === "THIS_FRIDAY") return getUpcomingWeekdayDateKey(5, today);
  if (preset === "THIS_SATURDAY") return getUpcomingWeekdayDateKey(6, today);
  return customServiceDate || today;
}

function formatServiceDateKey(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  return new Intl.DateTimeFormat("en-MY", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(date);
}

function getMalaysiaOrderDateTimeParts(value?: string | null) {
  if (!value) return null;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value])
  );

  return {
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

function getSlotIntelligence(
  orders: RestaurantOrder[],
  serviceDate: string,
  slot: ServiceSlot,
  recoveredOrdersCount: number
) {
  const nearbyOrders = orders.filter((order) => {
    if (order.status === "CANCELLED" || order.status === "NO_SHOW") return false;

    const parts = getMalaysiaOrderDateTimeParts(order.reservationTime);
    if (!parts || parts.dateKey !== serviceDate) return false;

    const orderMinutes = parts.hour * 60 + parts.minute;
    const slotMinutes = slot.hour * 60 + slot.minute;

    return Math.abs(orderMinutes - slotMinutes) <= 30;
  });
  const riskyOrders = nearbyOrders.filter(
    (order) =>
      order.collapseRiskTier === "CRITICAL" ||
      order.collapseRiskTier === "AT_RISK" ||
      order.riskLevel === "HIGH" ||
      order.paymentState === "BLOCKED"
  );
  const unpaidExposure = nearbyOrders
    .filter((order) => order.status !== "PAID" && order.paymentState !== "VERIFIED")
    .reduce((sum, order) => sum + Number(order.amount ?? 0), 0);

  if (riskyOrders.length > 0) return "Watch";
  if (nearbyOrders.length >= 3 || unpaidExposure >= 500) return "High demand";
  if (recoveredOrdersCount > 0 && nearbyOrders.length <= 1) return "Recovery-friendly";
  if (nearbyOrders.length === 0) return "Low pressure";

  return "Recommended";
}

function orderRenderKey(
  scope: string,
  order: Pick<RestaurantOrder, "id" | "status" | "paymentState" | "createdAt">,
  index: number
) {
  return [
    scope,
    order.status,
    order.paymentState ?? "NO_PAYMENT_STATE",
    order.id,
    order.createdAt ?? index,
    index,
  ].join("-");
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

function buildWhatsAppLink(phone: string, message: string) {
  const digits = phone.replace(/\D/g, "");
  const normalised = digits.startsWith("0") ? `6${digits}` : digits;
  return `https://wa.me/${normalised}?text=${encodeURIComponent(message)}`;
}

function statusBadgeClasses(status: OrderStatus) {
  if (status === "PAID") return "bg-green-100 text-green-700 border-green-200";
  if (status === "PAYMENT_SENT") return "bg-yellow-100 text-yellow-700 border-yellow-200";
  if (status === "UNPAID") return "bg-red-100 text-red-700 border-red-200";
  if (status === "NO_SHOW") return "bg-orange-100 text-orange-700 border-orange-200";
  if (status === "CANCELLED") return "bg-neutral-200 text-neutral-700 border-neutral-300";
  return "bg-neutral-100 text-neutral-700 border-neutral-200";
}

function paymentBadgeClasses(state?: PaymentState) {
  if (state === "VERIFIED") return "bg-green-100 text-green-700 border-green-200";
  if (state === "PENDING") return "bg-yellow-100 text-yellow-700 border-yellow-200";
  if (state === "FAILED") return "bg-orange-100 text-orange-700 border-orange-200";
  if (state === "BLOCKED") return "bg-red-100 text-red-700 border-red-200";
  return "bg-neutral-100 text-neutral-700 border-neutral-200";
}

function riskBadgeClasses(level: RiskLevel) {
  if (level === "HIGH") return "bg-red-100 text-red-700 border-red-200";
  if (level === "MED") return "bg-yellow-100 text-yellow-700 border-yellow-200";
  return "bg-green-100 text-green-700 border-green-200";
}

function collapseRiskBadgeClasses(tier?: string) {
  if (tier === "CRITICAL") return "bg-red-700 text-white border-red-700 shadow-sm shadow-red-200";
  if (tier === "AT_RISK") return "bg-red-100 text-red-800 border-red-200";
  if (tier === "WATCH") return "bg-yellow-100 text-yellow-800 border-yellow-200";
  if (tier === "STABLE") return "bg-green-100 text-green-800 border-green-200";
  return "bg-neutral-100 text-neutral-700 border-neutral-200";
}

function collapsePanelClasses(tier?: string) {
  if (tier === "CRITICAL") return "border-red-200 bg-red-50 text-red-950";
  if (tier === "AT_RISK") return "border-orange-200 bg-orange-50 text-orange-950";
  if (tier === "WATCH") return "border-yellow-200 bg-yellow-50 text-yellow-950";
  return "border-green-200 bg-green-50 text-green-950";
}

function collapseMeterClasses(tier?: string) {
  if (tier === "CRITICAL") return "bg-red-600";
  if (tier === "AT_RISK") return "bg-orange-500";
  if (tier === "WATCH") return "bg-yellow-500";
  return "bg-green-500";
}

function interventionLabel(value?: string) {
  if (!value || value === "NONE") return "No intervention";
  if (value === "GHOST_PING") return "Ghost ping";
  if (value === "DEPOSIT_ESCALATION") return "Deposit escalation";
  if (value === "PAYMENT_REMINDER") return "Payment reminder";
  if (value === "PREPARE_WAITLIST") return "Prepare waitlist";
  if (value === "RELEASE_AND_RECOVER") return "Release and recover";
  return value.replaceAll("_", " ").toLowerCase();
}

function mapStaffStatusToAutopilotStatus(
  status: OrderStatus
): AutopilotOrder["status"] {
  if (status === "PAID") return "Paid";
  if (status === "CANCELLED") return "Cancelled";
  if (status === "NO_SHOW") return "No-show";
  return "Pending";
}

function mapStaffOrderTypeToAutopilotType(
  orderType: OrderType
): AutopilotOrder["orderType"] {
  if (orderType === "DINE_IN_RESERVATION") return "DINE_IN";
  if (orderType === "DELIVERY_PREORDER") return "DELIVERY";
  return "PICKUP";
}

function getStaffAutopilotDate(value?: string) {
  if (!value) return new Date().toISOString().slice(0, 10);

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString().slice(0, 10);
  }

  return parsed.toISOString().slice(0, 10);
}

function getStaffAutopilotTime(value?: string) {
  if (!value) return "18:00";

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "18:00";
  }

  return parsed.toTimeString().slice(0, 5);
}

function getEffectiveDepositAmount(order: RestaurantOrder) {
  const totalAmount = Number(order.amount ?? 0);
  const rawDepositAmount = Number(order.depositAmount ?? 0);

  if (rawDepositAmount > 0) return rawDepositAmount;
  if (order.depositRequired) {
    return Math.round(totalAmount * 0.3 * 100) / 100;
  }

  return 0;
}

function getAmountDueNow(order: RestaurantOrder) {
  const totalAmount = Number(order.amount ?? 0);
  const effectiveDepositAmount = getEffectiveDepositAmount(order);

  if (needsRecoveredSetup(order)) return 0;
  if (order.status === "PAID") return 0;

  if (order.depositRequired && !order.depositPaid) {
    return effectiveDepositAmount;
  }

  if (order.depositRequired && order.depositPaid) {
    return Math.max(totalAmount - effectiveDepositAmount, 0);
  }

  return totalAmount;
}

function needsRecoveredSetup(order: RestaurantOrder) {
  return Boolean(
    order.awaitingDetails ||
      (order.recoverySourceOrderId &&
        Number(order.amount ?? 0) <= 0 &&
        Number(order.depositAmount ?? 0) <= 0) ||
      order.protectionReason?.toLowerCase().includes("awaiting actual order details") ||
      order.notes?.toLowerCase().includes("awaiting actual order details")
  );
}

function getPaymentStageLabel(order: RestaurantOrder) {
  if (needsRecoveredSetup(order)) return "Awaiting details";
  if (order.status === "PAID") return "Fully paid";
  if (order.depositRequired && !order.depositPaid) return "Deposit due";
  return "Final balance due";
}

function getSafeOrderDateTime(value?: string | null) {
  if (!value) return "Not set";

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Not set";

  return parsed.toLocaleString("en-MY", {
    timeZone: "Asia/Kuala_Lumpur",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getAutopilotStatus(order: RestaurantOrder) {
  const notes = (order.notes || "").toLowerCase();

  if (notes.includes("waitlist cascade") || notes.includes("recovered")) {
    return "Recovered (Waitlist)";
  }

  if (
    notes.includes("slot expired without verified payment") ||
    notes.includes("auto release") ||
    notes.includes("auto-released")
  ) {
    return "Auto Released";
  }

  if (notes.includes("final reminder")) {
    return "Final Reminder Sent";
  }

  if (notes.includes("reminder sent")) {
    return "Reminder Sent";
  }

  return "No automation yet";
}

function getAutopilotTone(status: string) {
  if (status.includes("Recovered")) return "text-green-700";
  if (status.includes("Auto Released")) return "text-red-700";
  if (status.includes("Final")) return "text-orange-700";
  if (status.includes("Reminder")) return "text-yellow-700";
  return "text-neutral-500";
}

function getAutopilotFeedClasses(status: string) {
  if (status.includes("Recovered")) return "border-green-200 bg-green-50 text-green-900";
  if (status.includes("Auto Released")) return "border-red-200 bg-red-50 text-red-900";
  if (status.includes("Final")) return "border-orange-200 bg-orange-50 text-orange-900";
  if (status.includes("Reminder")) return "border-yellow-200 bg-yellow-50 text-yellow-900";
  if (status.includes("Verified")) return "border-green-200 bg-green-50 text-green-900";
  return "border-neutral-200 bg-neutral-50 text-neutral-700";
}

export default function RestaurantStaffPage() {
  const [orders, setOrders] = useState<RestaurantOrder[]>([]);
  const [settings, setSettings] = useState<RestaurantSettings | null>(null);
  const [waitlist, setWaitlist] = useState<WaitlistLead[]>([]);
  const [audit, setAudit] = useState<AuditItem[]>([]);
  const [autopilotFeedItems, setAutopilotFeedItems] = useState<AutopilotFeedItem[]>([]);
  const [staffMembers, setStaffMembers] = useState<StaffMember[]>(DEFAULT_STAFF_MEMBERS);
  const [currentStaffId, setCurrentStaffId] = useState(DEFAULT_STAFF_MEMBERS[0].id);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [setupOrderId, setSetupOrderId] = useState<string | null>(null);
  const [setupAmount, setSetupAmount] = useState("");
  const [setupSummary, setSetupSummary] = useState("");
  const [quickAddTimeError, setQuickAddTimeError] = useState("");
  const { evaluateOrders } = useAutopilotStore();

  const [activeStaffTab, setActiveStaffTab] = useState<StaffTab>("today");
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickAdd, setQuickAdd] = useState({
    idOverride: "",
    customerName: "",
    phone: "",
    amount: "",
    guests: "2",
    reservationTime: "",
    serviceDatePreset: "TODAY" as ServiceDatePreset,
    customServiceDate: "",
    servicePeriod: "DINNER" as ServicePeriod,
    selectedSlotId: "2030",
    manualReservationTime: "",
    itemSummary: "",
    orderType: "PREORDER_PICKUP" as OrderType,
    assignedStaff: DEFAULT_STAFF_MEMBERS[0].name,
  });

  const currentStaff = useMemo(() => {
    return (
      staffMembers.find((staff) => staff.id === currentStaffId) ??
      staffMembers[0] ??
      DEFAULT_STAFF_MEMBERS[0]
    );
  }, [staffMembers, currentStaffId]);

  const currentStaffName = currentStaff?.name ?? "Unknown staff";

  const selectedServiceDate = useMemo(() => {
    return getServiceDateKey(quickAdd.serviceDatePreset, quickAdd.customServiceDate);
  }, [quickAdd.serviceDatePreset, quickAdd.customServiceDate]);

  const serviceSlots = useMemo(() => {
    if (quickAdd.servicePeriod === "CUSTOM") return [];
    return SERVICE_SLOTS[quickAdd.servicePeriod];
  }, [quickAdd.servicePeriod]);

  const selectedServiceSlot = useMemo(() => {
    return serviceSlots.find((slot) => slot.id === quickAdd.selectedSlotId) ?? null;
  }, [serviceSlots, quickAdd.selectedSlotId]);

  const recoveredOrderCountForSlots = useMemo(() => {
    return orders.filter((order) => order.status === "CANCELLED" || order.status === "NO_SHOW").length;
  }, [orders]);

  const selectedReservationTime = useMemo(() => {
    if (quickAdd.manualReservationTime.trim()) {
      return parseReservationTimeForServiceDate(
        quickAdd.manualReservationTime,
        selectedServiceDate,
        quickAdd.servicePeriod
      );
    }

    if (selectedServiceSlot) {
      return buildReservationTimeForServiceSlot(
        selectedServiceDate,
        selectedServiceSlot.hour,
        selectedServiceSlot.minute,
        selectedServiceSlot.label
      );
    }

    return { ok: false as const, input: "", error: "Choose an operational slot or type a time." };
  }, [
    quickAdd.manualReservationTime,
    quickAdd.servicePeriod,
    selectedServiceDate,
    selectedServiceSlot,
  ]);

  useEffect(() => {
    const savedStaffId = window.localStorage.getItem(STAFF_STORAGE_KEY);
    if (savedStaffId) setCurrentStaffId(savedStaffId);
  }, []);

  useEffect(() => {
    window.localStorage.setItem(STAFF_STORAGE_KEY, currentStaffId);
  }, [currentStaffId]);

  useEffect(() => {
    setQuickAdd((prev) => ({ ...prev, assignedStaff: currentStaffName }));
  }, [currentStaffName]);

  useEffect(() => {
    async function boot() {
      try {
        await Promise.all([
          loadOrders(),
          loadSettings(),
          loadWaitlist(),
          loadStaff(),
          loadAudit(),
          loadAutopilotFeed(),
        ]);
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

  async function loadAudit() {
    try {
      const res = await fetch("/api/audit", { cache: "no-store" });
      const data = await res.json();

      if (res.ok && Array.isArray(data)) {
        setAudit(data);
      }
    } catch (error) {
      console.warn("Audit log is not available yet.", error);
    }
  }

  async function loadStaff() {
    try {
      const res = await fetch("/api/staff", { cache: "no-store" });
      const data = await res.json();

      if (res.ok && Array.isArray(data) && data.length > 0) {
        const loadedStaff = data.map((staff: any) => ({
          id: String(staff.id),
          name: String(staff.name ?? "Staff"),
          role: String(staff.role ?? "staff"),
        }));

        setStaffMembers(loadedStaff);

        const savedStaffId = window.localStorage.getItem(STAFF_STORAGE_KEY);
        const savedStillExists = savedStaffId
          ? loadedStaff.some((staff: StaffMember) => staff.id === savedStaffId)
          : false;

        if (!savedStillExists) {
          setCurrentStaffId(loadedStaff[0].id);
        }
      }
    } catch (error) {
      console.warn("Using demo staff list because /api/staff is not available yet.", error);
    }
  }

  async function loadAutopilotFeed() {
    try {
      const res = await fetch("/api/autopilot/feed", { cache: "no-store" });
      const data = await res.json();

      if (res.ok && Array.isArray(data)) {
        setAutopilotFeedItems(data);
      }
    } catch (error) {
      console.warn("Autopilot feed is not available yet.", error);
    }
  }

  async function runAutopilotNow() {
    setSaving(true);

    try {
      const res = await fetch("/api/orders", {
        method: "PUT",
      });

      const data = await res.json();

      if (!res.ok) {
        alert(data.error || "Autopilot run failed.");
        return;
      }

      const logs = Array.isArray(data.logs) ? data.logs : [];
      alert(
        logs.length > 0
          ? `${data.message || "Autopilot run complete"}\n\n${logs.join("\n")}`
          : data.message || "Autopilot run complete"
      );

      await Promise.all([loadOrders(), loadWaitlist(), loadAudit(), loadAutopilotFeed()]);
    } finally {
      setSaving(false);
    }
  }

  function handleStaffChange(staffId: string) {
    setCurrentStaffId(staffId);
    window.localStorage.setItem(STAFF_STORAGE_KEY, staffId);
  }

  async function logAudit(action: string, staff: string, orderId: string) {
    await fetch("/api/audit", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action, staff, orderId }),
    });
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

  function getRiskLevel(input: {
    amount: number;
    guests: number;
    reliabilityScore: number;
    terminalMismatch: boolean;
    status: OrderStatus;
    orderType: OrderType;
  }): RiskLevel {
    let score = 0;

    if (input.terminalMismatch) score += 3;
    if (input.reliabilityScore <= 20) score += 3;
    else if (input.reliabilityScore <= 50) score += 2;

    if (input.amount >= 300) score += 2;
    else if (input.amount >= 150) score += 1;

    if (input.orderType === "DINE_IN_RESERVATION" && input.guests >= 10) score += 2;
    else if (input.orderType === "DINE_IN_RESERVATION" && input.guests >= 6) score += 1;

    if (input.status === "UNPAID") score += 1;
    if (input.status === "PAYMENT_SENT") score += 1;

    if (score >= 5) return "HIGH";
    if (score >= 3) return "MED";
    return "LOW";
  }

  function getProtectionReason(input: {
    depositRequired: boolean;
    reliabilityScore: number;
    terminalMismatch: boolean;
    amount: number;
    guests: number;
    orderType: OrderType;
  }) {
    if (input.terminalMismatch) return "Terminal mismatch";
    if (isBlacklisted(input.reliabilityScore)) return "Blacklisted customer";

    if (settings && input.reliabilityScore <= settings.lowReliabilityThreshold) {
      return "Low reliability customer";
    }

    if (input.reliabilityScore <= 20) return "Very low reliability";

    if (
      input.orderType === "DINE_IN_RESERVATION" &&
      settings &&
      input.guests >= settings.dineInDepositGuestsThreshold
    ) {
      return "Large dine-in booking";
    }

    if (
      input.orderType === "PREORDER_PICKUP" &&
      settings &&
      input.amount >= settings.pickupDepositAmountThreshold
    ) {
      return "High-value pickup";
    }

    if (
      input.orderType === "DELIVERY_PREORDER" &&
      settings?.requireDeliveryDeposit
    ) {
      return "Delivery deposit required";
    }

    if (input.depositRequired) return "Deposit required";

    return "Standard protection";
  }

  const isBlocked = useCallback((order: RestaurantOrder) => {
    if (needsRecoveredSetup(order)) return false;
    if (order.status === "PAID") return false;
    if (order.status === "CANCELLED" || order.status === "NO_SHOW") return false;

    if (settings?.hardBlockTerminalMismatch && order.terminalMismatch) {
      return true;
    }

    if (order.paymentState === "BLOCKED" || order.paymentState === "FAILED") {
      return true;
    }

    if (order.depositRequired && !order.depositPaid) {
      return true;
    }

    if (settings?.autoBlockHighValueUnpaid && requiresProtection(order)) {
      return true;
    }

    if (isBlacklisted(order.reliabilityScore)) return true;
    return false;
  }, [requiresProtection, settings]);

  function getBlockReasons(order: RestaurantOrder) {
    if (!settings) return [];

    const reasons: string[] = [];

    if (settings.hardBlockTerminalMismatch && order.terminalMismatch) {
      reasons.push("Terminal mismatch");
    }

    if (
      settings.autoBlockHighValueUnpaid &&
      requiresProtection(order) &&
      order.status !== "PAID"
    ) {
      reasons.push("High-value unpaid order");
    }

    if (order.reliabilityScore < settings.lowReliabilityThreshold) {
      reasons.push("Low reliability customer");
    }

    if (order.depositRequired && !order.depositPaid) {
      reasons.push("Deposit required but not paid");
    }

    if (order.paymentState === "FAILED" || order.paymentState === "BLOCKED") {
      reasons.push("Suspicious payment state");
    }

    if (isBlacklisted(order.reliabilityScore)) {
      reasons.push("Blacklisted customer");
    }

    return Array.from(new Set(reasons));
  }

  function getStaffGuidance(order: RestaurantOrder) {
    const guidance: string[] = [];
    const dueNow = getAmountDueNow(order);

    if (needsRecoveredSetup(order)) {
      guidance.push("Set up recovered order details before taking payment actions.");
      return guidance;
    }

    if (order.terminalMismatch) {
      guidance.push("Check terminal amount before releasing this order.");
    }

    if (order.paymentState === "PENDING") {
      guidance.push("Payment submitted or link sent. Verify before marking as paid.");
    }

    if (order.depositRequired && !order.depositPaid) {
      guidance.push(`Collect deposit now: ${formatCurrency(getEffectiveDepositAmount(order))}.`);
    }

    if (order.depositRequired && order.depositPaid && dueNow > 0) {
      guidance.push(`Deposit secured. Remaining balance: ${formatCurrency(dueNow)}.`);
    }

    if ((order.riskLevel ?? "LOW") === "HIGH") {
      guidance.push("High-risk order: confirm payment before preparing or holding capacity.");
    }

    if (order.reliabilityScore < 40) {
      guidance.push("Low reliability customer: require stronger payment protection.");
    }

    if (isBlacklisted(order.reliabilityScore)) {
      guidance.push("Blacklisted customer: do not release without owner approval.");
    }

    if (order.recommendedIntervention && order.recommendedIntervention !== "NONE") {
      guidance.push(`Collapse Engine recommends: ${interventionLabel(order.recommendedIntervention)}.`);
    }

    if (dueNow > 0 && !order.depositRequired) {
      guidance.push(`Amount due now: ${formatCurrency(dueNow)}.`);
    }

    return Array.from(new Set(guidance));
  }

  const getStaffAttentionItems = useCallback((items: RestaurantOrder[]) => {
    const highRisk = items.filter((order) => (order.riskLevel ?? "LOW") === "HIGH").length;
    const unpaidDeposits = items.filter(
      (order) => order.depositRequired && !order.depositPaid && !needsRecoveredSetup(order)
    ).length;
    const fraudFlags = items.filter(
      (order) => order.terminalMismatch || order.paymentState === "FAILED" || order.paymentState === "PENDING"
    ).length;
    const setupNeeded = items.filter((order) => needsRecoveredSetup(order)).length;
    const blocked = items.filter((order) => isBlocked(order)).length;
    const collapseWatch = items.filter(
      (order) => order.collapseRiskTier === "CRITICAL" || order.collapseRiskTier === "AT_RISK"
    ).length;

    const attention: string[] = [];

    if (collapseWatch > 0) attention.push(`${collapseWatch} booking${collapseWatch === 1 ? "" : "s"} have collapse risk that needs intervention.`);
    if (highRisk > 0) attention.push(`${highRisk} high-risk booking${highRisk === 1 ? "" : "s"} need close attention.`);
    if (unpaidDeposits > 0) attention.push(`${unpaidDeposits} deposit${unpaidDeposits === 1 ? "" : "s"} still unpaid.`);
    if (fraudFlags > 0) attention.push(`${fraudFlags} payment/fraud alert${fraudFlags === 1 ? "" : "s"} need review.`);
    if (setupNeeded > 0) attention.push(`${setupNeeded} recovered order${setupNeeded === 1 ? "" : "s"} need setup.`);
    if (blocked > 0) attention.push(`${blocked} order${blocked === 1 ? " is" : "s are"} blocked until protection is cleared.`);

    return attention;
  }, [isBlocked]);

  function getProtectionStatus(order: RestaurantOrder) {
    if (needsRecoveredSetup(order)) return "Awaiting setup";
    if (order.status === "PAID") return "Protected";
    if (order.status === "CANCELLED") return "Cancelled";
    if (order.status === "NO_SHOW") return "Lost";
    if (isBlacklisted(order.reliabilityScore)) return "Blacklisted";
    if (order.depositRequired && order.depositPaid) return "Deposit secured";
    if (isBlocked(order)) return "Blocked until verified";
    if (order.status === "PAYMENT_SENT") return "Waiting payment";
    return "Unprotected";
  }

  function getProtectionTone(order: RestaurantOrder) {
    if (needsRecoveredSetup(order)) return "text-yellow-700";
    if (order.status === "PAID") return "text-green-700";
    if (order.status === "CANCELLED" || order.status === "NO_SHOW") {
      return "text-neutral-700";
    }
    if (order.depositRequired && order.depositPaid) return "text-blue-700";
    if (isBlocked(order)) return "text-red-700";
    if (order.status === "PAYMENT_SENT") return "text-yellow-700";
    return "text-neutral-700";
  }

  function getBestWaitlistLead(order: RestaurantOrder) {
    return findBestWaitlistLead(
      {
        id: order.id,
        orderType: order.orderType,
        amount: order.amount,
      },
      waitlist
    );
  }

  async function patchOrder(id: string, updates: Partial<RestaurantOrder>) {
    setSaving(true);

    try {
      const res = await fetch("/api/orders", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ id, ...updates }),
      });

      const data = await res.json();

      if (!res.ok) {
        alert(data.error || "Failed to update order.");
        return null;
      }

      setOrders((prev) => prev.map((o) => (o.id === id ? data : o)));
      return data as RestaurantOrder;
    } finally {
      setSaving(false);
    }
  }

  async function createRecoveredOrderFromLead(
    originalOrder: RestaurantOrder,
    lead: WaitlistLead
  ) {
    if (!settings) {
      alert("Settings not loaded yet.");
      return;
    }

    setSaving(true);

    try {
      const replacementOrder: RestaurantOrder = {
        id: `ORD-${Date.now().toString().slice(-6)}`,
        customerName: lead.customerName,
        phone: lead.phone,
        orderType: originalOrder.orderType,
        amount: 0,
        guests: originalOrder.guests,
        reservationTime: originalOrder.reservationTime,
        itemSummary: "",
        status: "UNPAID",
        paymentState: "PENDING",
        paymentStage: "AWAITING_DETAILS",
        paymentVerified: false,
        depositRequired: false,
        depositAmount: 0,
        depositPaid: false,
        awaitingDetails: true,
        reliabilityScore: lead.reliabilityScore,
        terminalMismatch: false,
        notes: `Recovered from ${originalOrder.id}. Customer accepted slot, but actual order value/details still need to be entered.`,
        assignedStaff: currentStaffName,
        riskLevel: "LOW",
        protectionReason: "Recovered slot • awaiting actual order details",
        recoverySourceOrderId: originalOrder.id,
      };

      const res = await fetch("/api/orders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(replacementOrder),
      });

      const data = await res.json();

      if (!res.ok) {
        alert(data.error || "Failed to create recovered order.");
        return;
      }

      setOrders((prev) => [data, ...prev]);

      await patchOrder(originalOrder.id, {
        notes: `${originalOrder.notes} | Waitlist slot accepted by ${lead.customerName}. Replacement order created as draft.`,
      });

      await logAudit(
        `Recovered slot ${originalOrder.id} with waitlist lead ${lead.customerName}. Draft replacement order created.`,
        currentStaffName,
        data.id
      );

      alert(`Recovered slot with ${lead.customerName}. Draft replacement order created.`);
    } finally {
      setSaving(false);
    }
  }

  function openRecoveredOrderSetup(order: RestaurantOrder) {
    setSetupOrderId(order.id);
    setSetupAmount(order.amount > 0 ? String(order.amount) : "");
    setSetupSummary(order.itemSummary && order.itemSummary.trim() ? order.itemSummary : "");
  }

  async function confirmRecoveredOrderSetup() {
    if (!setupOrderId) return;
    if (!settings) {
      alert("Settings not loaded yet.");
      return;
    }

    const target = orders.find((o) => o.id === setupOrderId);
    if (!target) return;

    const amount = Number(setupAmount);
    if (Number.isNaN(amount) || amount <= 0) {
      alert("Enter a valid order amount.");
      return;
    }

    const summary = setupSummary.trim() || "Recovered order";

    const depositDecision = calculateDepositDecision({
      orderType: target.orderType,
      guests: target.guests,
      amount,
      reliabilityScore: target.reliabilityScore,
      dineInDepositGuestsThreshold: settings.dineInDepositGuestsThreshold,
      pickupDepositAmountThreshold: settings.pickupDepositAmountThreshold,
      requireDeliveryDeposit: settings.requireDeliveryDeposit,
      lowReliabilityThreshold: settings.lowReliabilityThreshold,
    });

    const riskLevel = getRiskLevel({
      amount,
      guests: target.guests,
      reliabilityScore: target.reliabilityScore,
      terminalMismatch: false,
      status: "UNPAID",
      orderType: target.orderType,
    });

    const updated = await patchOrder(target.id, {
      amount,
      itemSummary: summary,
      depositRequired: depositDecision.required,
      depositAmount: Number(depositDecision.depositAmount ?? 0),
      paymentStage: depositDecision.required ? "DEPOSIT" : "FINAL",
      awaitingDetails: false,
      riskLevel,
      protectionReason: depositDecision.required
        ? depositDecision.reason
        : "Recovered order configured",
      notes: `Recovered order configured with actual order details.`,
    });

    if (updated) {
      await logAudit("Configured recovered order details", currentStaffName, target.id);
      setSetupOrderId(null);
      setSetupAmount("");
      setSetupSummary("");
    }
  }

  async function markCancelled(orderId: string) {
    const target = orders.find((o) => o.id === orderId);
    if (!target) return;

    const newReliability = applyReliabilityEvent(
      target.reliabilityScore,
      "ORDER_CANCELLED"
    );

    const newRisk = getRiskLevel({
      amount: target.amount,
      guests: target.guests,
      reliabilityScore: newReliability,
      terminalMismatch: target.terminalMismatch,
      status: "CANCELLED",
      orderType: target.orderType,
    });

    const protectionReason = getProtectionReason({
      depositRequired: target.depositRequired,
      reliabilityScore: newReliability,
      terminalMismatch: target.terminalMismatch,
      amount: target.amount,
      guests: target.guests,
      orderType: target.orderType,
    });

    const updated = await patchOrder(orderId, {
      status: "CANCELLED",
      reliabilityScore: newReliability,
      riskLevel: newRisk,
      protectionReason,
      notes: "Order cancelled.",
    });

    if (updated) {
      await logAudit("Marked order cancelled", currentStaffName, orderId);
    }
  }

  async function markNoShow(orderId: string) {
    const target = orders.find((o) => o.id === orderId);
    if (!target) return;

    const newReliability = applyReliabilityEvent(
      target.reliabilityScore,
      "NO_SHOW"
    );

    const newRisk = getRiskLevel({
      amount: target.amount,
      guests: target.guests,
      reliabilityScore: newReliability,
      terminalMismatch: target.terminalMismatch,
      status: "NO_SHOW",
      orderType: target.orderType,
    });

    const protectionReason = getProtectionReason({
      depositRequired: target.depositRequired,
      reliabilityScore: newReliability,
      terminalMismatch: target.terminalMismatch,
      amount: target.amount,
      guests: target.guests,
      orderType: target.orderType,
    });

    const updated = await patchOrder(orderId, {
      status: "NO_SHOW",
      reliabilityScore: newReliability,
      riskLevel: newRisk,
      protectionReason,
      notes: "Customer did not show up.",
    });

    if (updated) {
      await logAudit("Marked order no-show", currentStaffName, orderId);
    }
  }

  async function verifyAndMarkPaid(orderId: string) {
    const target = orders.find((o) => o.id === orderId);
    if (!target) return;
    if (needsRecoveredSetup(target)) {
      alert("Set up the recovered order details first.");
      return;
    }

    const expectedAmount = getAmountDueNow(target);

    if (expectedAmount <= 0) {
      alert("There is no payment due for this order right now.");
      return;
    }

    const input = window.prompt(
      `Enter terminal amount received for ${orderId}.\nExpected now: ${expectedAmount}`
    );

    if (input === null) return;

    const enteredAmount = Number(input);

    if (Number.isNaN(enteredAmount)) {
      alert("Invalid amount.");
      return;
    }

    const verification = verifyPaymentAmount(expectedAmount, enteredAmount);

    const nextReliability = verification.reliabilityEvent
      ? applyReliabilityEvent(target.reliabilityScore, verification.reliabilityEvent)
      : target.reliabilityScore;

    const nextRisk = getRiskLevel({
      amount: target.amount,
      guests: target.guests,
      reliabilityScore: nextReliability,
      terminalMismatch: verification.terminalMismatch,
      status: target.status,
      orderType: target.orderType,
    });

    if (!verification.paymentVerified) {
      const updated = await patchOrder(orderId, {
        paymentState: verification.paymentState,
        paymentVerified: false,
        terminalMismatch: verification.terminalMismatch,
        reliabilityScore: nextReliability,
        riskLevel: nextRisk,
        protectionReason: "Terminal mismatch",
        notes: verification.reason,
      });

      if (updated) {
        await logAudit(verification.reason, currentStaffName, orderId);
      }

      alert(verification.reason);
      return;
    }

    if (target.depositRequired && !target.depositPaid) {
      const remainingBalance = Math.max(
        target.amount - getEffectiveDepositAmount(target),
        0
      );

      const updated = await patchOrder(orderId, {
        status: remainingBalance > 0 ? "PAYMENT_SENT" : "PAID",
        paymentStage: "FINAL",
        paymentState: "VERIFIED",
        paymentVerified: remainingBalance === 0,
        depositPaid: true,
        terminalMismatch: false,
        reliabilityScore: nextReliability,
        riskLevel: remainingBalance === 0 ? "LOW" : (target.riskLevel ?? "LOW"),
        protectionReason:
          remainingBalance > 0 ? "Deposit secured" : "Payment verified",
        notes:
          remainingBalance > 0
            ? `Deposit verified successfully. Remaining balance due: ${formatCurrency(
                remainingBalance
              )}`
            : "Deposit verified and order fully paid.",
      });

      if (updated) {
        await logAudit("Deposit verified successfully", currentStaffName, orderId);
      }

      alert(
        remainingBalance > 0
          ? `Deposit verified. Remaining balance: ${formatCurrency(remainingBalance)}`
          : "Payment verified successfully."
      );
      return;
    }

    const updated = await patchOrder(orderId, {
      status: "PAID",
      paymentStage: "FINAL",
      paymentState: "VERIFIED",
      paymentVerified: true,
      depositPaid: true,
      terminalMismatch: false,
      reliabilityScore: nextReliability,
      riskLevel: "LOW",
      protectionReason: "Payment verified",
      notes: "Final payment verified successfully.",
    });

    if (updated) {
      await logAudit("Final payment verified successfully", currentStaffName, orderId);
    }

    alert("Final payment verified successfully.");
  }

  async function sendPaymentLink(order: RestaurantOrder) {
    if (needsRecoveredSetup(order)) {
      alert("Set up the recovered order details first.");
      return;
    }
    const amountDueNow = getAmountDueNow(order);

    const updated = await patchOrder(order.id, {
      status: "PAYMENT_SENT",
      paymentStage:
        order.depositRequired && !order.depositPaid ? "DEPOSIT" : "FINAL",
      paymentState: sendPaymentLinkTransition(),
      notes: `Payment link sent. ${getPaymentStageLabel(order)}: ${formatCurrency(
        amountDueNow
      )}`,
    });

    if (updated) {
      await logAudit("Sent payment link", currentStaffName, order.id);
      window.open(`/pay/${order.id}`, "_blank");
    }
  }

  async function submitPaymentScreenshot(orderId: string) {
    const target = orders.find((o) => o.id === orderId);
    if (!target) return;
    if (needsRecoveredSetup(target)) {
      alert("Set up the recovered order details first.");
      return;
    }

    const updated = await patchOrder(orderId, {
      paymentState: submitScreenshotTransition(),
      notes: `Customer submitted screenshot for ${getPaymentStageLabel(target).toLowerCase()}. Manual verification required.`,
    });

    if (updated) {
      await logAudit("Marked screenshot submitted", currentStaffName, orderId);
    }
  }

  async function addQuickOrder() {
    if (
      !quickAdd.customerName ||
      !quickAdd.phone ||
      !quickAdd.amount
    ) {
      alert("Fill name, phone, amount.");
      return;
    }

    const reliabilityScore = 70;

    if (!settings) {
      alert("Settings not loaded yet.");
      return;
    }

    const orderAmount = Number(quickAdd.amount);
    const guestCount =
      quickAdd.orderType === "DINE_IN_RESERVATION"
        ? Number(quickAdd.guests)
        : 1;

    if (quickAdd.orderType === "DINE_IN_RESERVATION") {
      if (Number.isNaN(guestCount) || guestCount < 1) {
        alert("Enter a valid guest / pax count for dine-in bookings.");
        return;
      }
    }

    if (Number.isNaN(orderAmount) || orderAmount <= 0) {
      alert("Enter a valid order amount.");
      return;
    }

    if (!selectedReservationTime.ok) {
      const error =
        selectedReservationTime.error === SERVICE_PERIOD_AMBIGUOUS_TIME_MESSAGE
          ? "Select a service period or include AM/PM."
          : selectedReservationTime.error;
      setQuickAddTimeError(error);
      alert(error);
      return;
    }

    setQuickAddTimeError("");

    const depositDecision = calculateDepositDecision({
      orderType: quickAdd.orderType,
      guests: guestCount,
      amount: orderAmount,
      reliabilityScore,
      dineInDepositGuestsThreshold: settings.dineInDepositGuestsThreshold,
      pickupDepositAmountThreshold: settings.pickupDepositAmountThreshold,
      requireDeliveryDeposit: settings.requireDeliveryDeposit,
      lowReliabilityThreshold: settings.lowReliabilityThreshold,
    });

    const depositRequired = depositDecision.required;

    const riskLevel = getRiskLevel({
      amount: orderAmount,
      guests: guestCount,
      reliabilityScore,
      terminalMismatch: false,
      status: "UNPAID",
      orderType: quickAdd.orderType,
    });

    const protectionReason = depositRequired
      ? depositDecision.reason
      : getProtectionReason({
          depositRequired,
          reliabilityScore,
          terminalMismatch: false,
          amount: orderAmount,
          guests: guestCount,
          orderType: quickAdd.orderType,
        });

    const newOrder: RestaurantOrder = {
      id:
        SHOW_DEV_ORDER_ID_OVERRIDE && quickAdd.idOverride.trim()
          ? quickAdd.idOverride.trim()
          : `ORD-${Date.now().toString().slice(-6)}`,
      customerName: quickAdd.customerName,
      phone: quickAdd.phone,
      orderType: quickAdd.orderType,
      amount: orderAmount,
      guests: guestCount,
      reservationTime: selectedReservationTime.reservationTime,
      itemSummary: quickAdd.itemSummary || "New order",
      status: "UNPAID",
      paymentState: "PENDING",
      paymentStage: depositRequired ? "DEPOSIT" : "FINAL",
      paymentVerified: false,
      depositRequired,
      depositAmount: Number(depositDecision.depositAmount ?? 0),
      depositPaid: false,
      reliabilityScore,
      terminalMismatch: false,
      notes: "Quick-added by staff.",
      assignedStaff: currentStaffName,
      riskLevel,
      protectionReason,
    };

    setSaving(true);

    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(newOrder),
      });

      const data = await res.json();

      if (!res.ok) {
        alert(data.error || "Failed to create order.");
        return;
      }

      setOrders((prev) => [data, ...prev]);
      await logAudit("Created order", currentStaffName, data.id);

      setQuickAdd({
        idOverride: "",
        customerName: "",
        phone: "",
        amount: "",
        guests: "1",
        reservationTime: "",
        serviceDatePreset: "TODAY",
        customServiceDate: "",
        servicePeriod: "DINNER",
        selectedSlotId: "2030",
        manualReservationTime: "",
        itemSummary: "",
        orderType: "PREORDER_PICKUP",
        assignedStaff: currentStaffName,
      });

      setQuickAddOpen(false);
    } finally {
      setSaving(false);
    }
  }

  const metrics = useMemo(() => {
    const revenueProtected = orders
      .filter((o) => o.status === "PAID" || (o.depositRequired && o.depositPaid))
      .reduce((sum, o) => {
        if (o.status === "PAID") return sum + o.amount;
        return sum + getEffectiveDepositAmount(o);
      }, 0);

    const revenueAtRisk = orders
      .filter((o) => o.status === "UNPAID" || o.status === "PAYMENT_SENT")
      .reduce((sum, o) => sum + getAmountDueNow(o), 0);

    const blockedOrders = orders.filter((o) => isBlocked(o)).length;
    const collapseWatch = orders.filter(
      (o) => o.collapseRiskTier === "CRITICAL" || o.collapseRiskTier === "AT_RISK"
    ).length;

    return { revenueProtected, revenueAtRisk, blockedOrders, collapseWatch };
  }, [orders, isBlocked]);

  const activeOrders = useMemo(() => {
    return orders.filter((o) => o.status !== "CANCELLED" && o.status !== "NO_SHOW");
  }, [orders]);

  const closedOrders = useMemo(() => {
    return orders.filter((o) => o.status === "CANCELLED" || o.status === "NO_SHOW");
  }, [orders]);


  const staffAttentionItems = useMemo(() => {
    return getStaffAttentionItems(activeOrders);
  }, [activeOrders, getStaffAttentionItems]);

  const staffPaymentTruth = useMemo(() => {
    const unpaid = orders.filter((order) => order.paymentState === "UNPAID" || order.status === "UNPAID");
    const pending = orders.filter((order) => order.paymentState === "PENDING" || order.status === "PAYMENT_SENT");
    const verified = orders.filter((order) => order.paymentState === "VERIFIED" || order.paymentVerified || order.status === "PAID");
    const blocked = orders.filter((order) => order.paymentState === "BLOCKED" || order.paymentState === "FAILED" || order.terminalMismatch);
    const awaitingSetup = orders.filter(needsRecoveredSetup);

    return { unpaid, pending, verified, blocked, awaitingSetup };
  }, [orders]);

  const staffRiskQueue = useMemo(() => {
    return activeOrders.filter(
      (order) =>
        isBlocked(order) ||
        order.collapseRiskTier === "CRITICAL" ||
        order.collapseRiskTier === "AT_RISK" ||
        order.terminalMismatch ||
        order.paymentState === "BLOCKED" ||
        order.paymentState === "FAILED"
    );
  }, [activeOrders, isBlocked]);

  const agentDecisionByOrderId = useMemo(() => {
    const map = new Map<string, MultiAgentOperationalBrain>();

    for (const item of audit) {
      const decision =
        item.meta?.multiAgentOperationalBrain ??
        item.meta?.communicationDiagnostics?.multiAgentOperationalBrain ??
        null;

      if (decision && item.orderId && !map.has(item.orderId)) {
        map.set(item.orderId, decision);
      }
    }

    return map;
  }, [audit]);

  const autonomousRecoveryByOrderId = useMemo(() => {
    const map = new Map<string, NonNullable<AuditItem["meta"]>>();

    for (const item of audit) {
      if (item.orderId && item.meta?.autonomousRecoveryDiagnostics && !map.has(item.orderId)) {
        map.set(item.orderId, item.meta);
      }
    }

    return map;
  }, [audit]);

  const operationalSimulationByOrderId = useMemo(() => {
    const map = new Map<string, OperationalSimulation>();

    for (const item of audit) {
      if (item.orderId && item.meta?.operationalSimulation && !map.has(item.orderId)) {
        map.set(item.orderId, item.meta.operationalSimulation);
      }
    }

    return map;
  }, [audit]);

  const autopilotOrders = useMemo<AutopilotOrder[]>(() => {
    return orders.map((order) => ({
      id: order.id,
      customerName: order.customerName,
      date: getStaffAutopilotDate(order.reservationTime),
      time: getStaffAutopilotTime(order.reservationTime),
      amount: getAmountDueNow(order),
      status: mapStaffStatusToAutopilotStatus(order.status),
      risk: (order.riskLevel ?? "LOW") as "LOW" | "MED" | "HIGH",
      orderType: mapStaffOrderTypeToAutopilotType(order.orderType),
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


  
  useEffect(() => {
    evaluateOrders(autopilotOrders);
  }, [autopilotOrders, evaluateOrders]);

  if (loading) {
    return <div className="min-h-screen bg-neutral-50 p-6">Loading restaurant orders...</div>;
  }

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900">
      <div className="mx-auto max-w-6xl px-4 py-6 md:px-6 md:py-8">
        <div className="space-y-6">
          <section className="rounded-[28px] border border-neutral-200 bg-white p-6 shadow-sm md:p-8">
            <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.18em] text-red-600">
                  Valsentra Restaurant
                </p>
                <h1 className="mt-2 text-3xl font-bold tracking-tight md:text-4xl">
                  Staff Operations
                </h1>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-neutral-600 md:text-base">
                  Smart protection underneath, simple actions on top.
                </p>
              </div>


              <div className="flex flex-wrap items-center gap-3">
                <div className="rounded-2xl border border-neutral-300 bg-white px-4 py-2">
                  <label className="block text-[10px] font-semibold uppercase tracking-[0.14em] text-neutral-500">
                    Current staff
                  </label>
                  <select
                    value={currentStaffId}
                    onChange={(e) => handleStaffChange(e.target.value)}
                    className="mt-1 bg-transparent text-sm font-semibold text-neutral-900 outline-none"
                  >
                    {staffMembers.map((staff) => (
                      <option key={staff.id} value={staff.id}>
                        {staff.name} · {staff.role}
                      </option>
                    ))}
                  </select>
                </div>

                <button
                  onClick={runAutopilotNow}
                  disabled={saving}
                  className="rounded-2xl border border-green-300 bg-green-50 px-5 py-3 text-sm font-medium text-green-700 hover:bg-green-100 disabled:opacity-50"
                >
                  {saving ? "Running..." : "Run Autopilot"}
                </button>
<button
  onClick={async () => {
    const confirmReset = confirm(
      "Reset demo data? This will clear all current orders."
    );
    if (!confirmReset) return;

    try {
      const res = await fetch("/api/demo/reset", {
        method: "POST",
      });

      const data = await res.json();

      if (!res.ok) {
        alert(data.error || "Reset failed");
        return;
      }

      alert("Demo data reset successfully");
      window.location.reload();
    } catch (err) {
      alert("Something went wrong");
      console.error(err);
    }
  }}
  className="rounded-2xl border border-blue-300 bg-blue-50 px-5 py-3 text-sm font-medium text-blue-700 hover:bg-blue-100"
>
  Reset Demo Data
</button>

                <button
                  onClick={() => {
                    setActiveStaffTab("today");
                    setQuickAddOpen((prev) => !prev);
                  }}
                  className="rounded-2xl bg-black px-5 py-3 text-sm font-medium text-white"
                >
                  {quickAddOpen ? "Close Quick Add" : "Quick Add"}
                </button>

                <Link
                  href="/restaurant/owner"
                  className="rounded-2xl border border-neutral-300 bg-white px-5 py-3 text-sm font-medium text-neutral-900"
                >
                  Owner View
                </Link>
              </div>
            </div>
          </section>

          <section className="grid gap-4 md:grid-cols-4">
            <TopCard
              title="Revenue Protected"
              value={formatCurrency(metrics.revenueProtected)}
              subtitle="Deposits and paid revenue secured"
            />
            <TopCard
              title="Revenue At Risk"
              value={formatCurrency(metrics.revenueAtRisk)}
              subtitle="What is still due now"
            />
            <TopCard
              title="Blocked Orders"
              value={String(metrics.blockedOrders)}
              subtitle="Do not release yet"
            />
            <TopCard
              title="Collapse Watch"
              value={String(metrics.collapseWatch)}
              subtitle="At-risk or critical bookings"
            />
          </section>

          <div className="sticky top-0 z-20 -mx-4 border-y border-neutral-200/70 bg-neutral-50/90 px-4 py-3 backdrop-blur md:-mx-6 md:px-6">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex gap-2 overflow-x-auto pb-1">
                {STAFF_TABS.map((tab) => {
                  const selected = activeStaffTab === tab.id;

                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setActiveStaffTab(tab.id)}
                      className={`min-w-fit rounded-full border px-4 py-2 text-sm font-semibold transition ${
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

              <div className="grid gap-2 text-xs text-neutral-600 md:grid-cols-4 lg:min-w-[520px]">
                <div className="rounded-2xl border border-neutral-200 bg-white/80 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-neutral-500">Needs Action</span>
                    <span className="font-semibold text-neutral-950">{staffAttentionItems.length}</span>
                  </div>
                  <p className="mt-1 text-[11px] text-neutral-400">Staff guidance items</p>
                </div>
                <div className="rounded-2xl border border-neutral-200 bg-white/80 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-neutral-500">Unsafe Orders</span>
                    <span className="font-semibold text-neutral-950">{metrics.blockedOrders}</span>
                  </div>
                  <p className="mt-1 text-[11px] text-neutral-400">Blocked until cleared</p>
                </div>
                <div className="rounded-2xl border border-neutral-200 bg-white/80 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-neutral-500">Payment Issues</span>
                    <span className="font-semibold text-neutral-950">{staffPaymentTruth.unpaid.length + staffPaymentTruth.pending.length + staffPaymentTruth.blocked.length}</span>
                  </div>
                  <p className="mt-1 text-[11px] text-neutral-400">Unpaid, pending, blocked</p>
                </div>
                <div className="rounded-2xl border border-neutral-200 bg-white/80 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-neutral-500">Recovered Setup</span>
                    <span className="font-semibold text-neutral-950">{staffPaymentTruth.awaitingSetup.length}</span>
                  </div>
                  <p className="mt-1 text-[11px] text-neutral-400">Draft orders needing details</p>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-[24px] border border-neutral-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-neutral-500">
              {STAFF_TABS.find((tab) => tab.id === activeStaffTab)?.label}
            </p>
            <p className="mt-1 text-sm text-neutral-600">
              {STAFF_TABS.find((tab) => tab.id === activeStaffTab)?.description}
            </p>
          </div>

          <div className={activeStaffTab === "today" ? "space-y-6" : "hidden"}>
          <section className="rounded-[28px] border border-yellow-200 bg-yellow-50 p-5 shadow-sm md:p-6">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.16em] text-yellow-700">
                  Staff Assistant
                </p>
                <h2 className="mt-1 text-xl font-semibold tracking-tight text-yellow-950">
                  What needs attention now
                </h2>
                <p className="mt-1 text-sm text-yellow-800">
                  Valsentra highlights the orders staff should handle first.
                </p>
              </div>

              <div className="rounded-2xl border border-yellow-200 bg-white px-4 py-3 text-right">
                <p className="text-2xl font-bold text-yellow-900">{staffAttentionItems.length}</p>
                <p className="mt-1 text-xs font-medium text-yellow-700">
                  guidance item{staffAttentionItems.length === 1 ? "" : "s"}
                </p>
              </div>
            </div>

            {staffAttentionItems.length > 0 ? (
              <ul className="mt-4 grid gap-2 text-sm text-yellow-900 md:grid-cols-2">
                {staffAttentionItems.map((item, index) => (
                  <li key={index} className="rounded-2xl border border-yellow-200 bg-white px-4 py-3">
                    {item}
                  </li>
                ))}
              </ul>
            ) : (
              <div className="mt-4 rounded-2xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
                Everything looks clear right now. No urgent staff action needed.
              </div>
            )}
          </section>

          <section className="rounded-[28px] border border-neutral-200 bg-white p-5 shadow-sm md:p-6">
            <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.16em] text-red-600">
                  Unsafe Orders
                </p>
                <h2 className="mt-1 text-xl font-semibold tracking-tight">
                  Handle these before normal prep
                </h2>
              </div>
              <span className="rounded-full border border-neutral-200 bg-neutral-50 px-3 py-1 text-xs font-semibold text-neutral-600">
                {staffRiskQueue.length} order{staffRiskQueue.length === 1 ? "" : "s"}
              </span>
            </div>

            {staffRiskQueue.length === 0 ? (
              <div className="rounded-2xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
                No unsafe active orders right now.
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {staffRiskQueue.slice(0, 6).map((order, index) => (
                  <article key={orderRenderKey("today-unsafe-order", order, index)} className="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-red-950">{order.customerName}</p>
                      <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${paymentBadgeClasses(order.paymentState)}`}>
                        {order.paymentState ?? "UNPAID"}
                      </span>
                      {order.collapseRiskTier ? (
                        <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${collapseRiskBadgeClasses(order.collapseRiskTier)}`}>
                          {order.collapseRiskTier}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-2 text-red-800">
                      {order.id} · {formatCurrency(order.amount)} · {getProtectionStatus(order)}
                    </p>
                  </article>
                ))}
              </div>
            )}
          </section>

          </div>

          <div className={activeStaffTab === "autopilot" ? "space-y-6" : "hidden"}>
          <OperationalTimeline compact initialEvents={audit} />
          <section className="rounded-[28px] border border-neutral-200 bg-white p-5 shadow-sm md:p-6">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.16em] text-green-700">
                  Autopilot Feed
                </p>
                <h2 className="mt-1 text-xl font-semibold tracking-tight text-neutral-950">
                  What Valsentra handled for staff
                </h2>
                <p className="mt-1 text-sm text-neutral-600">
                  Audit-backed timeline of automatic actions, staff actions, and revenue protection events.
                </p>
              </div>

              <div className="rounded-2xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-right">
                <p className="text-2xl font-bold text-neutral-900">{autopilotFeedItems.length}</p>
                <p className="mt-1 text-xs font-medium text-neutral-500">
                  event{autopilotFeedItems.length === 1 ? "" : "s"}
                </p>
              </div>
            </div>

            {autopilotFeedItems.length > 0 ? (
              <div className="mt-4 grid gap-3">
                {autopilotFeedItems.slice(0, 8).map((item) => (
                  <div
                    key={item.id}
                    className={`rounded-2xl border px-4 py-3 ${getAutopilotFeedClasses(item.status)}`}
                  >
                    <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                      <div>
                        <p className="text-sm font-semibold">{item.title}</p>
                        <p className="mt-1 text-sm opacity-80">{item.detail}</p>
                      </div>

                      <div className="shrink-0 text-left md:text-right">
                        <p className="text-xs font-semibold uppercase tracking-[0.12em] opacity-70">
                          {item.status}
                        </p>
                        <p className="mt-1 text-xs opacity-70">{item.timeLabel}</p>
                        <p className="mt-1 text-xs opacity-70">
                          {item.staff} · {item.orderId}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-4 rounded-2xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-600">
                No autopilot or audit activity yet. Run Autopilot or handle an order to generate the feed.
              </div>
            )}
          </section>
          </div>

          <div className={activeStaffTab === "today" ? "space-y-6" : "hidden"}>
          {quickAddOpen && (
            <section className="rounded-[28px] border border-neutral-200 bg-white p-6 shadow-sm md:p-8">
              <div className="mb-5">
                <h2 className="text-2xl font-semibold tracking-tight">Quick Add Order</h2>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                {SHOW_DEV_ORDER_ID_OVERRIDE ? (
                  <input
                    className="rounded-2xl border border-neutral-300 px-4 py-3 text-sm outline-none focus:border-neutral-500 md:col-span-2"
                    placeholder="Development order ID override, e.g. DEV-AUTO-WHATSAPP-001"
                    value={quickAdd.idOverride}
                    onChange={(e) => setQuickAdd({ ...quickAdd, idOverride: e.target.value })}
                  />
                ) : null}
                <input
                  className="rounded-2xl border border-neutral-300 px-4 py-3 text-sm outline-none focus:border-neutral-500"
                  placeholder="Customer name"
                  value={quickAdd.customerName}
                  onChange={(e) => setQuickAdd({ ...quickAdd, customerName: e.target.value })}
                />
                <input
                  className="rounded-2xl border border-neutral-300 px-4 py-3 text-sm outline-none focus:border-neutral-500"
                  placeholder="Phone"
                  value={quickAdd.phone}
                  onChange={(e) => setQuickAdd({ ...quickAdd, phone: e.target.value })}
                />
                <input
                  className="rounded-2xl border border-neutral-300 px-4 py-3 text-sm outline-none focus:border-neutral-500"
                  placeholder="Amount"
                  value={quickAdd.amount}
                  onChange={(e) => setQuickAdd({ ...quickAdd, amount: e.target.value })}
                />
                {quickAdd.orderType === "DINE_IN_RESERVATION" ? (
                  <div className="rounded-2xl border border-neutral-300 bg-white px-4 py-3">
                    <label className="block text-xs font-semibold uppercase tracking-[0.12em] text-neutral-500">
                      Guests / Pax
                    </label>
                    <input
                      type="number"
                      min="1"
                      className="mt-1 w-full bg-transparent text-sm outline-none"
                      placeholder={`Deposit starts at ${settings?.dineInDepositGuestsThreshold ?? 0} guests`}
                      value={quickAdd.guests}
                      onChange={(e) => setQuickAdd({ ...quickAdd, guests: e.target.value })}
                    />
                    <p className="mt-1 text-xs text-neutral-500">
                      Used by owner rules to decide if a dine-in deposit is required.
                    </p>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-500">
                    Guest count is only used for dine-in bookings. Pickup / delivery defaults to 1.
                  </div>
                )}
                <div
                  className={`md:col-span-2 rounded-[24px] border p-4 ${
                    quickAddTimeError ? "border-red-200 bg-red-50" : "border-neutral-200 bg-neutral-50"
                  }`}
                >
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-neutral-500">
                        Service Flow Placement
                      </p>
                      <h3 className="mt-1 text-base font-semibold text-neutral-950">
                        Place this order into an operational slot
                      </h3>
                    </div>
                    <p className="text-xs font-medium text-neutral-500">
                      {formatServiceDateKey(selectedServiceDate)}
                    </p>
                  </div>

                  <div className="mt-4 space-y-4">
                    <div>
                      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-neutral-500">
                        Service day
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {SERVICE_DATE_PRESETS.map((preset) => {
                          const active = quickAdd.serviceDatePreset === preset.id;

                          return (
                            <button
                              key={preset.id}
                              type="button"
                              onClick={() => {
                                setQuickAdd({
                                  ...quickAdd,
                                  serviceDatePreset: preset.id,
                                });
                                setQuickAddTimeError("");
                              }}
                              className={`rounded-full border px-3 py-2 text-sm font-medium transition ${
                                active
                                  ? "border-neutral-950 bg-neutral-950 text-white"
                                  : "border-neutral-200 bg-white text-neutral-700 hover:border-neutral-300"
                              }`}
                            >
                              {preset.label}
                            </button>
                          );
                        })}
                      </div>
                      {quickAdd.serviceDatePreset === "CUSTOM" ? (
                        <input
                          type="date"
                          className="mt-3 w-full rounded-2xl border border-neutral-300 bg-white px-4 py-3 text-sm outline-none focus:border-neutral-500 sm:max-w-xs"
                          value={quickAdd.customServiceDate}
                          onChange={(e) => {
                            setQuickAdd({ ...quickAdd, customServiceDate: e.target.value });
                            setQuickAddTimeError("");
                          }}
                        />
                      ) : null}
                    </div>

                    <div>
                      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-neutral-500">
                        Service period
                      </p>
                      <div className="grid gap-2 sm:grid-cols-4">
                        {SERVICE_PERIODS.map((period) => {
                          const active = quickAdd.servicePeriod === period.id;

                          return (
                            <button
                              key={period.id}
                              type="button"
                              onClick={() => {
                                const nextSlots =
                                  period.id === "CUSTOM" ? [] : SERVICE_SLOTS[period.id];
                                setQuickAdd({
                                  ...quickAdd,
                                  servicePeriod: period.id,
                                  selectedSlotId: nextSlots[0]?.id ?? "",
                                  manualReservationTime: "",
                                });
                                setQuickAddTimeError("");
                              }}
                              className={`rounded-2xl border px-3 py-3 text-left transition ${
                                active
                                  ? "border-neutral-950 bg-white shadow-sm"
                                  : "border-neutral-200 bg-white text-neutral-700 hover:border-neutral-300"
                              }`}
                            >
                              <span className="block text-sm font-semibold">{period.label}</span>
                              <span className="mt-1 block text-xs text-neutral-500">{period.helper}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {serviceSlots.length > 0 ? (
                      <div>
                        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-neutral-500">
                          Operational slot
                        </p>
                        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
                          {serviceSlots.map((slot) => {
                            const active =
                              !quickAdd.manualReservationTime.trim() &&
                              quickAdd.selectedSlotId === slot.id;
                            const intelligenceLabel = getSlotIntelligence(
                              orders,
                              selectedServiceDate,
                              slot,
                              recoveredOrderCountForSlots
                            );

                            return (
                              <button
                                key={`${quickAdd.servicePeriod}-${selectedServiceDate}-${slot.id}`}
                                type="button"
                                onClick={() => {
                                  setQuickAdd({
                                    ...quickAdd,
                                    selectedSlotId: slot.id,
                                    manualReservationTime: "",
                                  });
                                  setQuickAddTimeError("");
                                }}
                                className={`rounded-2xl border px-4 py-3 text-left transition ${
                                  active
                                    ? "border-neutral-950 bg-neutral-950 text-white shadow-sm"
                                    : "border-neutral-200 bg-white text-neutral-900 hover:border-neutral-300"
                                }`}
                              >
                                <span className="block text-sm font-semibold">{slot.label}</span>
                                <span
                                  className={`mt-2 inline-flex rounded-full px-2 py-1 text-[11px] font-semibold ${
                                    active
                                      ? "bg-white/15 text-white"
                                      : intelligenceLabel === "Watch"
                                        ? "bg-orange-50 text-orange-700"
                                        : intelligenceLabel === "High demand"
                                          ? "bg-yellow-50 text-yellow-700"
                                          : "bg-neutral-100 text-neutral-600"
                                  }`}
                                >
                                  {intelligenceLabel}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}

                    <div className="rounded-2xl border border-neutral-200 bg-white px-4 py-3">
                      <label className="block text-xs font-semibold uppercase tracking-[0.14em] text-neutral-500">
                        Type time manually
                      </label>
                      <input
                        className="mt-2 w-full bg-transparent text-sm outline-none"
                        placeholder="Reservation time, e.g. 8:30pm or 20:30"
                        value={quickAdd.manualReservationTime}
                        onChange={(e) => {
                          const value = e.target.value;
                          setQuickAdd({
                            ...quickAdd,
                            manualReservationTime: value,
                            selectedSlotId: value.trim() ? "" : quickAdd.selectedSlotId,
                          });
                          if (!value.trim()) {
                            setQuickAddTimeError("");
                            return;
                          }
                          const parsed = parseReservationTimeForServiceDate(
                            value,
                            selectedServiceDate,
                            quickAdd.servicePeriod
                          );
                          setQuickAddTimeError(
                            parsed.ok
                              ? ""
                              : parsed.error === SERVICE_PERIOD_AMBIGUOUS_TIME_MESSAGE
                                ? "Select a service period or include AM/PM."
                                : parsed.error
                          );
                        }}
                      />
                      <p className="mt-2 text-xs text-neutral-500">
                        Manual times use the selected service day. Ambiguous times need AM/PM or a resolvable service period.
                      </p>
                    </div>

                    <div className="rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm">
                      <span className="font-semibold text-neutral-900">Canonical reservation:</span>{" "}
                      <span className={selectedReservationTime.ok ? "text-neutral-700" : "text-neutral-500"}>
                        {selectedReservationTime.ok
                          ? getSafeOrderDateTime(selectedReservationTime.reservationTime)
                          : "Choose a slot or type a valid time"}
                      </span>
                    </div>
                  </div>
                </div>
                {quickAddTimeError ? (
                  <p className="md:col-span-2 text-sm font-medium text-red-700">
                    {quickAddTimeError}
                  </p>
                ) : null}
                <input
                  className="rounded-2xl border border-neutral-300 px-4 py-3 text-sm outline-none focus:border-neutral-500 md:col-span-2"
                  placeholder="Order summary"
                  value={quickAdd.itemSummary}
                  onChange={(e) => setQuickAdd({ ...quickAdd, itemSummary: e.target.value })}
                />
                <select
                  className="rounded-2xl border border-neutral-300 px-4 py-3 text-sm outline-none focus:border-neutral-500 md:col-span-2"
                  value={quickAdd.orderType}
                  onChange={(e) => {
                    const nextOrderType = e.target.value as OrderType;
                    setQuickAdd({
                      ...quickAdd,
                      orderType: nextOrderType,
                      guests:
                        nextOrderType === "DINE_IN_RESERVATION"
                          ? quickAdd.guests || "2"
                          : "1",
                    });
                  }}
                >
                  <option value="DINE_IN_RESERVATION">Dine-In Reservation</option>
                  <option value="PREORDER_PICKUP">Pickup</option>
                  <option value="DELIVERY_PREORDER">Delivery</option>
                </select>
              </div>



              <button
                onClick={addQuickOrder}
                disabled={saving}
                className="mt-5 rounded-2xl bg-black px-5 py-3 text-sm font-medium text-white disabled:opacity-50"
              >
                {saving ? "Saving..." : "Add Order"}
              </button>
            </section>
          )}
          </div>

          <div className={activeStaffTab === "payment" ? "space-y-6" : "hidden"}>
            <section className="rounded-[28px] border border-neutral-200 bg-white p-6 shadow-sm md:p-8">
              <div className="mb-5">
                <p className="text-sm font-semibold uppercase tracking-[0.16em] text-red-600">
                  Payment Truth
                </p>
                <h2 className="mt-1 text-2xl font-semibold tracking-tight">
                  Which orders are safe to release?
                </h2>
                <p className="mt-2 text-sm text-neutral-600">
                  Staff can scan payment state here. Use the Orders tab for the full action controls.
                </p>
              </div>

              <div className="grid gap-4 md:grid-cols-4">
                <TopCard title="Unpaid" value={String(staffPaymentTruth.unpaid.length)} subtitle="No verified payment yet" />
                <TopCard title="Pending" value={String(staffPaymentTruth.pending.length)} subtitle="Link/screenshot awaiting review" />
                <TopCard title="Verified" value={String(staffPaymentTruth.verified.length)} subtitle="Safe payment state" />
                <TopCard title="Blocked" value={String(staffPaymentTruth.blocked.length)} subtitle="Do not release" />
              </div>

              <div className="mt-5 grid gap-4 lg:grid-cols-2">
                <PaymentTruthList title="Unpaid / Pending" orders={[...staffPaymentTruth.unpaid, ...staffPaymentTruth.pending]} />
                <PaymentTruthList title="Blocked / Fraud Signals" orders={staffPaymentTruth.blocked} danger />
              </div>
            </section>
          </div>

          <div className={activeStaffTab === "orders" ? "space-y-6" : "hidden"}>
          <section className="rounded-[28px] border border-neutral-200 bg-white p-6 shadow-sm md:p-8">
            <div className="mb-5">
              <h2 className="text-2xl font-semibold tracking-tight">Active Orders</h2>
            </div>

            <div className="space-y-5">
              {activeOrders.map((order, index) => {
                const blocked = isBlocked(order);
                const needsSetup = needsRecoveredSetup(order);
                const staffGuidance = getStaffGuidance(order);
                const agentDecision = agentDecisionByOrderId.get(order.id);
                const autonomousRecovery = autonomousRecoveryByOrderId.get(order.id);
                const operationalSimulation = operationalSimulationByOrderId.get(order.id);
                const shouldShowAgentDecision =
                  Boolean(agentDecision) &&
                  (blocked ||
                    order.status === "UNPAID" ||
                    order.status === "PAYMENT_SENT" ||
                    order.paymentState === "UNPAID" ||
                    order.paymentState === "PENDING" ||
                    order.collapseRiskTier === "CRITICAL" ||
                    order.collapseRiskTier === "AT_RISK");
                const reminderLink = buildWhatsAppLink(
                  order.phone,
                  `Hi ${order.customerName}, your order ${order.id} is currently ${order.status}. Please complete payment or reply if you need help.`
                );

                return (
                  <article
                    key={orderRenderKey("orders-active-order", order, index)}
                    className={`rounded-[24px] border p-5 md:p-6 ${
                      blocked ? "border-red-200 bg-red-50" : "border-neutral-200 bg-neutral-50/50"
                    }`}
                  >
                    <div className="flex flex-col gap-6 lg:flex-row lg:justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-xl font-semibold tracking-tight">
                            {order.customerName}
                          </h3>

                          <span className="rounded-full border border-neutral-200 bg-white px-3 py-1 text-xs font-semibold text-neutral-700">
                            {order.id}
                          </span>

                          <span
                            className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusBadgeClasses(
                              order.status
                            )}`}
                          >
                            {order.status}
                          </span>

                          <span
                            className={`rounded-full border px-3 py-1 text-xs font-semibold ${paymentBadgeClasses(
                              order.paymentState
                            )}`}
                          >
                            {order.paymentState ?? "PENDING"}
                          </span>

                          <span
                            className={`rounded-full border px-3 py-1 text-xs font-semibold ${riskBadgeClasses(
                              (order.riskLevel ?? "LOW") as RiskLevel
                            )}`}
                          >
                            {(order.riskLevel ?? "LOW")} RISK
                          </span>

                          {order.collapseRiskTier && (
                            <span
                              className={`rounded-full border px-3 py-1 text-xs font-semibold ${collapseRiskBadgeClasses(
                                order.collapseRiskTier
                              )}`}
                            >
                              {order.collapseRiskTier} COLLAPSE · {order.collapseProbability ?? 0}%
                            </span>
                          )}

                          {isBlacklisted(order.reliabilityScore) && (
                            <span className="rounded-full bg-red-700 px-3 py-1 text-xs font-semibold text-white">
                              BLACKLISTED
                            </span>
                          )}
                        </div>

                        {typeof order.collapseProbability === "number" && (
                          <div
                            className={`mt-4 rounded-2xl border p-4 ${collapsePanelClasses(
                              order.collapseRiskTier
                            )}`}
                          >
                            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                              <div>
                                <p className="text-xs font-semibold uppercase tracking-[0.14em] opacity-70">
                                  Collapse Probability Engine
                                </p>
                                <p className="mt-1 text-lg font-semibold">
                                  {order.collapseProbability}% collapse probability
                                </p>
                                <p className="mt-1 text-sm opacity-80">
                                  {order.collapseExplanation ||
                                    "Valsentra is monitoring this booking for instability."}
                                </p>
                              </div>

                              <div className="rounded-2xl border border-white/70 bg-white/70 px-4 py-3 text-left shadow-sm md:w-[220px]">
                                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-neutral-500">
                                  AI intervention
                                </p>
                                <p className="mt-1 text-sm font-semibold text-neutral-950">
                                  {interventionLabel(order.recommendedIntervention)}
                                </p>
                              </div>
                            </div>

                            <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/70">
                              <div
                                className={`h-full rounded-full ${collapseMeterClasses(order.collapseRiskTier)}`}
                                style={{ width: `${Math.min(Math.max(order.collapseProbability, 0), 100)}%` }}
                              />
                            </div>

                            {order.instabilityFactors && order.instabilityFactors.length > 0 && (
                              <div className="mt-3 flex flex-wrap gap-2">
                                {order.instabilityFactors.slice(0, 5).map((factor) => (
                                  <span
                                    key={factor}
                                    className="rounded-full border border-white/70 bg-white/70 px-3 py-1 text-xs font-medium text-neutral-800"
                                  >
                                    {factor}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        )}

                        {staffGuidance.length > 0 && (
                          <div className="mt-4 rounded-2xl border border-blue-200 bg-blue-50 p-4">
                            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-blue-600">
                              Staff guidance
                            </p>
                            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-blue-800">
                              {staffGuidance.map((item, index) => (
                                <li key={index}>{item}</li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {shouldShowAgentDecision ? (
                          <div className="mt-4">
                            <AgentDecisionPanel decision={agentDecision} compact />
                          </div>
                        ) : null}

                        {operationalSimulation && shouldShowAgentDecision ? (
                          <div className="mt-4">
                            <OperationalSimulationPanel simulation={operationalSimulation} compact />
                          </div>
                        ) : null}

                        {autonomousRecovery ? (
                          <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                              <div>
                                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-700">
                                  Autonomous recovery state
                                </p>
                                <p className="mt-1 text-sm font-semibold text-emerald-950">
                                  {autonomousRecovery.autonomousRecoveryAction?.recoveryStateTransition?.to?.replaceAll("_", " ") ??
                                    autonomousRecovery.autonomousRecoveryAction?.actionType?.replaceAll("_", " ") ??
                                    "Recovery monitored"}
                                </p>
                                <p className="mt-1 text-sm leading-6 text-emerald-800">
                                  {autonomousRecovery.autonomousRecoveryAction?.operationalImpact ??
                                    "Valsentra recorded a safe autonomous recovery signal for this order."}
                                </p>
                              </div>
                              <div className="grid gap-2 text-xs md:w-[220px]">
                                <span className="rounded-full border border-emerald-200 bg-white px-3 py-1.5 font-semibold text-emerald-700">
                                  Safety {autonomousRecovery.autonomousRecoveryDiagnostics?.safetyScore ?? 0}/100
                                </span>
                                <span className="rounded-full border border-emerald-200 bg-white px-3 py-1.5 font-semibold text-emerald-700">
                                  Recovery {autonomousRecovery.autonomousRecoveryDiagnostics?.recoveryConfidence ?? 0}/100
                                </span>
                                {autonomousRecovery.autonomousRecoveryAction?.recommendedStaffReview ? (
                                  <span className="rounded-full border border-amber-200 bg-white px-3 py-1.5 font-semibold text-amber-700">
                                    Staff review still required
                                  </span>
                                ) : null}
                              </div>
                            </div>
                          </div>
                        ) : null}

                        <div className="mt-4 grid gap-2 text-sm text-neutral-700 md:grid-cols-2">
                          <p>
                            <span className="font-medium text-neutral-900">Order made:</span>{" "}
                            {getSafeOrderDateTime(order.createdAt ?? order.reservationTime)}
                          </p>
                          <p>
                            <span className="font-medium text-neutral-900">Type:</span>{" "}
                            {getOrderTypeLabel(order.orderType)}
                          </p>
                          <p>
                            <span className="font-medium text-neutral-900">Guests / Pax:</span>{" "}
                            {order.orderType === "DINE_IN_RESERVATION" ? order.guests : "N/A"}
                          </p>
                          <p>
                            <span className="font-medium text-neutral-900">Total amount:</span>{" "}
                            {formatCurrency(order.amount)}
                          </p>
                          <p>
                            <span className="font-medium text-neutral-900">
                              Deposit amount:
                            </span>{" "}
                            {formatCurrency(getEffectiveDepositAmount(order))}
                          </p>
                          <p>
                            <span className="font-medium text-neutral-900">Due now:</span>{" "}
                            {formatCurrency(getAmountDueNow(order))}
                          </p>
                          <p>
                            <span className="font-medium text-neutral-900">
                              Payment step:
                            </span>{" "}
                            {getPaymentStageLabel(order)}
                          </p>
                          <p>
                            <span className="font-medium text-neutral-900">
                              Reliability:
                            </span>{" "}
                            {order.reliabilityScore}%
                          </p>
                          <p>
                            <span className="font-medium text-neutral-900">Verified:</span>{" "}
                            {order.paymentVerified ? "Yes" : "No"}
                          </p>
                          <p>
                            <span className="font-medium text-neutral-900">Autopilot:</span>{" "}
                            <span className={getAutopilotTone(getAutopilotStatus(order))}>
                              {getAutopilotStatus(order)}
                            </span>
                          </p>
                        </div>

                        <div className="mt-4 rounded-2xl border border-neutral-200 bg-white px-4 py-3">
                          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-neutral-500">
                            Protection
                          </p>
                          <div className="mt-1 flex items-center gap-2">
                            <p className={`text-base font-semibold ${getProtectionTone(order)}`}>
                              {getProtectionStatus(order)}
                            </p>

                            {blocked && getBlockReasons(order).length > 0 && (
                              <div className="group relative inline-flex">
                                <span className="flex h-5 w-5 cursor-help items-center justify-center rounded-full border border-neutral-300 bg-white text-[11px] font-semibold text-neutral-600">
                                  i
                                </span>
                                <div className="pointer-events-none absolute left-0 top-7 z-20 hidden w-64 rounded-xl bg-neutral-900 p-3 text-xs text-white shadow-lg group-hover:block">
                                  <p className="font-semibold">Why blocked</p>
                                  <ul className="mt-2 list-disc space-y-1 pl-4">
                                    {getBlockReasons(order).map((reason, index) => (
                                      <li key={index}>{reason}</li>
                                    ))}
                                  </ul>
                                </div>
                              </div>
                            )}
                          </div>
                          <p className="mt-1 text-sm text-neutral-500">
                            {order.protectionReason || "Standard protection"}
                          </p>
                        </div>

                        {order.terminalMismatch && (
                          <div className="mt-4 rounded-2xl border border-red-200 bg-white p-4 text-sm text-red-700">
                            Terminal mismatch detected. Expected payment does not match entered amount.
                          </div>
                        )}

                        {blocked && !order.terminalMismatch && (
                          <div className="mt-4 rounded-2xl border border-red-200 bg-white p-4 text-sm text-red-700">
                            Do not prepare or release until the current payment step is verified.
                          </div>
                        )}

                        {blocked && getBlockReasons(order).length > 0 && (
                          <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4">
                            <p className="text-sm font-semibold text-red-700">
                              Blocked because:
                            </p>
                            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-red-600">
                              {getBlockReasons(order).map((reason, index) => (
                                <li key={index}>{reason}</li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {needsSetup && (
                          <div className="mt-4 rounded-2xl border border-yellow-200 bg-yellow-50 p-4 text-sm text-yellow-800">
                            This recovered waitlist order needs its real amount and summary before payment actions can continue.
                          </div>
                        )}
                      </div>

                      <div className="w-full lg:w-[220px]">
                        <div className="grid gap-2">
                          {needsSetup && (
                            <button
                              type="button"
                              onClick={() => openRecoveredOrderSetup(order)}
                              className="rounded-2xl bg-blue-600 px-4 py-3 text-sm font-medium text-white"
                            >
                              Setup Order
                            </button>
                          )}

                          <button
                            onClick={() => sendPaymentLink(order)}
                            disabled={saving || needsSetup}
                            className="rounded-2xl border border-neutral-300 bg-white px-4 py-3 text-center text-sm font-medium text-neutral-900 disabled:opacity-50"
                          >
                            Payment Link
                          </button>

                          <button
                            type="button"
                            onClick={() => submitPaymentScreenshot(order.id)}
                            disabled={saving || needsSetup}
                            className="rounded-2xl border border-neutral-300 bg-white px-4 py-3 text-center text-sm font-medium text-neutral-900 disabled:opacity-50"
                          >
                            Screenshot Submitted
                          </button>

                          <button
                            type="button"
                            disabled={needsSetup}
                            className="rounded-2xl border border-neutral-300 bg-white px-4 py-3 text-center text-sm font-medium text-neutral-900 disabled:opacity-50"
                            onClick={() => {
                              if (needsSetup) return;
                              window.open(reminderLink, "_blank", "noreferrer");
                              logAudit("Sent WhatsApp reminder", currentStaffName, order.id);
                            }}
                          >
                            WhatsApp Reminder
                          </button>

                          <button
                            type="button"
                            onClick={() => verifyAndMarkPaid(order.id)}
                            disabled={saving || needsSetup}
                            className="rounded-2xl bg-green-600 px-4 py-3 text-sm font-medium text-white disabled:opacity-50"
                          >
                            Verify Payment
                          </button>

                          <button
                            type="button"
                            onClick={() => markNoShow(order.id)}
                            disabled={saving}
                            style={{
                              backgroundColor: "#f97316",
                              color: "#ffffff",
                              padding: "12px 16px",
                              borderRadius: "16px",
                              fontSize: "14px",
                              fontWeight: 500,
                              border: "none",
                              width: "100%",
                              display: "block",
                              opacity: saving ? 0.5 : 1,
                            }}
                          >
                            No Show
                          </button>

                          <button
                            type="button"
                            onClick={() => markCancelled(order.id)}
                            disabled={saving}
                            className="rounded-2xl bg-black px-4 py-3 text-sm font-medium text-white disabled:opacity-50"
                          >
                            Cancel Order
                          </button>
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
          </div>

          <div className={activeStaffTab === "recovery" ? "space-y-6" : "hidden"}>
            <section className="rounded-[28px] border border-neutral-200 bg-white p-6 shadow-sm md:p-8">
              <div className="mb-5">
                <p className="text-sm font-semibold uppercase tracking-[0.16em] text-green-700">
                  Recovery Workspace
                </p>
                <h2 className="mt-1 text-2xl font-semibold tracking-tight">
                  Recovered orders and waitlist opportunities
                </h2>
                <p className="mt-2 text-sm text-neutral-600">
                  Recovered drafts need setup before payment actions. Closed orders can be offered to the waitlist.
                </p>
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                <TopCard title="Recovered Setup" value={String(staffPaymentTruth.awaitingSetup.length)} subtitle="Drafts needing amount/details" />
                <TopCard title="Closed Orders" value={String(closedOrders.length)} subtitle="Potential recovery source" />
                <TopCard title="Waitlist Leads" value={String(waitlist.length)} subtitle="Available replacement demand" />
              </div>
            </section>
          </div>

          <div className={activeStaffTab === "recovery" ? "space-y-6" : "hidden"}>
          <section className="rounded-[28px] border border-neutral-200 bg-white p-6 shadow-sm md:p-8">
            <div className="mb-5">
              <h2 className="text-2xl font-semibold tracking-tight">Closed Orders</h2>
            </div>

            <div className="space-y-4">
              {closedOrders.length === 0 ? (
                <div className="rounded-2xl border border-green-200 bg-green-50 p-4 text-sm text-green-700">
                  No closed orders right now.
                </div>
              ) : (
                closedOrders.map((order, index) => {
                  const recovery = getBestWaitlistLead(order);
                  const bestLead = recovery.bestLead;

                  return (
                    <article
                      key={orderRenderKey("recovery-closed-order", order, index)}
                      className="rounded-[24px] border border-neutral-200 bg-neutral-50 p-5 md:p-6"
                    >
                      <div className="flex flex-col gap-5 md:flex-row md:justify-between">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-lg font-semibold">{order.customerName}</h3>
                            <span
                              className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusBadgeClasses(
                                order.status
                              )}`}
                            >
                              {order.status}
                            </span>
                          </div>

                          <div className="mt-3 space-y-1 text-sm text-neutral-700">
                            <p>
                              <span className="font-medium text-neutral-900">
                                Cancelled order value:
                              </span>{" "}
                              {formatCurrency(order.amount)}
                            </p>
                            <p>
                              <span className="font-medium text-neutral-900">Type:</span>{" "}
                              {getOrderTypeLabel(order.orderType)}
                            </p>
                            <p>
                              <span className="font-medium text-neutral-900">Recovery:</span>{" "}
                              {bestLead
                                ? `Offer slot to ${bestLead.customerName}`
                                : "No suitable waitlist lead"}
                            </p>
                            <p>
                              <span className="font-medium text-neutral-900">
                                Recovery score:
                              </span>{" "}
                              {recovery.recoveryScore}
                            </p>
                            <p>
                              <span className="font-medium text-neutral-900">
                                Opportunity value:
                              </span>{" "}
                              {formatCurrency(recovery.recoverableRevenue)}
                            </p>
                            <p className="text-neutral-500">
                              Replacement orders are created as drafts. Staff must enter
                              the new customer’s real order value later.
                            </p>
                          </div>
                        </div>

                        {bestLead && (
                          <div className="flex flex-col gap-2 md:w-[260px]">
                            <a
                              href={buildWhatsAppLink(
                                bestLead.phone,
                                `Hi ${bestLead.customerName}, we just opened a ${getOrderTypeLabel(
                                  order.orderType
                                )} slot. Would you like it? We will confirm your actual order details after you reply.`
                              )}
                              target="_blank"
                              rel="noreferrer"
                              className="rounded-2xl border border-neutral-300 bg-white px-4 py-3 text-center text-sm font-medium text-neutral-900"
                            >
                              Offer to Waitlist
                            </a>

                            <button
                              type="button"
                              disabled={saving}
                              onClick={() => createRecoveredOrderFromLead(order, bestLead)}
                              className="rounded-2xl bg-black px-4 py-3 text-sm font-medium text-white disabled:opacity-50"
                            >
                              Confirm Waitlist Fill
                            </button>

                            <button
                              type="button"
                              disabled={saving}
                              onClick={async () => {
                                const res = await fetch("/api/waitlist/cascade", {
                                  method: "POST",
                                  headers: {
                                    "Content-Type": "application/json",
                                  },
                                  body: JSON.stringify({
                                    orderId: order.id,
                                    staffName: currentStaffName,
                                  }),
                                });

                                const data = await res.json();

                                if (!res.ok) {
                                  alert(data.error || "Cascade failed");
                                  return;
                                }

                                alert(
                                  data.lead?.customerName
                                    ? `Recovered with ${data.lead.customerName}`
                                    : data.message || "Waitlist cascade completed"
                                );

                                window.location.reload();
                              }}
                              className="rounded-2xl border border-green-300 bg-green-50 px-4 py-3 text-sm font-medium text-green-700 disabled:opacity-50"
                            >
                              Auto Fill Waitlist
                            </button>
                          </div>
                        )}
                      </div>
                    </article>
                  );
                })
              )}
            </div>
          </section>
          </div>


          {setupOrderId && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
              <div className="w-full max-w-lg rounded-[28px] border border-neutral-200 bg-white p-6 shadow-2xl">
                <h3 className="text-2xl font-semibold tracking-tight">Setup recovered order</h3>
                <p className="mt-2 text-sm text-neutral-600">
                  Enter the actual order amount and summary for this recovered waitlist customer.
                </p>

                <div className="mt-5 grid gap-3">
                  <input
                    type="number"
                    placeholder="Actual order amount (RM)"
                    value={setupAmount}
                    onChange={(e) => setSetupAmount(e.target.value)}
                    className="rounded-2xl border border-neutral-300 px-4 py-3 text-sm outline-none focus:border-neutral-500"
                  />

                  <input
                    type="text"
                    placeholder="Order summary"
                    value={setupSummary}
                    onChange={(e) => setSetupSummary(e.target.value)}
                    className="rounded-2xl border border-neutral-300 px-4 py-3 text-sm outline-none focus:border-neutral-500"
                  />
                </div>

                <div className="mt-5 flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={confirmRecoveredOrderSetup}
                    disabled={saving}
                    className="rounded-2xl bg-black px-5 py-3 text-sm font-medium text-white disabled:opacity-50"
                  >
                    {saving ? "Saving..." : "Confirm Setup"}
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setSetupOrderId(null);
                      setSetupAmount("");
                      setSetupSummary("");
                    }}
                    className="rounded-2xl border border-neutral-300 bg-white px-5 py-3 text-sm font-medium text-neutral-900"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

function PaymentTruthList({
  title,
  orders,
  danger,
}: {
  title: string;
  orders: RestaurantOrder[];
  danger?: boolean;
}) {
  return (
    <div className="rounded-[24px] border border-neutral-200 bg-neutral-50 p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-semibold text-neutral-950">{title}</h3>
        <span className="rounded-full border border-neutral-200 bg-white px-3 py-1 text-xs font-semibold text-neutral-600">
          {orders.length}
        </span>
      </div>

      <div className="mt-3 space-y-2">
        {orders.length === 0 ? (
          <div className="rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-600">
            Nothing in this state right now.
          </div>
        ) : (
          orders.slice(0, 8).map((order, index) => (
            <article
              key={orderRenderKey(`payment-truth-${title}`, order, index)}
              className={`rounded-2xl border px-4 py-3 text-sm ${
                danger ? "border-red-100 bg-red-50" : "border-neutral-200 bg-white"
              }`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-semibold text-neutral-950">{order.customerName}</p>
                <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${paymentBadgeClasses(order.paymentState)}`}>
                  {order.paymentState ?? "UNPAID"}
                </span>
                <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${statusBadgeClasses(order.status)}`}>
                  {order.status}
                </span>
              </div>
              <p className="mt-2 text-neutral-600">
                {order.id} · {formatCurrency(order.amount)} · Verified: {order.paymentVerified ? "Yes" : "No"}
              </p>
              {order.terminalMismatch ? (
                <p className="mt-1 text-xs font-semibold text-red-700">
                  Terminal mismatch detected
                </p>
              ) : null}
            </article>
          ))
        )}
      </div>
    </div>
  );
}

function TopCard({
  title,
  value,
  subtitle,
}: {
  title: string;
  value: string;
  subtitle: string;
}) {
  return (
    <div className="rounded-[24px] border border-neutral-200 bg-white p-5 shadow-sm">
      <p className="text-sm font-medium text-neutral-500">{title}</p>
      <p className="mt-2 text-3xl font-bold tracking-tight">{value}</p>
      <p className="mt-2 text-sm text-neutral-500">{subtitle}</p>
    </div>
  );
}
