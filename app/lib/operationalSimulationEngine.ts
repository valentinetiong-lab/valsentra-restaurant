import type { AutonomousAction } from "@/app/lib/autonomousDecisionEngine";
import type { RestaurantOrder } from "@/app/lib/domain/restaurant";
import type { OperationalDigitalTwin } from "@/app/lib/operationalDigitalTwinEngine";
import type { AdaptiveDecisionContext } from "@/app/lib/operationalMemoryEngine";
import type { OperationalPolicy } from "@/app/lib/policyEngine";

export type SimulatedAction =
  | AutonomousAction
  | "WAIT_FOR_PAYMENT";

export type SimulationPath = {
  action: SimulatedAction;
  recoveryLikelihood: number;
  projectedRevenueProtection: number;
  projectedExposure: number;
  customerTrustRisk: number;
  falsePositiveRisk: number;
  operationalPressureImpact: number;
  reversibility: "REVERSIBLE" | "PARTIALLY_REVERSIBLE" | "IRREVERSIBLE";
  branchStabilityImpact: number;
  simulationConfidence: number;
  score: number;
  rejectedReasons: string[];
  explanation: string[];
};

export type OperationalSimulationResult = {
  orderId: string;
  policy: {
    automationAggressiveness: number;
    fraudSensitivity: number;
    recoveryAggressiveness: number;
    releaseTolerance: number;
    escalationSpeed: number;
  };
  paths: SimulationPath[];
  bestProjectedAction: SimulationPath;
  safestProjectedAction: SimulationPath;
  highestRecoveryAction: SimulationPath;
  lowestTrustRiskAction: SimulationPath;
  lowestOperationalPressureAction: SimulationPath;
  recommendedPolicyAdjustments: string[];
  confidence: number;
  memoryInfluence: string[];
};

function clamp(value: number) {
  return Math.max(0, Math.min(Math.round(value), 100));
}

function isVerified(order: RestaurantOrder) {
  return order.status === "PAID" || order.paymentState === "VERIFIED" || Boolean(order.paymentVerified);
}

function reversibility(action: SimulatedAction): SimulationPath["reversibility"] {
  if (
    action === "WAIT_FOR_PAYMENT" ||
    action === "SEND_REMINDER" ||
    action === "ESCALATE_PAYMENT" ||
    action === "REQUIRE_DEPOSIT" ||
    action === "OFFER_WAITLIST" ||
    action === "REQUEST_OWNER_REVIEW"
  ) return "REVERSIBLE";
  if (action === "BLOCK_ORDER" || action === "FREEZE_ORDER") return "PARTIALLY_REVERSIBLE";
  return "IRREVERSIBLE";
}

