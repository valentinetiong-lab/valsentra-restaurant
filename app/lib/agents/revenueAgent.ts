import {
  clamp,
  escalationFromScore,
  isPaymentResolved,
  type OperationalAgentContext,
  type OperationalAgentDecision,
} from "@/app/lib/agents/operationalAgentTypes";

export function runRevenueAgent(context: OperationalAgentContext): OperationalAgentDecision {
  const { order, waitlistAvailability } = context;
  const amount = Number(order.amount ?? 0);
  const collapse = Number(order.collapseProbability ?? 0);
  const revenueAtRisk = isPaymentResolved(order) ? 0 : amount;
  const waitlistRecoveryValue = waitlistAvailability > 0 ? Math.round(amount * Math.min(0.9, waitlistAvailability * 0.2)) : 0;
  const utilizationPriority = clamp(amount * 0.08 + collapse * 0.5 + (waitlistAvailability > 0 ? 10 : -8));
  const revenuePressure = clamp((revenueAtRisk / 8) + collapse * 0.55 + (waitlistAvailability > 0 ? -8 : 8));

  return {
    agentName: "Revenue Agent",
    agentDecision:
      revenuePressure >= 80
        ? "Revenue protection intervention is warranted."
        : waitlistRecoveryValue > 0
          ? "Waitlist recovery has measurable fallback value."
          : "Revenue pressure can remain under monitoring.",
    confidence: clamp(64 + (amount >= 300 ? 12 : 0) + (collapse >= 70 ? 10 : 0)),
    reasoning: [
      `Revenue at risk: RM ${revenueAtRisk}.`,
      `Waitlist availability: ${waitlistAvailability}.`,
      `Estimated waitlist recovery value: RM ${waitlistRecoveryValue}.`,
      `Collapse severity: ${collapse}%.`,
    ],
    recommendedActions: [
      ...(revenueAtRisk > 0 ? ["Protect payment before preparing the order."] : []),
      ...(waitlistRecoveryValue > 0 && collapse >= 75 ? ["Prepare waitlist fallback without releasing verified payments."] : []),
      ...(utilizationPriority >= 70 ? ["Prioritize this slot in operational review."] : []),
      ...(revenueAtRisk === 0 ? ["No revenue intervention needed while payment remains verified."] : []),
    ],
    escalationLevel: escalationFromScore(revenuePressure),
    supportingSignals: {
      amount,
      revenueAtRisk,
      waitlistAvailability,
      waitlistRecoveryValue,
      collapse,
      utilizationPriority,
      revenuePressure,
    },
  };
}
