import type { AutoReleaseDecision } from "@/app/lib/autoReleaseEngine";
import type { AutopilotMode } from "@/app/lib/autopilotMode";
import type { RestaurantOrder } from "@/app/lib/domain/restaurant";
import type { AdaptiveDecisionContext } from "@/app/lib/operationalMemoryEngine";
import type { OperationalSimulationResult, SimulationPath } from "@/app/lib/operationalSimulationEngine";
import type { OperationalPolicy } from "@/app/lib/policyEngine";

export type AutonomousExecutionMode =
  | "OBSERVE_ONLY"
  | "RECOMMEND_ONLY"
  | "SAFE_AUTONOMOUS"
  | "FULL_AUTONOMOUS";

export type AutonomousAction =
  | "RELEASE_SLOT"
  | "OFFER_WAITLIST"
  | "SEND_REMINDER"
  | "ESCALATE_PAYMENT"
  | "REQUIRE_DEPOSIT"
  | "BLOCK_ORDER"
  | "FREEZE_ORDER"
  | "REQUEST_OWNER_REVIEW";

export type GuardrailCode =
  | "HUMAN_REVIEW_REQUIRED"
  | "IRREVERSIBLE_ACTION"
  | "VIP_CUSTOMER_PROTECTION"
  | "HIGH_VALUE_PROTECTION"
  | "FRAUD_UNCERTAINTY"
  | "CONFIDENCE_BELOW_THRESHOLD"
  | "ORGANIZATION_POLICY_LIMIT"
  | "BRANCH_EXECUTION_LIMIT"
  | "VERIFIED_PAYMENT_PROTECTION";

export type AutonomousDecision = {
  id: string;
  action: AutonomousAction;
  executionMode: AutonomousExecutionMode;
  shouldExecute: boolean;
  humanReviewRequired: boolean;
  humanReviewBypassedSafely: boolean;
  automationConfidence: number;
  operationalRisk: number;
  reversibility: "REVERSIBLE" | "PARTIALLY_REVERSIBLE" | "IRREVERSIBLE";
  financialExposure: number;
  recoveryLikelihood: number;
  escalationUrgency: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  customerTrustRisk: number;
  learningConfidenceAdjustment: number;
  historicalSuccessRate: number;
  falsePositiveRate: number;
  adaptiveExplanations: string[];
  simulation?: {
    bestProjectedAction: string;
    safestProjectedAction: string;
    highestRecoveryAction: string;
    lowestTrustRiskAction: string;
    simulationConfidence: number;
    selectedPath?: SimulationPath;
    rejectedAlternatives: string[];
    recommendedPolicyAdjustments: string[];
    memoryInfluence: string[];
  };
  policy?: Pick<
    OperationalPolicy,
    | "automationAggressiveness"
    | "fraudSensitivity"
    | "recoveryAggressiveness"
    | "releaseTolerance"
    | "escalationSpeed"
    | "confidenceThresholds"
  >;
  preventedRisk: number;
  expectedOutcome: string;
  guardrails: Array<{
    code: GuardrailCode;
    message: string;
    blocking: boolean;
  }>;
  signals: string[];
  reasoning: string[];
};

export type BranchExecutionPolicy = {
  maxAutonomousReleaseValue?: number;
  maxAutonomousFraudActionValue?: number;
  requireOwnerReviewAbove?: number;
  minimumConfidenceOverride?: number;
};

function clamp(value: number) {
  return Math.max(0, Math.min(Math.round(value), 100));
}

function isVerified(order: RestaurantOrder) {
  return order.status === "PAID" || order.paymentState === "VERIFIED" || Boolean(order.paymentVerified);
}

function minutesUntil(value?: string | null) {
  if (!value) return null;
  const diff = new Date(value).getTime() - Date.now();
  if (!Number.isFinite(diff)) return null;
  return Math.round(diff / 60000);
}

