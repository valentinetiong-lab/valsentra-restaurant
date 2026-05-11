export type OrderRecord = {
  id: string;
  customerName: string;
  staffName?: string;
  assignedStaff?: string;
  amount: number;
  status:
    | "PAID"
    | "CANCELLED"
    | "NO_SHOW"
    | "PENDING"
    | "UNPAID"
    | "PAYMENT_SENT";
  riskLevel?: "LOW" | "MED" | "HIGH";
  reliabilityScore?: number;
  reservationTime: string;
  recovered?: boolean;
  createdAt?: string;
};

function safeAmount(value: number | undefined) {
  const amount = Number(value ?? 0);
  return Number.isNaN(amount) ? 0 : amount;
}

function isCancelledOrNoShow(status: OrderRecord["status"]) {
  return status === "CANCELLED" || status === "NO_SHOW";
}

function parseHourFromReservationTime(value: string): number | null {
  if (!value || typeof value !== "string") return null;

  const raw = value.trim().toLowerCase();

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.getHours();
  }

  const match = raw.match(/^(\d{1,2})(?:[:.](\d{1,2}))?\s*(am|pm)?$/i);

  if (!match) return null;

  let hour = Number(match[1]);
  const meridiem = match[3]?.toLowerCase();

  if (Number.isNaN(hour)) return null;

  if (meridiem === "am") {
    if (hour === 12) hour = 0;
  } else if (meridiem === "pm") {
    if (hour !== 12) hour += 12;
  }

  if (hour < 0 || hour > 23) return null;

  return hour;
}

function formatHourLabel(hour: number) {
  return `${hour}:00`;
}

export function getDangerousCustomers(orders: OrderRecord[]) {
  const map: Record<string, { noShows: number; cancelled: number; total: number }> = {};

  for (const order of orders) {
    const name = order.customerName || "Unknown customer";

    if (!map[name]) {
      map[name] = { noShows: 0, cancelled: 0, total: 0 };
    }

    map[name].total += 1;

    if (order.status === "NO_SHOW") map[name].noShows += 1;
    if (order.status === "CANCELLED") map[name].cancelled += 1;
  }

  return Object.entries(map)
    .map(([customerName, data]) => ({
      customerName,
      noShows: data.noShows,
      cancelled: data.cancelled,
      total: data.total,
      riskScore: data.noShows * 2 + data.cancelled,
    }))
    .filter((customer) => customer.riskScore > 0)
    .sort((a, b) => b.riskScore - a.riskScore)
    .slice(0, 5);
}

export function getWorstTimeSlots(orders: OrderRecord[]) {
  const slots: Record<string, number> = {};

  for (const order of orders) {
    if (isCancelledOrNoShow(order.status)) {
      const hour = parseHourFromReservationTime(order.reservationTime);
      if (hour === null) continue;

      const key = formatHourLabel(hour);
      slots[key] = (slots[key] || 0) + 1;
    }
  }

  return Object.entries(slots)
    .map(([time, count]) => ({ time, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
}

export function getStaffMistakes(orders: OrderRecord[]) {
  const staff: Record<string, number> = {};

  for (const order of orders) {
    if (isCancelledOrNoShow(order.status)) {
      const name = order.staffName || order.assignedStaff || "Unknown";
      staff[name] = (staff[name] || 0) + 1;
    }
  }

  return Object.entries(staff)
    .map(([name, mistakes]) => ({ name, mistakes }))
    .sort((a, b) => b.mistakes - a.mistakes)
    .slice(0, 5);
}

export function getMoneySavedThisMonth(orders: OrderRecord[]) {
  const now = new Date();
  let saved = 0;

  for (const order of orders) {
    if (!order.createdAt) continue;

    const date = new Date(order.createdAt);
    if (Number.isNaN(date.getTime())) continue;

    if (
      date.getMonth() === now.getMonth() &&
      date.getFullYear() === now.getFullYear() &&
      order.recovered
    ) {
      saved += safeAmount(order.amount);
    }
  }

  return saved;
}

export function predictNoShowProbability(order: OrderRecord) {
  let score = 0;

  if (order.status === "NO_SHOW") score += 50;
  if (order.status === "CANCELLED") score += 25;
  if (order.riskLevel === "HIGH") score += 40;
  if (order.riskLevel === "MED") score += 20;

  if ((order.reliabilityScore ?? 100) < 50) score += 30;
  if ((order.reliabilityScore ?? 100) < 30) score += 20;

  const hour = parseHourFromReservationTime(order.reservationTime);
  if (hour !== null && hour >= 20) score += 10;

  if (score > 100) score = 100;

  return score;
}

export function calculateSlotHealth(orders: OrderRecord[]) {
  const slots: Record<string, { total: number; bad: number }> = {};

  for (const order of orders) {
    const hour = parseHourFromReservationTime(order.reservationTime);
    if (hour === null) continue;

    const key = formatHourLabel(hour);

    if (!slots[key]) {
      slots[key] = { total: 0, bad: 0 };
    }

    slots[key].total += 1;

    if (isCancelledOrNoShow(order.status)) {
      slots[key].bad += 1;
    }
  }

  return Object.entries(slots)
    .map(([time, data]) => {
      const health = 100 - (data.bad / data.total) * 100;
      return { time, health: Math.round(health) };
    })
    .sort((a, b) => a.health - b.health)
    .slice(0, 8);
}

export function calculateRevenueLeakage(orders: OrderRecord[]) {
  let leakage = 0;
  let recovered = 0;
  let paid = 0;

  for (const order of orders) {
    const amount = safeAmount(order.amount);

    if (order.status === "PAID") paid += amount;

    if (isCancelledOrNoShow(order.status) && !order.recovered) {
      leakage += amount;
    }

    if (order.recovered) recovered += amount;
  }

  return {
    paid,
    leakage,
    recovered,
  };
}
