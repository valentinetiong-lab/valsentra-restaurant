import type { RestaurantOrder } from "@/app/lib/domain/restaurant";

export type CustomerOperationalAuditRow = {
  id?: string | number;
  action?: string;
  order_id?: string;
  orderId?: string;
  meta?: Record<string, any>;
  created_at?: string;
  createdAt?: string;
};

export type CustomerOperationalMemoryProfile = {
  customerKey: string;
  customerName: string;
  phone: string | null;
  orderIds: string[];
  remindersSent: number;
  remindersResponded: number;
  averageResponseTime: number | null;
  lateArrivalCount: number;
  cancellationCount: number;
  successfulRecoveryCount: number;
  paymentDelayCount: number;
  paymentVerifiedCount: number;
  noShowCount: number;
  slotChangeRequests: number;
  escalationCount: number;
  communicationResponsiveness: number;
  preferredDiningPeriod: "LUNCH" | "DINNER" | "LATE_NIGHT" | "UNKNOWN";
  preferredReservationTimes: string[];
  recoveryCooperationScore: number;
  operationalReliability: number;
  recoveryLikelihood: number;
  communicationTrust: number;
  escalationRisk: number;
  ghostRisk: number;
  reliabilityFactors: string[];
  memorySignalsUsed: string[];
  orchestrationBiasesApplied: string[];
};

function clamp(value: number) {
  return Math.max(0, Math.min(Math.round(value), 100));
}

function normalisePhone(value?: string | null) {
  return String(value ?? "").replace(/\D/g, "");
}

function getCustomerKey(order: Pick<RestaurantOrder, "phone" | "customerName" | "id">) {
  return normalisePhone(order.phone) || String(order.customerName ?? "").trim().toLowerCase() || order.id;
}

function getAuditOrderId(row: CustomerOperationalAuditRow) {
  return String(row.order_id ?? row.orderId ?? "");
}

function getAuditDate(row: CustomerOperationalAuditRow) {
  const parsed = new Date(row.created_at ?? row.createdAt ?? "").getTime();
  return Number.isNaN(parsed) ? null : parsed;
}

function lower(value: unknown) {
  return String(value ?? "").toLowerCase();
}

function minutesBetween(left: number, right: number) {
  return Math.max(0, Math.round((right - left) / 60000));
}

function getMalaysiaTimeParts(value?: string | null) {
  const parsed = new Date(value ?? "").getTime();
  if (Number.isNaN(parsed)) return null;

  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuala_Lumpur",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(new Date(parsed)).map((part) => [part.type, part.value])
  );

  return {
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    label: `${parts.hour}:${parts.minute}`,
  };
}

function getDiningPeriod(hour: number): "LUNCH" | "DINNER" | "LATE_NIGHT" | "UNKNOWN" {
  if (hour >= 11 && hour <= 15) return "LUNCH";
  if (hour >= 17 && hour <= 21) return "DINNER";
  if (hour >= 22 || hour <= 1) return "LATE_NIGHT";
  return "UNKNOWN";
}

function mode(values: string[]) {
  const counts = new Map<string, number>();
  values.forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "UNKNOWN";
}

function isReminder(row: CustomerOperationalAuditRow) {
  const text = `${lower(row.action)} ${lower(row.meta?.communicationOrchestration?.step)} ${lower(row.meta?.deliveryAttempt?.step)}`;
  return text.includes("reminder") || text.includes("whatsapp communication sent");
}

function isInboundResponse(row: CustomerOperationalAuditRow) {
  const text = `${lower(row.action)} ${lower(row.meta?.webhookType)} ${lower(row.meta?.inboundIntent)}`;
  return text.includes("inbound whatsapp") || text.includes("inbound_or_reply");
}

function isEscalation(row: CustomerOperationalAuditRow) {
  const text = `${lower(row.action)} ${lower(row.meta?.communicationOrchestration?.step)} ${lower(row.meta?.deliveryAttempt?.step)}`;
  return text.includes("escalat");
}

function isRecoverySuccess(row: CustomerOperationalAuditRow) {
  const text = `${lower(row.action)} ${lower(row.meta?.communicationOutcome)} ${lower(row.meta?.learningEntry?.outcome)}`;
  return text.includes("recovered") || text.includes("succeeded") || text.includes("sent");
}

