import type { RestaurantOrder } from "@/app/lib/domain/restaurant";
import type { MultiLocationIntelligenceSnapshot } from "@/app/lib/intelligence/multiLocationIntelligenceEngine";
import type { OperationalMemorySnapshot } from "@/app/lib/operationalMemoryEngine";

export type OperationalTwinState =
  | "STABLE"
  | "PRESSURED"
  | "DEGRADED"
  | "RECOVERING"
  | "OVERLOADED"
  | "FRAUD_ELEVATED"
  | "COLLAPSE_RISK"
  | "AUTONOMOUS_SATURATED"
  | "HUMAN_DEPENDENT";

export type DigitalTwinClimate = {
  trustClimate: number;
  fraudClimate: number;
  operationalCalm: number;
  operationalStress: number;
  recoveryClimate: number;
  automationHealth: number;
  businessStability: number;
  interventionPressure: number;
};

export type DigitalTwinProfile = {
  id: string;
  name: string;
  type: "ORGANIZATION" | "BRANCH" | "SEGMENT" | "CUSTOMER_ECOSYSTEM";
  state: OperationalTwinState;
  previousState: OperationalTwinState;
  projectedNextState: OperationalTwinState;
  transitionReasons: string[];
  transitionConfidence: number;
  escalationVelocity: number;
  recoveryVelocity: number;
  stateDurationMinutes: number;
  metrics: {
    branchStability: number;
    fraudClimate: number;
    recoveryMomentum: number;
    customerReliabilityClimate: number;
    operationalPressure: number;
    automationSaturation: number;
    interventionOverload: number;
    waitlistStrength: number;
    collapseVolatility: number;
    paymentTrustHealth: number;
    escalationIntensity: number;
    demandPressure: number;
    exposureAcceleration: number;
    operationalFatigue: number;
  };
  climate: DigitalTwinClimate;
  explainability: {
    whyThisState: string;
    contributingSignals: string[];
    memoryInfluence: string[];
    policyInfluence: string[];
    projectedRisk: string;
  };
};

export type OperationalDigitalTwin = {
  organization: DigitalTwinProfile;
  branches: DigitalTwinProfile[];
  segments: DigitalTwinProfile[];
  customerReliabilityEcosystem: DigitalTwinProfile;
  instabilityRanking: Array<{ id: string; name: string; score: number; state: OperationalTwinState }>;
  automationSaturationMap: Array<{ locationId: string; locationName: string; saturation: number }>;
  operationalFatigueIndicators: Array<{ locationId: string; locationName: string; fatigue: number; reason: string }>;
  recoveryMomentumMap: Array<{ locationId: string; locationName: string; momentum: number }>;
  fraudClimateMap: Array<{ locationId: string; locationName: string; fraudClimate: number }>;
  systemicDrift: {
    fraudDrift: number;
    recoveryDrift: number;
    branchInstability: number;
    automationDependence: number;
    humanInterventionLoad: number;
    collapseClustering: number;
    customerReliabilityDegradation: number;
    policyInstability: number;
  };
  predictedEvolution: {
    likelyFutureState: OperationalTwinState;
    projectedInstability: number;
    projectedRecoveryMomentum: number;
    projectedOverload: number;
    projectedFraudEscalation: number;
    projectedBusinessStabilization: number;
    reasoning: string[];
  };
  generatedAt: string;
};

type AuditRow = Record<string, any>;

function clamp(value: number) {
  return Math.max(0, Math.min(Math.round(value), 100));
}

function avg(values: number[]) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function active(order: RestaurantOrder) {
  return order.status !== "CANCELLED" && order.status !== "NO_SHOW";
}

function verified(order: RestaurantOrder) {
  return order.status === "PAID" || order.paymentState === "VERIFIED" || Boolean(order.paymentVerified);
}

function classifyState(metrics: DigitalTwinProfile["metrics"]): OperationalTwinState {
  if (metrics.interventionOverload >= 72 || metrics.operationalFatigue >= 75) return "OVERLOADED";
  if (metrics.automationSaturation >= 78) return "AUTONOMOUS_SATURATED";
  if (metrics.fraudClimate >= 68) return "FRAUD_ELEVATED";
  if (metrics.collapseVolatility >= 68) return "COLLAPSE_RISK";
  if (metrics.operationalPressure >= 70) return "PRESSURED";
  if (metrics.recoveryMomentum >= 65 && metrics.operationalPressure >= 38) return "RECOVERING";
  if (metrics.customerReliabilityClimate <= 38 || metrics.paymentTrustHealth <= 35) return "DEGRADED";
  if (metrics.interventionOverload >= 50 && metrics.automationSaturation < 35) return "HUMAN_DEPENDENT";
  return "STABLE";
}