function isReversible(action: AutonomousAction): AutonomousDecision["reversibility"] {
  if (
    action === "SEND_REMINDER" ||
    action === "ESCALATE_PAYMENT" ||
    action === "REQUIRE_DEPOSIT" ||
    action === "OFFER_WAITLIST" ||
    action === "REQUEST_OWNER_REVIEW"
  ) {
    return "REVERSIBLE";
  }

  if (action === "FREEZE_ORDER" || action === "BLOCK_ORDER") {
    return "PARTIALLY_REVERSIBLE";
  }

  return "IRREVERSIBLE";
}

export function resolveAutonomousExecutionMode(
  mode?: AutopilotMode | AutonomousExecutionMode | string | null
): AutonomousExecutionMode {
  if (
    mode === "OBSERVE_ONLY" ||
    mode === "RECOMMEND_ONLY" ||
    mode === "SAFE_AUTONOMOUS" ||
    mode === "FULL_AUTONOMOUS"
  ) {
    return mode;
  }

  if (mode === "MANUAL") return "RECOMMEND_ONLY";
  if (mode === "SEMI_AUTO") return "SAFE_AUTONOMOUS";
  if (mode === "FULL_AUTO") return "FULL_AUTONOMOUS";

  return "SAFE_AUTONOMOUS";
}

function getMinimumConfidence(action: AutonomousAction, mode: AutonomousExecutionMode) {
  if (mode === "FULL_AUTONOMOUS") {
    if (action === "RELEASE_SLOT") return 88;
    if (action === "BLOCK_ORDER") return 90;
    if (action === "FREEZE_ORDER") return 82;
    return 68;
  }

  if (action === "RELEASE_SLOT") return 96;
  if (action === "BLOCK_ORDER") return 94;
  if (action === "FREEZE_ORDER") return 88;
  return 72;
}

function getActionOutcome(action: AutonomousAction) {
  if (action === "RELEASE_SLOT") return "Expired unpaid capacity is released for recovery.";
  if (action === "OFFER_WAITLIST") return "Waitlist replacement path is activated.";
  if (action === "SEND_REMINDER") return "Customer receives a payment reminder.";
  if (action === "ESCALATE_PAYMENT") return "Payment urgency is escalated before collapse.";
  if (action === "REQUIRE_DEPOSIT") return "Deposit protection is enforced before fulfillment.";
  if (action === "BLOCK_ORDER") return "Unsafe payment state is blocked from operational release.";
  if (action === "FREEZE_ORDER") return "Order is frozen until payment truth is verified.";
  return "Owner review is requested with full decision context.";
}

