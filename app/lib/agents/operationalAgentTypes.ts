import type { RestaurantOrder } from "@/app/lib/domain/restaurant";
import type { CustomerOperationalMemoryProfile } from "@/app/lib/customerOperationalMemoryEngine";

export type OperationalAgentName =
  | "Recovery Agent"
  | "Trust Agent"
  | "Revenue Agent"
  | "Communication Agent"
  | "Operations Agent";

export type AgentEscalationLevel = "LOW" | "WATCH" | "WARNING" | "CRITICAL";

export type OperationalAgentContext = {
  order: RestaurantOrder;
  activeOrders: RestaurantOrder[];
  auditRows: Array<Record<string, any>>;
  waitlistAvailability: number;
  customerMemory?: CustomerOperationalMemoryProfile | null;
};

export type OperationalAgentDecision = {
  agentName: OperationalAgentName;
  agentDecision: string;
  confidence: number;
  reasoning: string[];
  recommendedActions: string[];
  escalationLevel: AgentEscalationLevel;
  supportingSignals: Record<string, unknown>;
};

export function clamp(value: number) {
  return Math.max(0, Math.min(Math.round(value), 100));
}

export function escalationFromScore(score: number): AgentEscalationLevel {
  if (score >= 85) return "CRITICAL";
  if (score >= 68) return "WARNING";
  if (score >= 45) return "WATCH";
  return "LOW";
}

export function isPaymentResolved(order: RestaurantOrder) {
  return order.status === "PAID" || order.paymentState === "VERIFIED" || Boolean(order.paymentVerified);
}

export function minutesUntil(value?: string | null) {
  if (!value) return null;
  const diff = new Date(value).getTime() - Date.now();
  if (!Number.isFinite(diff)) return null;
  return Math.round(diff / 60000);
}