function projectNextState(state: OperationalTwinState, metrics: DigitalTwinProfile["metrics"]): OperationalTwinState {
  if (metrics.exposureAcceleration >= 65 || metrics.escalationIntensity >= 70) return "PRESSURED";
  if (metrics.fraudClimate >= 60 && metrics.paymentTrustHealth <= 45) return "FRAUD_ELEVATED";
  if (metrics.recoveryMomentum >= 72 && metrics.operationalFatigue <= 45) return "RECOVERING";
  if (metrics.branchStability >= 70 && metrics.operationalPressure <= 35) return "STABLE";
  return state;
}

function climateFromMetrics(metrics: DigitalTwinProfile["metrics"]): DigitalTwinClimate {
  return {
    trustClimate: metrics.paymentTrustHealth,
    fraudClimate: metrics.fraudClimate,
    operationalCalm: clamp(100 - metrics.operationalPressure - metrics.operationalFatigue * 0.25),
    operationalStress: clamp(metrics.operationalPressure * 0.65 + metrics.operationalFatigue * 0.35),
    recoveryClimate: metrics.recoveryMomentum,
    automationHealth: clamp(100 - Math.abs(metrics.automationSaturation - 58) - metrics.interventionOverload * 0.2),
    businessStability: metrics.branchStability,
    interventionPressure: metrics.interventionOverload,
  } as DigitalTwinClimate & { policyInstability?: number };
}

function buildProfile({
  id,
  name,
  type,
  metrics,
  memoryInfluence,
  policyInfluence,
}: {
  id: string;
  name: string;
  type: DigitalTwinProfile["type"];
  metrics: DigitalTwinProfile["metrics"];
  memoryInfluence: string[];
  policyInfluence: string[];
}): DigitalTwinProfile {
  const state = classifyState(metrics);
  const projectedNextState = projectNextState(state, metrics);
  const transitionReasons = [
    `Operational pressure ${metrics.operationalPressure}/100.`,
    `Fraud climate ${metrics.fraudClimate}/100.`,
    `Recovery momentum ${metrics.recoveryMomentum}/100.`,
    `Automation saturation ${metrics.automationSaturation}/100.`,
    `Operational fatigue ${metrics.operationalFatigue}/100.`,
  ];

  return {
    id,
    name,
    type,
    state,
    previousState: state,
    projectedNextState,
    transitionReasons,
    transitionConfidence: clamp(58 + Math.abs(metrics.operationalPressure - 45) * 0.35 + metrics.escalationIntensity * 0.12),
    escalationVelocity: metrics.escalationIntensity,
    recoveryVelocity: metrics.recoveryMomentum,
    stateDurationMinutes: clamp(15 + metrics.operationalFatigue * 0.8 + metrics.collapseVolatility * 0.5),
    metrics,
    climate: climateFromMetrics(metrics),
    explainability: {
      whyThisState: `${name} is ${state.toLowerCase().replaceAll("_", " ")} because pressure, fraud, recovery, and intervention signals are converging at the current levels.`,
      contributingSignals: transitionReasons,
      memoryInfluence,
      policyInfluence,
      projectedRisk:
        projectedNextState === state
          ? `Projected to remain ${state.toLowerCase().replaceAll("_", " ")} without new shocks.`
          : `Projected to move toward ${projectedNextState.toLowerCase().replaceAll("_", " ")}.`,
    },
  };
}

