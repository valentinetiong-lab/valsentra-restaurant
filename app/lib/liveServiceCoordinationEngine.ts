import {
  buildOperationalCapacitySnapshot,
  type OperationalCapacitySnapshot,
} from "@/app/lib/operationalCapacityEngine";
import {
  appendOperationalTimelineEvent,
  type OperationalTimelineEventType,
} from "@/app/lib/operationalTimelineMemoryEngine";
import { publishOperationalCommand } from "@/app/lib/operationalCommandBus";

export type LiveCoordinationState =
  | "NORMAL_FLOW"
  | "ARRIVAL_WAVE"
  | "PAYMENT_BOTTLENECK"
  | "RECOVERY_SATURATION"
  | "FULFILLMENT_DELAY"
  | "SERVICE_STRAIN"
  | "RUSH_LOCK"
  | "STABILIZING";

export type CoordinationPacingRecommendation = {
  area: "ARRIVALS" | "PAYMENTS" | "RECOVERY" | "REMINDERS" | "FULFILLMENT" | "COMMUNICATION" | "MANAGER";
  label: string;
  guidance: string;
  throttle: "NONE" | "LIGHT" | "MODERATE" | "STRICT";
  priority: "LOW" | "NORMAL" | "HIGH" | "CRITICAL";
};

export type LiveServiceCoordinationSnapshot = {
  organizationId: string;
  locationId: string | null;
  state: LiveCoordinationState;
  previousState: LiveCoordinationState | null;
  coordinationScore: number;
  ownerSummary: string;
  staffGuidance: string[];
  pacingRecommendations: CoordinationPacingRecommendation[];
  throttles: {
    suppressNonCriticalReminders: boolean;
    reduceRecoveryEscalation: boolean;
    increaseWaitlistCooldown: boolean;
    prioritizePaymentReview: boolean;
    prioritizeArrivalVisibility: boolean;
    pauseLowPriorityOutbound: boolean;
    suppressNoisyDiagnostics: boolean;
  };
  signalsUsed: string[];
  capacityState: OperationalCapacitySnapshot["state"];
  generatedAt: string;
};

