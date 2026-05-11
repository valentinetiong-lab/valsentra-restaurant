import type { buildMultiLocationIntelligenceSnapshot } from "@/app/lib/intelligence/multiLocationIntelligenceEngine";
import type { OperationalMemoryPattern } from "@/app/lib/operationalMemoryEngine";

export type BrainSeverity = "INFO" | "WATCH" | "WARNING" | "CRITICAL";

export type BrainCategory =
  | "PAYMENT_TRUTH"
  | "COLLAPSE_PREVENTION"
  | "RECOVERY"
  | "FRAUD_CONTAINMENT"
  | "LEARNING"
  | "AUTOPILOT"
  | "ORGANIZATION";

export type BrainInsight = {
  id: string;
  title: string;
  summary: string;
  severity: BrainSeverity;
  category: BrainCategory;
  orderId?: string;
  customerName?: string;
  organizationId?: string;
  locationId?: string;
  locationName?: string;
  confidence: number;
  recommendedAction: string;
  reasoning: string[];
  createdAt: string;
  escalationUrgency: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  recoveryLikelihood: number;
  automationConfidence: number;
  whyThisMatters: string;
  decisionMode:
    | "INFORMATIONAL"
    | "MONITORING"
    | "INTERVENTION_REQUIRED"
    | "AUTONOMOUS_ACTION_SAFE";
  transition?: {
    label: string;
    from: string;
    to: string;
    direction: "UP" | "DOWN" | "RESTORED" | "UNCHANGED";
  };
  riskPrevented?: number;
  humanReviewBypassedSafely?: boolean;
  autonomousDecision?: {
    id: string;
    action: string;
    executionMode: string;
    shouldExecute: boolean;
    humanReviewRequired: boolean;
    automationConfidence: number;
    operationalRisk: number;
    reversibility: string;
    financialExposure: number;
    recoveryLikelihood: number;
    escalationUrgency: string;
    customerTrustRisk: number;
    learningConfidenceAdjustment?: number;
    historicalSuccessRate?: number;
    falsePositiveRate?: number;
    adaptiveExplanations?: string[];
    simulation?: {
      bestProjectedAction: string;
      safestProjectedAction: string;
      highestRecoveryAction: string;
      lowestTrustRiskAction: string;
      simulationConfidence: number;
      selectedPath?: {
        action: string;
        score: number;
        projectedRevenueProtection: number;
        projectedExposure: number;
        customerTrustRisk: number;
        falsePositiveRisk: number;
        operationalPressureImpact: number;
        reversibility: string;
        rejectedReasons: string[];
        explanation: string[];
      };
      rejectedAlternatives: string[];
      recommendedPolicyAdjustments: string[];
      memoryInfluence: string[];
    };
    policy?: {
      automationAggressiveness: number;
      fraudSensitivity: number;
      recoveryAggressiveness: number;
      releaseTolerance: number;
      escalationSpeed: number;
      confidenceThresholds: {
        reversible: number;
        guarded: number;
        irreversible: number;
      };
    };
    preventedRisk: number;
    expectedOutcome: string;
    guardrails: Array<{
      code: string;
      message: string;
      blocking: boolean;
    }>;
  };
  autonomousRecommendation:
    | "INTERVENE_NOW"
    | "SAFE_TO_AUTOMATE"
    | "WAIT_AND_MONITOR"
    | "ESCALATE_TO_OWNER"
    | "TRIGGER_RECOVERY_FLOW"
    | "REQUIRE_VERIFICATION";
  forecast?: {
    unrecoverableLikelihood: number;
    timeToCollapseMinutes: number | null;
    recoverySuccessLikelihood: number;
    projectedRevenueExposureGrowth: number;
    trend: "RISING" | "FALLING" | "STABLE";
  };
  systemPressure?: {
    level: "LOW" | "WATCH" | "ELEVATED" | "CRITICAL";
    score: number;
    reasons: string[];
  };
  drift?: {
    type:
      | "PAYMENT_CONFIRMATION_SLOWDOWN"
      | "RECOVERY_DECAY"
      | "GHOST_PING_INCREASE"
      | "RISK_CLUSTERING"
      | "NO_SHOW_RISE";
    summary: string;
    signals: string[];
  };
  scope?: "ORDER" | "SYSTEM";
  cluster?: {
    label: string;
    orders: string[];
    heat: "LOW" | "WATCH" | "ELEVATED" | "CRITICAL";
  };
  operationalZone?: {
    zone:
      | "STABLE_ZONE"
      | "WATCH_ZONE"
      | "CONGESTED_ZONE"
      | "RECOVERY_ZONE"
      | "CRITICAL_ZONE";
    score: number;
    summary: string;
  };
  revenueStability?: {
    projectedProtectedRevenue: number;
    projectedExposedRevenue: number;
    likelyRecoveryRevenue: number;
    collapseChainProbability: number;
    projectedNoShowImpact: number;
    projectedFraudExposure: number;
  };
  loadDistribution?: {
    paymentExposure: number;
    collapseRisk: number;
    recoveryBacklog: number;
    fraudContainment: number;
    messagingLoad: number;
    reliabilityDegradation: number;
    blockedOrders: number;
  };
  systemNarrative?: string;
  recoveryRecommendation?: {
    actions: Array<
      | "SEND_REMINDER"
      | "ESCALATE_PAYMENT"
      | "REQUIRE_DEPOSIT"
      | "OFFER_WAITLIST_REPLACEMENT"
      | "RELEASE_SLOT"
      | "OWNER_REVIEW"
    >;
    confidence: number;
    estimatedRecoverableRevenue: number;
    urgency: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
    automationSafetyLevel:
      | "SAFE_TO_AUTOMATE"
      | "GUARDED_AUTOMATION"
      | "OWNER_REVIEW_REQUIRED"
      | "BLOCKED";
    expectedRecoveryLikelihood: number;
    state:
      | "MONITORING"
      | "RECOVERY_RECOMMENDED"
      | "RECOVERY_ATTEMPTED"
      | "RECOVERY_SUCCEEDED"
      | "RECOVERY_FAILED";
    attempted: boolean;
    succeeded: boolean;
    humanInterventionAvoided: boolean;
    riskPrevented: number;
  };
  operationalMemory?: {
    memoryConfidence: number;
    customerPatternCount: number;
    learningSignalCount: number;
    adaptiveRecommendations: string[];
  };
  memoryPattern?: OperationalMemoryPattern;
  adaptiveExplanation?: string;
  liveEvents?: LiveOperationalEvent[];
  operationalPulse?: {
    pressure: number;
    collapseVelocity: number;
    recoveryMomentum: number;
    automationLoad: number;
    interventionFrequency: number;
    stability: "STABLE" | "WATCHING" | "ACTIVE" | "STRAINED";
    protectedRevenue: number;
    exposureGrowth: number;
    autonomousActionCount: number;
    collapseEscalationCount: number;
  };
  organizationPulse?: ReturnType<typeof buildMultiLocationIntelligenceSnapshot>["organizationPulse"];
  locationProfile?: ReturnType<typeof buildMultiLocationIntelligenceSnapshot>["locations"][number];
};

