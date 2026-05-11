export type OrderStatus = "Paid" | "Pending" | "Cancelled" | "No-show";

export type RiskLevel = "LOW" | "MED" | "HIGH";

export type OrderType = "DINE_IN" | "PICKUP" | "DELIVERY";

export type RestaurantOrder = {
  id: string;
  customerName: string;
  date: string;
  time: string;
  amount: number;
  status: OrderStatus;
  risk: RiskLevel;
  orderType?: OrderType;
  partySize?: number;
  reliabilityScore?: number;
  depositRequired?: boolean;
  depositPaid?: boolean;
  paymentVerified?: boolean;
  suspiciousPaymentScreenshot?: boolean;
  blocked?: boolean;

  collapseProbability?: number;
  collapseRiskTier?: string;
  recommendedIntervention?: string;
  instabilityFactors?: string[];
  collapseExplanation?: string;

  ghostPingShouldSend?: boolean;
  ghostPingUrgency?: string;
  ghostPingMessageType?: string;
  ghostPingEscalationStage?: string;
  ghostPingRecommendedDelayMinutes?: number;
  ghostPingReasoning?: string;
};

export type AutopilotActionType =
  | "REQUIRE_DEPOSIT"
  | "SEND_PAYMENT_LINK"
  | "SEND_REMINDER"
  | "BLOCK_ORDER"
  | "RELEASE_SLOT"
  | "OFFER_WAITLIST"
  | "FLAG_FRAUD"
  | "REDUCE_RELIABILITY";

export type AutopilotRuleKey =
  | "DINE_IN_DEPOSIT_BY_GUESTS"
  | "HIGH_VALUE_DEPOSIT"
  | "LOW_RELIABILITY_DEPOSIT"
  | "AUTO_BLOCK_HIGH_VALUE_UNPAID"
  | "HARD_BLOCK_TERMINAL_MISMATCH"
  | "LAST_MINUTE_CANCEL_WAITLIST"
  | "NO_SHOW_REDUCE_RELIABILITY"
  | "PAYMENT_SCREENSHOT_FLAG"
  | "TIME_BASED_REMINDER"
  | "UNPAID_RELEASE_SLOT";

export type AutopilotRule = {
  key: AutopilotRuleKey;
  title: string;
  description: string;
  enabled: boolean;
  config?: {
    guestThreshold?: number;
    amountThreshold?: number;
    reliabilityThreshold?: number;
    lastMinuteHours?: number;
    reminderHoursBefore?: number;
    unpaidReleaseMinutesBefore?: number;
  };
  actions: AutopilotActionType[];
};

export type AutopilotQueueStatus =
  | "QUEUED"
  | "APPROVED"
  | "DONE"
  | "REJECTED"
  | "SKIPPED";

export type AutopilotIntelligenceSeverity =
  | "INFO"
  | "WATCH"
  | "WARNING"
  | "CRITICAL";

export type AutopilotLearningSignal = {
  eventType: string;
  outcome: "POSITIVE" | "NEUTRAL" | "NEGATIVE" | "UNKNOWN";
  signalWeight: number;
  learningSummary: string;
};

export type AutopilotQueueItem = {
  id: string;
  orderId: string;
  customerName: string;
  ruleKey: AutopilotRuleKey;
  action: AutopilotActionType;
  status: AutopilotQueueStatus;
  reason: string;
  createdAt: string;
  estimatedRevenueProtected?: number;
  approvedAt?: string;
  rejectedAt?: string;
  completedAt?: string;
  skippedAt?: string;
  reviewedBy?: string;

  intelligenceSeverity?: AutopilotIntelligenceSeverity;
  collapseProbability?: number;
  collapseRiskTier?: string;
  recommendedIntervention?: string;
  ghostPingUrgency?: string;
  ghostPingReasoning?: string;
  aiConfidence?: number;
  learningSignal?: AutopilotLearningSignal;
};

export type AutopilotEvaluationResult = {
  matched: boolean;
  reason?: string;
  actions: AutopilotActionType[];
  estimatedRevenueProtected?: number;
  intelligenceSeverity?: AutopilotIntelligenceSeverity;
  collapseProbability?: number;
  collapseRiskTier?: string;
  recommendedIntervention?: string;
  ghostPingUrgency?: string;
  ghostPingReasoning?: string;
  aiConfidence?: number;
  learningSignal?: AutopilotLearningSignal;
};