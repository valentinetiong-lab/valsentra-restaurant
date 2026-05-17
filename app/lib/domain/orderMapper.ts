import { evaluateCollapseProbability } from "@/app/lib/collapseProbabilityEngine";
import { evaluateGhostPing } from "@/app/lib/ghostPingEngine";
import { normalisePaymentState } from "@/app/lib/engines/paymentEngine";
import { getOrderOrganizationContext } from "@/app/lib/domain/organization";
import type {
  OrderStatus,
  OrderType,
  PaymentStage,
  RestaurantOrder,
  RiskLevel,
} from "@/app/lib/domain/restaurant";

function asOrderType(value: unknown): OrderType {
  if (
    value === "DINE_IN_RESERVATION" ||
    value === "PREORDER_PICKUP" ||
    value === "DELIVERY_PREORDER"
  ) {
    return value;
  }

  return "PREORDER_PICKUP";
}

function asOrderStatus(value: unknown): OrderStatus {
  if (
    value === "UNPAID" ||
    value === "PAYMENT_SENT" ||
    value === "PAID" ||
    value === "CANCELLED" ||
    value === "NO_SHOW"
  ) {
    return value;
  }

  return "UNPAID";
}

function asPaymentStage(value: unknown): PaymentStage {
  if (value === "DEPOSIT" || value === "FINAL" || value === "AWAITING_DETAILS") {
    return value;
  }

  return "FINAL";
}

function asRiskLevel(value: unknown): RiskLevel {
  if (value === "LOW" || value === "MED" || value === "HIGH") {
    return value;
  }

  return "LOW";
}

export function mapOrderFromDb(row: Record<string, any>): RestaurantOrder {
  const organization = getOrderOrganizationContext(row);

  return {
    id: String(row.id),
    organizationId: organization.organizationId,
    locationId: organization.locationId,
    locationName: organization.locationName,
    customerName: String(row.customer_name ?? row.customerName ?? ""),
    phone: String(row.phone ?? ""),
    orderType: asOrderType(row.order_type ?? row.orderType),
    amount: Number(row.amount ?? 0),
    guests: Number(row.guests ?? 1),
    reservationTime: String(row.reservation_time ?? row.reservationTime ?? ""),
    itemSummary: String(row.item_summary ?? row.itemSummary ?? ""),
    status: asOrderStatus(row.status),
    paymentState: normalisePaymentState(row.payment_state ?? row.paymentState),
    paymentStage: asPaymentStage(row.payment_stage ?? row.paymentStage),
    paymentVerified: Boolean(row.payment_verified ?? row.paymentVerified),
    paymentIntentId: row.payment_intent_id ?? row.paymentIntentId ?? null,
    paymentProviderReference:
      row.payment_provider_reference ?? row.paymentProviderReference ?? null,
    paymentExpectedAmount:
      row.payment_expected_amount ?? row.paymentExpectedAmount ?? null,
    paymentPaidAmount: row.payment_paid_amount ?? row.paymentPaidAmount ?? null,
    paymentCurrency: row.payment_currency ?? row.paymentCurrency ?? null,
    paymentTruthStatus: row.payment_truth_status ?? row.paymentTruthStatus ?? null,
    paymentTruthSource: row.payment_truth_source ?? row.paymentTruthSource ?? null,
    paymentProviderVerifiedAt:
      row.payment_provider_verified_at ?? row.paymentProviderVerifiedAt ?? null,
    paymentMismatchReason:
      row.payment_mismatch_reason ?? row.paymentMismatchReason ?? null,
    paymentProviderMetadata:
      row.payment_provider_metadata ?? row.paymentProviderMetadata ?? null,
    paymentManagerOverrideBy:
      row.payment_manager_override_by ?? row.paymentManagerOverrideBy ?? null,
    paymentManagerOverrideAt:
      row.payment_manager_override_at ?? row.paymentManagerOverrideAt ?? null,
    paymentManagerOverrideReason:
      row.payment_manager_override_reason ?? row.paymentManagerOverrideReason ?? null,
    depositRequired: Boolean(row.deposit_required ?? row.depositRequired),
    depositAmount: Number(row.deposit_amount ?? row.depositAmount ?? 0),
    depositPaid: Boolean(row.deposit_paid ?? row.depositPaid),
    reliabilityScore: Number(row.reliability_score ?? row.reliabilityScore ?? 70),
    terminalMismatch: Boolean(row.terminal_mismatch ?? row.terminalMismatch),
    notes: String(row.notes ?? ""),
    assignedStaff: String(row.assigned_staff ?? row.assignedStaff ?? "Staff"),
    riskLevel: asRiskLevel(row.risk_level ?? row.riskLevel),
    protectionReason: String(
      row.protection_reason ?? row.protectionReason ?? "Standard protection"
    ),
    slotHoldStartedAt: row.slot_hold_started_at ?? row.slotHoldStartedAt ?? null,
    slotHoldExpiresAt: row.slot_hold_expires_at ?? row.slotHoldExpiresAt ?? null,
    lastReminderSentAt: row.last_reminder_sent_at ?? row.lastReminderSentAt ?? null,
    autoReleaseEligible: row.auto_release_eligible ?? row.autoReleaseEligible ?? true,
    recoveryState: row.recovery_state ?? row.recoveryState ?? null,
    recoveryStartedAt: row.recovery_started_at ?? row.recoveryStartedAt ?? null,
    recoveryUpdatedAt: row.recovery_updated_at ?? row.recoveryUpdatedAt ?? null,
    recoveryExpiresAt: row.recovery_expires_at ?? row.recoveryExpiresAt ?? null,
    recoveryAttemptCount:
      row.recovery_attempt_count ?? row.recoveryAttemptCount ?? null,
    recoverySelectedLeadId:
      row.recovery_selected_lead_id ?? row.recoverySelectedLeadId ?? null,
    createdAt: row.created_at ?? row.createdAt ?? null,
    recoverySourceOrderId:
      row.recovery_source_order_id ?? row.recoverySourceOrderId ?? undefined,
    awaitingDetails: Boolean(row.awaiting_details ?? row.awaitingDetails),
  };
}

