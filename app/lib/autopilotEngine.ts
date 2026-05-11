import {
  AutopilotQueueItem,
  AutopilotRule,
  RestaurantOrder,
} from "../types/autopilot";

function getNowMs() {
  return Date.now();
}

function parseOrderDateTime(order: RestaurantOrder) {
  const rawDate = order.date || new Date().toISOString().slice(0, 10);
  const rawTime = order.time || "00:00";

  const normalizedTime = rawTime
    .trim()
    .toLowerCase()
    .replace(".", ":")
    .replace(/\s+/g, "");

  const amPmMatch = normalizedTime.match(/^(\d{1,2})(?::(\d{1,2}))?(am|pm)$/);
  const normalMatch = normalizedTime.match(/^(\d{1,2})(?::(\d{1,2}))?$/);

  let hour = 0;
  let minute = 0;

  if (amPmMatch) {
    hour = Number(amPmMatch[1]);
    minute = Number(amPmMatch[2] ?? 0);

    if (amPmMatch[3] === "pm" && hour !== 12) hour += 12;
    if (amPmMatch[3] === "am" && hour === 12) hour = 0;
  } else if (normalMatch) {
    hour = Number(normalMatch[1]);
    minute = Number(normalMatch[2] ?? 0);
  }

  if (Number.isNaN(hour) || hour < 0 || hour > 23) hour = 0;
  if (Number.isNaN(minute) || minute < 0 || minute > 59) minute = 0;

  return new Date(
    `${rawDate}T${String(hour).padStart(2, "0")}:${String(minute).padStart(
      2,
      "0"
    )}:00`
  ).getTime();
}

function hoursUntilOrder(order: RestaurantOrder) {
  return (parseOrderDateTime(order) - getNowMs()) / (1000 * 60 * 60);
}

function createQueueItem(
  order: RestaurantOrder,
  ruleKey: AutopilotQueueItem["ruleKey"],
  action: AutopilotQueueItem["action"],
  reason: string,
  estimatedRevenueProtected?: number
): AutopilotQueueItem {
  return {
    id: `${ruleKey}-${action}-${order.id}`,
    ruleKey,
    orderId: order.id,
    customerName: order.customerName,
    action,
    reason,
    status: "QUEUED",
    createdAt: new Date().toISOString(),
    estimatedRevenueProtected,
  };
}

function isRuleEnabled(rules: AutopilotRule[], key: AutopilotRule["key"]) {
  return rules.find((rule) => rule.key === key)?.enabled ?? false;
}

function getRuleConfig(rules: AutopilotRule[], key: AutopilotRule["key"]) {
  return rules.find((rule) => rule.key === key)?.config ?? {};
}

function pushUnique(queue: AutopilotQueueItem[], item: AutopilotQueueItem) {
  const exists = queue.some(
    (existing) =>
      existing.orderId === item.orderId &&
      existing.action === item.action &&
      existing.reason === item.reason
  );

  if (!exists) queue.push(item);
}

