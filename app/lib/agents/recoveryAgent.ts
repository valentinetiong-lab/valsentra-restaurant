import {
  clamp,
  escalationFromScore,
  isPaymentResolved,
  minutesUntil,
  type OperationalAgentContext,
  type OperationalAgentDecision,
} from "@/app/lib/agents/operationalAgentTypes";

export function runRecoveryAgent(context: OperationalAgentContext): OperationalAgentDecision {
  const { order, customerMemory } = context;
  const paymentUnresolved = !isPaymentResolved(order);
  const reservationMinutes = minutesUntil(order.reservationTime);
  const slotMinutes = minutesUntil(order.slotHoldExpiresAt);
  const lateHistory = customerMemory?.lateArrivalCount ?? 0;
  const cancellationHistory = customerMemory?.cancellationCount ?? 0;
  const collapse = Number(order.collapseProbability ?? 0);
  const recoveryPressure = clamp(
    (paymentUnresolved ? 26 : 0) +
      collapse * 0.42 +
      (slotMinutes !== null && slotMinutes <= 0 ? 18 : 0) +
      (reservationMinutes !== null && reservationMinutes <= 90 ? 12 : 0) +
      lateHistory * 4 +
      cancellationHistory * 5
  );
  const recommendedActions = [
    ...(paymentUnresolved ? ["Recover payment before slot collapse."] : []),
    ...(lateHistory >= 2 ? ["Add proactive timing buffer to customer communication."] : []),
    ...(cancellationHistory > 0 ? ["Keep waitlist recovery warm in case cancellation repeats."] : []),
    ...(collapse >= 80 ? ["Prepare slot rescue path while preserving customer trust."] : []),
  ];

  return {
    agentName: "Recovery Agent",
    agentDecision:
      recoveryPressure >= 80
        ? "Active recovery required before slot collapse."
        : recoveryPressure >= 55
          ? "Monitor and prepare payment/slot recovery."
          : "Recovery pressure is manageable.",
    confidence: clamp(62 + Math.min(25, Math.abs(collapse - 50) * 0.4) + (customerMemory ? 8 : 0)),
    reasoning: [
      `Payment unresolved: ${paymentUnresolved}.`,
      `Collapse probability: ${collapse}%.`,
      `Slot hold minutes left: ${slotMinutes ?? "unknown"}.`,
      `Customer late arrivals in memory: ${lateHistory}.`,
    ],
    recommendedActions: recommendedActions.length > 0 ? recommendedActions : ["Continue normal monitoring."],
    escalationLevel: escalationFromScore(recoveryPressure),
    supportingSignals: {
      paymentUnresolved,
      collapseProbability: collapse,
      reservationMinutes,
      slotMinutes,
      lateHistory,
      cancellationHistory,
      recoveryPressure,
    },
  };
}
