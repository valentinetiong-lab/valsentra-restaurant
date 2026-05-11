import type { OrderStatus, OrderType, RestaurantOrder, RestaurantSettings, RiskLevel } from "../domain/restaurant";

export function isBlacklisted(score: number) {
  return score <= 10;
}

export function calculateRiskLevel(input: {
  amount: number;
  guests: number;
  reliabilityScore: number;
  terminalMismatch: boolean;
  status: OrderStatus;
  orderType: OrderType;
}): RiskLevel {
  let score = 0;

  if (input.terminalMismatch) score += 3;
  if (input.reliabilityScore <= 20) score += 3;
  else if (input.reliabilityScore <= 50) score += 2;

  if (input.amount >= 300) score += 2;
  else if (input.amount >= 150) score += 1;

  if (input.orderType === "DINE_IN_RESERVATION" && input.guests >= 10) score += 2;
  else if (input.orderType === "DINE_IN_RESERVATION" && input.guests >= 6) score += 1;

  if (input.status === "UNPAID") score += 1;
  if (input.status === "PAYMENT_SENT") score += 1;

  if (score >= 5) return "HIGH";
  if (score >= 3) return "MED";
  return "LOW";
}

export function requiresPaymentProtection(order: RestaurantOrder, settings: RestaurantSettings | null) {
  if (!settings) return order.depositRequired;

  if (
    order.orderType === "DINE_IN_RESERVATION" &&
    order.guests >= settings.dineInDepositGuestsThreshold
  ) {
    return true;
  }

  if (
    order.orderType === "PREORDER_PICKUP" &&
    order.amount >= settings.pickupDepositAmountThreshold
  ) {
    return true;
  }

  if (order.orderType === "DELIVERY_PREORDER" && settings.requireDeliveryDeposit) {
    return true;
  }

  if (order.reliabilityScore <= settings.lowReliabilityThreshold) {
    return true;
  }

  return order.depositRequired;
}

export function getProtectionReason(input: {
  depositRequired: boolean;
  reliabilityScore: number;
  terminalMismatch: boolean;
  amount: number;
  guests: number;
  orderType: OrderType;
}, settings: RestaurantSettings | null) {
  if (input.terminalMismatch) return "Terminal mismatch";
  if (isBlacklisted(input.reliabilityScore)) return "Blacklisted customer";

  if (settings && input.reliabilityScore <= settings.lowReliabilityThreshold) {
    return "Low reliability customer";
  }

  if (input.reliabilityScore <= 20) return "Very low reliability";

  if (
    input.orderType === "DINE_IN_RESERVATION" &&
    settings &&
    input.guests >= settings.dineInDepositGuestsThreshold
  ) {
    return "Large dine-in booking";
  }

  if (
    input.orderType === "PREORDER_PICKUP" &&
    settings &&
    input.amount >= settings.pickupDepositAmountThreshold
  ) {
    return "High-value pickup";
  }

  if (input.orderType === "DELIVERY_PREORDER" && settings?.requireDeliveryDeposit) {
    return "Delivery deposit required";
  }

  if (input.depositRequired) return "Deposit required";

  return "Standard protection";
}