function simulatePath({
  order,
  action,
  waitlistAvailability,
  policy,
  learningContext,
  digitalTwin,
}: {
  order: RestaurantOrder;
  action: SimulatedAction;
  waitlistAvailability: number;
  policy: OperationalPolicy;
  learningContext?: AdaptiveDecisionContext;
  digitalTwin?: OperationalDigitalTwin;
}): SimulationPath {
  const amount = Number(order.amount ?? 0);
  const collapse = Number(order.collapseProbability ?? 0);
  const fraud = order.terminalMismatch || order.paymentState === "FAILED" || order.paymentState === "BLOCKED";
  const vip = Number(order.reliabilityScore ?? 0) >= 95;
  const historicalSuccess = learningContext?.historicalSuccessRate ?? 50;
  const falsePositiveHistory = learningContext?.falsePositiveRate ?? 0;
  const branchStability = learningContext?.branchStability ?? 60;
  const memoryAdjustment = learningContext?.confidenceAdjustment ?? 0;
  const twinBranch = digitalTwin?.branches.find((profile) => profile.id === (order.locationId ?? "loc-primary"));
  const twinPressure = twinBranch?.metrics.operationalPressure ?? digitalTwin?.organization.metrics.operationalPressure ?? 45;
  const twinFatigue = twinBranch?.metrics.operationalFatigue ?? digitalTwin?.organization.metrics.operationalFatigue ?? 30;
  const rev = reversibility(action);

  let recoveryLikelihood = clamp(historicalSuccess * 0.45 + waitlistAvailability * 15 + policy.recoveryAggressiveness * 0.25 - collapse * 0.12);
  let projectedRevenueProtection = Math.round(amount * (recoveryLikelihood / 100));
  let projectedExposure = Math.round(amount - projectedRevenueProtection);
  let customerTrustRisk = clamp((vip ? 26 : 0) + (action === "RELEASE_SLOT" ? 36 : 0) + (action === "BLOCK_ORDER" ? 22 : 0));
  let falsePositiveRisk = clamp(falsePositiveHistory + (fraud ? -8 : 8) + (action === "BLOCK_ORDER" ? 12 : 0));
  let operationalPressureImpact = clamp(collapse - recoveryLikelihood * 0.35 + twinPressure * 0.12);
  const branchStabilityImpact = clamp(branchStability + recoveryLikelihood * 0.18 - customerTrustRisk * 0.12 - falsePositiveRisk * 0.1);
  const explanation: string[] = [];
  const rejectedReasons: string[] = [];

  if (action === "WAIT_FOR_PAYMENT") {
    recoveryLikelihood = clamp(30 + Number(order.reliabilityScore ?? 70) * 0.28 - collapse * 0.35);
    projectedRevenueProtection = Math.round(amount * (recoveryLikelihood / 100));
    projectedExposure = Math.round(amount - projectedRevenueProtection);
    operationalPressureImpact = clamp(collapse + 14);
    explanation.push("Waiting preserves customer trust but allows collapse exposure to grow.");
  }

  if (action === "SEND_REMINDER" || action === "ESCALATE_PAYMENT" || action === "REQUIRE_DEPOSIT") {
    const lift = action === "ESCALATE_PAYMENT" ? 16 : action === "REQUIRE_DEPOSIT" ? 13 : 9;
    recoveryLikelihood = clamp(recoveryLikelihood + lift + policy.escalationSpeed * 0.12);
    projectedRevenueProtection = Math.round(amount * (recoveryLikelihood / 100));
    projectedExposure = Math.round(amount - projectedRevenueProtection);
    customerTrustRisk = clamp(customerTrustRisk + (action === "ESCALATE_PAYMENT" ? 8 : 4));
    operationalPressureImpact = clamp(operationalPressureImpact - lift);
    explanation.push(`${action} improves recovery odds while remaining reversible.`);
  }

  if (action === "OFFER_WAITLIST") {
    recoveryLikelihood = clamp(recoveryLikelihood + waitlistAvailability * 12 + policy.recoveryAggressiveness * 0.18);
    projectedRevenueProtection = Math.round(amount * (recoveryLikelihood / 100));
    projectedExposure = Math.round(amount - projectedRevenueProtection);
    customerTrustRisk = clamp(customerTrustRisk + 10);
    operationalPressureImpact = clamp(operationalPressureImpact - 22);
    explanation.push("Waitlist replacement reduces exposure if candidate availability holds.");
    if (waitlistAvailability <= 0) rejectedReasons.push("No waitlist availability detected.");
  }

  if (action === "RELEASE_SLOT") {
    recoveryLikelihood = clamp(waitlistAvailability * 24 + historicalSuccess * 0.25 - (vip ? 20 : 0));
    projectedRevenueProtection = Math.round(amount * (recoveryLikelihood / 100));
    projectedExposure = Math.round(amount - projectedRevenueProtection);
    customerTrustRisk = clamp(customerTrustRisk + 24);
    falsePositiveRisk = clamp(falsePositiveRisk + (isVerified(order) ? 60 : 12));
    operationalPressureImpact = clamp(operationalPressureImpact - 30);
    explanation.push("Release can reduce pressure quickly, but it is irreversible and trust-sensitive.");
    if (isVerified(order)) rejectedReasons.push("Verified payment protection rejects release.");
    if (amount > policy.maxAutonomousReleaseValue) rejectedReasons.push("Projected value exceeds branch release tolerance.");
  }

  if (action === "BLOCK_ORDER" || action === "FREEZE_ORDER") {
    recoveryLikelihood = clamp(fraud ? 72 : 38);
    projectedRevenueProtection = Math.round(amount * (fraud ? 0.8 : 0.35));
    projectedExposure = Math.round(amount - projectedRevenueProtection);
    customerTrustRisk = clamp(customerTrustRisk + 18);
    falsePositiveRisk = clamp(falsePositiveRisk + (fraud ? -12 : 25));
    operationalPressureImpact = clamp(operationalPressureImpact - (fraud ? 28 : 8));
    explanation.push(`${action} protects against unsafe payment states but must manage false-positive risk.`);
    if (!fraud && policy.fraudSensitivity < 85) rejectedReasons.push("Fraud signal is not strong enough for containment.");
  }

  if (action === "REQUEST_OWNER_REVIEW") {
    recoveryLikelihood = clamp(recoveryLikelihood + 8);
    projectedRevenueProtection = Math.round(amount * (recoveryLikelihood / 100));
    projectedExposure = Math.round(amount - projectedRevenueProtection);
    customerTrustRisk = clamp(customerTrustRisk - 8);
    falsePositiveRisk = clamp(falsePositiveRisk - 10);
    operationalPressureImpact = clamp(operationalPressureImpact + 5);
    explanation.push("Owner review lowers false-positive and trust risk, but pressure may continue while waiting.");
  }

  if (vip && policy.vipProtectionStrictness !== "LOW" && (action === "RELEASE_SLOT" || action === "BLOCK_ORDER")) {
    rejectedReasons.push("VIP protection policy discourages aggressive irreversible action.");
  }

  if (rev === "IRREVERSIBLE" && projectedRevenueProtection < amount * 0.45) {
    rejectedReasons.push("Irreversible path does not project enough protected revenue.");
  }

  const simulationConfidence = clamp(
    58 +
      historicalSuccess * 0.22 +
      branchStability * 0.16 +
      memoryAdjustment -
      falsePositiveRisk * 0.12 -
      rejectedReasons.length * 10
  );
  const score = clamp(
    recoveryLikelihood * 0.3 +
      (100 - projectedExposure / Math.max(amount, 1) * 100) * 0.25 +
      (100 - customerTrustRisk) * 0.18 +
      (100 - falsePositiveRisk) * 0.12 +
      (100 - operationalPressureImpact) * 0.15 -
      (rev === "IRREVERSIBLE" ? 8 : 0)
  );

  return {
    action,
    recoveryLikelihood,
    projectedRevenueProtection,
    projectedExposure,
    customerTrustRisk,
    falsePositiveRisk,
    operationalPressureImpact,
    reversibility: rev,
    branchStabilityImpact,
    simulationConfidence,
    score,
    rejectedReasons,
    explanation: [
      ...explanation,
      `Historical success ${historicalSuccess}% and branch stability ${branchStability}% influenced this projection.`,
      `Digital twin pressure ${twinPressure}/100 and fatigue ${twinFatigue}/100 adjusted the path.`,
    ],
  };
}

