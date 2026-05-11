import type { OrderStatus, PaymentState } from "./domain/restaurant";
import { isPaymentVerified } from "./engines/paymentEngine";

export type RevenueOrderStatus =
  | "UNPAID"
  | "PAYMENT_SENT"
  | "PAID"
  | "CANCELLED"
  | "NO_SHOW";

export type RevenueOrder = {
  id: string;
  amount: number;
  status: RevenueOrderStatus | string;
  paymentState?: PaymentState | string;
  paymentVerified?: boolean;
  depositRequired?: boolean;
  depositAmount?: number;
  depositPaid?: boolean;
  notes?: string;
  recoverySourceOrderId?: string;
};

export type RevenueFeedItem = {
  status: string;
  detail?: string;
  orderId?: string;
  staff?: string;
};

export type RevenueSnapshot = {
  metrics: {
    revenueProtected: number;
    revenueAtRisk: number;
    noShowLoss: number;
    preventedLoss: number;
    blockedOrders: number;
    recoveredOpportunities: number;
    recoveryScore: number;
  };
  revenueIntelligence: {
    estimatedAutopilotImpact: number;
    atRiskNow: number;
    preventedLoss: number;
    recoveredDrafts: number;
    remindersSent: number;
    recoveredRevenue: number;
    depositProtected: number;
  };
};

function money(value: unknown) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export function getEffectiveDepositAmount(order: RevenueOrder) {
  const amount = money(order.amount);
  const explicitDeposit = money(order.depositAmount);

  if (explicitDeposit > 0) return explicitDeposit;
  if (order.depositRequired) return Math.round(amount * 0.3 * 100) / 100;

  return 0;
}

function isActive(order: RevenueOrder) {
  return order.status !== "CANCELLED" && order.status !== "NO_SHOW";
}

function isPaidOrVerified(order: RevenueOrder) {
  return isPaymentVerified({
    status: order.status as OrderStatus,
    paymentState: order.paymentState as PaymentState | undefined,
    paymentVerified: order.paymentVerified,
  });
}

function isRecoveredDraft(order: RevenueOrder) {
  const notes = (order.notes ?? "").toLowerCase();
  return Boolean(order.recoverySourceOrderId) || notes.includes("recovered from");
}

function getOriginalOrderMap(orders: RevenueOrder[]) {
  return new Map(orders.map((order) => [order.id, order]));
}

export function calculateRecoveredRevenue(orders: RevenueOrder[]) {
  const byId = getOriginalOrderMap(orders);
  const recoveredOrders = orders.filter(isRecoveredDraft);

  return recoveredOrders.reduce((sum, recoveredOrder) => {
    const original = recoveredOrder.recoverySourceOrderId
      ? byId.get(recoveredOrder.recoverySourceOrderId)
      : undefined;

    const recoveredAmount = money(recoveredOrder.amount);
    const originalAmount = original ? money(original.amount) : 0;

    // If the recovered draft has not been configured yet, use the original lost slot value
    // because that is the real opportunity Valsentra recovered.
    return sum + (recoveredAmount > 0 ? recoveredAmount : originalAmount);
  }, 0);
}

export function calculateRevenueSnapshot({
  orders,
  autopilotFeed,
  isBlocked,
}: {
  orders: RevenueOrder[];
  autopilotFeed: RevenueFeedItem[];
  isBlocked: (order: any) => boolean;
}): RevenueSnapshot {
  const revenueProtected = orders.reduce((sum, order) => {
    if (order.status === "PAID") return sum + money(order.amount);
    if (order.depositPaid) return sum + getEffectiveDepositAmount(order);
    return sum;
  }, 0);

  const revenueAtRisk = orders.reduce((sum, order) => {
    if (!isActive(order)) return sum;
    if (isPaidOrVerified(order)) return sum;
    return sum + money(order.amount);
  }, 0);

  const noShowLoss = orders
    .filter((order) => order.status === "NO_SHOW")
    .reduce((sum, order) => sum + money(order.amount), 0);

  const preventedLoss = orders
    .filter((order) => isActive(order) && !isPaidOrVerified(order) && isBlocked(order))
    .reduce((sum, order) => sum + money(order.amount), 0);

  const blockedOrders = orders.filter((order) => isActive(order) && isBlocked(order)).length;
  const recoveredRevenue = calculateRecoveredRevenue(orders);
  const recoveredDrafts = orders.filter(isRecoveredDraft).length;
  const recoveredEvents = autopilotFeed.filter((item) =>
    item.status.includes("Recovered")
  ).length;
  const remindersSent = autopilotFeed.filter((item) =>
    item.status.includes("Reminder")
  ).length;
  const depositProtected = orders
    .filter((order) => order.depositPaid)
    .reduce((sum, order) => sum + getEffectiveDepositAmount(order), 0);

  const totalExposure = revenueProtected + revenueAtRisk + noShowLoss;
  const recoveryScore =
    totalExposure === 0 ? 0 : Math.round((revenueProtected / totalExposure) * 100);

  const trackedAutopilotImpact = recoveredRevenue + preventedLoss + depositProtected;

  return {
    metrics: {
      revenueProtected,
      revenueAtRisk,
      noShowLoss,
      preventedLoss,
      blockedOrders,
      recoveredOpportunities: Math.max(recoveredDrafts, recoveredEvents),
      recoveryScore,
    },
    revenueIntelligence: {
      estimatedAutopilotImpact: trackedAutopilotImpact,
      atRiskNow: revenueAtRisk,
      preventedLoss,
      recoveredDrafts: Math.max(recoveredDrafts, recoveredEvents),
      remindersSent,
      recoveredRevenue,
      depositProtected,
    },
  };
}