function clamp(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function getSignalScore(capacity: OperationalCapacitySnapshot, type: string) {
  return capacity.signals.find((signal) => signal.type === type)?.score ?? 0;
}

function determineCoordinationState(capacity: OperationalCapacitySnapshot): LiveCoordinationState {
  const arrival = getSignalScore(capacity, "ARRIVAL_PRESSURE");
  const payment = getSignalScore(capacity, "PAYMENT_PRESSURE");
  const recovery = getSignalScore(capacity, "RECOVERY_PRESSURE");
  const worker = getSignalScore(capacity, "WORKER_PRESSURE");
  const provider = getSignalScore(capacity, "PROVIDER_PRESSURE");

  if (capacity.state === "COLLAPSE_RISK") return "RUSH_LOCK";
  if (capacity.state === "CRITICAL" || (arrival >= 55 && payment >= 45)) return "SERVICE_STRAIN";
  if (arrival >= 55 || capacity.metrics.denseArrivalWindows > 0) return "ARRIVAL_WAVE";
  if (payment >= 55 || capacity.metrics.blockedFulfillment >= 2) return "PAYMENT_BOTTLENECK";
  if (recovery >= 45 || capacity.metrics.activeRecovery >= 3) return "RECOVERY_SATURATION";
  if (worker >= 45 || provider >= 45 || capacity.metrics.delayedJobs + capacity.metrics.providerFailures >= 3) return "FULFILLMENT_DELAY";
  if (capacity.state === "ELEVATED") return "STABILIZING";
  return "NORMAL_FLOW";
}

function scoreForState(state: LiveCoordinationState, capacity: OperationalCapacitySnapshot) {
  const base = {
    NORMAL_FLOW: 8,
    STABILIZING: 28,
    ARRIVAL_WAVE: 48,
    PAYMENT_BOTTLENECK: 56,
    RECOVERY_SATURATION: 52,
    FULFILLMENT_DELAY: 50,
    SERVICE_STRAIN: 74,
    RUSH_LOCK: 92,
  } satisfies Record<LiveCoordinationState, number>;

  return clamp(base[state] + capacity.score * 0.25);
}

function ownerSummaryFor(state: LiveCoordinationState) {
  if (state === "RUSH_LOCK") return "Rush lock active. Low-priority outbound work should pause while staff clear service pressure.";
  if (state === "SERVICE_STRAIN") return "Service strain detected. Valsentra should pace reminders and recovery so staff can clear urgent work.";
  if (state === "ARRIVAL_WAVE") return "Arrival wave detected. Prioritize check-in visibility and avoid extra noise.";
  if (state === "PAYMENT_BOTTLENECK") return "Payment review queue is slowing service. Manager visibility should increase.";
  if (state === "RECOVERY_SATURATION") return "Recovery pacing reduced temporarily so waitlist offers do not crowd the operation.";
  if (state === "FULFILLMENT_DELAY") return "Fulfillment and background actions are delayed. Keep staff focused on release-critical work.";
  if (state === "STABILIZING") return "Service is stabilizing. Recovery and reminders can return gradually.";
  return "Live service flow is normal.";
}

function staffGuidanceFor(state: LiveCoordinationState) {
  if (state === "RUSH_LOCK") return ["Rush Wave Active", "Manager Review Needed", "Only critical messages"];
  if (state === "SERVICE_STRAIN") return ["Rush Pressure High", "Clear urgent orders first", "Hide noisy details"];
  if (state === "ARRIVAL_WAVE") return ["Rush Wave Active", "Watch arrivals", "Payments after arrivals"];
  if (state === "PAYMENT_BOTTLENECK") return ["Payments Need Attention", "Do Not Release blocked orders", "Manager Review Needed"];
  if (state === "RECOVERY_SATURATION") return ["Recovery Slowed During Rush", "Waitlist offers staggered", "Avoid repeat contact"];
  if (state === "FULFILLMENT_DELAY") return ["Service Running Late", "Check blocked releases", "System actions may lag"];
  if (state === "STABILIZING") return ["Service Stabilizing", "Return to normal pace", "Keep watching payments"];
  return ["Normal Flow"];
}

function buildPacingRecommendations(
  state: LiveCoordinationState,
  capacity: OperationalCapacitySnapshot
): CoordinationPacingRecommendation[] {
  const recommendations: CoordinationPacingRecommendation[] = [];

  if (state === "ARRIVAL_WAVE" || state === "SERVICE_STRAIN" || state === "RUSH_LOCK") {
    recommendations.push({
      area: "ARRIVALS",
      label: "Prioritize arrival visibility",
      guidance: "Keep arriving-soon bookings at the top and reduce lower-priority panels.",
      throttle: "NONE",
      priority: state === "RUSH_LOCK" ? "CRITICAL" : "HIGH",
    });
    recommendations.push({
      area: "REMINDERS",
      label: "Reduce non-critical reminders",
      guidance: "Delay reminders that are not payment- or release-critical during the arrival wave.",
      throttle: state === "RUSH_LOCK" ? "STRICT" : "MODERATE",
      priority: "HIGH",
    });
  }

  if (state === "PAYMENT_BOTTLENECK" || capacity.metrics.blockedFulfillment > 0) {
    recommendations.push({
      area: "PAYMENTS",
      label: "Prioritize payment review",
      guidance: "Move unpaid, blocked, and proof-review orders ahead of non-critical recovery work.",
      throttle: "NONE",
      priority: "CRITICAL",
    });
    recommendations.push({
      area: "MANAGER",
      label: "Elevate manager review",
      guidance: "Manager should clear amount mismatches, blocked releases, and override requests.",
      throttle: "NONE",
      priority: "HIGH",
    });
  }

  if (state === "RECOVERY_SATURATION" || capacity.metrics.activeRecovery >= 2) {
    recommendations.push({
      area: "RECOVERY",
      label: "Stagger recovery offers",
      guidance: "Increase waitlist cooldowns and avoid contacting multiple replacement customers at once.",
      throttle: state === "RUSH_LOCK" ? "STRICT" : "MODERATE",
      priority: "HIGH",
    });
  }

  if (state === "FULFILLMENT_DELAY" || capacity.metrics.delayedJobs > 0 || capacity.metrics.providerFailures > 0) {
    recommendations.push({
      area: "FULFILLMENT",
      label: "Protect release-critical work",
      guidance: "Keep staff focused on orders that can be safely released and note delayed provider actions.",
      throttle: "LIGHT",
      priority: "HIGH",
    });
  }

  if (state === "STABILIZING") {
    recommendations.push({
      area: "RECOVERY",
      label: "Restore pacing slowly",
      guidance: "Resume normal recovery escalation gradually after urgent service pressure drops.",
      throttle: "LIGHT",
      priority: "NORMAL",
    });
  }

  if (recommendations.length === 0) {
    recommendations.push({
      area: "COMMUNICATION",
      label: "Normal pacing",
      guidance: "No coordination throttle is needed right now.",
      throttle: "NONE",
      priority: "LOW",
    });
  }

  return recommendations;
}

function buildThrottles(state: LiveCoordinationState, recommendations: CoordinationPacingRecommendation[]) {
  const strictOutbound = state === "RUSH_LOCK";
  return {
    suppressNonCriticalReminders:
      strictOutbound ||
      state === "SERVICE_STRAIN" ||
      recommendations.some((item) => item.area === "REMINDERS" && item.throttle !== "NONE"),
    reduceRecoveryEscalation:
      strictOutbound ||
      state === "ARRIVAL_WAVE" ||
      state === "SERVICE_STRAIN" ||
      state === "RECOVERY_SATURATION",
    increaseWaitlistCooldown:
      strictOutbound ||
      state === "RECOVERY_SATURATION" ||
      state === "SERVICE_STRAIN",
    prioritizePaymentReview:
      state === "PAYMENT_BOTTLENECK" ||
      state === "SERVICE_STRAIN" ||
      state === "RUSH_LOCK",
    prioritizeArrivalVisibility:
      state === "ARRIVAL_WAVE" ||
      state === "SERVICE_STRAIN" ||
      state === "RUSH_LOCK",
    pauseLowPriorityOutbound: strictOutbound,
    suppressNoisyDiagnostics:
      state === "SERVICE_STRAIN" ||
      state === "RUSH_LOCK" ||
      state === "ARRIVAL_WAVE",
  };
}

export function shouldThrottleNonCriticalReminder(snapshot: LiveServiceCoordinationSnapshot) {
  return snapshot.throttles.suppressNonCriticalReminders;
}

export function shouldReduceRecoveryEscalation(snapshot: LiveServiceCoordinationSnapshot) {
  return snapshot.throttles.reduceRecoveryEscalation;
}

export function getRecoveryCooldownMultiplier(snapshot: LiveServiceCoordinationSnapshot) {
  if (snapshot.state === "RUSH_LOCK") return 2.5;
  if (snapshot.state === "SERVICE_STRAIN" || snapshot.state === "RECOVERY_SATURATION") return 1.75;
  if (snapshot.state === "ARRIVAL_WAVE" || snapshot.state === "STABILIZING") return 1.25;
  return 1;
}

export function evaluateLiveServiceCoordination({
  capacity,
  previousState = null,
}: {
  capacity: OperationalCapacitySnapshot;
  previousState?: LiveCoordinationState | null;
}): LiveServiceCoordinationSnapshot {
  const state = determineCoordinationState(capacity);
  const pacingRecommendations = buildPacingRecommendations(state, capacity);
  const throttles = buildThrottles(state, pacingRecommendations);
  const signalsUsed = [
    `Capacity state: ${capacity.state}.`,
    `Pressure score: ${capacity.score}/100.`,
    ...capacity.signals.map((signal) => `${signal.label}: ${signal.score}/100.`),
    ...capacity.safetyActions,
  ];

  return {
    organizationId: capacity.organizationId,
    locationId: capacity.locationId,
    state,
    previousState,
    coordinationScore: scoreForState(state, capacity),
    ownerSummary: ownerSummaryFor(state),
    staffGuidance: staffGuidanceFor(state),
    pacingRecommendations,
    throttles,
    signalsUsed,
    capacityState: capacity.state,
    generatedAt: new Date().toISOString(),
  };
}

function timelineEventForState(state: LiveCoordinationState): OperationalTimelineEventType {
  if (state === "ARRIVAL_WAVE") return "ARRIVAL_WAVE_STARTED";
  if (state === "PAYMENT_BOTTLENECK") return "PAYMENT_BOTTLENECK_ACTIVE";
  if (state === "RECOVERY_SATURATION") return "RECOVERY_PACING_REDUCED";
  if (state === "RUSH_LOCK") return "RUSH_LOCK_ENABLED";
  if (state === "STABILIZING") return "SERVICE_STABILIZING";
  return "COORDINATION_STATE_CHANGED";
}

export async function recordCoordinationTimelineEvent(snapshot: LiveServiceCoordinationSnapshot) {
  if (snapshot.state === "NORMAL_FLOW") return;

  const bucket = new Date().toISOString().slice(0, 13);
  await appendOperationalTimelineEvent({
    organizationId: snapshot.organizationId,
    locationId: snapshot.locationId,
    orderId: "OPERATION",
    actorSource: "Live Service Coordination Engine",
    eventType: timelineEventForState(snapshot.state),
    summary: `${snapshot.state.replaceAll("_", " ")}: ${snapshot.ownerSummary}`,
    severity:
      snapshot.state === "RUSH_LOCK" || snapshot.state === "SERVICE_STRAIN"
        ? "CRITICAL"
        : "WARNING",
    category: "WORKER",
    correlationId: `coordination:${snapshot.state}:${bucket}`,
    idempotencyKey: `coordination:${snapshot.organizationId}:${snapshot.locationId ?? "org"}:${snapshot.state}:${bucket}`,
    metadata: {
      liveServiceCoordination: true,
      coordinationState: snapshot.state,
      previousState: snapshot.previousState,
      coordinationScore: snapshot.coordinationScore,
      staffGuidance: snapshot.staffGuidance,
      pacingRecommendations: snapshot.pacingRecommendations,
      throttles: snapshot.throttles,
      signalsUsed: snapshot.signalsUsed,
      capacityState: snapshot.capacityState,
    },
  });

  await publishOperationalCommand({
    eventType:
      snapshot.state === "RUSH_LOCK"
        ? "COLLAPSE_PROTECTION_ENABLED"
        : snapshot.throttles.prioritizePaymentReview
          ? "PAYMENT_PRIORITY_ENABLED"
          : snapshot.throttles.reduceRecoveryEscalation
            ? "RECOVERY_THROTTLED"
            : snapshot.throttles.suppressNonCriticalReminders
              ? "REMINDERS_SUPPRESSED"
              : "PRESSURE_STATE_CHANGED",
    organizationId: snapshot.organizationId,
    locationId: snapshot.locationId,
    source: "Live Service Coordination Engine",
    summary: snapshot.ownerSummary,
    severity:
      snapshot.state === "RUSH_LOCK" || snapshot.state === "SERVICE_STRAIN"
        ? "CRITICAL"
        : "WARNING",
    correlationId: `coordination:${snapshot.state}:${bucket}`,
    payload: {
      coordinationState: snapshot.state,
      previousState: snapshot.previousState,
      coordinationScore: snapshot.coordinationScore,
      throttles: snapshot.throttles,
      pacingRecommendations: snapshot.pacingRecommendations,
      capacityState: snapshot.capacityState,
    },
  });
}

export async function buildLiveServiceCoordinationSnapshot({
  organizationId,
  locationId = null,
  previousState = null,
}: {
  organizationId: string;
  locationId?: string | null;
  previousState?: LiveCoordinationState | null;
}) {
  const capacity = await buildOperationalCapacitySnapshot({ organizationId, locationId });
  const snapshot = evaluateLiveServiceCoordination({ capacity, previousState });
  await recordCoordinationTimelineEvent(snapshot);
  return snapshot;
}