function byHighest<K extends keyof SimulationPath>(paths: SimulationPath[], key: K) {
  return [...paths].sort((a, b) => Number(b[key]) - Number(a[key]))[0];
}

function byLowest<K extends keyof SimulationPath>(paths: SimulationPath[], key: K) {
  return [...paths].sort((a, b) => Number(a[key]) - Number(b[key]))[0];
}

export function simulateOperationalDecision({
  order,
  waitlistAvailability,
  policy,
  learningContext,
  digitalTwin,
}: {
  order: RestaurantOrder;
  waitlistAvailability: number;
  policy: OperationalPolicy;
  learningContext?: AdaptiveDecisionContext;
  digitalTwin?: OperationalDigitalTwin;
}): OperationalSimulationResult {
  const actions: SimulatedAction[] = [
    "RELEASE_SLOT",
    "WAIT_FOR_PAYMENT",
    "ESCALATE_PAYMENT",
    "OFFER_WAITLIST",
    "REQUIRE_DEPOSIT",
    "BLOCK_ORDER",
    "REQUEST_OWNER_REVIEW",
  ];
  const paths = actions.map((action) =>
    simulatePath({ order, action, waitlistAvailability, policy, learningContext, digitalTwin })
  );
  const bestProjectedAction = byHighest(paths, "score");
  const safestProjectedAction = [...paths].sort((a, b) => {
    const aRisk = a.customerTrustRisk + a.falsePositiveRisk + (a.reversibility === "IRREVERSIBLE" ? 35 : 0);
    const bRisk = b.customerTrustRisk + b.falsePositiveRisk + (b.reversibility === "IRREVERSIBLE" ? 35 : 0);
    return aRisk - bRisk;
  })[0];
  const highestRecoveryAction = byHighest(paths, "recoveryLikelihood");
  const lowestTrustRiskAction = byLowest(paths, "customerTrustRisk");
  const lowestOperationalPressureAction = byLowest(paths, "operationalPressureImpact");
  const recommendedPolicyAdjustments: string[] = [];

  if (paths.some((path) => path.falsePositiveRisk >= 45)) {
    recommendedPolicyAdjustments.push("Increase confidence thresholds for fraud-sensitive actions.");
  }
  if (highestRecoveryAction.action === "OFFER_WAITLIST" && highestRecoveryAction.recoveryLikelihood >= 70) {
    recommendedPolicyAdjustments.push("Increase recovery aggressiveness for similar waitlist-backed cases.");
  }
  if (bestProjectedAction.reversibility === "IRREVERSIBLE" && bestProjectedAction.simulationConfidence < policy.confidenceThresholds.irreversible) {
    recommendedPolicyAdjustments.push("Keep irreversible actions behind owner review until simulation confidence improves.");
  }
  if ((learningContext?.branchStability ?? 60) < 45) {
    recommendedPolicyAdjustments.push("Escalate faster in this branch and reduce automation aggressiveness.");
  }

  return {
    orderId: order.id,
    policy: {
      automationAggressiveness: policy.automationAggressiveness,
      fraudSensitivity: policy.fraudSensitivity,
      recoveryAggressiveness: policy.recoveryAggressiveness,
      releaseTolerance: policy.releaseTolerance,
      escalationSpeed: policy.escalationSpeed,
    },
    paths,
    bestProjectedAction,
    safestProjectedAction,
    highestRecoveryAction,
    lowestTrustRiskAction,
    lowestOperationalPressureAction,
    recommendedPolicyAdjustments,
    confidence: clamp(paths.reduce((sum, path) => sum + path.simulationConfidence, 0) / paths.length),
    memoryInfluence: learningContext?.explanations ?? [
      "Simulation used live operational signals because memory context was unavailable.",
    ],
  };
}

export function getSimulationPathForAction(
  simulation: OperationalSimulationResult | undefined,
  action: SimulatedAction
) {
  return simulation?.paths.find((path) => path.action === action);
}
