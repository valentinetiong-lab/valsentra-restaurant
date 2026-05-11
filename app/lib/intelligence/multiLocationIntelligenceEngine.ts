import {
  DEFAULT_ORGANIZATION_NAME,
  DEFAULT_LOCATION_ID,
  normalizeLocationId,
  normalizeLocationName,
  normalizeOrganizationId,
} from "@/app/lib/domain/organization";
import type { RestaurantOrder } from "@/app/lib/domain/restaurant";

export type LocationPressureLevel = "LOW" | "WATCH" | "ELEVATED" | "CRITICAL";
export type LocationStability = "STABLE" | "WATCHING" | "ACTIVE" | "STRAINED";
export type LocationBenchmarkSignal =
  | "BELOW_ORG_AVERAGE"
  | "ABOVE_ORG_AVERAGE"
  | "ANOMALY"
  | "HOTSPOT"
  | "STRATEGY_OUTPERFORMING";

export type LocationOperationalProfile = {
  organizationId: string;
  locationId: string;
  locationName: string;
  orderCount: number;
  activeOrders: number;
  collapsePressure: number;
  recoverySuccessRate: number;
  fraudPressure: number;
  ghostPingFrequency: number;
  noShowTrend: number;
  protectedRevenue: number;
  exposedRevenue: number;
  exposureGrowth: number;
  automationEffectiveness: number;
  operationalStability: LocationStability;
  pressureLevel: LocationPressureLevel;
  benchmarkDelta: {
    collapsePressure: number;
    recoverySuccessRate: number;
    fraudPressure: number;
    ghostPingFrequency: number;
    exposedRevenue: number;
  };
  signals: LocationBenchmarkSignal[];
  narrative: string;
};

export type OrganizationOperationalPulse = {
  organizationId: string;
  organizationName: string;
  totalProtectedRevenue: number;
  totalExposure: number;
  recoveryMomentum: number;
  operationalStability: LocationStability;
  automationLoad: number;
  branchPressureMap: Array<{
    locationId: string;
    locationName: string;
    pressureLevel: LocationPressureLevel;
    pressureScore: number;
  }>;
  branchRankings: Array<{
    locationId: string;
    locationName: string;
    rank: number;
    score: number;
    reason: string;
  }>;
};

export type CrossLocationInsight = {
  id: string;
  title: string;
  summary: string;
  severity: "INFO" | "WATCH" | "WARNING" | "CRITICAL";
  locationId?: string;
  locationName?: string;
  benchmarkSignal: LocationBenchmarkSignal;
  reasoning: string[];
  recommendedAction: string;
  confidence: number;
  createdAt: string;
};

export type MultiLocationIntelligenceSnapshot = {
  organizationPulse: OrganizationOperationalPulse;
  locations: LocationOperationalProfile[];
  insights: CrossLocationInsight[];
};

type AuditRow = Record<string, any>;

function clamp(value: number) {
  return Math.max(0, Math.min(Math.round(value), 100));
}

function isClosed(order: RestaurantOrder) {
  return order.status === "CANCELLED" || order.status === "NO_SHOW";
}

function isVerified(order: RestaurantOrder) {
  return order.status === "PAID" || order.paymentState === "VERIFIED" || Boolean(order.paymentVerified);
}

function getAuditLocationId(row: AuditRow) {
  return normalizeLocationId(row.meta?.locationId ?? row.meta?.location_id);
}

function getAuditOrganizationId(row: AuditRow) {
  return normalizeOrganizationId(
    row.meta?.organizationId ?? row.meta?.organization_id
  );
}

