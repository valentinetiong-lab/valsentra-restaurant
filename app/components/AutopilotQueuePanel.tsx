"use client";

import { useMemo, useState } from "react";
import { AutopilotQueueItem } from "../types/autopilot";
import { useAutopilotStore } from "../store/autopilotStore";
import { findBestWaitlistLead } from "../lib/waitlistEngine";
import type { PaymentState } from "../lib/domain/restaurant";

type OrderType =
  | "DINE_IN_RESERVATION"
  | "PREORDER_PICKUP"
  | "DELIVERY_PREORDER";

type OrderStatus =
  | "UNPAID"
  | "PAYMENT_SENT"
  | "PAID"
  | "CANCELLED"
  | "NO_SHOW";

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
  paymentVerified?: boolean;
  depositRequired: boolean;
  depositAmount?: number;
  depositPaid: boolean;
  reliabilityScore: number;
  terminalMismatch: boolean;
  notes: string;
  assignedStaff: string;
  riskLevel?: "LOW" | "MED" | "HIGH";
  protectionReason?: string;
  createdAt?: string;
  awaitingDetails?: boolean;
  recoverySourceOrderId?: string;
  autoReleaseEligible?: boolean;
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

const MESSAGE_LIMIT = 300;

function formatAutopilotAction(action: string) {
  switch (action) {
    case "SEND_PAYMENT_LINK":
      return "Send Payment Link";
    case "BLOCK_ORDER":
      return "Block Order";
    case "OFFER_WAITLIST":
      return "Offer to Waitlist";
    case "REDUCE_RELIABILITY":
      return "Reduce Reliability";
    case "FLAG_FRAUD":
      return "Flag Fraud";
    case "SEND_REMINDER":
      return "Send Reminder";
    case "RELEASE_SLOT":
      return "Release Slot";
    case "REQUIRE_DEPOSIT":
      return "Require Deposit";
    default:
      return action;
  }
}

function getApprovalButtonLabel(action: string) {
  switch (action) {
    case "SEND_REMINDER":
      return "Approve & Send";
    case "OFFER_WAITLIST":
      return "Approve & Send";
    case "SEND_PAYMENT_LINK":
      return "Approve & Open";
    default:
      return "Approve & Run";
  }
}

function buildWhatsAppLink(phone: string, message: string) {
  const digits = phone.replace(/\D/g, "");
  const normalised = digits.startsWith("0") ? `6${digits}` : digits;
  return `https://wa.me/${normalised}?text=${encodeURIComponent(message)}`;
}

function getOrderTypeLabel(orderType: OrderType) {
  switch (orderType) {
    case "DINE_IN_RESERVATION":
      return "dine-in reservation";
    case "PREORDER_PICKUP":
      return "pickup order";
    case "DELIVERY_PREORDER":
      return "delivery preorder";
    default:
      return "booking/order";
  }
}

function getSafeDepositAmount(order: RestaurantOrder) {
  const existingDeposit = Number(order.depositAmount ?? 0);
  const amount = Number(order.amount ?? 0);

  if (existingDeposit > 0) return existingDeposit;
  if (order.depositRequired && amount > 0) {
    return Math.round(amount * 0.3 * 100) / 100;
  }

  return 0;
}

function getAmountDueNow(order: RestaurantOrder) {
  const amount = Number(order.amount ?? 0);
  const deposit = getSafeDepositAmount(order);

  if (order.status === "PAID") return 0;

  if (order.depositRequired && !order.depositPaid) {
    return deposit;
  }

  if (order.depositRequired && order.depositPaid) {
    return Math.max(amount - deposit, 0);
  }

  return amount;
}

function needsRecoveredOrderSetup(order: RestaurantOrder) {
  return Boolean(
    order.awaitingDetails ||
      (order.recoverySourceOrderId && Number(order.amount ?? 0) <= 0)
  );
}

function buildReminderMessage(order: RestaurantOrder) {
  const amountDueNow = getAmountDueNow(order);

  if (amountDueNow > 0) {
    return `Hi ${order.customerName} 👋\n\nReminder for your ${getOrderTypeLabel(
      order.orderType
    )} (${order.id}).\n\nAmount due now: RM ${amountDueNow}. Please complete payment to keep your slot protected.\n\n— Valsentra`;
  }

  return `Hi ${order.customerName} 👋\n\nReminder for your ${getOrderTypeLabel(
    order.orderType
  )} (${order.id}).\n\nPlease reply YES to confirm your attendance.\n\n— Valsentra`;
}

