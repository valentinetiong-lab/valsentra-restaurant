import type { RestaurantOrder } from "@/app/lib/domain/restaurant";
import { parseReservationTimeForServiceDate } from "@/app/lib/domain/reservationTimeParser";

export type WhatsAppIntent =
  | "PAID_ALREADY"
  | "CANCEL_REQUEST"
  | "RUNNING_LATE"
  | "CHANGE_TIME_REQUEST"
  | "CONFIRM_BOOKING"
  | "HELP_OR_HUMAN"
  | "UNKNOWN";

export type ConversationState =
  | "NO_RESPONSE"
  | "ACKNOWLEDGED"
  | "AWAITING_CUSTOMER_CONFIRMATION"
  | "AWAITING_STAFF_REVIEW";

export type RecoveryActionType =
  | "ACKNOWLEDGE_LATE"
  | "OFFER_RECOVERY_SLOT"
  | "OFFER_ALTERNATIVE_SLOTS"
  | "FLAG_PAYMENT_VERIFICATION"
  | "ACKNOWLEDGE_CONFIRMATION"
  | "ROUTE_TO_HUMAN"
  | "NO_AUTOMATED_REPLY";

export type ConversationalRecoveryDecision = {
  shouldSendReply: boolean;
  generatedReply: string | null;
  operationalDecision: string;
  slotAvailabilityChecked: boolean;
  recoveryActionType: RecoveryActionType;
  requiresHumanReview: boolean;
  conversationContext: {
    lastCustomerIntent: WhatsAppIntent;
    awaitingCustomerConfirmation: boolean;
    proposedRecoverySlot: string | null;
    conversationState: ConversationState;
  };
  diagnostics: {
    requestedTimeText: string | null;
    requestedSlotIso: string | null;
    requestedSlotAvailable: boolean | null;
    alternativeSlots: string[];
    riskAcceptable: boolean | null;
  };
};

const SERVICE_SLOT_TIMES = [
  { label: "12:00 PM", value: "12:00pm" },
  { label: "12:30 PM", value: "12:30pm" },
  { label: "1:00 PM", value: "1:00pm" },
  { label: "1:30 PM", value: "1:30pm" },
  { label: "2:00 PM", value: "2:00pm" },
  { label: "6:00 PM", value: "6:00pm" },
  { label: "6:30 PM", value: "6:30pm" },
  { label: "7:00 PM", value: "7:00pm" },
  { label: "7:30 PM", value: "7:30pm" },
  { label: "8:00 PM", value: "8:00pm" },
  { label: "8:30 PM", value: "8:30pm" },
  { label: "9:00 PM", value: "9:00pm" },
  { label: "9:30 PM", value: "9:30pm" },
  { label: "10:00 PM", value: "10:00pm" },
  { label: "10:30 PM", value: "10:30pm" },
];

function getMalaysiaDateKey(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return new Date().toISOString().slice(0, 10);

  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value])
  );

  return `${parts.year}-${parts.month}-${parts.day}`;
}

