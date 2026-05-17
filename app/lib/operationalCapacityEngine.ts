import { supabaseAdmin } from "@/app/lib/admin";
import { getOperationalJobSnapshot } from "@/app/lib/infrastructure/operationalJobEngine";
import {
  appendOperationalTimelineEvent,
  type OperationalTimelineEventType,
} from "@/app/lib/operationalTimelineMemoryEngine";
import { publishOperationalCommand } from "@/app/lib/operationalCommandBus";

export type OperationalPressureState =
  | "STABLE"
  | "ELEVATED"
  | "HIGH_PRESSURE"
  | "CRITICAL"
  | "COLLAPSE_RISK";

export type CapacitySignalType =
  | "ARRIVAL_PRESSURE"
  | "PAYMENT_PRESSURE"
  | "RECOVERY_PRESSURE"
  | "MESSAGE_PRESSURE"
  | "WORKER_PRESSURE"
  | "PROVIDER_PRESSURE"
  | "RISK_CONCENTRATION";

export type CapacitySignal = {
  type: CapacitySignalType;
  label: string;
  score: number;
  count: number;
  summary: string;
  recommendation: string;
  orderIds: string[];
};

export type OperationalCapacitySnapshot = {
  organizationId: string;
  locationId: string | null;
  state: OperationalPressureState;
  score: number;
  ownerSummary: string;
  staffGuidance: string[];
  safetyActions: string[];
  signals: CapacitySignal[];
  metrics: {
    arrivalsSoon: number;
    denseArrivalWindows: number;
    unpaidOrPending: number;
    blockedFulfillment: number;
    activeRecovery: number;
    unresolvedInbound: number;
    retryingJobs: number;
    delayedJobs: number;
    deadLetterJobs: number;
    providerFailures: number;
    highRiskOrders: number;
  };
  generatedAt: string;
};

type CapacityOrder = {
  id: string;
  locationId?: string | null;
  status?: string | null;
  paymentState?: string | null;
  paymentVerified?: boolean | null;
  terminalMismatch?: boolean | null;
  reservationTime?: string | null;
  riskLevel?: string | null;
  collapseRiskTier?: string | null;
  recoveryState?: string | null;
};

type AuditRow = {
  id?: string | number;
  action?: string | null;
  orderId?: string | null;
  createdAt?: string | null;
  meta?: Record<string, any> | null;
};