function buildWaitlistMessage(order: RestaurantOrder, lead: WaitlistLead) {
  return `Hi ${lead.customerName} 👋\n\nA ${getOrderTypeLabel(
    order.orderType
  )} slot just opened.\n\nReply YES if you want to take it. We will confirm your actual order details after you reply.\n\n— Valsentra`;
}

function isCommunicationAction(action: AutopilotQueueItem["action"]) {
  return (
    action === "SEND_REMINDER" ||
    action === "OFFER_WAITLIST" ||
    action === "SEND_PAYMENT_LINK"
  );
}

function getSeverity(item: AutopilotQueueItem) {
  if (item.intelligenceSeverity) return item.intelligenceSeverity;

  const collapse = Number(item.collapseProbability ?? 0);

  if (collapse >= 85 || item.action === "RELEASE_SLOT" || item.action === "FLAG_FRAUD") {
    return "CRITICAL";
  }

  if (collapse >= 65 || item.action === "BLOCK_ORDER") {
    return "WARNING";
  }

  if (collapse >= 35 || item.action === "SEND_REMINDER") {
    return "WATCH";
  }

  return "INFO";
}

function severityClasses(item: AutopilotQueueItem) {
  const severity = getSeverity(item);

  if (severity === "CRITICAL") {
    return {
      card: "border-red-200 bg-red-50",
      badge: "border-red-200 bg-red-100 text-red-700",
      dot: "bg-red-500",
    };
  }

  if (severity === "WARNING") {
    return {
      card: "border-orange-200 bg-orange-50",
      badge: "border-orange-200 bg-orange-100 text-orange-700",
      dot: "bg-orange-500",
    };
  }

  if (severity === "WATCH") {
    return {
      card: "border-yellow-200 bg-yellow-50",
      badge: "border-yellow-200 bg-yellow-100 text-yellow-700",
      dot: "bg-yellow-500",
    };
  }

  return {
    card: "border-neutral-200 bg-white",
    badge: "border-neutral-200 bg-neutral-100 text-neutral-700",
    dot: "bg-neutral-400",
  };
}

function formatLearningWeight(value?: number) {
  const signal = Number(value ?? 0);
  if (signal > 0) return `+${signal}`;
  return String(signal);
}

async function fetchOrders(): Promise<RestaurantOrder[]> {
  const res = await fetch("/api/orders", { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to load orders");
  return res.json();
}

async function fetchWaitlist(): Promise<WaitlistLead[]> {
  const res = await fetch("/api/waitlist", { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to load waitlist");
  return res.json();
}

async function patchOrder(id: string, updates: Partial<RestaurantOrder>) {
  const res = await fetch("/api/orders", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ id, ...updates }),
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error || "Failed to update order");
  }

  return data;
}

async function logAudit(
  action: string,
  staff: string,
  orderId: string,
  meta: Record<string, any> = {}
) {
  await fetch("/api/audit", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ action, staff, orderId, meta }),
  });
}

async function rejectAutopilotAction(item: AutopilotQueueItem) {
  await logAudit(
    `Autopilot recommendation rejected: ${formatAutopilotAction(item.action)}`,
    "Owner",
    item.orderId,
    {
      rule: item.ruleKey,
      reason: item.reason,
      action: item.action,
      estimatedRevenueProtected: item.estimatedRevenueProtected ?? 0,
      requiresHumanAction: false,
      rejected: true,
      collapseProbability: item.collapseProbability,
      collapseRiskTier: item.collapseRiskTier,
      ghostPingUrgency: item.ghostPingUrgency,
      ghostPingReasoning: item.ghostPingReasoning,
      learningSignal: item.learningSignal,
    }
  );
}