export function evaluateAutonomousDecision({
  order,
  action,
  executionMode,
  waitlistAvailability = 0,
  autoReleaseDecision,
  branchPolicy,
  organizationPolicy,
  learningContext,
  simulation,
  policy,
}: {
  order: RestaurantOrder;
  action: AutonomousAction;
  executionMode: AutonomousExecutionMode | AutopilotMode | string;
  waitlistAvailability?: number;
  autoReleaseDecision?: AutoReleaseDecision;
  branchPolicy?: BranchExecutionPolicy;
  organizationPolicy?: BranchExecutionPolicy;
  learningContext?: AdaptiveDecisionContext;
  simulation?: OperationalSimulationResult;
  policy?: OperationalPolicy;
}): AutonomousDecision {
  const mode = resolveAutonomousExecutionMode(executionMode);
  const financialExposure = Math.round(Number(order.amount ?? 0));
  const collapse = Number(order.collapseProbability ?? 0);
  const slotMinutesLeft = minutesUntil(order.slotHoldExpiresAt);
  const reservationMinutesLeft = minutesUntil(order.reservationTime);
  const reversible = isReversible(action);
  const fraudSignal =
    order.terminalMismatch ||
    order.paymentState === "FAILED" ||
    order.paymentState === "BLOCKED";
  const vipCustomer = Number(order.reliabilityScore ?? 0) >= 95;
  const highValue = financialExposure >= 500;
  const nearService = reservationMinutesLeft !== null && reservationMinutesLeft <= 90;
  const expiredHold = slotMinutesLeft !== null && slotMinutesLeft <= 0;
  const recoveryLikelihood = clamp(
    waitlistAvailability * 18 +
      Number(order.reliabilityScore ?? 70) * 0.35 +
      (order.ghostPingUrgency === "CRITICAL" ? -15 : 0) +
      (nearService ? -10 : 8)
  );
  const operationalRisk = clamp(
    collapse * 0.55 +
      (fraudSignal ? 30 : 0) +
      (highValue ? 12 : 0) +
      (nearService ? 10 : 0) +
      (isVerified(order) ? -40 : 0)
  );
  const customerTrustRisk = clamp(
    (action === "RELEASE_SLOT" ? 35 : 0) +
      (action === "BLOCK_ORDER" || action === "FREEZE_ORDER" ? 25 : 0) +
      (vipCustomer ? 30 : 0) +
      (highValue ? 10 : 0) -
      (fraudSignal ? 12 : 0)
  );
  const escalationUrgency: AutonomousDecision["escalationUrgency"] =
    collapse >= 90 || order.ghostPingUrgency === "CRITICAL" || fraudSignal
      ? "CRITICAL"
      : collapse >= 70 || order.ghostPingUrgency === "HIGH"
        ? "HIGH"
        : collapse >= 45
          ? "MEDIUM"
          : "LOW";
  const baseConfidence =
    autoReleaseDecision?.confidence ??
    clamp(
      64 +
        collapse * 0.25 +
        (expiredHold ? 16 : 0) +
        (fraudSignal ? 8 : 0) +
        (waitlistAvailability > 0 ? 8 : -4) -
        customerTrustRisk * 0.18
    );
  const automationConfidence = clamp(
    baseConfidence +
      (action === "SEND_REMINDER" ? 10 : 0) +
      (action === "REQUEST_OWNER_REVIEW" ? 15 : 0) -
      (reversible === "IRREVERSIBLE" ? 8 : 0) +
      (learningContext?.confidenceAdjustment ?? 0)
  );
  const selectedPath = simulation?.paths.find((path) => path.action === action);
  const simulationAdjustment = selectedPath
    ? clamp((selectedPath.score - 55) * 0.16 + (selectedPath.simulationConfidence - 60) * 0.12) - 8
    : 0;
  const finalAutomationConfidence = clamp(automationConfidence + simulationAdjustment);
  const minimumConfidence = Math.max(
    getMinimumConfidence(action, mode),
    selectedPath?.reversibility === "IRREVERSIBLE"
      ? policy?.confidenceThresholds.irreversible ?? 0
      : selectedPath?.reversibility === "PARTIALLY_REVERSIBLE"
        ? policy?.confidenceThresholds.guarded ?? 0
        : policy?.confidenceThresholds.reversible ?? 0,
    branchPolicy?.minimumConfidenceOverride ?? 0,
    organizationPolicy?.minimumConfidenceOverride ?? 0
  );
  const guardrails: AutonomousDecision["guardrails"] = [];

  if (mode === "OBSERVE_ONLY") {
    guardrails.push({
      code: "ORGANIZATION_POLICY_LIMIT",
      message: "Execution mode is observe-only; Valsentra may explain but cannot act.",
      blocking: true,
    });
  }

  if (mode === "RECOMMEND_ONLY") {
    guardrails.push({
      code: "HUMAN_REVIEW_REQUIRED",
      message: "Execution mode allows recommendations only.",
      blocking: true,
    });
  }

  if (isVerified(order) && action === "RELEASE_SLOT") {
    guardrails.push({
      code: "VERIFIED_PAYMENT_PROTECTION",
      message: "Verified payments are never released autonomously.",
      blocking: true,
    });
  }

  if (reversible === "IRREVERSIBLE" && mode !== "FULL_AUTONOMOUS") {
    guardrails.push({
      code: "IRREVERSIBLE_ACTION",
      message: "Irreversible action requires full autonomous mode or owner review.",
      blocking: true,
    });
  }

  if (vipCustomer && (action === "RELEASE_SLOT" || action === "BLOCK_ORDER")) {
    guardrails.push({
      code: "VIP_CUSTOMER_PROTECTION",
      message: "VIP or highly reliable customers require stronger human oversight.",
      blocking: true,
    });
  }

  if (highValue && (action === "RELEASE_SLOT" || action === "BLOCK_ORDER")) {
    guardrails.push({
      code: "HIGH_VALUE_PROTECTION",
      message: "High-value orders require stronger confidence before irreversible action.",
      blocking: mode !== "FULL_AUTONOMOUS" || automationConfidence < 94,
    });
  }

  if (fraudSignal && action === "RELEASE_SLOT") {
    guardrails.push({
      code: "FRAUD_UNCERTAINTY",
      message: "Fraud/payment uncertainty blocks slot release; freeze or owner review is safer.",
      blocking: true,
    });
  }

  if (selectedPath && selectedPath.rejectedReasons.length > 0) {
    guardrails.push({
      code: "ORGANIZATION_POLICY_LIMIT",
      message: `Simulation rejected this path: ${selectedPath.rejectedReasons[0]}.`,
      blocking: selectedPath.reversibility === "IRREVERSIBLE" || selectedPath.falsePositiveRisk >= 45,
    });
  }

  if (selectedPath && selectedPath.reversibility === "IRREVERSIBLE" && selectedPath.simulationConfidence < minimumConfidence) {
    guardrails.push({
      code: "IRREVERSIBLE_ACTION",
      message: `Simulation confidence ${selectedPath.simulationConfidence}% is below irreversible threshold ${minimumConfidence}%.`,
      blocking: true,
    });
  }

  if (finalAutomationConfidence < minimumConfidence) {
    guardrails.push({
      code: "CONFIDENCE_BELOW_THRESHOLD",
      message: `Automation confidence ${finalAutomationConfidence}% is below the ${minimumConfidence}% threshold.`,
      blocking: true,
    });
  }

  const branchLimit =
    action === "RELEASE_SLOT"
      ? branchPolicy?.maxAutonomousReleaseValue
      : branchPolicy?.maxAutonomousFraudActionValue;
  if (branchLimit !== undefined && financialExposure > branchLimit) {
    guardrails.push({
      code: "BRANCH_EXECUTION_LIMIT",
      message: `Branch execution limit blocks autonomous action above RM ${branchLimit}.`,
      blocking: true,
    });
  }

  const orgReviewLimit = organizationPolicy?.requireOwnerReviewAbove;
  if (orgReviewLimit !== undefined && financialExposure > orgReviewLimit) {
    guardrails.push({
      code: "ORGANIZATION_POLICY_LIMIT",
      message: `Organization policy requires owner review above RM ${orgReviewLimit}.`,
      blocking: true,
    });
  }

  const blockingGuardrails = guardrails.filter((guardrail) => guardrail.blocking);
  const safeAutonomousAllowed =
    mode === "SAFE_AUTONOMOUS" &&
    reversible === "REVERSIBLE" &&
    blockingGuardrails.length === 0;
  const fullAutonomousAllowed =
    mode === "FULL_AUTONOMOUS" && blockingGuardrails.length === 0;
  const shouldExecute = safeAutonomousAllowed || fullAutonomousAllowed;

  return {
    id: `decision-${order.id}-${action.toLowerCase()}-${Date.now()}`,
    action,
    executionMode: mode,
    shouldExecute,
    humanReviewRequired: blockingGuardrails.length > 0 || action === "REQUEST_OWNER_REVIEW",
    humanReviewBypassedSafely: shouldExecute && blockingGuardrails.length === 0,
    automationConfidence: finalAutomationConfidence,
    operationalRisk,
    reversibility: reversible,
    financialExposure,
    recoveryLikelihood,
    escalationUrgency,
    customerTrustRisk,
    preventedRisk: selectedPath?.projectedRevenueProtection ?? clamp(financialExposure * (operationalRisk / 100)),
    expectedOutcome: getActionOutcome(action),
    guardrails,
    signals: [
      `Payment state: ${order.paymentState ?? "UNPAID"}.`,
      `Collapse probability: ${collapse}%.`,
      `Ghost Ping urgency: ${order.ghostPingUrgency ?? "LOW"}.`,
      `Financial exposure: RM ${financialExposure}.`,
      `Recovery likelihood: ${selectedPath?.recoveryLikelihood ?? recoveryLikelihood}%.`,
      `Historical success rate: ${learningContext?.historicalSuccessRate ?? 50}%.`,
      simulation ? `Best simulated path: ${simulation.bestProjectedAction.action}.` : "No multi-path simulation was attached.",
    ],
    reasoning: [
      `Execution mode resolved to ${mode}.`,
      `Action reversibility is ${reversible}.`,
      `Automation confidence is ${finalAutomationConfidence}%.`,
      learningContext
        ? `Operational memory adjusted confidence by ${learningContext.confidenceAdjustment} points.`
        : "No operational memory adjustment was applied.",
      selectedPath
        ? `Simulation scored selected path ${selectedPath.score}/100 with ${selectedPath.simulationConfidence}% confidence.`
        : "No selected simulation path was available.",
      blockingGuardrails.length > 0
        ? `${blockingGuardrails.length} blocking guardrail${blockingGuardrails.length === 1 ? "" : "s"} active.`
        : "No blocking guardrails active.",
    ],
    learningConfidenceAdjustment: learningContext?.confidenceAdjustment ?? 0,
    historicalSuccessRate: learningContext?.historicalSuccessRate ?? 50,
    falsePositiveRate: learningContext?.falsePositiveRate ?? 0,
    adaptiveExplanations: learningContext?.explanations ?? [
      "Decision used live operational signals because historical memory was not available.",
    ],
    simulation: simulation
      ? {
          bestProjectedAction: simulation.bestProjectedAction.action,
          safestProjectedAction: simulation.safestProjectedAction.action,
          highestRecoveryAction: simulation.highestRecoveryAction.action,
          lowestTrustRiskAction: simulation.lowestTrustRiskAction.action,
          simulationConfidence: simulation.confidence,
          selectedPath,
          rejectedAlternatives: simulation.paths
            .filter((path) => path.action !== action)
            .sort((a, b) => b.score - a.score)
            .slice(0, 3)
            .map((path) => `${path.action}: score ${path.score}, exposure RM ${path.projectedExposure}`),
          recommendedPolicyAdjustments: simulation.recommendedPolicyAdjustments,
          memoryInfluence: simulation.memoryInfluence,
        }
      : undefined,
    policy: policy
      ? {
          automationAggressiveness: policy.automationAggressiveness,
          fraudSensitivity: policy.fraudSensitivity,
          recoveryAggressiveness: policy.recoveryAggressiveness,
          releaseTolerance: policy.releaseTolerance,
          escalationSpeed: policy.escalationSpeed,
          confidenceThresholds: policy.confidenceThresholds,
        }
      : undefined,
  };
}

export function decisionToAuditMeta(decision: AutonomousDecision) {
  return {
    autonomousDecision: {
      id: decision.id,
      action: decision.action,
      executionMode: decision.executionMode,
      shouldExecute: decision.shouldExecute,
      humanReviewRequired: decision.humanReviewRequired,
      humanReviewBypassedSafely: decision.humanReviewBypassedSafely,
      automationConfidence: decision.automationConfidence,
      operationalRisk: decision.operationalRisk,
      reversibility: decision.reversibility,
      financialExposure: decision.financialExposure,
      recoveryLikelihood: decision.recoveryLikelihood,
      escalationUrgency: decision.escalationUrgency,
      customerTrustRisk: decision.customerTrustRisk,
      learningConfidenceAdjustment: decision.learningConfidenceAdjustment,
      historicalSuccessRate: decision.historicalSuccessRate,
      falsePositiveRate: decision.falsePositiveRate,
      adaptiveExplanations: decision.adaptiveExplanations,
      simulation: decision.simulation,
      policy: decision.policy,
      preventedRisk: decision.preventedRisk,
      expectedOutcome: decision.expectedOutcome,
      guardrails: decision.guardrails,
      signals: decision.signals,
      reasoning: decision.reasoning,
    },
  };
}