function clamp(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function minutesUntil(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return Math.round((date.getTime() - Date.now()) / 60_000);
}

function stateFromScore(score: number): OperationalPressureState {
  if (score >= 90) return "COLLAPSE_RISK";
  if (score >= 75) return "CRITICAL";
  if (score >= 58) return "HIGH_PRESSURE";
  if (score >= 34) return "ELEVATED";
  return "STABLE";
}

function activeOrder(order: CapacityOrder) {
  return order.status !== "CANCELLED" && order.status !== "NO_SHOW" && order.status !== "PAID";
}

function activeRecovery(order: CapacityOrder) {
  return (
    order.recoveryState === "OPEN_RECOVERY" ||
    order.recoveryState === "OFFER_SENT" ||
    order.recoveryState === "WAITING_RESPONSE"
  );
}

function isBlocked(order: CapacityOrder) {
  return (
    order.terminalMismatch ||
    order.paymentState === "BLOCKED" ||
    order.paymentState === "FAILED" ||
    (order.paymentState !== "VERIFIED" && order.paymentVerified === false && order.status !== "PAID")
  );
}

function highRisk(order: CapacityOrder) {
  return (
    order.riskLevel === "HIGH" ||
    order.collapseRiskTier === "CRITICAL" ||
    order.collapseRiskTier === "AT_RISK"
  );
}

function recent(row: AuditRow, minutes: number) {
  const time = row.createdAt ? new Date(row.createdAt).getTime() : NaN;
  return Number.isFinite(time) && Date.now() - time <= minutes * 60_000;
}

function buildSignal(input: CapacitySignal): CapacitySignal | null {
  if (input.score <= 0 && input.count <= 0) return null;
  return { ...input, score: clamp(input.score), orderIds: Array.from(new Set(input.orderIds)).slice(0, 12) };
}

export function evaluateOperationalCapacity({
  organizationId,
  locationId = null,
  orders,
  auditRows,
  jobSnapshot,
}: {
  organizationId: string;
  locationId?: string | null;
  orders: CapacityOrder[];
  auditRows: AuditRow[];
  jobSnapshot: {
    delayedJobs?: number;
    retries?: number;
    deadLetterJobs?: number;
    providerFailures?: number;
    queuePressure?: number;
  };
}): OperationalCapacitySnapshot {
  const scopedOrders = locationId
    ? orders.filter((order) => !order.locationId || order.locationId === locationId)
    : orders;
  const active = scopedOrders.filter(activeOrder);
  const arrivalsSoon = active.filter((order) => {
    const minutes = minutesUntil(order.reservationTime);
    return minutes !== null && minutes >= -10 && minutes <= 45;
  });
  const arrivalBuckets = new Map<string, string[]>();
  arrivalsSoon.forEach((order) => {
    const minutes = minutesUntil(order.reservationTime);
    if (minutes === null) return;
    const bucket = String(Math.floor(minutes / 15));
    arrivalBuckets.set(bucket, [...(arrivalBuckets.get(bucket) ?? []), order.id]);
  });
  const denseArrivalWindows = Array.from(arrivalBuckets.values()).filter((ids) => ids.length >= 4);

  const unpaidOrPending = active.filter((order) =>
    order.paymentState === "UNPAID" ||
    order.paymentState === "PENDING" ||
    order.status === "UNPAID" ||
    order.status === "PAYMENT_SENT"
  );
  const blockedFulfillment = active.filter(isBlocked);
  const recoveryQueue = scopedOrders.filter(activeRecovery);
  const highRiskOrders = active.filter(highRisk);
  const unresolvedInbound = auditRows.filter((row) => {
    const meta = row.meta ?? {};
    return (
      recent(row, 90) &&
      (meta.operationalEvent === "INBOUND_OPERATIONAL_MESSAGE" || String(row.action ?? "").toLowerCase().includes("inbound customer reply")) &&
      (meta.requiresHumanReview || row.orderId === "COMMUNICATION" || !row.orderId)
    );
  });
  const providerFailures = Number(jobSnapshot.providerFailures ?? 0);
  const retryingJobs = Number(jobSnapshot.retries ?? 0);
  const delayedJobs = Number(jobSnapshot.delayedJobs ?? 0);
  const deadLetterJobs = Number(jobSnapshot.deadLetterJobs ?? 0);

  const signals = [
    buildSignal({
      type: "ARRIVAL_PRESSURE",
      label: denseArrivalWindows.length > 0 ? "Too Many Arrivals Soon" : "Arrival pressure rising",
      score: arrivalsSoon.length * 8 + denseArrivalWindows.length * 20,
      count: arrivalsSoon.length,
      summary:
        denseArrivalWindows.length > 0
          ? "Several bookings are clustered into the same short arrival window."
          : "Arrivals are building up for the next service window.",
      recommendation: "Keep front-of-house focused on arrivals and avoid low-priority outreach.",
      orderIds: arrivalsSoon.map((order) => order.id),
    }),
    buildSignal({
      type: "PAYMENT_PRESSURE",
      label: blockedFulfillment.length > 0 ? "Payments Backing Up" : "Payment pressure",
      score: unpaidOrPending.length * 7 + blockedFulfillment.length * 14,
      count: unpaidOrPending.length + blockedFulfillment.length,
      summary: "Unpaid, pending, or blocked orders are competing for staff attention.",
      recommendation: "Prioritize Confirm Paid, Needs Manager, and Do Not Release decisions.",
      orderIds: [...unpaidOrPending, ...blockedFulfillment].map((order) => order.id),
    }),
    buildSignal({
      type: "RECOVERY_PRESSURE",
      label: "Recovery Queue Busy",
      score: recoveryQueue.length * 16,
      count: recoveryQueue.length,
      summary: "Multiple lost or endangered slots are being refilled at the same time.",
      recommendation: "Slow non-critical recovery escalation and avoid contacting too many customers at once.",
      orderIds: recoveryQueue.map((order) => order.id),
    }),
    buildSignal({
      type: "MESSAGE_PRESSURE",
      label: "Customer Replies Waiting",
      score: unresolvedInbound.length * 12,
      count: unresolvedInbound.length,
      summary: "Customer replies are waiting for staff or manager review.",
      recommendation: "Resolve late arrivals, slot acceptances, and cancellation requests before new outreach.",
      orderIds: unresolvedInbound.map((row) => String(row.orderId ?? "COMMUNICATION")),
    }),
    buildSignal({
      type: "WORKER_PRESSURE",
      label: "System Work Delayed",
      score: delayedJobs * 12 + retryingJobs * 10 + deadLetterJobs * 25,
      count: delayedJobs + retryingJobs + deadLetterJobs,
      summary: "Background actions are delayed, retrying, or need review.",
      recommendation: "Manager should check delayed work before relying on automatic actions.",
      orderIds: [],
    }),
    buildSignal({
      type: "PROVIDER_PRESSURE",
      label: "Messages or Providers Delayed",
      score: providerFailures * 18,
      count: providerFailures,
      summary: "Recent provider failures may delay customer messages or payment checks.",
      recommendation: "Keep staff aware that some reminders or confirmations may arrive late.",
      orderIds: [],
    }),
    buildSignal({
      type: "RISK_CONCENTRATION",
      label: "High-Risk Bookings Clustered",
      score: highRiskOrders.length * 11,
      count: highRiskOrders.length,
      summary: "High-risk orders are concentrated in the live service window.",
      recommendation: "Escalate manager visibility and keep fulfillment blocked until cleared.",
      orderIds: highRiskOrders.map((order) => order.id),
    }),
  ].filter((signal): signal is CapacitySignal => Boolean(signal));

  const weightedScore = clamp(
    signals.reduce((sum, signal) => {
      const weight =
        signal.type === "PAYMENT_PRESSURE" ? 1.1 :
        signal.type === "ARRIVAL_PRESSURE" ? 1 :
        signal.type === "RISK_CONCENTRATION" ? 1.05 :
        signal.type === "WORKER_PRESSURE" ? 0.9 :
        0.85;
      return sum + signal.score * weight;
    }, 0) / 2.8
  );
  const incidentAmplification = auditRows.filter((row) => recent(row, 30) && /failed|blocked|timeout|retry|mismatch/i.test(`${row.action ?? ""} ${JSON.stringify(row.meta ?? {})}`)).length;
  const score = clamp(weightedScore + Math.min(18, incidentAmplification * 3));
  const state = stateFromScore(score);
  const topSignals = [...signals].sort((a, b) => b.score - a.score).slice(0, 3);

  const safetyActions = [
    state === "HIGH_PRESSURE" || state === "CRITICAL" || state === "COLLAPSE_RISK"
      ? "Reduce non-critical reminders and recovery escalation."
      : "",
    state === "HIGH_PRESSURE" || state === "CRITICAL" || state === "COLLAPSE_RISK"
      ? "Prioritize payment checks, blocked releases, and arriving-soon bookings."
      : "",
    state === "COLLAPSE_RISK"
      ? "Pause low-priority outbound flows until the service wave stabilizes."
      : "",
    state === "COLLAPSE_RISK" || state === "CRITICAL"
      ? "Manager attention needed now."
      : "",
  ].filter(Boolean);

  const staffGuidance = [
    state === "COLLAPSE_RISK" || state === "CRITICAL" ? "Service Pressure High" : "",
    denseArrivalWindows.length > 0 ? "Too Many Arrivals Soon" : "",
    blockedFulfillment.length > 0 || unpaidOrPending.length >= 3 ? "Payments Backing Up" : "",
    recoveryQueue.length >= 2 ? "Recovery Queue Busy" : "",
    unresolvedInbound.length > 0 ? "Customer Replies Waiting" : "",
    state === "HIGH_PRESSURE" || state === "CRITICAL" || state === "COLLAPSE_RISK"
      ? "Manager Attention Needed"
      : "",
  ].filter(Boolean);

  return {
    organizationId,
    locationId,
    state,
    score,
    ownerSummary:
      state === "STABLE"
        ? "Service pressure is stable."
        : `${topSignals[0]?.label ?? "Service pressure"} detected. ${topSignals[0]?.summary ?? "Review the live operation before pressure builds."}`,
    staffGuidance: staffGuidance.length > 0 ? staffGuidance : ["Service looks steady"],
    safetyActions,
    signals: topSignals,
    metrics: {
      arrivalsSoon: arrivalsSoon.length,
      denseArrivalWindows: denseArrivalWindows.length,
      unpaidOrPending: unpaidOrPending.length,
      blockedFulfillment: blockedFulfillment.length,
      activeRecovery: recoveryQueue.length,
      unresolvedInbound: unresolvedInbound.length,
      retryingJobs,
      delayedJobs,
      deadLetterJobs,
      providerFailures,
      highRiskOrders: highRiskOrders.length,
    },
    generatedAt: new Date().toISOString(),
  };
}

function timelineEventForSignal(signal: CapacitySignal, state: OperationalPressureState): OperationalTimelineEventType {
  if (state === "COLLAPSE_RISK") return "COLLAPSE_RISK_TRIGGERED";
  if (signal.type === "ARRIVAL_PRESSURE") return "ARRIVAL_PRESSURE_HIGH";
  if (signal.type === "PAYMENT_PRESSURE") return "PAYMENT_CONGESTION";
  if (signal.type === "RECOVERY_PRESSURE") return "RECOVERY_OVERLOAD";
  if (signal.type === "PROVIDER_PRESSURE") return "PROVIDER_DEGRADED";
  return "COLLAPSE_RISK_TRIGGERED";
}

export async function recordCapacityTimelineEvents(snapshot: OperationalCapacitySnapshot) {
  if (snapshot.state !== "HIGH_PRESSURE" && snapshot.state !== "CRITICAL" && snapshot.state !== "COLLAPSE_RISK") {
    return;
  }

  const bucket = new Date().toISOString().slice(0, 13);
  for (const signal of snapshot.signals.filter((item) => item.score >= 35).slice(0, 3)) {
    await appendOperationalTimelineEvent({
      organizationId: snapshot.organizationId,
      locationId: snapshot.locationId,
      orderId: signal.orderIds[0] ?? "OPERATION",
      actorSource: "Operational Capacity Engine",
      eventType: timelineEventForSignal(signal, snapshot.state),
      summary: `${signal.label}: ${signal.summary}`,
      severity:
        snapshot.state === "COLLAPSE_RISK" || snapshot.state === "CRITICAL"
          ? "CRITICAL"
          : "WARNING",
      category: "WORKER",
      correlationId: `capacity:${signal.type}:${bucket}`,
      idempotencyKey: `capacity:${snapshot.organizationId}:${snapshot.locationId ?? "org"}:${signal.type}:${bucket}`,
      metadata: {
        operationalCapacity: true,
        pressureState: snapshot.state,
        pressureScore: snapshot.score,
        signalType: signal.type,
        signalScore: signal.score,
        signalCount: signal.count,
        orderIds: signal.orderIds,
        recommendation: signal.recommendation,
        safetyActions: snapshot.safetyActions,
      },
    });

    await publishOperationalCommand({
      eventType: snapshot.state === "COLLAPSE_RISK" ? "COLLAPSE_PROTECTION_ENABLED" : "PRESSURE_STATE_CHANGED",
      organizationId: snapshot.organizationId,
      locationId: snapshot.locationId,
      source: "Operational Capacity Engine",
      summary: `${signal.label}: ${signal.summary}`,
      severity:
        snapshot.state === "COLLAPSE_RISK" || snapshot.state === "CRITICAL"
          ? "CRITICAL"
          : "WARNING",
      correlationId: `capacity:${signal.type}:${bucket}`,
      payload: {
        pressureState: snapshot.state,
        pressureScore: snapshot.score,
        signal,
        safetyActions: snapshot.safetyActions,
      },
    });
  }
}

export async function buildOperationalCapacitySnapshot({
  organizationId,
  locationId = null,
}: {
  organizationId: string;
  locationId?: string | null;
}) {
  const [ordersResult, auditResult, jobSnapshot] = await Promise.all([
    supabaseAdmin
      .from("orders")
      .select("*")
      .eq("organization_id", organizationId),
    supabaseAdmin
      .from("audit_logs")
      .select("*")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .limit(250),
    getOperationalJobSnapshot(organizationId),
  ]);

  if (ordersResult.error) throw new Error(ordersResult.error.message);
  if (auditResult.error) throw new Error(auditResult.error.message);

  const orders = (ordersResult.data ?? []).map((row) => ({
    id: String(row.id),
    locationId: row.location_id ?? null,
    status: row.status,
    paymentState: row.payment_state,
    paymentVerified: row.payment_verified,
    terminalMismatch: row.terminal_mismatch,
    reservationTime: row.reservation_time,
    riskLevel: row.risk_level,
    collapseRiskTier: row.collapse_risk_tier,
    recoveryState: row.recovery_state,
  }));
  const auditRows = (auditResult.data ?? []).map((row) => ({
    id: row.id,
    action: row.action,
    orderId: row.order_id,
    createdAt: row.created_at,
    meta: row.meta ?? {},
  }));

  const snapshot = evaluateOperationalCapacity({
    organizationId,
    locationId,
    orders,
    auditRows,
    jobSnapshot,
  });

  await recordCapacityTimelineEvents(snapshot);
  return snapshot;
}