export function mapOrderToDb(body: Partial<RestaurantOrder> & Record<string, any>) {
  const payload: Record<string, any> = {};

  if (body.id !== undefined) payload.id = body.id;
  if (body.organizationId !== undefined) payload.organization_id = body.organizationId;
  if (body.locationId !== undefined) payload.location_id = body.locationId;
  if (body.locationName !== undefined) payload.location_name = body.locationName;
  if (body.customerName !== undefined) payload.customer_name = body.customerName;
  if (body.phone !== undefined) payload.phone = body.phone;
  if (body.orderType !== undefined) payload.order_type = body.orderType;
  if (body.amount !== undefined) payload.amount = body.amount;
  if (body.guests !== undefined) payload.guests = body.guests;
  if (body.reservationTime !== undefined)
    payload.reservation_time = body.reservationTime;
  if (body.itemSummary !== undefined) payload.item_summary = body.itemSummary;
  if (body.status !== undefined) payload.status = body.status;
  if (body.paymentState !== undefined)
    payload.payment_state = normalisePaymentState(body.paymentState);
  if (body.paymentStage !== undefined) payload.payment_stage = body.paymentStage;
  if (body.paymentVerified !== undefined)
    payload.payment_verified = body.paymentVerified;
  if (body.paymentIntentId !== undefined) payload.payment_intent_id = body.paymentIntentId;
  if (body.paymentProviderReference !== undefined)
    payload.payment_provider_reference = body.paymentProviderReference;
  if (body.paymentExpectedAmount !== undefined)
    payload.payment_expected_amount = body.paymentExpectedAmount;
  if (body.paymentPaidAmount !== undefined)
    payload.payment_paid_amount = body.paymentPaidAmount;
  if (body.paymentCurrency !== undefined) payload.payment_currency = body.paymentCurrency;
  if (body.paymentTruthStatus !== undefined)
    payload.payment_truth_status = body.paymentTruthStatus;
  if (body.paymentTruthSource !== undefined)
    payload.payment_truth_source = body.paymentTruthSource;
  if (body.paymentProviderVerifiedAt !== undefined)
    payload.payment_provider_verified_at = body.paymentProviderVerifiedAt;
  if (body.paymentMismatchReason !== undefined)
    payload.payment_mismatch_reason = body.paymentMismatchReason;
  if (body.paymentProviderMetadata !== undefined)
    payload.payment_provider_metadata = body.paymentProviderMetadata;
  if (body.paymentManagerOverrideBy !== undefined)
    payload.payment_manager_override_by = body.paymentManagerOverrideBy;
  if (body.paymentManagerOverrideAt !== undefined)
    payload.payment_manager_override_at = body.paymentManagerOverrideAt;
  if (body.paymentManagerOverrideReason !== undefined)
    payload.payment_manager_override_reason = body.paymentManagerOverrideReason;
  if (body.depositRequired !== undefined)
    payload.deposit_required = body.depositRequired;
  if (body.depositAmount !== undefined) payload.deposit_amount = body.depositAmount;
  if (body.depositPaid !== undefined) payload.deposit_paid = body.depositPaid;
  if (body.reliabilityScore !== undefined)
    payload.reliability_score = body.reliabilityScore;
  if (body.terminalMismatch !== undefined)
    payload.terminal_mismatch = body.terminalMismatch;
  if (body.notes !== undefined) payload.notes = body.notes;
  if (body.assignedStaff !== undefined) payload.assigned_staff = body.assignedStaff;
  if (body.riskLevel !== undefined) payload.risk_level = body.riskLevel;
  if (body.protectionReason !== undefined)
    payload.protection_reason = body.protectionReason;
  if (body.slotHoldStartedAt !== undefined)
    payload.slot_hold_started_at = body.slotHoldStartedAt;
  if (body.slotHoldExpiresAt !== undefined)
    payload.slot_hold_expires_at = body.slotHoldExpiresAt;
  if (body.lastReminderSentAt !== undefined)
    payload.last_reminder_sent_at = body.lastReminderSentAt;
  if (body.autoReleaseEligible !== undefined)
    payload.auto_release_eligible = body.autoReleaseEligible;
  if (body.recoveryState !== undefined) payload.recovery_state = body.recoveryState;
  if (body.recoveryStartedAt !== undefined)
    payload.recovery_started_at = body.recoveryStartedAt;
  if (body.recoveryUpdatedAt !== undefined)
    payload.recovery_updated_at = body.recoveryUpdatedAt;
  if (body.recoveryExpiresAt !== undefined)
    payload.recovery_expires_at = body.recoveryExpiresAt;
  if (body.recoveryAttemptCount !== undefined)
    payload.recovery_attempt_count = body.recoveryAttemptCount;
  if (body.recoverySelectedLeadId !== undefined)
    payload.recovery_selected_lead_id = body.recoverySelectedLeadId;
  if (body.createdAt !== undefined) payload.created_at = body.createdAt;
  if (body.recoverySourceOrderId !== undefined)
    payload.recovery_source_order_id = body.recoverySourceOrderId;
  if (body.awaitingDetails !== undefined) payload.awaiting_details = body.awaitingDetails;

  return payload;
}