function branchMetrics({
  orders,
  auditRows,
  memory,
  locationId,
  waitlistCount,
}: {
  orders: RestaurantOrder[];
  auditRows: AuditRow[];
  memory: OperationalMemorySnapshot;
  locationId: string;
  waitlistCount: number;
}): DigitalTwinProfile["metrics"] {
  const activeOrders = orders.filter(active);
  const unresolved = activeOrders.filter((order) => !verified(order));
  const collapseValues = activeOrders.map((order) => Number(order.collapseProbability ?? 0));
  const fraudOrders = activeOrders.filter((order) => order.terminalMismatch || order.paymentState === "FAILED" || order.paymentState === "BLOCKED");
  const ghostEvents = auditRows.filter((row) => {
    const action = String(row.action ?? "").toLowerCase();
    return action.includes("ghost") || action.includes("reminder") || row.meta?.ghostPingUrgency;
  });
  const autonomousEvents = auditRows.filter((row) => row.meta?.autonomousDecision || row.meta?.operationalEvent);
  const reviewEvents = auditRows.filter((row) => row.meta?.requiresHumanAction || String(row.action ?? "").toLowerCase().includes("human review"));
  const branch = memory.branchProfiles.find((profile) => profile.locationId === locationId);
  const exposure = unresolved.reduce((sum, order) => sum + Number(order.amount ?? 0), 0);
  const total = activeOrders.reduce((sum, order) => sum + Number(order.amount ?? 0), 0);

  return {
    branchStability: branch ? clamp(100 - branch.operationalVolatility) : clamp(100 - avg(collapseValues)),
    fraudClimate: clamp((fraudOrders.length / Math.max(activeOrders.length, 1)) * 100 + (branch?.fraudTrend ?? 0) * 0.35),
    recoveryMomentum: branch?.recoveryQuality ?? 50,
    customerReliabilityClimate: clamp(avg(activeOrders.map((order) => Number(order.reliabilityScore ?? 70)))),
    operationalPressure: clamp(avg(collapseValues) + unresolved.length * 5 + (exposure / Math.max(total, 1)) * 25),
    automationSaturation: clamp((autonomousEvents.length / Math.max(auditRows.length, 1)) * 100),
    interventionOverload: clamp((reviewEvents.length / Math.max(activeOrders.length, 1)) * 25),
    waitlistStrength: clamp(waitlistCount * 22),
    collapseVolatility: clamp(avg(collapseValues) + collapseValues.filter((value) => value >= 70).length * 10),
    paymentTrustHealth: clamp(100 - (unresolved.length / Math.max(activeOrders.length, 1)) * 65 - fraudOrders.length * 12),
    escalationIntensity: clamp(ghostEvents.length * 12 + reviewEvents.length * 8),
    demandPressure: clamp(activeOrders.length * 10),
    exposureAcceleration: clamp((exposure / Math.max(total, 1)) * 100),
    operationalFatigue: clamp(reviewEvents.length * 10 + ghostEvents.length * 5 + unresolved.length * 4),
  };
}

