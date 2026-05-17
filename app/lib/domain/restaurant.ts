export type OrderStatus =
  | "UNPAID"
  | "PAYMENT_SENT"
  | "PAID"
  | "CANCELLED"
  | "NO_SHOW";

export type OrderType =
  | "DINE_IN_RESERVATION"
  | "PREORDER_PICKUP"
  | "DELIVERY_PREORDER";

export type RiskLevel = "LOW" | "MED" | "HIGH";

export type PaymentState =
  | "UNPAID"
  | "PENDING"
  | "VERIFIED"
  | "FAILED"
  | "BLOCKED";

export type PaymentStage = "DEPOSIT" | "FINAL" | "AWAITING_DETAILS";

export type PaymentTruthStatus =
  | "PENDING_PROVIDER"
  | "SCREENSHOT_ONLY"
  | "PROVIDER_CONFIRMED"
  | "AMOUNT_MISMATCH"
  | "FAILED"
  | "MANAGER_OVERRIDE";

export type PaymentTruthSource =
  | "CUSTOMER_SCREENSHOT"
  | "STAFF_TERMINAL_CHECK"
  | "PROVIDER_CALLBACK"
  | "MANAGER_OVERRIDE"
  | "SYSTEM";

export type RecoveryState =
  | "OPEN_RECOVERY"
  | "OFFER_SENT"
  | "WAITING_RESPONSE"
  | "RECOVERED"
  | "EXPIRED"
  | "FAILED_RECOVERY";

export type Organization = {
  id: string;
  name: string;
};

export type RestaurantLocation = {
  id: string;
  organizationId: string;
  name: string;
};

export type RestaurantPayment = {
  state?: PaymentState;
  stage?: PaymentStage;
  verified?: boolean;
  depositRequired: boolean;
  depositAmount?: number;
  depositPaid: boolean;
};

export type RestaurantOrder = {
  id: string;
  organizationId?: string;
  locationId?: string;
  locationName?: string;
  customerName: string;
  phone: string;
  orderType: OrderType;
  amount: number;
  guests: number;
  reservationTime: string;
  itemSummary: string;
  status: OrderStatus;
  paymentState?: PaymentState;
  paymentStage?: PaymentStage;
  paymentVerified?: boolean;
  paymentIntentId?: string | null;
  paymentProviderReference?: string | null;
  paymentExpectedAmount?: number | null;
  paymentPaidAmount?: number | null;
  paymentCurrency?: string | null;
  paymentTruthStatus?: PaymentTruthStatus | null;
  paymentTruthSource?: PaymentTruthSource | string | null;
  paymentProviderVerifiedAt?: string | null;
  paymentMismatchReason?: string | null;
  paymentProviderMetadata?: Record<string, unknown> | null;
  paymentManagerOverrideBy?: string | null;
  paymentManagerOverrideAt?: string | null;
  paymentManagerOverrideReason?: string | null;
  depositRequired: boolean;
  depositAmount?: number;
  depositPaid: boolean;
  reliabilityScore: number;
  terminalMismatch: boolean;
  notes: string;
  assignedStaff: string;
  riskLevel?: RiskLevel;
  protectionReason?: string;
  createdAt?: string | null;
  slotHoldStartedAt?: string | null;
  slotHoldExpiresAt?: string | null;
  lastReminderSentAt?: string | null;
  autoReleaseEligible?: boolean;
  recoveryState?: RecoveryState | null;
  recoveryStartedAt?: string | null;
  recoveryUpdatedAt?: string | null;
  recoveryExpiresAt?: string | null;
  recoveryAttemptCount?: number | null;
  recoverySelectedLeadId?: string | number | null;
  recoverySourceOrderId?: string;
  awaitingDetails?: boolean;
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

export type RestaurantSettings = {
  id: number;
  dineInDepositGuestsThreshold: number;
  pickupDepositAmountThreshold: number;
  requireDeliveryDeposit: boolean;
  lowReliabilityThreshold: number;
  autoBlockHighValueUnpaid: boolean;
  hardBlockTerminalMismatch: boolean;
  autopilotMode?: "MANUAL" | "SEMI_AUTO" | "FULL_AUTO";
  updatedAt?: string;
};

export type WaitlistLead = {
  id: number | string;
  customerName: string;
  phone: string;
  preferredType: OrderType;
  showProbability: number;
  responseSpeedScore: number;
  reliabilityScore: number;
  createdAt?: string;
};

export type AuditItem = {
  id: number | string;
  action: string;
  staff: string;
  orderId: string;
  organizationId?: string;
  locationId?: string;
  locationName?: string;
  createdAt?: string;
};