export function enrichOrderWithIntelligence(order: RestaurantOrder): RestaurantOrder {
  const collapse = evaluateCollapseProbability({
    amount: order.amount,
    guests: order.guests,
    orderType: order.orderType,
    paymentState: order.paymentState,
    paymentVerified: Boolean(order.paymentVerified),
    depositRequired: order.depositRequired,
    depositPaid: order.depositPaid,
    reliabilityScore: order.reliabilityScore,
    riskLevel: order.riskLevel ?? "LOW",
    slotHoldExpiresAt: order.slotHoldExpiresAt ?? null,
    reservationTime: order.reservationTime ?? null,
    terminalMismatch: order.terminalMismatch,
    awaitingDetails: Boolean(order.awaitingDetails),
  });

  const ghostPing = evaluateGhostPing({
    collapseProbability: collapse.collapseProbability,
    collapseRiskTier: collapse.riskTier,
    paymentState: order.paymentState,
    paymentVerified: Boolean(order.paymentVerified),
    depositRequired: order.depositRequired,
    depositPaid: order.depositPaid,
    reservationTime: order.reservationTime ?? null,
    lastReminderSentAt: order.lastReminderSentAt ?? null,
    recommendedIntervention: collapse.recommendedIntervention,
    instabilityFactors: collapse.instabilityFactors,
  });

  return {
    ...order,
    collapseProbability: collapse.collapseProbability,
    collapseRiskTier: collapse.riskTier,
    recommendedIntervention: collapse.recommendedIntervention,
    instabilityFactors: collapse.instabilityFactors,
    collapseExplanation: collapse.explanation,
    ghostPingShouldSend: ghostPing.shouldSendGhostPing,
    ghostPingUrgency: ghostPing.urgencyLevel,
    ghostPingMessageType: ghostPing.messageType,
    ghostPingEscalationStage: ghostPing.escalationStage,
    ghostPingRecommendedDelayMinutes: ghostPing.recommendedDelayMinutes,
    ghostPingReasoning: ghostPing.reasoning,
  };
}

export function mapAndEnrichOrderFromDb(row: Record<string, any>) {
  return enrichOrderWithIntelligence(mapOrderFromDb(row));
}