export function buildOperationalDigitalTwin({
  orders,
  auditRows,
  memory,
  organization,
  waitlistCount = 0,
}: {
  orders: RestaurantOrder[];
  auditRows: AuditRow[];
  memory: OperationalMemorySnapshot;
  organization: MultiLocationIntelligenceSnapshot;
  waitlistCount?: number;
}): OperationalDigitalTwin {
  const generatedAt = new Date().toISOString();
  const locationIds = new Set(organization.locations.map((location) => location.locationId));
  if (locationIds.size === 0) locationIds.add("loc-primary");

  const branches = Array.from(locationIds).map((locationId) => {
    const location = organization.locations.find((candidate) => candidate.locationId === locationId);
    const branchOrders = orders.filter((order) => (order.locationId ?? "loc-primary") === locationId);
    const branchAudit = auditRows.filter((row) => (row.meta?.locationId ?? "loc-primary") === locationId);
    const metrics = branchMetrics({
      orders: branchOrders,
      auditRows: branchAudit,
      memory,
      locationId,
      waitlistCount,
    });
    const branchMemory = memory.branchProfiles.find((profile) => profile.locationId === locationId);

    return buildProfile({
      id: locationId,
      name: location?.locationName ?? branchMemory?.locationName ?? "Primary Location",
      type: "BRANCH",
      metrics,
      memoryInfluence: [
        branchMemory?.explanation ?? "No branch-specific memory signal has dominated this state.",
        memory.organizationLearning.explanation,
      ],
      policyInfluence: [
        metrics.fraudClimate >= 60 ? "Fraud sensitivity should rise for this branch." : "Fraud policy remains inside normal posture.",
        metrics.operationalFatigue >= 65 ? "Escalation speed should increase while automation aggressiveness reduces." : "No overload policy shift required.",
      ],
    });
  });

  const orgMetrics = {
    branchStability: clamp(avg(branches.map((branch) => branch.metrics.branchStability))),
    fraudClimate: clamp(avg(branches.map((branch) => branch.metrics.fraudClimate))),
    recoveryMomentum: clamp(avg(branches.map((branch) => branch.metrics.recoveryMomentum))),
    customerReliabilityClimate: clamp(avg(branches.map((branch) => branch.metrics.customerReliabilityClimate))),
    operationalPressure: clamp(avg(branches.map((branch) => branch.metrics.operationalPressure))),
    automationSaturation: clamp(avg(branches.map((branch) => branch.metrics.automationSaturation))),
    interventionOverload: clamp(avg(branches.map((branch) => branch.metrics.interventionOverload))),
    waitlistStrength: clamp(waitlistCount * 22),
    collapseVolatility: clamp(avg(branches.map((branch) => branch.metrics.collapseVolatility))),
    paymentTrustHealth: clamp(avg(branches.map((branch) => branch.metrics.paymentTrustHealth))),
    escalationIntensity: clamp(avg(branches.map((branch) => branch.metrics.escalationIntensity))),
    demandPressure: clamp(avg(branches.map((branch) => branch.metrics.demandPressure))),
    exposureAcceleration: clamp(avg(branches.map((branch) => branch.metrics.exposureAcceleration))),
    operationalFatigue: clamp(avg(branches.map((branch) => branch.metrics.operationalFatigue))),
  };

  const organizationProfile = buildProfile({
    id: organization.organizationPulse.organizationId,
    name: organization.organizationPulse.organizationName,
    type: "ORGANIZATION",
    metrics: orgMetrics,
    memoryInfluence: [memory.organizationLearning.explanation],
    policyInfluence: [
      orgMetrics.automationSaturation >= 70
        ? "Organization policy should reduce automation aggressiveness."
        : "Organization automation policy remains within operating range.",
    ],
  });

  const customerMetrics = {
    ...orgMetrics,
    branchStability: clamp(avg(memory.customerProfiles.map((profile) => profile.averageReliability))),
    customerReliabilityClimate: clamp(avg(memory.customerProfiles.map((profile) => profile.averageReliability))),
    operationalPressure: clamp(avg(memory.customerProfiles.map((profile) => profile.paymentDelayCount * 12 + profile.noShowCount * 20))),
    operationalFatigue: clamp(avg(memory.customerProfiles.map((profile) => profile.ghostPingCount * 10 + profile.paymentDelayCount * 5))),
  };
  const customerReliabilityEcosystem = buildProfile({
    id: "customer-reliability-ecosystem",
    name: "Customer reliability ecosystem",
    type: "CUSTOMER_ECOSYSTEM",
    metrics: customerMetrics,
    memoryInfluence: memory.customerProfiles.slice(0, 3).map((profile) =>
      `${profile.customerName}: reliability ${profile.averageReliability}, delays ${profile.paymentDelayCount}.`
    ),
    policyInfluence: ["Customer reliability climate influences deposit strictness and release tolerance."],
  });

  const systemicDrift = {
    fraudDrift: orgMetrics.fraudClimate,
    recoveryDrift: clamp(100 - orgMetrics.recoveryMomentum),
    branchInstability: clamp(100 - orgMetrics.branchStability),
    automationDependence: orgMetrics.automationSaturation,
    humanInterventionLoad: orgMetrics.interventionOverload,
    collapseClustering: orgMetrics.collapseVolatility,
    customerReliabilityDegradation: clamp(100 - orgMetrics.customerReliabilityClimate),
    policyInstability: memory.organizationLearning.systemicDrift,
  };

  return {
    organization: organizationProfile,
    branches,
    segments: [
      buildProfile({
        id: "payment-trust-segment",
        name: "Payment trust segment",
        type: "SEGMENT",
        metrics: { ...orgMetrics, operationalPressure: clamp(100 - orgMetrics.paymentTrustHealth), fraudClimate: orgMetrics.fraudClimate },
        memoryInfluence: ["Payment trust state is derived from unpaid, failed, blocked, and verified payment signals."],
        policyInfluence: ["Payment trust health adjusts fraud sensitivity and verification review requirements."],
      }),
    ],
    customerReliabilityEcosystem,
    instabilityRanking: [...branches, organizationProfile, customerReliabilityEcosystem]
      .map((profile) => ({
        id: profile.id,
        name: profile.name,
        state: profile.state,
        score: clamp(profile.metrics.operationalPressure + profile.metrics.fraudClimate * 0.35 + profile.metrics.operationalFatigue * 0.25),
      }))
      .sort((a, b) => b.score - a.score),
    automationSaturationMap: branches.map((branch) => ({
      locationId: branch.id,
      locationName: branch.name,
      saturation: branch.metrics.automationSaturation,
    })),
    operationalFatigueIndicators: branches.map((branch) => ({
      locationId: branch.id,
      locationName: branch.name,
      fatigue: branch.metrics.operationalFatigue,
      reason: branch.explainability.contributingSignals.join(" "),
    })),
    recoveryMomentumMap: branches.map((branch) => ({
      locationId: branch.id,
      locationName: branch.name,
      momentum: branch.metrics.recoveryMomentum,
    })),
    fraudClimateMap: branches.map((branch) => ({
      locationId: branch.id,
      locationName: branch.name,
      fraudClimate: branch.metrics.fraudClimate,
    })),
    systemicDrift,
    predictedEvolution: {
      likelyFutureState: organizationProfile.projectedNextState,
      projectedInstability: clamp(systemicDrift.branchInstability + systemicDrift.collapseClustering * 0.35),
      projectedRecoveryMomentum: orgMetrics.recoveryMomentum,
      projectedOverload: clamp(orgMetrics.operationalFatigue + orgMetrics.interventionOverload * 0.4),
      projectedFraudEscalation: systemicDrift.fraudDrift,
      projectedBusinessStabilization: clamp(orgMetrics.branchStability + orgMetrics.recoveryMomentum * 0.25 - orgMetrics.operationalPressure * 0.2),
      reasoning: organizationProfile.explainability.contributingSignals,
    },
    generatedAt,
  };
}