function createReliabilityFactors(profile: {
  remindersSent: number;
  remindersResponded: number;
  paymentDelayCount: number;
  paymentVerifiedCount: number;
  lateArrivalCount: number;
  cancellationCount: number;
  noShowCount: number;
  slotChangeRequests: number;
  successfulRecoveryCount: number;
  escalationCount: number;
}) {
  const factors: string[] = [];
  if (profile.paymentVerifiedCount > 0) factors.push(`${profile.paymentVerifiedCount} verified payment outcome${profile.paymentVerifiedCount === 1 ? "" : "s"}.`);
  if (profile.remindersResponded > 0) factors.push(`${profile.remindersResponded}/${Math.max(profile.remindersSent, 1)} reminders received a customer response.`);
  if (profile.paymentDelayCount > 0) factors.push(`${profile.paymentDelayCount} delayed or unresolved payment signal${profile.paymentDelayCount === 1 ? "" : "s"}.`);
  if (profile.noShowCount > 0) factors.push(`${profile.noShowCount} no-show signal${profile.noShowCount === 1 ? "" : "s"}.`);
  if (profile.lateArrivalCount > 0) factors.push(`${profile.lateArrivalCount} late-arrival signal${profile.lateArrivalCount === 1 ? "" : "s"}.`);
  if (profile.cancellationCount > 0) factors.push(`${profile.cancellationCount} cancellation signal${profile.cancellationCount === 1 ? "" : "s"}.`);
  if (profile.slotChangeRequests > 0) factors.push(`${profile.slotChangeRequests} slot-change request${profile.slotChangeRequests === 1 ? "" : "s"}.`);
  if (profile.successfulRecoveryCount > 0) factors.push(`${profile.successfulRecoveryCount} successful recovery cooperation signal${profile.successfulRecoveryCount === 1 ? "" : "s"}.`);
  if (profile.escalationCount > 0) factors.push(`${profile.escalationCount} escalation signal${profile.escalationCount === 1 ? "" : "s"}.`);
  return factors.length > 0 ? factors : ["Insufficient history; defaulting to neutral customer memory."];
}

export function buildCustomerOperationalMemoryProfiles({
  orders,
  auditRows,
}: {
  orders: RestaurantOrder[];
  auditRows: CustomerOperationalAuditRow[];
}) {
  const ordersByCustomer = new Map<string, RestaurantOrder[]>();

  orders.forEach((order) => {
    const key = getCustomerKey(order);
    ordersByCustomer.set(key, [...(ordersByCustomer.get(key) ?? []), order]);
  });

  return Array.from(ordersByCustomer.entries()).map(([customerKey, customerOrders]) => {
    const orderIds = customerOrders.map((order) => order.id);
    const orderIdSet = new Set(orderIds);
    const customerAuditRows = auditRows.filter((row) => orderIdSet.has(getAuditOrderId(row)));
    const reminders = customerAuditRows.filter(isReminder);
    const responses = customerAuditRows.filter(isInboundResponse);
    const responseTimes = responses
      .map((response) => {
        const responseAt = getAuditDate(response);
        if (!responseAt) return null;
        const previousReminder = reminders
          .map(getAuditDate)
          .filter((value): value is number => value !== null && value <= responseAt)
          .sort((a, b) => b - a)[0];
        return previousReminder ? minutesBetween(previousReminder, responseAt) : null;
      })
      .filter((value): value is number => value !== null);
    const paymentDelayCount = customerOrders.filter(
      (order) => order.status !== "PAID" && order.paymentState !== "VERIFIED" && !order.paymentVerified
    ).length;
    const paymentVerifiedCount = customerOrders.filter(
      (order) => order.status === "PAID" || order.paymentState === "VERIFIED" || order.paymentVerified
    ).length;
    const noShowCount = customerOrders.filter((order) => order.status === "NO_SHOW").length;
    const cancellationCount = customerOrders.filter((order) => order.status === "CANCELLED").length;
    const lateArrivalCount = customerAuditRows.filter((row) => lower(row.meta?.inboundIntent) === "running_late" || lower(row.action).includes("running late")).length;
    const slotChangeRequests = customerAuditRows.filter((row) => lower(row.meta?.inboundIntent) === "change_time_request" || lower(row.action).includes("time change")).length;
    const successfulRecoveryCount = customerAuditRows.filter(isRecoverySuccess).length;
    const escalationCount = customerAuditRows.filter(isEscalation).length;
    const periods = customerOrders
      .map((order) => getMalaysiaTimeParts(order.reservationTime))
      .filter((parts): parts is { hour: number; minute: number; label: string } => Boolean(parts));
    const preferredDiningPeriod = mode(periods.map((parts) => getDiningPeriod(parts.hour))) as CustomerOperationalMemoryProfile["preferredDiningPeriod"];
    const preferredReservationTimes = Array.from(new Set(periods.map((parts) => parts.label))).slice(0, 4);
    const communicationResponsiveness = clamp(
      52 +
        (responses.length / Math.max(reminders.length, 1)) * 36 -
        escalationCount * 7 -
        (responseTimes.length > 0 ? Math.min(18, (responseTimes.reduce((sum, value) => sum + value, 0) / responseTimes.length) / 8) : 8)
    );
    const recoveryCooperationScore = clamp(
      55 + successfulRecoveryCount * 11 + responses.length * 4 - noShowCount * 18 - cancellationCount * 10 - escalationCount * 5
    );
    const operationalReliability = clamp(
      62 +
        paymentVerifiedCount * 7 +
        communicationResponsiveness * 0.16 +
        recoveryCooperationScore * 0.12 -
        paymentDelayCount * 8 -
        noShowCount * 22 -
        cancellationCount * 11 -
        lateArrivalCount * 5
    );
    const recoveryLikelihood = clamp(
      48 +
        recoveryCooperationScore * 0.34 +
        communicationResponsiveness * 0.28 +
        paymentVerifiedCount * 4 -
        paymentDelayCount * 6 -
        noShowCount * 16
    );
    const communicationTrust = clamp(
      45 + communicationResponsiveness * 0.45 + operationalReliability * 0.25 - escalationCount * 5
    );
    const escalationRisk = clamp(
      28 + paymentDelayCount * 12 + escalationCount * 10 + noShowCount * 18 + cancellationCount * 9 - communicationResponsiveness * 0.18
    );
    const ghostRisk = clamp(
      22 + noShowCount * 24 + paymentDelayCount * 10 + escalationCount * 8 - responses.length * 6 - paymentVerifiedCount * 4
    );
    const rawFactorInputs = {
      remindersSent: reminders.length,
      remindersResponded: responses.length,
      paymentDelayCount,
      paymentVerifiedCount,
      lateArrivalCount,
      cancellationCount,
      noShowCount,
      slotChangeRequests,
      successfulRecoveryCount,
      escalationCount,
    };
    const reliabilityFactors = createReliabilityFactors(rawFactorInputs);
    const orchestrationBiasesApplied = [
      ...(communicationResponsiveness >= 72 ? ["Use softer reminder tone; customer has historically responded."] : []),
      ...(ghostRisk >= 68 ? ["Escalate earlier; ghost risk is elevated from customer memory."] : []),
      ...(operationalReliability >= 82 ? ["Lower friction; customer has earned operational trust."] : []),
      ...(lateArrivalCount >= 2 ? ["Add proactive timing buffer language for repeat late-arrival behavior."] : []),
      ...(recoveryCooperationScore >= 75 ? ["Increase recovery confidence; customer cooperates with recovery flows."] : []),
    ];

    return {
      customerKey,
      customerName: customerOrders[0]?.customerName ?? "Unknown customer",
      phone: customerOrders[0]?.phone ?? null,
      orderIds,
      remindersSent: reminders.length,
      remindersResponded: responses.length,
      averageResponseTime:
        responseTimes.length > 0
          ? Math.round(responseTimes.reduce((sum, value) => sum + value, 0) / responseTimes.length)
          : null,
      lateArrivalCount,
      cancellationCount,
      successfulRecoveryCount,
      paymentDelayCount,
      paymentVerifiedCount,
      noShowCount,
      slotChangeRequests,
      escalationCount,
      communicationResponsiveness,
      preferredDiningPeriod,
      preferredReservationTimes,
      recoveryCooperationScore,
      operationalReliability,
      recoveryLikelihood,
      communicationTrust,
      escalationRisk,
      ghostRisk,
      reliabilityFactors,
      memorySignalsUsed: [
        "orders",
        "audit_logs",
        "payment_state",
        "inbound_whatsapp_intents",
        "communication_outcomes",
        "reservation_times",
      ],
      orchestrationBiasesApplied:
        orchestrationBiasesApplied.length > 0
          ? orchestrationBiasesApplied
          : ["Neutral orchestration; no strong customer-specific bias detected."],
    } satisfies CustomerOperationalMemoryProfile;
  });
}

