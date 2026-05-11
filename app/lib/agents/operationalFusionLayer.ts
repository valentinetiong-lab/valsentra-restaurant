import { runCommunicationAgent } from "@/app/lib/agents/communicationAgent";
import { runOperationsAgent } from "@/app/lib/agents/operationsAgent";
import { runRecoveryAgent } from "@/app/lib/agents/recoveryAgent";
import { runRevenueAgent } from "@/app/lib/agents/revenueAgent";
import { runTrustAgent } from "@/app/lib/agents/trustAgent";
import {
  clamp,
  type AgentEscalationLevel,
  type OperationalAgentContext,
  type OperationalAgentDecision,
  type OperationalAgentName,
} from "@/app/lib/agents/operationalAgentTypes";

export type MultiAgentTimelineSignal =
  | "agent escalation"
  | "operational conflict"
  | "recovery consensus"
  | "trust downgrade"
  | "revenue protection intervention";

export type MultiAgentFusionResult = {
  participatingAgents: OperationalAgentName[];
  agentDecisions: OperationalAgentDecision[];
  fusionDecision:
    | "SAFETY_REVIEW_REQUIRED"
    | "RECOVERY_CONSENSUS"
    | "REVENUE_PROTECTION_INTERVENTION"
    | "COMMUNICATION_PACING_REQUIRED"
    | "MONITOR_WITH_AUTONOMOUS_RECOVERY";
  confidence: number;
  escalationLevel: AgentEscalationLevel;
  dominantSignals: string[];
  conflictingRecommendations: string[];
  finalOperationalReasoning: string[];
  recommendedActions: string[];
  timelineSignalType: MultiAgentTimelineSignal | null;
};

const escalationWeight: Record<AgentEscalationLevel, number> = {
  LOW: 25,
  WATCH: 50,
  WARNING: 75,
  CRITICAL: 95,
};

function levelFromWeight(value: number): AgentEscalationLevel {
  if (value >= 88) return "CRITICAL";
  if (value >= 68) return "WARNING";
  if (value >= 42) return "WATCH";
  return "LOW";
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function getBooleanSignal(decision: OperationalAgentDecision, key: string) {
  return decision.supportingSignals[key] === true;
}

function getNumberSignal(decision: OperationalAgentDecision, key: string) {
  const value = Number(decision.supportingSignals[key] ?? 0);
  return Number.isFinite(value) ? value : 0;
}

export function evaluateMultiAgentOperationalBrain(
  context: OperationalAgentContext
): MultiAgentFusionResult {
  const agentDecisions = [
    runRecoveryAgent(context),
    runTrustAgent(context),
    runRevenueAgent(context),
    runCommunicationAgent(context),
    runOperationsAgent(context),
  ];
  const trust = agentDecisions.find((decision) => decision.agentName === "Trust Agent");
  const recovery = agentDecisions.find((decision) => decision.agentName === "Recovery Agent");
  const revenue = agentDecisions.find((decision) => decision.agentName === "Revenue Agent");
  const communication = agentDecisions.find((decision) => decision.agentName === "Communication Agent");
  const elevatedAgents = agentDecisions.filter(
    (decision) => decision.escalationLevel === "WARNING" || decision.escalationLevel === "CRITICAL"
  );
  const criticalAgents = agentDecisions.filter((decision) => decision.escalationLevel === "CRITICAL");
  const fraudSignal = trust ? getBooleanSignal(trust, "fraudSignal") : false;
  const communicationFatigue = communication ? getNumberSignal(communication, "fatigue") : 0;
  const revenuePressure = revenue ? getNumberSignal(revenue, "revenuePressure") : 0;
  const recoveryPressure = recovery ? getNumberSignal(recovery, "recoveryPressure") : 0;
  const conflictReasons = [
    ...(communicationFatigue >= 78 && (recoveryPressure >= 68 || revenuePressure >= 68)
      ? ["Communication Agent recommends pacing while Recovery/Revenue agents want intervention."]
      : []),
    ...(fraudSignal && recovery?.recommendedActions.some((action) => action.toLowerCase().includes("payment"))
      ? ["Trust Agent blocks customer-facing payment action until payment truth review."]
      : []),
    ...(revenuePressure >= 78 && context.waitlistAvailability === 0
      ? ["Revenue Agent sees exposure but waitlist recovery capacity is unavailable."]
      : []),
  ];

  let fusionDecision: MultiAgentFusionResult["fusionDecision"] = "MONITOR_WITH_AUTONOMOUS_RECOVERY";
  let timelineSignalType: MultiAgentTimelineSignal | null = null;

  if (fraudSignal || trust?.escalationLevel === "CRITICAL") {
    fusionDecision = "SAFETY_REVIEW_REQUIRED";
    timelineSignalType = "trust downgrade";
  } else if (elevatedAgents.length >= 3 && recoveryPressure >= 60) {
    fusionDecision = "RECOVERY_CONSENSUS";
    timelineSignalType = "recovery consensus";
  } else if (revenuePressure >= 78) {
    fusionDecision = "REVENUE_PROTECTION_INTERVENTION";
    timelineSignalType = "revenue protection intervention";
  } else if (communicationFatigue >= 78) {
    fusionDecision = "COMMUNICATION_PACING_REQUIRED";
    timelineSignalType = conflictReasons.length > 0 ? "operational conflict" : "agent escalation";
  } else if (elevatedAgents.length > 0) {
    timelineSignalType = "agent escalation";
  }

  const weightedEscalation = clamp(
    agentDecisions.reduce(
      (sum, decision) => sum + escalationWeight[decision.escalationLevel] * (decision.confidence / 100),
      0
    ) / agentDecisions.length
  );
  const confidence = clamp(
    agentDecisions.reduce((sum, decision) => sum + decision.confidence, 0) / agentDecisions.length +
      elevatedAgents.length * 3 -
      conflictReasons.length * 4
  );
  const dominantSignals = unique(
    agentDecisions
      .sort((left, right) => escalationWeight[right.escalationLevel] - escalationWeight[left.escalationLevel])
      .slice(0, 3)
      .flatMap((decision) => [
        `${decision.agentName}: ${decision.agentDecision}`,
        ...decision.reasoning.slice(0, 1),
      ])
  );
  const recommendedActions = unique(
    agentDecisions.flatMap((decision) => decision.recommendedActions)
  ).slice(0, 6);
  const finalOperationalReasoning = [
    `${agentDecisions.length} deterministic operational agents evaluated order ${context.order.id}.`,
    ...(criticalAgents.length > 0
      ? [`${criticalAgents.length} agent${criticalAgents.length === 1 ? "" : "s"} returned CRITICAL escalation.`]
      : []),
    ...(elevatedAgents.length > 0
      ? [`${elevatedAgents.length} agent${elevatedAgents.length === 1 ? "" : "s"} returned elevated pressure.`]
      : ["No agent returned elevated pressure beyond monitoring range."]),
    ...(conflictReasons.length > 0
      ? [`Fusion detected ${conflictReasons.length} operational conflict${conflictReasons.length === 1 ? "" : "s"} before selecting the final posture.`]
      : ["No material agent conflict detected."]),
    `Final fused decision: ${fusionDecision}.`,
  ];

  return {
    participatingAgents: agentDecisions.map((decision) => decision.agentName),
    agentDecisions,
    fusionDecision,
    confidence,
    escalationLevel: levelFromWeight(Math.max(weightedEscalation, ...criticalAgents.map(() => 95))),
    dominantSignals,
    conflictingRecommendations: conflictReasons,
    finalOperationalReasoning,
    recommendedActions,
    timelineSignalType,
  };
}
