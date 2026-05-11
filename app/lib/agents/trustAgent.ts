import {
  clamp,
  escalationFromScore,
  type OperationalAgentContext,
  type OperationalAgentDecision,
} from "@/app/lib/agents/operationalAgentTypes";

export function runTrustAgent(context: OperationalAgentContext): OperationalAgentDecision {
  const { order, customerMemory } = context;
  const fraudSignal = Boolean(order.terminalMismatch || order.paymentState === "FAILED" || order.paymentState === "BLOCKED");
  const reliability = customerMemory?.operationalReliability ?? Number(order.reliabilityScore ?? 70);
  const ghostRisk = customerMemory?.ghostRisk ?? (order.ghostPingUrgency === "CRITICAL" ? 85 : order.ghostPingUrgency === "HIGH" ? 68 : 35);
  const vipTrust = reliability >= 86 && (customerMemory?.communicationTrust ?? 70) >= 78;
  const trustRisk = clamp((100 - reliability) * 0.4 + ghostRisk * 0.42 + (fraudSignal ? 35 : 0));

  return {
    agentName: "Trust Agent",
    agentDecision: fraudSignal
      ? "Payment trust is unsafe; internal verification required."
      : vipTrust
        ? "Customer has earned high operational trust."
        : ghostRisk >= 70
          ? "Ghost risk is elevated; use earlier escalation."
          : "Trust posture is acceptable.",
    confidence: clamp(66 + (customerMemory ? 12 : 0) + (fraudSignal ? 15 : 0)),
    reasoning: [
      `Operational reliability: ${reliability}/100.`,
      `Ghost risk: ${ghostRisk}/100.`,
      `Fraud/payment mismatch signal: ${fraudSignal}.`,
      `VIP operational trust: ${vipTrust}.`,
    ],
    recommendedActions: [
      ...(fraudSignal ? ["Do not release without payment truth verification."] : []),
      ...(ghostRisk >= 70 ? ["Escalate earlier if payment remains unresolved."] : []),
      ...(vipTrust ? ["Use lower-friction, trust-preserving communication."] : []),
      ...(!fraudSignal && ghostRisk < 70 && !vipTrust ? ["Continue trust-aware monitoring."] : []),
    ],
    escalationLevel: escalationFromScore(trustRisk),
    supportingSignals: {
      reliability,
      ghostRisk,
      communicationTrust: customerMemory?.communicationTrust ?? null,
      fraudSignal,
      vipTrust,
      trustRisk,
    },
  };
}
