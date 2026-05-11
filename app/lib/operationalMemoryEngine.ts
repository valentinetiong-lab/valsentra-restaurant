export type OperationalMemoryOrder = {
  id: string;
  customerName?: string;
  phone?: string;
  orderType?: string;
  amount?: number;
  status?: string;
  paymentState?: string;
  paymentVerified?: boolean;
  depositRequired?: boolean;
  depositPaid?: boolean;
  reliabilityScore?: number;
  terminalMismatch?: boolean;
  reservationTime?: string | null;
  createdAt?: string | null;
  collapseProbability?: number;
  ghostPingUrgency?: string;
};

export type OperationalMemoryAuditRow = {
  id?: string | number;
  action?: string;
  staff?: string;
  order_id?: string;
  orderId?: string;
  meta?: Record<string, any>;
  created_at?: string;
  createdAt?: string;
};

export type OperationalMemoryPattern = {
  id: string;
  type:
    | "NO_SHOW_CLUSTER"
    | "FRAUD_RISK_SPIKE"
    | "RECOVERY_DECAY"
    | "HIGH_RISK_WINDOW"
    | "UNRELIABLE_CUSTOMER"
    | "COLLAPSE_PRESSURE";
  title: string;
  summary: string;
  severity: "INFO" | "WATCH" | "WARNING" | "CRITICAL";
  confidence: number;
  signals: string[];
  affectedOrderIds: string[];
  adaptiveRecommendation: string;
};

export type OperationalLearningSignal = {
  id: string;
  action: string;
  outcome: "SUCCEEDED" | "FAILED" | "PREVENTED" | "UNRECOVERABLE" | "NEUTRAL";
  preventedRevenue: number;
  unrecoverableRevenue: number;
  automationConfidenceDelta: number;
  escalationEffectiveness: number;
  autonomousInterventionSafety: "SAFE" | "GUARDED" | "NEEDS_REVIEW";
  explanation: string;
};

export type OperationalOutcomeStatus =
  | "SUCCEEDED"
  | "FAILED"
  | "PARTIALLY_RECOVERED"
  | "RECOVERED_LATE"
  | "FALSE_POSITIVE_PREVENTED"
  | "ESCALATION_AVOIDED"
  | "NEUTRAL";

export type OperationalMemoryOutcome = {
  id: string;
  orderId?: string;
  organizationId: string;
  locationId: string;
  locationName: string;
  action: string;
  outcome: OperationalOutcomeStatus;
  revenueProtected: number;
  revenueLost: number;
  recoveryDurationMinutes: number | null;
  interventionFrequency: number;
  confidenceAtDecision: number;
  executedAutonomously: boolean;
  humanReviewRequired: boolean;
  createdAt: string;
  explanation: string;
};

export type ActionLearningProfile = {
  action: string;
  attempts: number;
  successRate: number;
  falsePositiveRate: number;
  averageConfidence: number;
  averageRevenueProtected: number;
  confidenceAdjustment: number;
  recommendation: string;
  evidence: string[];
};

export type CommunicationLearningProfile = {
  attempts: number;
  responseSuccessRate: number;
  paymentCompletionRate: number;
  escalationEffectiveness: number;
  waitlistConversionSuccess: number;
  recoveryTimingEffectiveness: number;
  customerResponsiveness: number;
  fatigueRisk: number;
  confidenceAdjustment: number;
  explanation: string;
};

export type BranchLearningProfile = {
  organizationId: string;
  locationId: string;
  locationName: string;
  recoveryQuality: number;
  pressureStability: number;
  fraudTrend: number;
  noShowGrowth: number;
  automationEffectiveness: number;
  operationalVolatility: number;
  collapseRecurrence: number;
  confidenceAdjustment: number;
  trend: "IMPROVING" | "STABLE" | "DEGRADING";
  explanation: string;
};

export type OrganizationLearningProfile = {
  organizationId: string;
  branchLearningQuality: number;
  unstableBranches: string[];
  improvingBranches: string[];
  systemicDrift: number;
  benchmarkEffectiveness: number;
  explanation: string;
};

export type AdaptiveDecisionContext = {
  action: string;
  locationId?: string;
  customerKey?: string;
  confidenceAdjustment: number;
  historicalSuccessRate: number;
  falsePositiveRate: number;
  branchStability: number;
  recoveryMomentum: number;
  memoryConfidence: number;
  explanations: string[];
};

export type CustomerMemoryProfile = {
  key: string;
  customerName: string;
  paymentDelayCount: number;
  noShowCount: number;
  cancellationCount: number;
  ghostPingCount: number;
  recoverySuccessCount: number;
  recoveryFailureCount: number;
  waitlistConversionCount: number;
  averageReliability: number;
  orderIds: string[];
};