function formatSlot(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "that time";

  return new Intl.DateTimeFormat("en-MY", {
    timeZone: "Asia/Kuala_Lumpur",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function minutesBetween(left: string, right: string) {
  return Math.abs(new Date(left).getTime() - new Date(right).getTime()) / 60000;
}

function extractRequestedTime(message: string) {
  const text = message.toLowerCase();
  const match =
    text.match(/\b(?:to|at)\s+(\d{1,2}(?::|\.)?\d{0,2}\s*(?:am|pm))\b/) ??
    text.match(/\b(\d{1,2}(?::|\.)\d{2}\s*(?:am|pm))\b/) ??
    text.match(/\b(\d{3,4}\s*(?:am|pm))\b/) ??
    text.match(/\b(\d{1,2}\s*(?:am|pm))\b/);

  return match?.[1]?.replace(/\s+/g, "") ?? null;
}

function isOrderActive(order: RestaurantOrder) {
  return order.status !== "CANCELLED" && order.status !== "NO_SHOW";
}

function checkSlotRisk({
  activeOrders,
  slotIso,
  currentOrderId,
}: {
  activeOrders: RestaurantOrder[];
  slotIso: string;
  currentOrderId: string;
}) {
  const nearby = activeOrders.filter((order) => {
    if (!isOrderActive(order) || order.id === currentOrderId) return false;
    return minutesBetween(order.reservationTime, slotIso) <= 30;
  });
  const risky = nearby.filter(
    (order) =>
      order.paymentState === "BLOCKED" ||
      order.paymentState === "FAILED" ||
      order.terminalMismatch ||
      order.collapseRiskTier === "CRITICAL" ||
      order.collapseRiskTier === "AT_RISK"
  );

  return {
    available: nearby.length < 3 && risky.length === 0,
    riskAcceptable: risky.length === 0,
  };
}

function findAlternativeSlots({
  order,
  activeOrders,
  serviceDate,
}: {
  order: RestaurantOrder;
  activeOrders: RestaurantOrder[];
  serviceDate: string;
}) {
  return SERVICE_SLOT_TIMES.map((slot) => {
    const parsed = parseReservationTimeForServiceDate(slot.value, serviceDate, "CUSTOM");
    if (!parsed.ok) return null;

    const risk = checkSlotRisk({
      activeOrders,
      slotIso: parsed.reservationTime,
      currentOrderId: order.id,
    });

    return risk.available ? parsed.reservationTime : null;
  })
    .filter((slot): slot is string => Boolean(slot))
    .slice(0, 3);
}

export function buildConversationalRecoveryResponse({
  order,
  activeOrders,
  intent,
  confidence,
  inboundMessage,
}: {
  order: RestaurantOrder | null;
  activeOrders: RestaurantOrder[];
  intent: WhatsAppIntent;
  confidence: number;
  inboundMessage: string;
}): ConversationalRecoveryDecision {
  const baseContext = {
    lastCustomerIntent: intent,
    awaitingCustomerConfirmation: false,
    proposedRecoverySlot: null as string | null,
    conversationState: "NO_RESPONSE" as ConversationState,
  };

  if (!order || confidence < 70 || intent === "UNKNOWN" || intent === "CANCEL_REQUEST") {
    return {
      shouldSendReply: false,
      generatedReply: null,
      operationalDecision:
        intent === "CANCEL_REQUEST"
          ? "Cancellation requests require staff review and are not auto-confirmed."
          : "No safe automated reply generated.",
      slotAvailabilityChecked: false,
      recoveryActionType: "NO_AUTOMATED_REPLY",
      requiresHumanReview: true,
      conversationContext: {
        ...baseContext,
        conversationState: "AWAITING_STAFF_REVIEW",
      },
      diagnostics: {
        requestedTimeText: null,
        requestedSlotIso: null,
        requestedSlotAvailable: null,
        alternativeSlots: [],
        riskAcceptable: null,
      },
    };
  }

  if (intent === "PAID_ALREADY") {
    return {
      shouldSendReply: true,
      generatedReply:
        "Thanks, we’ve flagged your payment for verification. The team will confirm once it is checked.",
      operationalDecision: "Payment claim acknowledged; payment remains unverified pending staff review.",
      slotAvailabilityChecked: false,
      recoveryActionType: "FLAG_PAYMENT_VERIFICATION",
      requiresHumanReview: true,
      conversationContext: {
        ...baseContext,
        conversationState: "AWAITING_STAFF_REVIEW",
      },
      diagnostics: {
        requestedTimeText: null,
        requestedSlotIso: null,
        requestedSlotAvailable: null,
        alternativeSlots: [],
        riskAcceptable: null,
      },
    };
  }

  if (intent === "RUNNING_LATE") {
    return {
      shouldSendReply: true,
      generatedReply:
        "Thanks for letting us know. We’ve alerted the team. Please reply with your ETA if it changes.",
      operationalDecision: "Late arrival acknowledged and staff note created.",
      slotAvailabilityChecked: false,
      recoveryActionType: "ACKNOWLEDGE_LATE",
      requiresHumanReview: true,
      conversationContext: {
        ...baseContext,
        conversationState: "AWAITING_STAFF_REVIEW",
      },
      diagnostics: {
        requestedTimeText: null,
        requestedSlotIso: null,
        requestedSlotAvailable: null,
        alternativeSlots: [],
        riskAcceptable: null,
      },
    };
  }

  if (intent === "CONFIRM_BOOKING") {
    return {
      shouldSendReply: true,
      generatedReply: "Thanks, your confirmation is noted. We’ll keep your booking under monitoring.",
      operationalDecision: "Customer confirmation acknowledged without changing payment or slot state.",
      slotAvailabilityChecked: false,
      recoveryActionType: "ACKNOWLEDGE_CONFIRMATION",
      requiresHumanReview: false,
      conversationContext: {
        ...baseContext,
        conversationState: "ACKNOWLEDGED",
      },
      diagnostics: {
        requestedTimeText: null,
        requestedSlotIso: null,
        requestedSlotAvailable: null,
        alternativeSlots: [],
        riskAcceptable: null,
      },
    };
  }

  if (intent === "HELP_OR_HUMAN") {
    return {
      shouldSendReply: true,
      generatedReply: "A team member has been flagged to help. Please send any extra details here.",
      operationalDecision: "Customer requested human help; routed to staff review.",
      slotAvailabilityChecked: false,
      recoveryActionType: "ROUTE_TO_HUMAN",
      requiresHumanReview: true,
      conversationContext: {
        ...baseContext,
        conversationState: "AWAITING_STAFF_REVIEW",
      },
      diagnostics: {
        requestedTimeText: null,
        requestedSlotIso: null,
        requestedSlotAvailable: null,
        alternativeSlots: [],
        riskAcceptable: null,
      },
    };
  }

  const serviceDate = getMalaysiaDateKey(order.reservationTime);
  const requestedTimeText = extractRequestedTime(inboundMessage);
  const requestedSlot = requestedTimeText
    ? parseReservationTimeForServiceDate(requestedTimeText, serviceDate, "CUSTOM")
    : null;
  const alternativeSlots = findAlternativeSlots({ order, activeOrders, serviceDate });

  if (requestedSlot?.ok) {
    const risk = checkSlotRisk({
      activeOrders,
      slotIso: requestedSlot.reservationTime,
      currentOrderId: order.id,
    });

    if (risk.available) {
      return {
        shouldSendReply: true,
        generatedReply: `We can tentatively offer ${formatSlot(requestedSlot.reservationTime)}. Reply CONFIRM ${formatSlot(requestedSlot.reservationTime)} and staff will review before changing the booking.`,
        operationalDecision: "Safe slot offer generated; customer confirmation and staff review required before changing reservation time.",
        slotAvailabilityChecked: true,
        recoveryActionType: "OFFER_RECOVERY_SLOT",
        requiresHumanReview: true,
        conversationContext: {
          ...baseContext,
          awaitingCustomerConfirmation: true,
          proposedRecoverySlot: requestedSlot.reservationTime,
          conversationState: "AWAITING_CUSTOMER_CONFIRMATION",
        },
        diagnostics: {
          requestedTimeText,
          requestedSlotIso: requestedSlot.reservationTime,
          requestedSlotAvailable: true,
          alternativeSlots,
          riskAcceptable: risk.riskAcceptable,
        },
      };
    }

    return {
      shouldSendReply: true,
      generatedReply:
        alternativeSlots.length > 0
          ? `That time needs staff review. Lower-pressure options are ${alternativeSlots.map(formatSlot).join(", ")}. Reply with your preferred time.`
          : "That time needs staff review. The team has been alerted and will help with available options.",
      operationalDecision: "Requested slot was not safe to offer automatically; alternatives generated where available.",
      slotAvailabilityChecked: true,
      recoveryActionType: alternativeSlots.length > 0 ? "OFFER_ALTERNATIVE_SLOTS" : "ROUTE_TO_HUMAN",
      requiresHumanReview: true,
      conversationContext: {
        ...baseContext,
        awaitingCustomerConfirmation: alternativeSlots.length > 0,
        proposedRecoverySlot: alternativeSlots[0] ?? null,
        conversationState:
          alternativeSlots.length > 0 ? "AWAITING_CUSTOMER_CONFIRMATION" : "AWAITING_STAFF_REVIEW",
      },
      diagnostics: {
        requestedTimeText,
        requestedSlotIso: requestedSlot.reservationTime,
        requestedSlotAvailable: false,
        alternativeSlots,
        riskAcceptable: risk.riskAcceptable,
      },
    };
  }

  return {
    shouldSendReply: true,
    generatedReply:
      alternativeSlots.length > 0
        ? `We need staff review for the time change. Lower-pressure options are ${alternativeSlots.map(formatSlot).join(", ")}. Reply with your preferred time.`
        : "We need staff review for the time change. The team has been alerted.",
    operationalDecision: "No parseable requested slot; safe alternatives offered when available.",
    slotAvailabilityChecked: true,
    recoveryActionType: alternativeSlots.length > 0 ? "OFFER_ALTERNATIVE_SLOTS" : "ROUTE_TO_HUMAN",
    requiresHumanReview: true,
    conversationContext: {
      ...baseContext,
      awaitingCustomerConfirmation: alternativeSlots.length > 0,
      proposedRecoverySlot: alternativeSlots[0] ?? null,
      conversationState:
        alternativeSlots.length > 0 ? "AWAITING_CUSTOMER_CONFIRMATION" : "AWAITING_STAFF_REVIEW",
    },
    diagnostics: {
      requestedTimeText,
      requestedSlotIso: null,
      requestedSlotAvailable: null,
      alternativeSlots,
      riskAcceptable: null,
    },
  };
}