export function runAutopilot(
  orders: RestaurantOrder[],
  rules: AutopilotRule[]
): {
  queue: AutopilotQueueItem[];
  revenueSaved: number;
} {
  const queue: AutopilotQueueItem[] = [];
  let revenueSaved = 0;

  for (const order of orders) {
    const hoursUntil = hoursUntilOrder(order);

    const isPending = order.status === "Pending";
    const isPaid = order.status === "Paid";
    const isCancelled = order.status === "Cancelled";
    const isNoShow = order.status === "No-show";

    if (isPending && hoursUntil <= 24 && hoursUntil > 23) {
      pushUnique(
        queue,
        createQueueItem(
          order,
          "HIGH_VALUE_DEPOSIT",
          "SEND_REMINDER",
          "24h reminder before reservation"
        )
      );
    }

    if (isPending && hoursUntil <= 12 && hoursUntil > 11) {
      pushUnique(
        queue,
        createQueueItem(
          order,
          "HIGH_VALUE_DEPOSIT",
          "SEND_REMINDER",
          "12h reminder before reservation"
        )
      );
    }

    if (isPending && hoursUntil <= 2 && hoursUntil > 1) {
      pushUnique(
        queue,
        createQueueItem(
          order,
          "HIGH_VALUE_DEPOSIT",
          "SEND_REMINDER",
          "Final 2h reminder before reservation"
        )
      );
    }

    if (isRuleEnabled(rules, "DINE_IN_DEPOSIT_BY_GUESTS")) {
      const config = getRuleConfig(rules, "DINE_IN_DEPOSIT_BY_GUESTS");
      const guestThreshold = Number(config.guestThreshold ?? 10);

      if (
        order.orderType === "DINE_IN" &&
        (order.partySize ?? 0) >= guestThreshold &&
        !order.depositPaid &&
        !isPaid
      ) {
        pushUnique(
          queue,
          createQueueItem(
            order,
            "DINE_IN_DEPOSIT_BY_GUESTS",
            "REQUIRE_DEPOSIT",
            `Dine-in party size reached ${guestThreshold}+ guests`,
            order.amount
          )
        );
      }
    }

    if (isRuleEnabled(rules, "HIGH_VALUE_DEPOSIT")) {
      const config = getRuleConfig(rules, "HIGH_VALUE_DEPOSIT");
      const amountThreshold = Number(config.amountThreshold ?? 200);

      if (order.amount >= amountThreshold && !order.depositPaid && !isPaid) {
        pushUnique(
          queue,
          createQueueItem(
            order,
            "HIGH_VALUE_DEPOSIT",
            "SEND_PAYMENT_LINK",
            "High-value order needs deposit",
            order.amount
          )
        );
      }
    }

    if (isRuleEnabled(rules, "LOW_RELIABILITY_DEPOSIT")) {
      const config = getRuleConfig(rules, "LOW_RELIABILITY_DEPOSIT");
      const reliabilityThreshold = Number(config.reliabilityThreshold ?? 50);

      if (
        (order.reliabilityScore ?? 100) < reliabilityThreshold &&
        !order.depositPaid &&
        !isPaid
      ) {
        pushUnique(
          queue,
          createQueueItem(
            order,
            "LOW_RELIABILITY_DEPOSIT",
            "REQUIRE_DEPOSIT",
            `Customer reliability below ${reliabilityThreshold}%`,
            order.amount
          )
        );
      }
    }

    if (isRuleEnabled(rules, "AUTO_BLOCK_HIGH_VALUE_UNPAID")) {
      const config = getRuleConfig(rules, "HIGH_VALUE_DEPOSIT");
      const amountThreshold = Number(config.amountThreshold ?? 200);

      if (order.amount >= amountThreshold && !order.paymentVerified && !isPaid) {
        pushUnique(
          queue,
          createQueueItem(
            order,
            "AUTO_BLOCK_HIGH_VALUE_UNPAID",
            "BLOCK_ORDER",
            "High-value unpaid order should be blocked",
            order.amount
          )
        );
      }
    }

    if (
      isRuleEnabled(rules, "HARD_BLOCK_TERMINAL_MISMATCH") &&
      order.suspiciousPaymentScreenshot
    ) {
      pushUnique(
        queue,
        createQueueItem(
          order,
          "HARD_BLOCK_TERMINAL_MISMATCH",
          "FLAG_FRAUD",
          "Suspicious payment screenshot requires review",
          order.amount
        )
      );
    }

    if (isPending && hoursUntil < 0) {
      pushUnique(
        queue,
        createQueueItem(
          order,
          "AUTO_BLOCK_HIGH_VALUE_UNPAID",
          "RELEASE_SLOT",
          "Reservation time passed and order is still pending",
          order.amount
        )
      );
    }

    if (isCancelled || isNoShow) {
      pushUnique(
        queue,
        createQueueItem(
          order,
          "LOW_RELIABILITY_DEPOSIT",
          "OFFER_WAITLIST",
          "Recover lost slot using waitlist",
          order.amount
        )
      );

      revenueSaved += order.amount || 0;
    }

    if (isNoShow) {
      pushUnique(
        queue,
        createQueueItem(
          order,
          "LOW_RELIABILITY_DEPOSIT",
          "REDUCE_RELIABILITY",
          "Customer no-show should reduce reliability"
        )
      );
    }
  }

  return {
    queue,
    revenueSaved,
  };
}