export type OperationalMemorySnapshot = {
  customerProfiles: CustomerMemoryProfile[];
  patterns: OperationalMemoryPattern[];
  learningSignals: OperationalLearningSignal[];
  outcomes: OperationalMemoryOutcome[];
  actionProfiles: ActionLearningProfile[];
  branchProfiles: BranchLearningProfile[];
  organizationLearning: OrganizationLearningProfile;
  communicationLearning: CommunicationLearningProfile;
  adaptiveRecommendations: string[];
  memoryConfidence: number;
};

function clamp(value: number) {
  return Math.max(0, Math.min(Math.round(value), 100));
}

function money(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function average(values: number[]) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function normaliseText(value?: string | null) {
  return String(value ?? "").trim().toLowerCase();
}

function getCustomerKey(order: OperationalMemoryOrder) {
  return normaliseText(order.phone) || normaliseText(order.customerName) || order.id;
}

function isRecent(value?: string | null, hours = 48) {
  if (!value) return false;
  const parsed = new Date(value).getTime();
  if (Number.isNaN(parsed)) return false;
  return Date.now() - parsed <= hours * 60 * 60 * 1000;
}

function getWindowKey(value?: string | null) {
  const parsed = new Date(value ?? "").getTime();
  if (Number.isNaN(parsed)) return "Unscheduled";
  const date = new Date(parsed);
  const hour = date.getHours();
  const start = Math.floor(hour / 2) * 2;
  return `${String(start).padStart(2, "0")}:00-${String(start + 2).padStart(2, "0")}:00`;
}

function getLocationIdFromRow(row: OperationalMemoryAuditRow) {
  return String(row.meta?.locationId ?? row.meta?.location_id ?? "loc-primary");
}

function getLocationNameFromRow(row: OperationalMemoryAuditRow) {
  return String(row.meta?.locationName ?? row.meta?.location_name ?? "Primary Location");
}

function getOrganizationIdFromRow(row: OperationalMemoryAuditRow) {
  return String(row.meta?.organizationId ?? row.meta?.organization_id ?? "org-valsentra");
}

function getOrderLocation(order?: OperationalMemoryOrder) {
  return {
    organizationId: String((order as any)?.organizationId ?? "org-valsentra"),
    locationId: String((order as any)?.locationId ?? "loc-primary"),
    locationName: String((order as any)?.locationName ?? "Primary Location"),
  };
}

function getRecoveryDurationMinutes(row: OperationalMemoryAuditRow, order?: OperationalMemoryOrder) {
  const eventTime = new Date(row.created_at ?? row.createdAt ?? "").getTime();
  const startTime = new Date(order?.createdAt ?? "").getTime();
  if (Number.isNaN(eventTime) || Number.isNaN(startTime)) return null;
  return Math.max(0, Math.round((eventTime - startTime) / 60000));
}

function createCustomerProfiles(orders: OperationalMemoryOrder[], auditRows: OperationalMemoryAuditRow[]) {
  const profiles = new Map<string, CustomerMemoryProfile>();
  const auditByOrder = new Map<string, OperationalMemoryAuditRow[]>();

  auditRows.forEach((row) => {
    const orderId = String(row.order_id ?? row.orderId ?? "");
    if (!orderId) return;
    auditByOrder.set(orderId, [...(auditByOrder.get(orderId) ?? []), row]);
  });

  orders.forEach((order) => {
    const key = getCustomerKey(order);
    const existing =
      profiles.get(key) ??
      ({
        key,
        customerName: order.customerName || "Unknown customer",
        paymentDelayCount: 0,
        noShowCount: 0,
        cancellationCount: 0,
        ghostPingCount: 0,
        recoverySuccessCount: 0,
        recoveryFailureCount: 0,
        waitlistConversionCount: 0,
        averageReliability: 0,
        orderIds: [],
      } satisfies CustomerMemoryProfile);

    const orderAudit = auditByOrder.get(order.id) ?? [];
    const auditText = orderAudit.map((row) => String(row.action ?? "").toLowerCase()).join(" ");

    existing.orderIds.push(order.id);
    existing.averageReliability += Number(order.reliabilityScore ?? 70);

    if (
      order.status !== "PAID" &&
      order.paymentState !== "VERIFIED" &&
      !order.paymentVerified
    ) {
      existing.paymentDelayCount += 1;
    }

    if (order.status === "NO_SHOW" || auditText.includes("no-show")) {
      existing.noShowCount += 1;
    }

    if (order.status === "CANCELLED" || auditText.includes("cancelled")) {
      existing.cancellationCount += 1;
    }

    if (auditText.includes("ghost") || order.ghostPingUrgency === "HIGH" || order.ghostPingUrgency === "CRITICAL") {
      existing.ghostPingCount += 1;
    }

    if (auditText.includes("waitlist recovery succeeded") || auditText.includes("recovered")) {
      existing.recoverySuccessCount += 1;
      existing.waitlistConversionCount += 1;
    }

    if (auditText.includes("waitlist recovery failed") || auditText.includes("no suitable waitlist")) {
      existing.recoveryFailureCount += 1;
    }

    profiles.set(key, existing);
  });

  return Array.from(profiles.values()).map((profile) => ({
    ...profile,
    averageReliability: clamp(profile.averageReliability / Math.max(profile.orderIds.length, 1)),
  }));
}

function createLearningSignals(
  orders: OperationalMemoryOrder[],
  auditRows: OperationalMemoryAuditRow[]
): OperationalLearningSignal[] {
  const orderById = new Map(orders.map((order) => [order.id, order]));

  return auditRows
    .map((row, index): OperationalLearningSignal | null => {
      const action = String(row.action ?? "Operational event");
      const lower = action.toLowerCase();
      const meta = row.meta ?? {};
      const orderId = String(row.order_id ?? row.orderId ?? "");
      const order = orderById.get(orderId);
      const amount = money(meta.recoverableRevenue ?? meta.orderAmount ?? order?.amount);

      if (meta.learningEntry) {
        const outcome = String(meta.learningEntry.outcome ?? "NEUTRAL");
        return {
          id: `learning-${row.id ?? index}`,
          action: String(meta.learningEntry.eventType ?? action),
          outcome: outcome === "POSITIVE" ? "SUCCEEDED" : outcome === "NEGATIVE" ? "FAILED" : "NEUTRAL",
          preventedRevenue: outcome === "POSITIVE" ? amount : 0,
          unrecoverableRevenue: outcome === "NEGATIVE" ? amount : 0,
          automationConfidenceDelta: Number(meta.learningEntry.signalWeight ?? 0),
          escalationEffectiveness: outcome === "POSITIVE" ? 82 : outcome === "NEGATIVE" ? 34 : 55,
          autonomousInterventionSafety: meta.requiresHumanAction ? "NEEDS_REVIEW" : "SAFE",
          explanation: String(meta.learningEntry.learningSummary ?? action),
        };
      }

      if (lower.includes("waitlist recovery succeeded") || lower.includes("recovered")) {
        return {
          id: `recovery-success-${row.id ?? index}`,
          action: "WAITLIST_RECOVERY",
          outcome: "SUCCEEDED",
          preventedRevenue: amount,
          unrecoverableRevenue: 0,
          automationConfidenceDelta: 8,
          escalationEffectiveness: 84,
          autonomousInterventionSafety: meta.requiresHumanAction ? "GUARDED" : "SAFE",
          explanation: action,
        };
      }

      if (lower.includes("waitlist recovery failed")) {
        return {
          id: `recovery-failed-${row.id ?? index}`,
          action: "WAITLIST_RECOVERY",
          outcome: "FAILED",
          preventedRevenue: 0,
          unrecoverableRevenue: amount,
          automationConfidenceDelta: -10,
          escalationEffectiveness: 28,
          autonomousInterventionSafety: "NEEDS_REVIEW",
          explanation: action,
        };
      }

      if (lower.includes("auto release") || lower.includes("blocked") || lower.includes("fraud")) {
        return {
          id: `prevented-${row.id ?? index}`,
          action: lower.includes("fraud") ? "FRAUD_CONTAINMENT" : "AUTO_RELEASE",
          outcome: "PREVENTED",
          preventedRevenue: amount,
          unrecoverableRevenue: 0,
          automationConfidenceDelta: meta.requiresHumanAction ? 2 : 6,
          escalationEffectiveness: meta.requiresHumanAction ? 62 : 78,
          autonomousInterventionSafety: meta.requiresHumanAction ? "GUARDED" : "SAFE",
          explanation: action,
        };
      }

      return null;
    })
    .filter((signal): signal is OperationalLearningSignal => Boolean(signal))
    .slice(0, 40);
}

function createOperationalOutcomes(
  orders: OperationalMemoryOrder[],
  auditRows: OperationalMemoryAuditRow[]
): OperationalMemoryOutcome[] {
  const orderById = new Map(orders.map((order) => [order.id, order]));
  const interventionCountByOrder = new Map<string, number>();

  auditRows.forEach((row) => {
    const orderId = String(row.order_id ?? row.orderId ?? "");
    if (!orderId) return;
    interventionCountByOrder.set(orderId, (interventionCountByOrder.get(orderId) ?? 0) + 1);
  });

  return auditRows
    .map((row, index): OperationalMemoryOutcome | null => {
      const action = String(row.action ?? "Operational event");
      const lower = action.toLowerCase();
      const meta = row.meta ?? {};
      const decision = meta.autonomousDecision;
      const orderId = String(row.order_id ?? row.orderId ?? "");
      const order = orderById.get(orderId);
      const location = order ? getOrderLocation(order) : {
        organizationId: getOrganizationIdFromRow(row),
        locationId: getLocationIdFromRow(row),
        locationName: getLocationNameFromRow(row),
      };
      const amount = money(
        meta.recoverableRevenue ??
          meta.orderAmount ??
          decision?.financialExposure ??
          order?.amount
      );
      let outcome: OperationalOutcomeStatus = "NEUTRAL";
      let revenueProtected = 0;
      let revenueLost = 0;

      if (lower.includes("recovered late")) {
        outcome = "RECOVERED_LATE";
        revenueProtected = Math.round(amount * 0.65);
        revenueLost = amount - revenueProtected;
      } else if (lower.includes("partially recovered")) {
        outcome = "PARTIALLY_RECOVERED";
        revenueProtected = Math.round(amount * 0.5);
        revenueLost = amount - revenueProtected;
      } else if (
        lower.includes("recovered") ||
        lower.includes("succeeded") ||
        meta.learningEntry?.outcome === "POSITIVE"
      ) {
        outcome = "SUCCEEDED";
        revenueProtected = amount;
      } else if (
        lower.includes("failed") ||
        lower.includes("no suitable waitlist") ||
        meta.learningEntry?.outcome === "NEGATIVE"
      ) {
        outcome = "FAILED";
        revenueLost = amount;
      } else if (lower.includes("false positive") || lower.includes("blocked by guardrails")) {
        outcome = "FALSE_POSITIVE_PREVENTED";
        revenueProtected = amount;
      } else if (lower.includes("human review") || decision?.humanReviewRequired) {
        outcome = "ESCALATION_AVOIDED";
      } else if (lower.includes("auto-released") || lower.includes("contained payment risk")) {
        outcome = "SUCCEEDED";
        revenueProtected = amount;
      }

      if (!decision && outcome === "NEUTRAL" && !meta.learningEntry) return null;

      return {
        id: `outcome-${row.id ?? index}`,
        orderId: orderId || undefined,
        organizationId: location.organizationId,
        locationId: location.locationId,
        locationName: location.locationName,
        action: String(decision?.action ?? meta.learningEntry?.eventType ?? action),
        outcome,
        revenueProtected,
        revenueLost,
        recoveryDurationMinutes: getRecoveryDurationMinutes(row, order),
        interventionFrequency: interventionCountByOrder.get(orderId) ?? 1,
        confidenceAtDecision: Number(decision?.automationConfidence ?? meta.confidence ?? 50),
        executedAutonomously: Boolean(decision?.shouldExecute),
        humanReviewRequired: Boolean(decision?.humanReviewRequired ?? meta.requiresHumanAction),
        createdAt: String(row.created_at ?? row.createdAt ?? new Date().toISOString()),
        explanation: String(meta.summary ?? meta.learningEntry?.learningSummary ?? action),
      };
    })
    .filter((outcome): outcome is OperationalMemoryOutcome => Boolean(outcome))
    .slice(0, 120);
}

function createActionProfiles(outcomes: OperationalMemoryOutcome[]): ActionLearningProfile[] {
  const grouped = new Map<string, OperationalMemoryOutcome[]>();
  outcomes.forEach((outcome) => {
    grouped.set(outcome.action, [...(grouped.get(outcome.action) ?? []), outcome]);
  });

  return Array.from(grouped.entries()).map(([action, actionOutcomes]) => {
    const successes = actionOutcomes.filter((outcome) =>
      outcome.outcome === "SUCCEEDED" ||
      outcome.outcome === "PARTIALLY_RECOVERED" ||
      outcome.outcome === "RECOVERED_LATE" ||
      outcome.outcome === "FALSE_POSITIVE_PREVENTED" ||
      outcome.outcome === "ESCALATION_AVOIDED"
    );
    const falsePositives = actionOutcomes.filter((outcome) => outcome.outcome === "FALSE_POSITIVE_PREVENTED");
    const successRate = clamp((successes.length / Math.max(actionOutcomes.length, 1)) * 100);
    const falsePositiveRate = clamp((falsePositives.length / Math.max(actionOutcomes.length, 1)) * 100);
    const averageConfidence = clamp(
      actionOutcomes.reduce((sum, outcome) => sum + outcome.confidenceAtDecision, 0) /
        Math.max(actionOutcomes.length, 1)
    );
    const averageRevenueProtected = Math.round(
      actionOutcomes.reduce((sum, outcome) => sum + outcome.revenueProtected, 0) /
        Math.max(actionOutcomes.length, 1)
    );
    const confidenceAdjustment = clamp((successRate - 55) * 0.28 - falsePositiveRate * 0.2) - 10;

    return {
      action,
      attempts: actionOutcomes.length,
      successRate,
      falsePositiveRate,
      averageConfidence,
      averageRevenueProtected,
      confidenceAdjustment,
      recommendation:
        confidenceAdjustment >= 6
          ? "Increase automation confidence for this action under similar conditions."
          : confidenceAdjustment <= -6
            ? "Downgrade automation confidence until outcomes stabilize."
            : "Keep confidence stable while collecting more outcome evidence.",
      evidence: actionOutcomes.slice(0, 4).map((outcome) => outcome.explanation),
    };
  });
}

function createBranchProfiles(
  orders: OperationalMemoryOrder[],
  outcomes: OperationalMemoryOutcome[]
): BranchLearningProfile[] {
  const locationIds = new Set<string>();
  orders.forEach((order) => locationIds.add(String((order as any).locationId ?? "loc-primary")));
  outcomes.forEach((outcome) => locationIds.add(outcome.locationId));

  return Array.from(locationIds).map((locationId) => {
    const locationOrders = orders.filter((order) => String((order as any).locationId ?? "loc-primary") === locationId);
    const locationOutcomes = outcomes.filter((outcome) => outcome.locationId === locationId);
    const locationName =
      String((locationOrders[0] as any)?.locationName ?? locationOutcomes[0]?.locationName ?? "Primary Location");
    const organizationId =
      String((locationOrders[0] as any)?.organizationId ?? locationOutcomes[0]?.organizationId ?? "org-valsentra");
    const recoveryOutcomes = locationOutcomes.filter((outcome) =>
      outcome.action.includes("RECOVERY") || outcome.action.includes("WAITLIST") || outcome.action === "OFFER_WAITLIST"
    );
    const successfulRecovery = recoveryOutcomes.filter((outcome) =>
      outcome.outcome === "SUCCEEDED" ||
      outcome.outcome === "PARTIALLY_RECOVERED" ||
      outcome.outcome === "RECOVERED_LATE"
    );
    const highCollapse = locationOrders.filter((order) => Number(order.collapseProbability ?? 0) >= 70);
    const fraudSignals = locationOrders.filter((order) => order.terminalMismatch || order.paymentState === "FAILED" || order.paymentState === "BLOCKED");
    const noShows = locationOrders.filter((order) => order.status === "NO_SHOW");
    const autonomousSuccesses = locationOutcomes.filter((outcome) => outcome.executedAutonomously && outcome.outcome === "SUCCEEDED");
    const autonomousAttempts = locationOutcomes.filter((outcome) => outcome.executedAutonomously);
    const recoveryQuality = recoveryOutcomes.length > 0
      ? clamp((successfulRecovery.length / recoveryOutcomes.length) * 100)
      : 50;
    const pressureStability = clamp(100 - average(highCollapse.map((order) => Number(order.collapseProbability ?? 0))));
    const fraudTrend = clamp((fraudSignals.length / Math.max(locationOrders.length, 1)) * 100);
    const noShowGrowth = clamp((noShows.length / Math.max(locationOrders.length, 1)) * 100);
    const automationEffectiveness = autonomousAttempts.length > 0
      ? clamp((autonomousSuccesses.length / autonomousAttempts.length) * 100)
      : 55;
    const collapseRecurrence = clamp((highCollapse.length / Math.max(locationOrders.length, 1)) * 100);
    const operationalVolatility = clamp(
      collapseRecurrence * 0.42 + fraudTrend * 0.26 + noShowGrowth * 0.18 + (100 - recoveryQuality) * 0.14
    );
    const confidenceAdjustment = clamp(
      (recoveryQuality - 55) * 0.18 +
        (automationEffectiveness - 55) * 0.16 +
        (pressureStability - 50) * 0.1 -
        operationalVolatility * 0.14
    ) - 8;
    const trend =
      confidenceAdjustment >= 6
        ? "IMPROVING"
        : confidenceAdjustment <= -6
          ? "DEGRADING"
          : "STABLE";

    return {
      organizationId,
      locationId,
      locationName,
      recoveryQuality,
      pressureStability,
      fraudTrend,
      noShowGrowth,
      automationEffectiveness,
      operationalVolatility,
      collapseRecurrence,
      confidenceAdjustment,
      trend,
      explanation:
        trend === "IMPROVING"
          ? `${locationName} is improving based on recovery and automation outcomes.`
          : trend === "DEGRADING"
            ? `${locationName} is degrading due to pressure, fraud, no-show, or recovery volatility.`
            : `${locationName} is stable with current operational evidence.`,
    };
  });
}

function createOrganizationLearning(branchProfiles: BranchLearningProfile[]): OrganizationLearningProfile {
  const unstableBranches = branchProfiles
    .filter((branch) => branch.trend === "DEGRADING" || branch.operationalVolatility >= 60)
    .map((branch) => branch.locationName);
  const improvingBranches = branchProfiles
    .filter((branch) => branch.trend === "IMPROVING")
    .map((branch) => branch.locationName);
  const branchLearningQuality = clamp(
    branchProfiles.reduce(
      (sum, branch) => sum + branch.recoveryQuality + branch.automationEffectiveness - branch.operationalVolatility,
      0
    ) / Math.max(branchProfiles.length, 1)
  );
  const systemicDrift = clamp(
    branchProfiles.reduce((sum, branch) => sum + branch.operationalVolatility, 0) /
      Math.max(branchProfiles.length, 1)
  );

  return {
    organizationId: branchProfiles[0]?.organizationId ?? "org-valsentra",
    branchLearningQuality,
    unstableBranches,
    improvingBranches,
    systemicDrift,
    benchmarkEffectiveness: clamp(100 - systemicDrift + improvingBranches.length * 8 - unstableBranches.length * 8),
    explanation:
      unstableBranches.length > 0
        ? `Operational learning detects instability in ${unstableBranches.join(", ")}.`
        : improvingBranches.length > 0
          ? `Operational learning detects improving branches: ${improvingBranches.join(", ")}.`
          : "Organization learning remains stable with current outcome history.",
  };
}

function createCommunicationLearning(auditRows: OperationalMemoryAuditRow[]): CommunicationLearningProfile {
  const communicationRows = auditRows.filter((row) => {
    const action = String(row.action ?? "").toLowerCase();
    return action.includes("communication") || action.includes("reminder") || action.includes("ghost") || row.meta?.communicationOrchestration;
  });
  const successful = communicationRows.filter((row) => {
    const action = String(row.action ?? "").toLowerCase();
    return action.includes("verified") || action.includes("recovered") || row.meta?.communicationOutcome === "SUCCEEDED";
  });
  const paymentCompleted = communicationRows.filter((row) => String(row.action ?? "").toLowerCase().includes("payment verified"));
  const waitlistConverted = communicationRows.filter((row) => String(row.action ?? "").toLowerCase().includes("waitlist") && String(row.action ?? "").toLowerCase().includes("recovered"));
  const suppressed = communicationRows.filter((row) => row.meta?.communicationOutcome === "SUPPRESSED");
  const attempts = communicationRows.length;
  const responseSuccessRate = clamp((successful.length / Math.max(attempts, 1)) * 100);
  const paymentCompletionRate = clamp((paymentCompleted.length / Math.max(attempts, 1)) * 100);
  const waitlistConversionSuccess = clamp((waitlistConverted.length / Math.max(attempts, 1)) * 100);
  const fatigueRisk = clamp((suppressed.length / Math.max(attempts, 1)) * 100 + attempts * 3);
  const escalationEffectiveness = clamp(responseSuccessRate * 0.55 + paymentCompletionRate * 0.25 + waitlistConversionSuccess * 0.2);
  const recoveryTimingEffectiveness = clamp(100 - fatigueRisk * 0.55 + escalationEffectiveness * 0.25);
  const customerResponsiveness = clamp(responseSuccessRate + paymentCompletionRate * 0.3 - fatigueRisk * 0.2);
  const confidenceAdjustment = clamp(escalationEffectiveness * 0.22 + customerResponsiveness * 0.16 - fatigueRisk * 0.2) - 8;

  return {
    attempts,
    responseSuccessRate,
    paymentCompletionRate,
    escalationEffectiveness,
    waitlistConversionSuccess,
    recoveryTimingEffectiveness,
    customerResponsiveness,
    fatigueRisk,
    confidenceAdjustment,
    explanation:
      attempts === 0
        ? "No autonomous communication outcomes have accumulated yet."
        : `Communication memory saw ${attempts} outreach signal${attempts === 1 ? "" : "s"} with ${responseSuccessRate}% response success and ${fatigueRisk}% fatigue risk.`,
  };
}

export function getAdaptiveDecisionContext({
  snapshot,
  action,
  locationId = "loc-primary",
  customerKey,
}: {
  snapshot: OperationalMemorySnapshot;
  action: string;
  locationId?: string;
  customerKey?: string;
}): AdaptiveDecisionContext {
  const actionProfile = snapshot.actionProfiles.find((profile) => profile.action === action);
  const branchProfile = snapshot.branchProfiles.find((profile) => profile.locationId === locationId);
  const customerProfile = customerKey
    ? snapshot.customerProfiles.find((profile) => profile.key === customerKey)
    : undefined;
  const customerAdjustment = customerProfile
    ? clamp(
        customerProfile.recoverySuccessCount * 4 -
          customerProfile.recoveryFailureCount * 6 -
          customerProfile.noShowCount * 8 -
          customerProfile.paymentDelayCount * 2 +
          (customerProfile.averageReliability - 70) * 0.18
      ) - 8
    : 0;
  const confidenceAdjustment = clamp(
    (actionProfile?.confidenceAdjustment ?? 0) +
      (branchProfile?.confidenceAdjustment ?? 0) +
      customerAdjustment +
      (snapshot.organizationLearning.benchmarkEffectiveness - 50) * 0.08
  ) - 8;

  return {
    action,
    locationId,
    customerKey,
    confidenceAdjustment,
    historicalSuccessRate: actionProfile?.successRate ?? 50,
    falsePositiveRate: actionProfile?.falsePositiveRate ?? 0,
    branchStability: branchProfile ? clamp(100 - branchProfile.operationalVolatility) : 60,
    recoveryMomentum: branchProfile?.recoveryQuality ?? 50,
    memoryConfidence: snapshot.memoryConfidence,
    explanations: [
      actionProfile
        ? `${action} historical success rate is ${actionProfile.successRate}%.`
        : `No strong historical action profile exists for ${action} yet.`,
      branchProfile
        ? branchProfile.explanation
        : "No branch-specific learning profile exists yet.",
      customerProfile
        ? `${customerProfile.customerName} memory: ${customerProfile.paymentDelayCount} payment delays, ${customerProfile.recoverySuccessCount} recoveries, ${customerProfile.recoveryFailureCount} recovery failures.`
        : "No customer-specific memory adjusted this decision.",
      snapshot.organizationLearning.explanation,
    ],
  };
}

function detectPatterns({
  orders,
  auditRows,
  profiles,
  learningSignals,
}: {
  orders: OperationalMemoryOrder[];
  auditRows: OperationalMemoryAuditRow[];
  profiles: CustomerMemoryProfile[];
  learningSignals: OperationalLearningSignal[];
}): OperationalMemoryPattern[] {
  const patterns: OperationalMemoryPattern[] = [];
  const recentOrders = orders.filter((order) => isRecent(order.createdAt, 72));
  const noShows = recentOrders.filter((order) => order.status === "NO_SHOW");
  const riskyOrders = orders.filter(
    (order) =>
      Number(order.collapseProbability ?? 0) >= 70 ||
      order.terminalMismatch ||
      order.paymentState === "FAILED" ||
      order.paymentState === "BLOCKED"
  );
  const recoveryFailures = learningSignals.filter((signal) => signal.action === "WAITLIST_RECOVERY" && signal.outcome === "FAILED");
  const highRiskByWindow = new Map<string, OperationalMemoryOrder[]>();

  riskyOrders.forEach((order) => {
    const key = getWindowKey(order.reservationTime ?? order.createdAt);
    highRiskByWindow.set(key, [...(highRiskByWindow.get(key) ?? []), order]);
  });

  if (noShows.length >= 2) {
    patterns.push({
      id: "memory-noshow-cluster",
      type: "NO_SHOW_CLUSTER",
      title: "Rising no-show cluster detected",
      summary: `${noShows.length} recent no-show outcomes are now influencing future protection rules.`,
      severity: noShows.length >= 4 ? "WARNING" : "WATCH",
      confidence: clamp(62 + noShows.length * 7),
      signals: noShows.map((order) => `${order.id}: ${order.customerName ?? "Customer"}`),
      affectedOrderIds: noShows.map((order) => order.id),
      adaptiveRecommendation: "Strengthen deposit and verification requirements for matching customer patterns.",
    });
  }

  if (riskyOrders.length >= 2) {
    patterns.push({
      id: "memory-risk-spike",
      type: "FRAUD_RISK_SPIKE",
      title: "Fraud or risk spike detected",
      summary: `${riskyOrders.length} orders show high collapse, blocked payment, failed payment, or terminal mismatch signals.`,
      severity: riskyOrders.length >= 4 ? "CRITICAL" : "WARNING",
      confidence: clamp(68 + riskyOrders.length * 6),
      signals: riskyOrders.slice(0, 6).map((order) => `${order.id}: payment ${order.paymentState}, collapse ${order.collapseProbability ?? 0}%`),
      affectedOrderIds: riskyOrders.map((order) => order.id),
      adaptiveRecommendation: "Downgrade automation confidence until payment truth and risk containment stabilize.",
    });
  }

  if (recoveryFailures.length >= 2) {
    patterns.push({
      id: "memory-recovery-decay",
      type: "RECOVERY_DECAY",
      title: "Recovery decay trend detected",
      summary: `${recoveryFailures.length} recovery failures are reducing future waitlist automation confidence.`,
      severity: "WARNING",
      confidence: clamp(66 + recoveryFailures.length * 7),
      signals: recoveryFailures.slice(0, 5).map((signal) => signal.explanation),
      affectedOrderIds: [],
      adaptiveRecommendation: "Prioritize waitlist replacement earlier for historically unrecoverable cases.",
    });
  }

  for (const [window, windowOrders] of highRiskByWindow) {
    if (windowOrders.length < 2) continue;
    patterns.push({
      id: `memory-window-${window}`,
      type: "HIGH_RISK_WINDOW",
      title: "High-risk operational window detected",
      summary: `${windowOrders.length} high-risk orders cluster around ${window}.`,
      severity: windowOrders.length >= 4 ? "WARNING" : "WATCH",
      confidence: clamp(60 + windowOrders.length * 8),
      signals: windowOrders.map((order) => `${order.id}: ${order.collapseProbability ?? 0}% collapse`),
      affectedOrderIds: windowOrders.map((order) => order.id),
      adaptiveRecommendation: "Escalate earlier in this window and pre-stage recovery paths.",
    });
  }

  profiles
    .filter((profile) => profile.noShowCount + profile.paymentDelayCount + profile.recoveryFailureCount >= 3)
    .slice(0, 4)
    .forEach((profile) => {
      patterns.push({
        id: `memory-customer-${profile.key}`,
        type: "UNRELIABLE_CUSTOMER",
        title: "Unreliable customer behavior pattern detected",
        summary: `${profile.customerName} has repeated payment, no-show, or recovery friction.`,
        severity: profile.averageReliability <= 40 ? "WARNING" : "WATCH",
        confidence: clamp(58 + (100 - profile.averageReliability) * 0.35),
        signals: [
          `${profile.paymentDelayCount} payment delay signal${profile.paymentDelayCount === 1 ? "" : "s"}`,
          `${profile.noShowCount} no-show signal${profile.noShowCount === 1 ? "" : "s"}`,
          `${profile.recoveryFailureCount} recovery failure signal${profile.recoveryFailureCount === 1 ? "" : "s"}`,
        ],
        affectedOrderIds: profile.orderIds,
        adaptiveRecommendation: "Require stronger payment protection before committing future capacity.",
      });
    });

  const recentGhostOrCollapse = auditRows.filter((row) => {
    const action = String(row.action ?? "").toLowerCase();
    return isRecent(row.created_at ?? row.createdAt, 48) && (action.includes("ghost") || Number(row.meta?.collapseProbability ?? 0) >= 70);
  });

  if (recentGhostOrCollapse.length >= 3) {
    patterns.push({
      id: "memory-collapse-pressure",
      type: "COLLAPSE_PRESSURE",
      title: "Increasing collapse pressure detected",
      summary: `${recentGhostOrCollapse.length} recent Ghost Ping or high-collapse audit signals are shaping future intervention timing.`,
      severity: recentGhostOrCollapse.length >= 5 ? "WARNING" : "WATCH",
      confidence: clamp(60 + recentGhostOrCollapse.length * 5),
      signals: recentGhostOrCollapse.slice(0, 5).map((row) => String(row.action ?? "Collapse signal")),
      affectedOrderIds: recentGhostOrCollapse.map((row) => String(row.order_id ?? row.orderId ?? "")).filter(Boolean),
      adaptiveRecommendation: "Escalate earlier for repeated collapse patterns before recovery value decays.",
    });
  }

  return patterns.slice(0, 12);
}

export function createOperationalMemorySnapshot({
  orders,
  auditRows,
}: {
  orders: OperationalMemoryOrder[];
  auditRows: OperationalMemoryAuditRow[];
}): OperationalMemorySnapshot {
  const customerProfiles = createCustomerProfiles(orders, auditRows);
  const learningSignals = createLearningSignals(orders, auditRows);
  const outcomes = createOperationalOutcomes(orders, auditRows);
  const actionProfiles = createActionProfiles(outcomes);
  const branchProfiles = createBranchProfiles(orders, outcomes);
  const organizationLearning = createOrganizationLearning(branchProfiles);
  const communicationLearning = createCommunicationLearning(auditRows);
  const patterns = detectPatterns({
    orders,
    auditRows,
    profiles: customerProfiles,
    learningSignals,
  });
  const adaptiveRecommendations = Array.from(
    new Set(patterns.map((pattern) => pattern.adaptiveRecommendation))
  );
  const evidenceCount = orders.length + auditRows.length + learningSignals.length;
  const memoryConfidence = clamp(Math.min(evidenceCount * 4, 70) + patterns.length * 4);

  return {
    customerProfiles,
    patterns,
    learningSignals,
    outcomes,
    actionProfiles,
    branchProfiles,
    organizationLearning,
    communicationLearning,
    adaptiveRecommendations,
    memoryConfidence,
  };
}