export type LiveOperationalEvent = {
  id: string;
  type:
    | "PAYMENT_VERIFICATION"
    | "COLLAPSE_CHANGE"
    | "GHOST_PING_ESCALATION"
    | "RECOVERY_ATTEMPT"
    | "WAITLIST_REPLACEMENT"
    | "FRAUD_RISK_SPIKE"
    | "AUTOMATION_DECISION"
    | "AUTONOMOUS_RECOVERY"
    | "RELIABILITY_CHANGE"
    | "PRESSURE_CHANGE";
  title: string;
  summary: string;
  orderId?: string;
  severity: BrainSeverity;
  previousState: string;
  nextLikelyState: string;
  preventedOutcome: string;
  operationalImpact: string;
  createdAt: string;
  chainId: string;
};

export type BrainOrder = {
  id: string;
  customerName: string;
  organizationId: string;
  locationId: string;
  locationName: string;
  orderType: string;
  amount: number;
  guests: number;
  reservationTime: string | null;
  status: string;
  paymentState: string;
  paymentVerified: boolean;
  depositRequired: boolean;
  depositPaid: boolean;
  reliabilityScore: number;
  terminalMismatch: boolean;
  riskLevel: "LOW" | "MED" | "HIGH";
  slotHoldExpiresAt: string | null;
  lastReminderSentAt: string | null;
  awaitingDetails: boolean;
  createdAt: string;
  collapseProbability: number;
  collapseRiskTier: string;
  recommendedIntervention: string;
  instabilityFactors: string[];
  collapseExplanation: string;
  ghostPingShouldSend: boolean;
  ghostPingUrgency: string;
  ghostPingReasoning: string;
};
