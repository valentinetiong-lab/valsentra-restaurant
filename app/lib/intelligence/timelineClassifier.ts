import type {
  OperationalEventCategory,
  OperationalEventSeverity,
} from "@/app/lib/intelligence/operationalEventModel";

export type TimelineSeverity = OperationalEventSeverity | "SUCCESS";
export type TimelineCategory = OperationalEventCategory;

function includesAny(value: string, tokens: string[]) {
  return tokens.some((token) => value.includes(token));
}

export function classifyTimelineCategory(
  action: string,
  meta: Record<string, any>
): TimelineCategory {
  if (meta?.category) return meta.category as TimelineCategory;

  const lower = action.toLowerCase();

  if (meta?.learningEntry) return "LEARNING";
  if (
    includesAny(lower, ["fraud", "blocked", "terminal mismatch", "mismatch"]) ||
    meta?.terminalMismatch
  ) {
    return "FRAUD";
  }
  if (
    includesAny(lower, ["waitlist", "cascade", "replacement"]) ||
    meta?.selectedLeadId ||
    meta?.recoveredOrderId
  ) {
    return "WAITLIST";
  }
  if (
    includesAny(lower, ["recovered", "recovery"]) ||
    meta?.recoveryScore ||
    meta?.recoverableRevenue
  ) {
    return "RECOVERY";
  }
  if (
    includesAny(lower, ["ghost", "reminder", "whatsapp"]) ||
    meta?.ghostPingShouldSend ||
    meta?.ghostPingUrgency
  ) {
    return "GHOST_PING";
  }
  if (
    includesAny(lower, ["release", "collapse", "expired", "slot"]) ||
    meta?.collapseProbability !== undefined
  ) {
    return "COLLAPSE";
  }
  if (
    includesAny(lower, ["payment", "deposit", "verified", "paid"]) ||
    meta?.paymentState ||
    meta?.paymentStage
  ) {
    return "PAYMENT";
  }
  if (
    includesAny(lower, ["autopilot", "autonomous", "continuous"]) ||
    meta?.operationalEvent ||
    meta?.autonomousDecision
  ) {
    return "AUTONOMOUS_ACTION";
  }

  return "AUTONOMOUS_ACTION";
}

export function classifyTimelineSeverity(
  action: string,
  meta: Record<string, any>
): TimelineSeverity {
  if (meta?.severity) return meta.severity as TimelineSeverity;

  const lower = action.toLowerCase();
  const collapseProbability = Number(meta?.collapseProbability ?? 0);
  const ghostUrgency = String(meta?.ghostPingUrgency ?? "");

  if (
    includesAny(lower, ["failed", "blocked", "fraud", "terminal mismatch"]) ||
    collapseProbability >= 90 ||
    ghostUrgency === "CRITICAL"
  ) {
    return "CRITICAL";
  }

  if (
    includesAny(lower, ["human review", "suggested", "release", "expired"]) ||
    collapseProbability >= 60 ||
    ghostUrgency === "HIGH"
  ) {
    return "WARNING";
  }

  if (
    includesAny(lower, ["verified", "recovered", "succeeded"]) ||
    meta?.learningEntry?.outcome === "POSITIVE"
  ) {
    return "SUCCESS";
  }

  if (ghostUrgency === "MEDIUM" || collapseProbability >= 35) return "WATCH";

  return "INFO";
}

export function getTimelineEventTitle(category: TimelineCategory) {
  if (category === "PAYMENT") return "Payment truth event";
  if (category === "GHOST_PING") return "Ghost Ping intervention";
  if (category === "RECOVERY") return "Revenue recovery event";
  if (category === "COLLAPSE") return "Collapse prevention event";
  if (category === "FRAUD") return "Fraud containment event";
  if (category === "WAITLIST") return "Waitlist replacement event";
  if (category === "LEARNING") return "Learning signal recorded";
  return "Autonomous action";
}

export function buildTimelineSummary(action: string, meta: Record<string, any>) {
  if (meta?.summary) return String(meta.summary);
  if (meta?.learningEntry?.learningSummary) {
    return String(meta.learningEntry.learningSummary);
  }

  const collapseProbability = meta?.collapseProbability;
  const ghostReasoning = meta?.ghostPingReasoning;

  if (collapseProbability !== undefined && ghostReasoning) {
    return `${action} Collapse probability: ${collapseProbability}%. Ghost Ping: ${ghostReasoning}`;
  }

  if (collapseProbability !== undefined) {
    return `${action} Collapse probability: ${collapseProbability}%.`;
  }

  return action;
}