async function executeAutopilotAction(item: AutopilotQueueItem) {
  const orders = await fetchOrders();
  const order = orders.find((o) => o.id === item.orderId);

  if (!order) {
    throw new Error(`Order ${item.orderId} not found`);
  }

  await logAudit(
    `Autopilot recommendation approved: ${formatAutopilotAction(item.action)}`,
    "Owner",
    item.orderId,
    {
      rule: item.ruleKey,
      reason: item.reason,
      action: item.action,
      estimatedRevenueProtected: item.estimatedRevenueProtected ?? 0,
      requiresHumanAction: false,
      approved: true,
      collapseProbability: item.collapseProbability,
      collapseRiskTier: item.collapseRiskTier,
      recommendedIntervention: item.recommendedIntervention,
      ghostPingUrgency: item.ghostPingUrgency,
      ghostPingReasoning: item.ghostPingReasoning,
      aiConfidence: item.aiConfidence,
      learningSignal: item.learningSignal,
    }
  );

  const paymentActions = new Set([
    "REQUIRE_DEPOSIT",
    "SEND_PAYMENT_LINK",
    "SEND_REMINDER",
    "BLOCK_ORDER",
    "FLAG_FRAUD",
  ]);

  if (needsRecoveredOrderSetup(order) && paymentActions.has(item.action)) {
    throw new Error(
      `${order.customerName} is still awaiting setup. Enter the real amount and summary first.`
    );
  }

  if (item.action === "SEND_PAYMENT_LINK") {
    const amountDueNow = getAmountDueNow(order);
    const depositAmount = getSafeDepositAmount(order);

    await patchOrder(order.id, {
      status: "PAYMENT_SENT",
      paymentState: "PENDING",
      depositAmount,
      notes: `Autopilot prepared payment link. Amount due now: RM ${amountDueNow}.`,
    });

    await logAudit("Autopilot prepared payment link", "Autopilot", order.id);
    window.open(`/pay/${order.id}`, "_blank");
    return { messageSent: false };
  }

  if (item.action === "SEND_REMINDER") {
    const opened = window.open(
      buildWhatsAppLink(order.phone, buildReminderMessage(order)),
      "_blank"
    );

    if (!opened) {
      throw new Error(
        "WhatsApp popup was blocked. Please allow popups or retry from the button."
      );
    }

    await logAudit("Autopilot sent reminder", "Autopilot", order.id);
    return { messageSent: true };
  }

  if (item.action === "BLOCK_ORDER") {
    await patchOrder(order.id, {
      paymentState: "BLOCKED",
      paymentVerified: false,
      notes: "Autopilot blocked this order pending verification.",
      protectionReason: "Blocked by autopilot",
    });

    await logAudit("Autopilot blocked order", "Autopilot", order.id);
    return { messageSent: false };
  }

  if (item.action === "FLAG_FRAUD") {
    await patchOrder(order.id, {
      paymentState: "BLOCKED",
      paymentVerified: false,
      terminalMismatch: true,
      notes: "Autopilot flagged suspicious payment activity.",
      protectionReason: "Fraud review required",
    });

    await logAudit("Autopilot flagged fraud", "Autopilot", order.id);
    return { messageSent: false };
  }

  if (item.action === "RELEASE_SLOT") {
    await patchOrder(order.id, {
      status: "CANCELLED",
      notes: "Autopilot released the slot after owner approval.",
      protectionReason: "Slot released by autopilot approval",
      autoReleaseEligible: false,
    });

    await logAudit("Autopilot released slot after approval", "Autopilot", order.id);
    return { messageSent: false };
  }

  if (item.action === "OFFER_WAITLIST") {
    const waitlist = await fetchWaitlist();
    const recovery = findBestWaitlistLead(
      {
        id: order.id,
        orderType: order.orderType,
        amount: order.amount,
      },
      waitlist
    );

    if (!recovery.bestLead) {
      throw new Error("No suitable waitlist lead found");
    }

    const opened = window.open(
      buildWhatsAppLink(
        recovery.bestLead.phone,
        buildWaitlistMessage(order, recovery.bestLead)
      ),
      "_blank"
    );

    if (!opened) {
      throw new Error(
        "WhatsApp popup was blocked. Please allow popups or retry from the button."
      );
    }

    await logAudit(
      `Autopilot offered slot to waitlist lead ${recovery.bestLead.customerName}`,
      "Autopilot",
      order.id,
      {
        rule: item.ruleKey,
        selectedLeadName: recovery.bestLead.customerName,
        recoveryScore: recovery.recoveryScore,
        recoverableRevenue: recovery.recoverableRevenue,
      }
    );

    await patchOrder(order.id, {
      notes: `${order.notes || ""} | Autopilot offered this slot to waitlist lead ${
        recovery.bestLead.customerName
      }.`,
      protectionReason: "Waitlist offer prepared by autopilot",
    });

    return { messageSent: true };
  }

  if (item.action === "REDUCE_RELIABILITY") {
    const nextReliability = Math.max((order.reliabilityScore ?? 100) - 25, 0);

    await patchOrder(order.id, {
      reliabilityScore: nextReliability,
      notes: `Autopilot reduced reliability score to ${nextReliability}.`,
    });

    await logAudit("Autopilot reduced customer reliability", "Autopilot", order.id);
    return { messageSent: false };
  }

  if (item.action === "REQUIRE_DEPOSIT") {
    const depositAmount = getSafeDepositAmount(order);
    const finalDepositAmount =
      depositAmount > 0
        ? depositAmount
        : Math.round(Number(order.amount ?? 0) * 0.3 * 100) / 100;

    await patchOrder(order.id, {
      depositRequired: true,
      depositAmount: finalDepositAmount,
      notes: `Autopilot required deposit of RM ${finalDepositAmount}.`,
    });

    await logAudit("Autopilot required deposit", "Autopilot", order.id);
    return { messageSent: false };
  }

  return { messageSent: false };
}

