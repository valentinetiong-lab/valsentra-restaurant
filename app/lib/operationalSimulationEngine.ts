import type { AutonomousAction } from "@/app/lib/autonomousDecisionEngine";
import type { CustomerOperationalMemoryProfile } from "@/app/lib/customerOperationalMemoryEngine";
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

export type OperationalFutureScenarioName =
  | "No intervention"
  | "WhatsApp reminder sent"
  | "Waitlist activated"
  | "Staff escalation"
  | "Tentative slot rescue";

export type OperationalTimelineProjection = {
  label: string;
  minutesFromNow: number;
  projectedState: string;
  riskLevel: "LOW" | "WATCH" | "WARNING" | "CRITICAL";
  explanation: string;
};

export type OperationalScenarioProjection = {
  scenario: OperationalFutureScenarioName;
  predictedOutcome: string;
  recoveryChance: number;
  estimatedRevenueLoss: number;
  revenueProtectionImpact: number;
  confidence: number;
  riskTrajectory: "IMPROVING" | "STABLE" | "WORSENING";
  interventionUrgency: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  explanation: string[];
};

export type OperationalFutureSimulation = {
  orderId: string;
  predictedOutcome: string;
  confidence: number;
  dominantRisk:
    | "NO_SHOW"
    | "PAYMENT_RECOVERY"
    | "LATE_ARRIVAL"
    | "SLOT_RECOVERY"
    | "WAITLIST_REPLACEMENT"
    | "CONGESTION"
    | "REVENUE_EXPOSURE"
    | "ESCALATION"
    | "COMMUNICATION_FATIGUE"
    | "STAFF_INTERVENTION";
  likelyOperationalPath: string[];
  simulatedRecoveryChance: number;
  estimatedRevenueLoss: number;
  recommendedIntervention: string;
  interventionUrgency: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  timelineProjection: OperationalTimelineProjection[];
  simulationFactorsUsed: string[];
  scenarios: OperationalScenarioProjection[];
  diagnostics: {
    simulationConfidence: number;
    simulationConsensus: string;
    dominantSimulationFactors: string[];
    projectionWindow: string;
    interventionComparison: Array<{
      scenario: OperationalFutureScenarioName;
      recoveryChance: number;
      estimatedRevenueLoss: number;
      riskTrajectory: OperationalScenarioProjection["riskTrajectory"];
    }>;
  };
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

function countRecentRows(rows: Array<Record<string, any>>, patterns: string[], withinMinutes: number) {
  const cutoff = Date.now() - withinMinutes * 60000;
  return rows.filter((row) => {
    const created = new Date(row.created_at ?? row.createdAt ?? "").getTime();
    if (!Number.isFinite(created) || created < cutoff) return false;
    const text = `${row.action ?? ""} ${JSON.stringify(row.meta ?? {})}`.toLowerCase();
    return patterns.some((pattern) => text.includes(pattern));
  }).length;
}

function countServiceWaveOrders(order: RestaurantOrder, activeOrders: RestaurantOrder[]) {
  const target = new Date(order.reservationTime ?? "").getTime();
  if (!Number.isFinite(target)) return 0;

  return activeOrders.filter((candidate) => {
    const time = new Date(candidate.reservationTime ?? "").getTime();
    if (!Number.isFinite(time)) return false;
    return Math.abs(time - target) <= 60 * 60000;
  }).length;
}

function urgencyFromScore(score: number): OperationalFutureSimulation["interventionUrgency"] {
  if (score >= 85) return "CRITICAL";
  if (score >= 68) return "HIGH";
  if (score >= 45) return "MEDIUM";
  return "LOW";
}

function riskFromScore(score: number): OperationalTimelineProjection["riskLevel"] {
  if (score >= 85) return "CRITICAL";
  if (score >= 68) return "WARNING";
  if (score >= 45) return "WATCH";
  return "LOW";
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

export function simulateOperationalFuture({
  order,
  activeOrders,
  auditRows,
  waitlistAvailability,
  customerMemory,
}: {
  order: RestaurantOrder;
  activeOrders: RestaurantOrder[];
  auditRows: Array<Record<string, any>>;
  waitlistAvailability: number;
  customerMemory?: CustomerOperationalMemoryProfile | null;
}): OperationalFutureSimulation {
  const amount = Number(order.amount ?? 0);
  const collapse = Number(order.collapseProbability ?? 0);
  const minutesToReservation = minutesUntil(order.reservationTime);
  const minutesToSlotExpiry = minutesUntil(order.slotHoldExpiresAt);
  const paymentResolved = isVerified(order);
  const fraudSignal = Boolean(order.terminalMismatch || order.paymentState === "BLOCKED" || order.paymentState === "FAILED");
  const communicationAttempts = countRecentRows(auditRows, ["communication", "whatsapp", "reminder"], 240);
  const inboundResponses = countRecentRows(auditRows, ["inbound whatsapp", "customer reply", "inbound_or_reply"], 240);
  const recoveryEvents = countRecentRows(auditRows, ["recovery", "waitlist", "tentative"], 360);
  const waveOrders = countServiceWaveOrders(order, activeOrders);
  const trustScore =
    customerMemory
      ? clamp(
          customerMemory.operationalReliability * 0.35 +
            customerMemory.communicationTrust * 0.25 +
            customerMemory.recoveryCooperationScore * 0.2 +
            (100 - customerMemory.ghostRisk) * 0.2
        )
      : Number(order.reliabilityScore ?? 70);
  const communicationFatigueRisk = clamp(communicationAttempts * 18 + (customerMemory?.communicationTrust ?? 60) * -0.12);
  const congestionImpact = clamp(waveOrders * 12 + activeOrders.length * 3 + (minutesToReservation !== null && minutesToReservation <= 90 ? 14 : 0));
  const noShowLikelihood = clamp(
    collapse * 0.45 +
      (customerMemory?.ghostRisk ?? 35) * 0.28 +
      (100 - trustScore) * 0.22 +
      (inboundResponses > 0 ? -18 : 0)
  );
  const paymentRecoveryProbability = paymentResolved
    ? 96
    : clamp(
        34 +
          trustScore * 0.22 +
          (customerMemory?.paymentVerifiedCount ?? 0) * 4 +
          (inboundResponses > 0 ? 14 : 0) -
          collapse * 0.18 -
          communicationFatigueRisk * 0.12
      );
  const lateArrivalImpact = clamp((customerMemory?.lateArrivalCount ?? 0) * 14 + (minutesToReservation !== null && minutesToReservation <= 45 ? 12 : 0));
  const slotRecoveryProbability = clamp(
    waitlistAvailability * 16 +
      (customerMemory?.recoveryCooperationScore ?? 50) * 0.26 +
      (minutesToSlotExpiry !== null && minutesToSlotExpiry > 20 ? 16 : -8) -
      collapse * 0.12
  );
  const waitlistReplacementSuccess = clamp(waitlistAvailability * 22 + recoveryEvents * 6 - congestionImpact * 0.12);
  const escalationLikelihood = clamp(collapse * 0.42 + (paymentResolved ? -20 : 14) + (fraudSignal ? 22 : 0));
  const staffInterventionNecessity = clamp(
    collapse * 0.28 +
      congestionImpact * 0.24 +
      communicationFatigueRisk * 0.2 +
      (fraudSignal ? 30 : 0) +
      (order.riskLevel === "HIGH" ? 16 : 0)
  );
  const revenueAtRiskProgression = paymentResolved ? 0 : clamp(collapse * 0.62 + congestionImpact * 0.18 + (minutesToReservation !== null && minutesToReservation <= 90 ? 12 : 0));

  const factors = {
    noShowLikelihood,
    paymentRecoveryProbability,
    lateArrivalImpact,
    slotRecoveryProbability,
    waitlistReplacementSuccess,
    congestionImpact,
    revenueAtRiskProgression,
    escalationLikelihood,
    communicationFatigueRisk,
    staffInterventionNecessity,
  };
  const dominantRisk = Object.entries({
    NO_SHOW: noShowLikelihood,
    PAYMENT_RECOVERY: 100 - paymentRecoveryProbability,
    LATE_ARRIVAL: lateArrivalImpact,
    SLOT_RECOVERY: 100 - slotRecoveryProbability,
    WAITLIST_REPLACEMENT: 100 - waitlistReplacementSuccess,
    CONGESTION: congestionImpact,
    REVENUE_EXPOSURE: revenueAtRiskProgression,
    ESCALATION: escalationLikelihood,
    COMMUNICATION_FATIGUE: communicationFatigueRisk,
    STAFF_INTERVENTION: staffInterventionNecessity,
  }).sort((a, b) => b[1] - a[1])[0][0] as OperationalFutureSimulation["dominantRisk"];

  const scenarioBase = [
    {
      scenario: "No intervention" as const,
      recoveryDelta: -16,
      lossMultiplier: 0.86,
      trustDelta: 6,
      trajectory: "WORSENING" as const,
    },
    {
      scenario: "WhatsApp reminder sent" as const,
      recoveryDelta: communicationFatigueRisk >= 72 ? 4 : 15,
      lossMultiplier: communicationFatigueRisk >= 72 ? 0.72 : 0.52,
      trustDelta: communicationFatigueRisk >= 72 ? -8 : 4,
      trajectory: communicationFatigueRisk >= 72 ? "STABLE" as const : "IMPROVING" as const,
    },
    {
      scenario: "Waitlist activated" as const,
      recoveryDelta: waitlistAvailability > 0 ? 22 : -8,
      lossMultiplier: waitlistAvailability > 0 ? 0.38 : 0.8,
      trustDelta: -6,
      trajectory: waitlistAvailability > 0 ? "IMPROVING" as const : "WORSENING" as const,
    },
    {
      scenario: "Staff escalation" as const,
      recoveryDelta: 12,
      lossMultiplier: 0.48,
      trustDelta: 10,
      trajectory: "IMPROVING" as const,
    },
    {
      scenario: "Tentative slot rescue" as const,
      recoveryDelta: slotRecoveryProbability >= 55 ? 18 : 4,
      lossMultiplier: slotRecoveryProbability >= 55 ? 0.42 : 0.74,
      trustDelta: 2,
      trajectory: slotRecoveryProbability >= 55 ? "IMPROVING" as const : "STABLE" as const,
    },
  ];
  const baseRecovery = clamp((paymentRecoveryProbability + slotRecoveryProbability + waitlistReplacementSuccess) / 3);
  const scenarios = scenarioBase.map((scenario): OperationalScenarioProjection => {
    const recoveryChance = clamp(baseRecovery + scenario.recoveryDelta + scenario.trustDelta * 0.25);
    const estimatedRevenueLoss = paymentResolved
      ? 0
      : Math.round(amount * scenario.lossMultiplier * Math.max(0.18, (100 - recoveryChance) / 100));
    return {
      scenario: scenario.scenario,
      predictedOutcome:
        scenario.trajectory === "IMPROVING"
          ? `${scenario.scenario} is projected to improve recovery posture.`
          : scenario.trajectory === "WORSENING"
            ? `${scenario.scenario} is projected to increase exposure.`
            : `${scenario.scenario} keeps risk stable while the system watches.`,
      recoveryChance,
      estimatedRevenueLoss,
      revenueProtectionImpact: Math.max(0, amount - estimatedRevenueLoss),
      confidence: clamp(58 + trustScore * 0.16 + (scenario.scenario === "No intervention" ? 8 : 0) - communicationFatigueRisk * 0.08),
      riskTrajectory: scenario.trajectory,
      interventionUrgency: urgencyFromScore(revenueAtRiskProgression + (100 - recoveryChance) * 0.35),
      explanation: [
        `Base recovery chance is ${baseRecovery}%.`,
        `Communication fatigue risk is ${communicationFatigueRisk}/100.`,
        `Waitlist availability is ${waitlistAvailability}.`,
        `Service wave pressure includes ${waveOrders} nearby order${waveOrders === 1 ? "" : "s"}.`,
      ],
    };
  });
  const bestScenario = [...scenarios].sort((a, b) => {
    if (b.recoveryChance !== a.recoveryChance) return b.recoveryChance - a.recoveryChance;
    return a.estimatedRevenueLoss - b.estimatedRevenueLoss;
  })[0];
  const noIntervention = scenarios.find((scenario) => scenario.scenario === "No intervention")!;
  const estimatedRevenueLoss = noIntervention.estimatedRevenueLoss;
  const interventionUrgency = urgencyFromScore(
    Math.max(revenueAtRiskProgression, staffInterventionNecessity, escalationLikelihood)
  );
  const predictedOutcome =
    dominantRisk === "REVENUE_EXPOSURE"
      ? "Revenue exposure is projected to grow without intervention."
      : dominantRisk === "COMMUNICATION_FATIGUE"
        ? "Communication fatigue may reduce recovery effectiveness."
        : dominantRisk === "STAFF_INTERVENTION"
          ? "Staff intervention is likely required before safe recovery."
          : dominantRisk === "NO_SHOW"
            ? "No-show risk is the leading projected outcome."
            : `${dominantRisk.replaceAll("_", " ").toLowerCase()} is the leading projected pressure.`;
  const confidence = clamp(
    scenarios.reduce((sum, scenario) => sum + scenario.confidence, 0) / scenarios.length +
      (customerMemory ? 6 : 0) -
      (fraudSignal ? 6 : 0)
  );
  const likelyOperationalPath = [
    paymentResolved ? "Payment truth remains verified." : "Payment remains unresolved.",
    inboundResponses > 0 ? "Customer has recently responded." : "Customer response remains unconfirmed.",
    bestScenario.predictedOutcome,
    staffInterventionNecessity >= 68
      ? "Staff review is likely needed before operational state changes."
      : "System can continue monitoring with reversible recovery recommendations.",
  ];
  const timelineProjection: OperationalTimelineProjection[] = [
    {
      label: "Now",
      minutesFromNow: 0,
      projectedState: paymentResolved ? "Protected monitoring" : "Unresolved payment exposure",
      riskLevel: riskFromScore(revenueAtRiskProgression),
      explanation: `Collapse probability is ${collapse}% and payment recovery probability is ${paymentRecoveryProbability}%.`,
    },
    {
      label: "Next 30 minutes",
      minutesFromNow: 30,
      projectedState: communicationFatigueRisk >= 70 ? "Outreach fatigue risk" : "Recovery window active",
      riskLevel: riskFromScore(Math.max(communicationFatigueRisk, collapse - 8)),
      explanation: `Communication fatigue risk is ${communicationFatigueRisk}/100.`,
    },
    {
      label: "Service approach",
      minutesFromNow: Math.max(60, Math.min(minutesToReservation ?? 120, 120)),
      projectedState: congestionImpact >= 68 ? "Congested service wave" : "Service wave manageable",
      riskLevel: riskFromScore(Math.max(congestionImpact, noShowLikelihood)),
      explanation: `${waveOrders} order${waveOrders === 1 ? "" : "s"} sit inside the same service wave.`,
    },
  ];
  const simulationFactorsUsed = [
    `Collapse probability ${collapse}%.`,
    `Trust score ${trustScore}/100.`,
    `Payment recovery probability ${paymentRecoveryProbability}%.`,
    `Slot recovery probability ${slotRecoveryProbability}%.`,
    `Waitlist replacement success ${waitlistReplacementSuccess}%.`,
    `Communication fatigue risk ${communicationFatigueRisk}/100.`,
    `Service wave pressure ${congestionImpact}/100.`,
    ...(customerMemory?.memorySignalsUsed ?? ["Live order and audit signals."]),
  ];
  const dominantSimulationFactors = Object.entries(factors)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([key, value]) => `${key.replaceAll("_", " ")} ${Math.round(value)}/100`);

  return {
    orderId: order.id,
    predictedOutcome,
    confidence,
    dominantRisk,
    likelyOperationalPath,
    simulatedRecoveryChance: bestScenario.recoveryChance,
    estimatedRevenueLoss,
    recommendedIntervention: bestScenario.scenario,
    interventionUrgency,
    timelineProjection,
    simulationFactorsUsed,
    scenarios,
    diagnostics: {
      simulationConfidence: confidence,
      simulationConsensus:
        bestScenario.recoveryChance >= noIntervention.recoveryChance + 12
          ? `${bestScenario.scenario} materially improves recovery compared with no intervention.`
          : "Simulation does not show a strong improvement over monitoring yet.",
      dominantSimulationFactors,
      projectionWindow:
        minutesToReservation !== null
          ? `Now to reservation in ${Math.max(0, minutesToReservation)} minutes`
          : "Next operational service window",
      interventionComparison: scenarios.map((scenario) => ({
        scenario: scenario.scenario,
        recoveryChance: scenario.recoveryChance,
        estimatedRevenueLoss: scenario.estimatedRevenueLoss,
        riskTrajectory: scenario.riskTrajectory,
      })),
    },
  };
}
