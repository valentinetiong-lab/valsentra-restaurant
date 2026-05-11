import type { AdaptiveDecisionContext, OperationalMemorySnapshot } from "@/app/lib/operationalMemoryEngine";
import type { OperationalDigitalTwin } from "@/app/lib/operationalDigitalTwinEngine";

export type PolicyStrictness = "LOW" | "MEDIUM" | "HIGH" | "STRICT";

export type OperationalPolicy = {
  organizationId: string;
  locationId?: string;
  automationAggressiveness: number;
  fraudSensitivity: number;
  recoveryAggressiveness: number;
  vipProtectionStrictness: PolicyStrictness;
  confidenceThresholds: {
    reversible: number;
    guarded: number;
    irreversible: number;
  };
  escalationSpeed: number;
  releaseTolerance: number;
  humanReviewRequiredAbove: number;
  maxAutonomousReleaseValue: number;
  maxAutonomousFraudActionValue: number;
  explanation: string[];
};

function clamp(value: number) {
  return Math.max(0, Math.min(Math.round(value), 100));
}

export function buildBaseOrganizationPolicy(organizationId = "org-valsentra"): OperationalPolicy {
  return {
    organizationId,
    automationAggressiveness: 58,
    fraudSensitivity: 78,
    recoveryAggressiveness: 68,
    vipProtectionStrictness: "HIGH",
    confidenceThresholds: {
      reversible: 72,
      guarded: 86,
      irreversible: 94,
    },
    escalationSpeed: 66,
    releaseTolerance: 42,
    humanReviewRequiredAbove: 750,
    maxAutonomousReleaseValue: 600,
    maxAutonomousFraudActionValue: 500,
    explanation: ["Default organization policy balances recovery speed with payment-truth safety."],
  };
}

export function resolveOperationalPolicy({
  organizationId = "org-valsentra",
  locationId = "loc-primary",
  memory,
  learningContext,
  digitalTwin,
}: {
  organizationId?: string;
  locationId?: string;
  memory?: OperationalMemorySnapshot;
  learningContext?: AdaptiveDecisionContext;
  digitalTwin?: OperationalDigitalTwin;
}): OperationalPolicy {
  const base = buildBaseOrganizationPolicy(organizationId);
  const branch = memory?.branchProfiles.find((profile) => profile.locationId === locationId);
  const orgLearning = memory?.organizationLearning;
  const falsePositiveRate = learningContext?.falsePositiveRate ?? 0;
  const recoveryMomentum = learningContext?.recoveryMomentum ?? branch?.recoveryQuality ?? 50;
  const branchStability = learningContext?.branchStability ?? (branch ? clamp(100 - branch.operationalVolatility) : 60);
  const systemicDrift = orgLearning?.systemicDrift ?? 30;
  const twinBranch = digitalTwin?.branches.find((profile) => profile.id === locationId);
  const twinOrg = digitalTwin?.organization;
  const explanations = [...base.explanation];

  let automationAggressiveness = base.automationAggressiveness;
  let fraudSensitivity = base.fraudSensitivity;
  let recoveryAggressiveness = base.recoveryAggressiveness;
  let escalationSpeed = base.escalationSpeed;
  let releaseTolerance = base.releaseTolerance;
  let vipProtectionStrictness = base.vipProtectionStrictness;
  let irreversibleThreshold = base.confidenceThresholds.irreversible;
  let guardedThreshold = base.confidenceThresholds.guarded;

  if (recoveryMomentum >= 70) {
    recoveryAggressiveness += 8;
    explanations.push("Recovery momentum is strong, so waitlist/recovery paths can be evaluated more confidently.");
  }

  if (branchStability < 45) {
    automationAggressiveness -= 12;
    escalationSpeed += 10;
    irreversibleThreshold += 3;
    explanations.push("Branch stability is weak, so irreversible automation becomes more conservative while escalation speeds up.");
  }

  if (falsePositiveRate >= 20) {
    automationAggressiveness -= 10;
    releaseTolerance -= 10;
    guardedThreshold += 4;
    explanations.push("False-positive history is elevated, so automation requires stronger evidence.");
  }

  if (systemicDrift >= 60) {
    automationAggressiveness -= 8;
    fraudSensitivity += 8;
    escalationSpeed += 8;
    explanations.push("Organization-level drift is rising, so policy shifts toward earlier review and fraud sensitivity.");
  }

  if (branch?.fraudTrend && branch.fraudTrend >= 45) {
    fraudSensitivity += 10;
    vipProtectionStrictness = "STRICT";
    explanations.push("Branch fraud trend is elevated, so VIP/high-value protection is stricter.");
  }

  if (twinBranch?.state === "OVERLOADED" || twinOrg?.state === "OVERLOADED") {
    automationAggressiveness -= 14;
    escalationSpeed += 12;
    guardedThreshold += 4;
    explanations.push("Digital twin detects overload, so policy reduces automation saturation and increases review sensitivity.");
  }

  if (twinBranch?.state === "FRAUD_ELEVATED" || twinOrg?.state === "FRAUD_ELEVATED") {
    fraudSensitivity += 12;
    releaseTolerance -= 12;
    irreversibleThreshold += 3;
    explanations.push("Digital twin fraud climate is elevated, so release tolerance decreases and fraud sensitivity rises.");
  }

  if (twinBranch?.state === "RECOVERING" && twinBranch.metrics.recoveryMomentum >= 70) {
    recoveryAggressiveness += 6;
    explanations.push("Digital twin shows recovery momentum, so reversible recovery paths can be considered earlier.");
  }

  return {
    ...base,
    locationId,
    automationAggressiveness: clamp(automationAggressiveness),
    fraudSensitivity: clamp(fraudSensitivity),
    recoveryAggressiveness: clamp(recoveryAggressiveness),
    vipProtectionStrictness,
    confidenceThresholds: {
      reversible: base.confidenceThresholds.reversible,
      guarded: Math.min(96, guardedThreshold),
      irreversible: Math.min(99, irreversibleThreshold),
    },
    escalationSpeed: clamp(escalationSpeed),
    releaseTolerance: clamp(releaseTolerance),
    explanation: explanations,
  };
}