export function getCustomerOperationalMemoryForOrder({
  order,
  profiles,
}: {
  order: RestaurantOrder;
  profiles: CustomerOperationalMemoryProfile[];
}) {
  const key = getCustomerKey(order);
  return profiles.find((profile) => profile.customerKey === key || profile.orderIds.includes(order.id)) ?? null;
}

export function buildCustomerMemoryTimelineSignals(profile: CustomerOperationalMemoryProfile) {
  return [
    ...(profile.operationalReliability <= 45
      ? [{
          type: "reliability changed",
          severity: "WARNING" as const,
          summary: `${profile.customerName} reliability is ${profile.operationalReliability}/100 based on payment, response, and attendance history.`,
        }]
      : []),
    ...(profile.ghostRisk >= 70
      ? [{
          type: "ghost risk increased",
          severity: "WARNING" as const,
          summary: `${profile.customerName} ghost risk is ${profile.ghostRisk}/100 from no-show, payment delay, and escalation history.`,
        }]
      : []),
    ...(profile.operationalReliability >= 86 && profile.communicationTrust >= 78
      ? [{
          type: "VIP operational trust earned",
          severity: "INFO" as const,
          summary: `${profile.customerName} has earned high operational trust from verified payments and responsive behavior.`,
        }]
      : []),
    ...(profile.recoveryCooperationScore >= 78
      ? [{
          type: "recovery cooperation improved",
          severity: "INFO" as const,
          summary: `${profile.customerName} recovery cooperation is ${profile.recoveryCooperationScore}/100.`,
        }]
      : []),
  ];
}