export default function AutopilotQueuePanel() {
  const {
    queue,
    approveQueueItem,
    rejectQueueItem,
    markQueueItemDone,
    markQueueItemSkipped,
    revenueSaved,
  } = useAutopilotStore();

  const [executingId, setExecutingId] = useState<string | null>(null);
  const [runningSweep, setRunningSweep] = useState(false);
  const [lastSweepMessage, setLastSweepMessage] = useState("");
  const [messagesUsed, setMessagesUsed] = useState(0);

  const queuedItems = useMemo(
    () => queue.filter((item) => item.status === "QUEUED"),
    [queue]
  );

  const readyToSendActions = useMemo(
    () => queuedItems.filter((item) => isCommunicationAction(item.action)),
    [queuedItems]
  );

  const criticalQueueItems = useMemo(
    () => queuedItems.filter((item) => getSeverity(item) === "CRITICAL"),
    [queuedItems]
  );

  const learningSignals = useMemo(
    () => queue.filter((item) => item.learningSignal).slice(0, 5),
    [queue]
  );

  async function handleApproveAndExecute(item: AutopilotQueueItem) {
    try {
      setExecutingId(item.id);
      approveQueueItem(item.id, "Owner");
      const result = await executeAutopilotAction(item);

      if (result.messageSent) {
        setMessagesUsed((prev) => prev + 1);
      }

      markQueueItemDone(item.id);
    } catch (error) {
      console.error(error);
      markQueueItemSkipped(item.id);
      const message =
        error instanceof Error ? error.message : "Failed to execute approved action";
      alert(message);
    } finally {
      setExecutingId(null);
    }
  }

  async function handleReject(item: AutopilotQueueItem) {
    try {
      setExecutingId(item.id);
      await rejectAutopilotAction(item);
      rejectQueueItem(item.id, "Owner");
    } catch (error) {
      console.error(error);
      const message =
        error instanceof Error ? error.message : "Failed to reject action";
      alert(message);
    } finally {
      setExecutingId(null);
    }
  }

  async function handleApproveSweep() {
    const itemsToRun = queuedItems.filter(
      (item) => !isCommunicationAction(item.action)
    );
    const skippedCommunicationCount = queuedItems.length - itemsToRun.length;

    if (itemsToRun.length === 0) {
      setLastSweepMessage(
        skippedCommunicationCount > 0
          ? `${skippedCommunicationCount} message action${
              skippedCommunicationCount === 1 ? " is" : "s are"
            } ready. Approve them one by one to avoid browser popup blocking.`
          : "No queued actions to approve."
      );
      return;
    }

    try {
      setRunningSweep(true);
      let completed = 0;
      const failures: string[] = [];

      for (const item of itemsToRun) {
        try {
          approveQueueItem(item.id, "Owner");
          await executeAutopilotAction(item);
          markQueueItemDone(item.id);
          completed += 1;
        } catch (error) {
          console.error(error);
          markQueueItemSkipped(item.id);
          failures.push(
            `${item.customerName} • ${formatAutopilotAction(item.action)}`
          );
        }
      }

      const messageSuffix =
        skippedCommunicationCount > 0
          ? ` ${skippedCommunicationCount} message action${
              skippedCommunicationCount === 1 ? " was" : "s were"
            } left for one-by-one approval.`
          : "";

      if (failures.length === 0) {
        setLastSweepMessage(
          `Approval sweep complete. Ran ${completed} approved action${
            completed === 1 ? "" : "s"
          }.${messageSuffix}`
        );
      } else {
        setLastSweepMessage(
          `Approval sweep complete. Ran ${completed}, skipped ${failures.length}.${messageSuffix}`
        );
      }
    } finally {
      setRunningSweep(false);
    }
  }

  return (
    <div className="rounded-[28px] border border-neutral-200 bg-white p-5 shadow-sm md:p-6">
      <div className="mb-5 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-neutral-500">
            AI Operations Rail
          </p>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight text-neutral-950">
            Approval Queue
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-neutral-500">
            Review Valsentra recommendations before they execute. This is the human override layer for autonomous revenue protection.
          </p>
        </div>

        <button
          onClick={handleApproveSweep}
          disabled={runningSweep || queuedItems.length === 0}
          className="rounded-2xl bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {runningSweep ? "Approving..." : "Approve Safe Sweep"}
        </button>
      </div>

      <div className="mb-5 grid gap-3 md:grid-cols-4">
        <div className="rounded-2xl border border-green-200 bg-green-50 p-4">
          <div className="text-xs font-semibold uppercase tracking-[0.12em] text-green-700">
            Revenue Protected
          </div>
          <div className="mt-1 text-2xl font-bold text-green-700">
            RM {revenueSaved.toFixed(2)}
          </div>
        </div>

        <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
          <div className="text-xs font-semibold uppercase tracking-[0.12em] text-neutral-500">
            Pending Approval
          </div>
          <div className="mt-1 text-2xl font-bold text-neutral-950">
            {queuedItems.length}
          </div>
        </div>

        <div className="rounded-2xl border border-red-200 bg-red-50 p-4">
          <div className="text-xs font-semibold uppercase tracking-[0.12em] text-red-700">
            Critical
          </div>
          <div className="mt-1 text-2xl font-bold text-red-700">
            {criticalQueueItems.length}
          </div>
        </div>

        <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4">
          <div className="text-xs font-semibold uppercase tracking-[0.12em] text-blue-700">
            Messages Used
          </div>
          <div className="mt-1 text-2xl font-bold text-blue-700">
            {messagesUsed} / {MESSAGE_LIMIT}
          </div>
          {messagesUsed >= MESSAGE_LIMIT * 0.8 ? (
            <div className="mt-1 text-xs text-orange-600">
              Approaching included message limit
            </div>
          ) : null}
        </div>
      </div>

      {learningSignals.length > 0 ? (
        <div className="mb-5 rounded-2xl border border-purple-200 bg-purple-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-purple-700">
            Continuous Learning Feed
          </p>
          <p className="mt-1 text-sm text-purple-900">
            Signals Valsentra is using to improve future revenue protection decisions.
          </p>

          <div className="mt-3 space-y-2">
            {learningSignals.map((item) => {
              const signal = item.learningSignal;
              if (!signal) return null;

              return (
                <div
                  key={`${item.id}-learning`}
                  className="flex flex-col gap-2 rounded-xl border border-purple-100 bg-white px-4 py-3 md:flex-row md:items-center md:justify-between"
                >
                  <div>
                    <p className="text-sm font-semibold text-purple-950">
                      {signal.learningSummary}
                    </p>
                    <p className="mt-1 text-xs text-purple-700">
                      {signal.eventType} · {signal.outcome}
                    </p>
                  </div>

                  <span
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${
                      signal.signalWeight > 0
                        ? "bg-green-100 text-green-700"
                        : signal.signalWeight < 0
                          ? "bg-red-100 text-red-700"
                          : "bg-neutral-100 text-neutral-600"
                    }`}
                  >
                    {formatLearningWeight(signal.signalWeight)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {readyToSendActions.length > 0 ? (
        <div className="mb-4 rounded-2xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
          {readyToSendActions.length} message action
          {readyToSendActions.length === 1 ? " is" : "s are"} ready. Approve
          them one by one so the browser does not block WhatsApp/payment popups.
        </div>
      ) : null}

      {lastSweepMessage ? (
        <div className="mb-4 rounded-2xl border border-neutral-200 bg-neutral-50 p-3 text-sm text-neutral-700">
          {lastSweepMessage}
        </div>
      ) : null}

      <div className="space-y-3">
        {queue.length === 0 && (
          <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-5 text-sm text-neutral-500">
            No approval items yet.
          </div>
        )}

        {queue.map((item) => {
          const classes = severityClasses(item);
          const severity = getSeverity(item);

          return (
            <div
              key={item.id}
              className={`rounded-2xl border p-4 ${classes.card}`}
            >
              <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`h-2.5 w-2.5 rounded-full ${classes.dot}`} />
                    <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${classes.badge}`}>
                      {severity}
                    </span>
                    <span className="rounded-full border border-neutral-200 bg-white px-3 py-1 text-xs font-semibold text-neutral-600">
                      {item.status}
                    </span>
                    {typeof item.collapseProbability === "number" ? (
                      <span className="rounded-full border border-neutral-200 bg-white px-3 py-1 text-xs font-semibold text-neutral-700">
                        Collapse {item.collapseProbability}%
                      </span>
                    ) : null}
                    {item.ghostPingUrgency ? (
                      <span className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
                        Ghost Ping {item.ghostPingUrgency}
                      </span>
                    ) : null}
                  </div>

                  <div className="mt-3">
                    <div className="text-base font-semibold text-neutral-950">
                      {item.customerName}
                    </div>

                    <div className="mt-1 text-sm text-neutral-700">
                      <span className="font-medium">Recommended action:</span>{" "}
                      {formatAutopilotAction(item.action)}
                    </div>

                    <div className="mt-1 text-sm text-neutral-700">
                      <span className="font-medium">Why:</span> {item.reason}
                    </div>

                    {item.ghostPingReasoning ? (
                      <div className="mt-2 rounded-xl border border-blue-100 bg-white/80 px-3 py-2 text-xs text-blue-800">
                        <span className="font-semibold">Ghost Ping reasoning:</span>{" "}
                        {item.ghostPingReasoning}
                      </div>
                    ) : null}

                    {item.learningSignal ? (
                      <div className="mt-2 rounded-xl border border-purple-100 bg-white/80 px-3 py-2 text-xs text-purple-800">
                        <span className="font-semibold">Learning signal:</span>{" "}
                        {item.learningSignal.learningSummary}
                      </div>
                    ) : null}

                    {isCommunicationAction(item.action) && item.status === "QUEUED" ? (
                      <div className="mt-2 text-xs font-medium text-blue-700">
                        Requires one-by-one approval because it opens a message/payment window.
                      </div>
                    ) : null}

                    <div className="mt-2 flex flex-wrap gap-3 text-xs text-neutral-500">
                      <span>{new Date(item.createdAt).toLocaleString()}</span>

                      {item.reviewedBy ? (
                        <span>Reviewed by {item.reviewedBy}</span>
                      ) : null}

                      {item.aiConfidence ? (
                        <span>AI confidence {item.aiConfidence}%</span>
                      ) : null}

                      {item.estimatedRevenueProtected ? (
                        <span className="font-semibold text-green-700">
                          Protect RM {item.estimatedRevenueProtected.toFixed(2)}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div className="flex shrink-0 flex-wrap gap-2 md:justify-end">
                  {item.status === "QUEUED" ? (
                    <>
                      <button
                        onClick={() => handleApproveAndExecute(item)}
                        disabled={executingId === item.id || runningSweep}
                        className="rounded-xl bg-green-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                      >
                        {executingId === item.id
                          ? "Running..."
                          : getApprovalButtonLabel(item.action)}
                      </button>

                      <button
                        onClick={() => handleReject(item)}
                        disabled={executingId === item.id || runningSweep}
                        className="rounded-xl bg-red-100 px-3 py-2 text-sm font-medium text-red-700 disabled:opacity-50"
                      >
                        Reject
                      </button>
                    </>
                  ) : (
                    <span className="rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-500">
                      {item.status}
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
