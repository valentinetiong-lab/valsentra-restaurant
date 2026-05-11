import {
  clamp,
  escalationFromScore,
  minutesUntil,
  type OperationalAgentContext,
  type OperationalAgentDecision,
} from "@/app/lib/agents/operationalAgentTypes";

function getReservationTime(orderTime?: string | null) {
  const parsed = new Date(orderTime ?? "").getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function isPeakHour(orderTime?: string | null) {
  const parsed = getReservationTime(orderTime);
  if (!parsed) return false;
  const hour = Number(
    new Intl.DateTimeFormat("en-MY", {
      timeZone: "Asia/Kuala_Lumpur",
      hour: "2-digit",
      hourCycle: "h23",
    }).format(new Date(parsed))
  );
  return (hour >= 12 && hour <= 14) || (hour >= 18 && hour <= 21);
}

function countServiceWaveOrders(context: OperationalAgentContext) {
  const target = getReservationTime(context.order.reservationTime);
  if (!target) return 0;

  return context.activeOrders.filter((candidate) => {
    const candidateTime = getReservationTime(candidate.reservationTime);
    if (!candidateTime) return false;
    return Math.abs(candidateTime - target) <= 60 * 60000;
  }).length;
}

export function runOperationsAgent(context: OperationalAgentContext): OperationalAgentDecision {
  const { order, activeOrders } = context;
  const waveOrders = countServiceWaveOrders(context);
  const peakHour = isPeakHour(order.reservationTime);
  const minutesToReservation = minutesUntil(order.reservationTime);
  const unresolvedInWave = context.activeOrders.filter((candidate) => {
    const candidateTime = getReservationTime(candidate.reservationTime);
    const orderTime = getReservationTime(order.reservationTime);
    if (!candidateTime || !orderTime) return false;
    const sameWave = Math.abs(candidateTime - orderTime) <= 60 * 60000;
    const unresolved =
      candidate.status !== "PAID" &&
      candidate.paymentState !== "VERIFIED" &&
      !candidate.paymentVerified;
    return sameWave && unresolved;
  }).length;
  const staffingLoadAssumption = clamp(activeOrders.length * 7 + waveOrders * 8 + unresolvedInWave * 10);
  const congestion = clamp(waveOrders * 14 + unresolvedInWave * 12 + (peakHour ? 14 : 0));
  const peakProtection = peakHour && Number(order.amount ?? 0) >= 180;

  return {
    agentName: "Operations Agent",
    agentDecision:
      congestion >= 82
        ? "Service wave congestion is high; protect staff attention and slot timing."
        : peakProtection
          ? "Peak-hour slot deserves stronger protection."
          : congestion >= 55
            ? "Operational pressure is building around this service window."
            : "Service wave pressure is stable.",
    confidence: clamp(60 + Math.min(24, waveOrders * 3) + (peakHour ? 8 : 0)),
    reasoning: [
      `Orders within the service wave: ${waveOrders}.`,
      `Unresolved orders in the same wave: ${unresolvedInWave}.`,
      `Peak-hour reservation: ${peakHour}.`,
      `Minutes until reservation: ${minutesToReservation ?? "unknown"}.`,
    ],
    recommendedActions: [
      ...(congestion >= 82 ? ["Keep risky orders out of staff setup flow until payment truth is clear."] : []),
      ...(peakProtection ? ["Prioritize peak-hour payment verification before slot collapse."] : []),
      ...(unresolvedInWave >= 3 ? ["Avoid creating additional staff intervention load in this wave."] : []),
      ...(congestion < 55 ? ["Maintain normal staff workflow monitoring."] : []),
    ],
    escalationLevel: escalationFromScore(congestion),
    supportingSignals: {
      waveOrders,
      unresolvedInWave,
      peakHour,
      minutesToReservation,
      staffingLoadAssumption,
      congestion,
      peakProtection,
    },
  };
}