function average(values: number[]) {
  if (values.length === 0) return 0;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function getPressureLevel(score: number): LocationPressureLevel {
  if (score >= 78) return "CRITICAL";
  if (score >= 58) return "ELEVATED";
  if (score >= 32) return "WATCH";
  return "LOW";
}

function getStability(score: number): LocationStability {
  if (score >= 78) return "STRAINED";
  if (score >= 58) return "ACTIVE";
  if (score >= 32) return "WATCHING";
  return "STABLE";
}

function getLocationNarrative(profile: Omit<LocationOperationalProfile, "narrative">) {
  if (profile.pressureLevel === "CRITICAL") {
    return `${profile.locationName} is carrying critical operational pressure from unresolved exposure and risk signals.`;
  }

  if (profile.fraudPressure >= 40) {
    return `${profile.locationName} is showing concentrated fraud/payment containment pressure.`;
  }

  if (profile.recoverySuccessRate > 0 && profile.recoverySuccessRate >= 70) {
    return `${profile.locationName} is recovering endangered revenue above the current organization baseline.`;
  }

  if (profile.ghostPingFrequency >= 45) {
    return `${profile.locationName} has rising Ghost Ping activity and should be watched for payment delay clustering.`;
  }

  return `${profile.locationName} is operating inside the current organization baseline.`;
}

function buildLocationProfile(
  organizationId: string,
  locationId: string,
  locationName: string,
  orders: RestaurantOrder[],
  auditRows: AuditRow[],
  averages: {
    collapsePressure: number;
    recoverySuccessRate: number;
    fraudPressure: number;
    ghostPingFrequency: number;
    exposedRevenue: number;
  }
): LocationOperationalProfile {
  const active = orders.filter((order) => !isClosed(order));
  const unresolved = active.filter((order) => !isVerified(order));
  const protectedOrders = orders.filter((order) => isVerified(order) || order.depositPaid);
  const fraudOrders = active.filter(
    (order) =>
      order.terminalMismatch ||
      order.paymentState === "BLOCKED" ||
      order.paymentState === "FAILED"
  );
  const noShowOrders = orders.filter((order) => order.status === "NO_SHOW");
  const recoveryEvents = auditRows.filter((row) =>
    String(row.action ?? "").toLowerCase().includes("recovery") ||
    String(row.action ?? "").toLowerCase().includes("waitlist")
  );
  const recoverySuccess = recoveryEvents.filter((row) =>
    String(row.action ?? "").toLowerCase().includes("succeeded") ||
    String(row.action ?? "").toLowerCase().includes("recovered")
  );
  const automationEvents = auditRows.filter((row) =>
    Boolean(row.meta?.operationalEvent) ||
    String(row.staff ?? "").toLowerCase().includes("autopilot") ||
    String(row.staff ?? "").toLowerCase().includes("continuous")
  );
  const ghostEvents = auditRows.filter((row) => {
    const action = String(row.action ?? "").toLowerCase();
    return action.includes("ghost") || action.includes("reminder") || row.meta?.ghostPingUrgency;
  });

  const collapsePressure = clamp(
    average(active.map((order) => Number(order.collapseProbability ?? 0))) +
      unresolved.length * 4
  );
  const recoverySuccessRate =
    recoveryEvents.length > 0
      ? clamp((recoverySuccess.length / recoveryEvents.length) * 100)
      : 0;
  const fraudPressure = clamp((fraudOrders.length / Math.max(active.length, 1)) * 100);
  const ghostPingFrequency = clamp((ghostEvents.length / Math.max(active.length, 1)) * 25);
  const noShowTrend = clamp((noShowOrders.length / Math.max(orders.length, 1)) * 100);
  const protectedRevenue = Math.round(
    protectedOrders.reduce((sum, order) => sum + Number(order.amount ?? 0), 0)
  );
  const exposedRevenue = Math.round(
    unresolved.reduce((sum, order) => sum + Number(order.amount ?? 0), 0)
  );
  const exposureGrowth = clamp(
    unresolved.filter((order) => Number(order.collapseProbability ?? 0) >= 60).length * 15
  );
  const automationEffectiveness =
    automationEvents.length > 0
      ? clamp(
          ((recoverySuccess.length + protectedOrders.length) /
            Math.max(automationEvents.length + unresolved.length, 1)) *
            100
        )
      : protectedOrders.length > 0
        ? 70
        : 0;
  const pressureScore = clamp(
    collapsePressure * 0.34 +
      fraudPressure * 0.22 +
      ghostPingFrequency * 0.16 +
      exposureGrowth * 0.18 +
      noShowTrend * 0.1
  );
  const benchmarkDelta = {
    collapsePressure: collapsePressure - averages.collapsePressure,
    recoverySuccessRate: recoverySuccessRate - averages.recoverySuccessRate,
    fraudPressure: fraudPressure - averages.fraudPressure,
    ghostPingFrequency: ghostPingFrequency - averages.ghostPingFrequency,
    exposedRevenue: exposedRevenue - averages.exposedRevenue,
  };
  const signals: LocationBenchmarkSignal[] = [];

  if (benchmarkDelta.recoverySuccessRate <= -15 && recoveryEvents.length > 0) {
    signals.push("BELOW_ORG_AVERAGE");
  }
  if (benchmarkDelta.recoverySuccessRate >= 15 && recoveryEvents.length > 0) {
    signals.push("STRATEGY_OUTPERFORMING");
  }
  if (benchmarkDelta.collapsePressure >= 20 || benchmarkDelta.ghostPingFrequency >= 20) {
    signals.push("ANOMALY");
  }
  if (benchmarkDelta.fraudPressure >= 15) signals.push("HOTSPOT");
  if (signals.length === 0 && pressureScore <= averages.collapsePressure) {
    signals.push("ABOVE_ORG_AVERAGE");
  }

  const profileWithoutNarrative = {
    organizationId,
    locationId,
    locationName,
    orderCount: orders.length,
    activeOrders: active.length,
    collapsePressure,
    recoverySuccessRate,
    fraudPressure,
    ghostPingFrequency,
    noShowTrend,
    protectedRevenue,
    exposedRevenue,
    exposureGrowth,
    automationEffectiveness,
    operationalStability: getStability(pressureScore),
    pressureLevel: getPressureLevel(pressureScore),
    benchmarkDelta,
    signals,
  };

  return {
    ...profileWithoutNarrative,
    narrative: getLocationNarrative(profileWithoutNarrative),
  };
}

function buildInsights(locations: LocationOperationalProfile[]): CrossLocationInsight[] {
  const now = new Date().toISOString();
  const insights: CrossLocationInsight[] = [];

  for (const location of locations) {
    if (location.benchmarkDelta.recoverySuccessRate <= -15) {
      insights.push({
        id: `org-recovery-benchmark-${location.locationId}`,
        title: "Branch recovery rate below organization average",
        summary: `${location.locationName} recovery rate is ${Math.abs(location.benchmarkDelta.recoverySuccessRate)} points below the organization baseline.`,
        severity: "WARNING",
        locationId: location.locationId,
        locationName: location.locationName,
        benchmarkSignal: "BELOW_ORG_AVERAGE",
        reasoning: [
          `Recovery success rate: ${location.recoverySuccessRate}%.`,
          `Organization delta: ${location.benchmarkDelta.recoverySuccessRate} points.`,
        ],
        recommendedAction: "Review recovery timing and waitlist conversion behavior for this branch.",
        confidence: 84,
        createdAt: now,
      });
    }

    if (location.benchmarkDelta.ghostPingFrequency >= 20) {
      insights.push({
        id: `org-ghost-benchmark-${location.locationId}`,
        title: "Ghost Ping escalation rising faster in this branch",
        summary: `${location.locationName} has elevated reminder/Ghost Ping frequency versus the organization baseline.`,
        severity: "WATCH",
        locationId: location.locationId,
        locationName: location.locationName,
        benchmarkSignal: "ANOMALY",
        reasoning: [
          `Ghost Ping frequency: ${location.ghostPingFrequency}/100.`,
          `Organization delta: +${location.benchmarkDelta.ghostPingFrequency} points.`,
        ],
        recommendedAction: "Monitor payment delay clustering and adjust deposit escalation timing if it continues.",
        confidence: 80,
        createdAt: now,
      });
    }

    if (location.benchmarkDelta.fraudPressure >= 15) {
      insights.push({
        id: `org-fraud-hotspot-${location.locationId}`,
        title: "Fraud pressure hotspot detected",
        summary: `${location.locationName} is carrying more fraud/payment containment pressure than peer branches.`,
        severity: "CRITICAL",
        locationId: location.locationId,
        locationName: location.locationName,
        benchmarkSignal: "HOTSPOT",
        reasoning: [
          `Fraud pressure: ${location.fraudPressure}/100.`,
          `Blocked or mismatch signals are concentrated in this branch.`,
        ],
        recommendedAction: "Keep release protection locked until payment truth is verified.",
        confidence: 88,
        createdAt: now,
      });
    }

    if (location.pressureLevel === "CRITICAL" || location.pressureLevel === "ELEVATED") {
      insights.push({
        id: `org-pressure-${location.locationId}`,
        title: "Operational pressure concentrated in specific location",
        summary: `${location.locationName} is in ${location.pressureLevel.toLowerCase()} pressure with RM ${location.exposedRevenue} exposure.`,
        severity: location.pressureLevel === "CRITICAL" ? "CRITICAL" : "WARNING",
        locationId: location.locationId,
        locationName: location.locationName,
        benchmarkSignal: "ANOMALY",
        reasoning: [
          `Collapse pressure: ${location.collapsePressure}/100.`,
          `Exposure growth: ${location.exposureGrowth}/100.`,
          `Exposed revenue: RM ${location.exposedRevenue}.`,
        ],
        recommendedAction: "Prioritize highest-exposure branch interventions before adding new capacity.",
        confidence: 86,
        createdAt: now,
      });
    }

    if (location.benchmarkDelta.recoverySuccessRate >= 15) {
      insights.push({
        id: `org-recovery-outperform-${location.locationId}`,
        title: "High-performing recovery strategy detected",
        summary: `${location.locationName} is recovering endangered revenue above the organization average.`,
        severity: "INFO",
        locationId: location.locationId,
        locationName: location.locationName,
        benchmarkSignal: "STRATEGY_OUTPERFORMING",
        reasoning: [
          `Recovery success rate: ${location.recoverySuccessRate}%.`,
          `Organization delta: +${location.benchmarkDelta.recoverySuccessRate} points.`,
        ],
        recommendedAction: "Use this branch as the reference pattern for recovery timing.",
        confidence: 78,
        createdAt: now,
      });
    }
  }

  return insights.slice(0, 8);
}

export function buildMultiLocationIntelligenceSnapshot({
  orders,
  auditRows,
  organizationName = DEFAULT_ORGANIZATION_NAME,
}: {
  orders: RestaurantOrder[];
  auditRows: AuditRow[];
  organizationName?: string;
}): MultiLocationIntelligenceSnapshot {
  const organizationId = normalizeOrganizationId(orders[0]?.organizationId);
  const locationIds = new Set<string>();

  for (const order of orders) locationIds.add(normalizeLocationId(order.locationId));
  for (const row of auditRows) {
    if (getAuditOrganizationId(row) === organizationId) locationIds.add(getAuditLocationId(row));
  }
  if (locationIds.size === 0) locationIds.add(DEFAULT_LOCATION_ID);

  const rawLocationMetrics = Array.from(locationIds).map((locationId) => {
    const locationOrders = orders.filter(
      (order) => normalizeLocationId(order.locationId) === locationId
    );
    const locationAuditRows = auditRows.filter((row) => getAuditLocationId(row) === locationId);
    const locationName = normalizeLocationName(
      locationOrders[0]?.locationName ?? locationAuditRows[0]?.meta?.locationName,
      locationId
    );
    const active = locationOrders.filter((order) => !isClosed(order));
    const unresolved = active.filter((order) => !isVerified(order));
    const fraudOrders = active.filter(
      (order) =>
        order.terminalMismatch ||
        order.paymentState === "BLOCKED" ||
        order.paymentState === "FAILED"
    );
    const recoveryEvents = locationAuditRows.filter((row) =>
      String(row.action ?? "").toLowerCase().includes("recovery") ||
      String(row.action ?? "").toLowerCase().includes("waitlist")
    );
    const recoverySuccess = recoveryEvents.filter((row) =>
      String(row.action ?? "").toLowerCase().includes("succeeded") ||
      String(row.action ?? "").toLowerCase().includes("recovered")
    );
    const ghostEvents = locationAuditRows.filter((row) => {
      const action = String(row.action ?? "").toLowerCase();
      return action.includes("ghost") || action.includes("reminder") || row.meta?.ghostPingUrgency;
    });

    return {
      organizationId,
      locationId,
      locationName,
      orders: locationOrders,
      auditRows: locationAuditRows,
      collapsePressure: clamp(
        average(active.map((order) => Number(order.collapseProbability ?? 0))) +
          unresolved.length * 4
      ),
      recoverySuccessRate:
        recoveryEvents.length > 0
          ? clamp((recoverySuccess.length / recoveryEvents.length) * 100)
          : 0,
      fraudPressure: clamp((fraudOrders.length / Math.max(active.length, 1)) * 100),
      ghostPingFrequency: clamp((ghostEvents.length / Math.max(active.length, 1)) * 25),
      exposedRevenue: Math.round(
        unresolved.reduce((sum, order) => sum + Number(order.amount ?? 0), 0)
      ),
    };
  });

  const averages = {
    collapsePressure: average(rawLocationMetrics.map((location) => location.collapsePressure)),
    recoverySuccessRate: average(rawLocationMetrics.map((location) => location.recoverySuccessRate)),
    fraudPressure: average(rawLocationMetrics.map((location) => location.fraudPressure)),
    ghostPingFrequency: average(rawLocationMetrics.map((location) => location.ghostPingFrequency)),
    exposedRevenue: average(rawLocationMetrics.map((location) => location.exposedRevenue)),
  };

  const locations = rawLocationMetrics.map((location) =>
    buildLocationProfile(
      location.organizationId,
      location.locationId,
      location.locationName,
      location.orders,
      location.auditRows,
      averages
    )
  );

  const totalProtectedRevenue = Math.round(
    locations.reduce((sum, location) => sum + location.protectedRevenue, 0)
  );
  const totalExposure = Math.round(
    locations.reduce((sum, location) => sum + location.exposedRevenue, 0)
  );
  const automationLoad = clamp(
    average(locations.map((location) => location.automationEffectiveness))
  );
  const recoveryMomentum = clamp(
    average(locations.map((location) => location.recoverySuccessRate))
  );
  const pressureAverage = average(locations.map((location) => location.collapsePressure));
  const organizationPulse: OrganizationOperationalPulse = {
    organizationId,
    organizationName,
    totalProtectedRevenue,
    totalExposure,
    recoveryMomentum,
    operationalStability: getStability(pressureAverage),
    automationLoad,
    branchPressureMap: locations.map((location) => ({
      locationId: location.locationId,
      locationName: location.locationName,
      pressureLevel: location.pressureLevel,
      pressureScore: location.collapsePressure,
    })),
    branchRankings: [...locations]
      .sort((a, b) => {
        const aScore = 100 - a.collapsePressure + a.recoverySuccessRate - a.fraudPressure;
        const bScore = 100 - b.collapsePressure + b.recoverySuccessRate - b.fraudPressure;
        return bScore - aScore;
      })
      .map((location, index) => ({
        locationId: location.locationId,
        locationName: location.locationName,
        rank: index + 1,
        score: clamp(100 - location.collapsePressure + location.recoverySuccessRate - location.fraudPressure),
        reason:
          location.recoverySuccessRate > 0
            ? "Recovery performance and pressure control"
            : "Pressure control and payment protection",
      })),
  };

  return {
    organizationPulse,
    locations,
    insights: buildInsights(locations),
  };
}
