import {
  clamp,
  escalationFromScore,
  type OperationalAgentContext,
  type OperationalAgentDecision,
} from "@/app/lib/agents/operationalAgentTypes";

function countCommunicationAttempts(rows: Array<Record<string, any>>) {
  return rows.filter((row) => {
    const action = String(row.action ?? "").toLowerCase();
    const step = String(row.meta?.communicationOrchestration?.step ?? row.meta?.deliveryAttempt?.step ?? "").toLowerCase();
    return action.includes("communication") || action.includes("whatsapp") || action.includes("reminder") || step.includes("reminder");
  }).length;
}

function hasRecentOutbound(rows: Array<Record<string, any>>, minutes: number) {
  const cutoff = Date.now() - minutes * 60000;
  return rows.some((row) => {
    const createdAt = new Date(row.created_at ?? row.createdAt ?? "").getTime();
    if (!Number.isFinite(createdAt) || createdAt < cutoff) return false;
    const action = String(row.action ?? "").toLowerCase();
    return action.includes("communication") || action.includes("whatsapp") || action.includes("reminder");
  });
}

export function runCommunicationAgent(context: OperationalAgentContext): OperationalAgentDecision {
  const { order, auditRows, customerMemory } = context;
  const attempts = countCommunicationAttempts(auditRows);
  const recentOutbound = hasRecentOutbound(auditRows, 90);
  const responsiveness = customerMemory?.communicationResponsiveness ?? Number(order.reliabilityScore ?? 68);
  const trust = customerMemory?.communicationTrust ?? 65;
  const ghostRisk = customerMemory?.ghostRisk ?? (order.ghostPingUrgency === "CRITICAL" ? 82 : 38);
  const fatigue = clamp(attempts * 22 + (recentOutbound ? 28 : 0) + (100 - responsiveness) * 0.28);
  const pacingNeed = clamp(fatigue * 0.58 + ghostRisk * 0.25 - trust * 0.12);
  const shouldSoften = trust >= 75 || Number(order.reliabilityScore ?? 0) >= 86;
  const shouldEscalatePace = ghostRisk >= 72 && !recentOutbound;

  return {
    agentName: "Communication Agent",
    agentDecision:
      fatigue >= 78
        ? "Outreach should pause or move internal to prevent communication fatigue."
        : shouldEscalatePace
          ? "Payment outreach can escalate sooner because ghost risk is elevated."
          : shouldSoften
            ? "Use a softer trust-preserving communication tone."
            : "Customer outreach pacing is within safe operating range.",
    confidence: clamp(62 + attempts * 4 + (customerMemory ? 10 : 0) + (recentOutbound ? 8 : 0)),
    reasoning: [
      `Communication attempts on this order: ${attempts}.`,
      `Recent outbound within 90 minutes: ${recentOutbound}.`,
      `Customer communication responsiveness: ${responsiveness}/100.`,
      `Communication trust: ${trust}/100.`,
    ],
    recommendedActions: [
      ...(fatigue >= 78 ? ["Suppress customer-facing outreach until cooldown clears."] : []),
      ...(shouldEscalatePace ? ["Escalate payment communication once cooldown allows."] : []),
      ...(shouldSoften ? ["Use concise, lower-friction reminder language."] : []),
      ...(fatigue < 78 && !shouldEscalatePace && !shouldSoften ? ["Continue normal outreach pacing."] : []),
    ],
    escalationLevel: escalationFromScore(pacingNeed),
    supportingSignals: {
      attempts,
      recentOutbound,
      responsiveness,
      communicationTrust: trust,
      ghostRisk,
      fatigue,
      pacingNeed,
      shouldSoften,
      shouldEscalatePace,
    },
  };
}
