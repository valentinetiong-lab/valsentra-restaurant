import { supabaseAdmin } from "@/app/lib/admin";

export type ActiveOperationalPacingPolicy = {
  suppressNonCriticalReminders: boolean;
  reduceRecoveryEscalation: boolean;
  delayNonCriticalNotifications: boolean;
  suppressNoisyDiagnostics: boolean;
  prioritizePaymentReview: boolean;
  prioritizeArrivalVisibility: boolean;
  recoveryCooldownMultiplier: number;
  rushLockActive: boolean;
  expiresAt: string | null;
};

const DEFAULT_POLICY: ActiveOperationalPacingPolicy = {
  suppressNonCriticalReminders: false,
  reduceRecoveryEscalation: false,
  delayNonCriticalNotifications: false,
  suppressNoisyDiagnostics: false,
  prioritizePaymentReview: false,
  prioritizeArrivalVisibility: false,
  recoveryCooldownMultiplier: 1,
  rushLockActive: false,
  expiresAt: null,
};

function active(meta: Record<string, any>) {
  const expiresAt = typeof meta.expiresAt === "string" ? new Date(meta.expiresAt).getTime() : NaN;
  return Number.isFinite(expiresAt) && expiresAt > Date.now();
}

export async function getActiveOperationalPacingPolicy({
  organizationId,
  locationId = null,
}: {
  organizationId: string;
  locationId?: string | null;
}): Promise<ActiveOperationalPacingPolicy> {
  const { data, error } = await supabaseAdmin
    .from("audit_logs")
    .select("meta, location_id, created_at")
    .eq("organization_id", organizationId)
    .eq("meta->>operationalEvent", "AUTONOMOUS_OPERATIONAL_EXECUTION")
    .order("created_at", { ascending: false })
    .limit(30);

  if (error) return DEFAULT_POLICY;

  const activeRows = (data ?? []).filter((row) => {
    const meta = row.meta ?? {};
    const sameLocation = !locationId || !row.location_id || row.location_id === locationId;
    return sameLocation && active(meta);
  });

  if (activeRows.length === 0) return DEFAULT_POLICY;

  const policy = activeRows.reduce<ActiveOperationalPacingPolicy>((current, row) => {
    const meta = row.meta ?? {};
    const actionType = String(meta.actionType ?? "");
    const throttles = meta.activeThrottles ?? {};
    const expiresAt = typeof meta.expiresAt === "string" ? meta.expiresAt : current.expiresAt;
    const recoveryCooldownMultiplier = actionType === "INCREASE_RECOVERY_COOLDOWN_WINDOWS"
      ? Math.max(current.recoveryCooldownMultiplier, 1.75)
      : current.recoveryCooldownMultiplier;

    return {
      suppressNonCriticalReminders:
        current.suppressNonCriticalReminders ||
        actionType === "PAUSE_NON_CRITICAL_REMINDERS" ||
        actionType === "SUPPRESS_DUPLICATE_REMINDER_BURSTS" ||
        Boolean(throttles.suppressNonCriticalReminders),
      reduceRecoveryEscalation:
        current.reduceRecoveryEscalation ||
        actionType === "SLOW_WAITLIST_ESCALATION" ||
        actionType === "STAGGER_RECOVERY_OFFERS" ||
        Boolean(throttles.reduceRecoveryEscalation),
      delayNonCriticalNotifications:
        current.delayNonCriticalNotifications ||
        actionType === "DELAY_NON_CRITICAL_NOTIFICATIONS" ||
        Boolean(throttles.pauseLowPriorityOutbound),
      suppressNoisyDiagnostics:
        current.suppressNoisyDiagnostics ||
        actionType === "REDUCE_NOISY_DIAGNOSTICS" ||
        Boolean(throttles.suppressNoisyDiagnostics),
      prioritizePaymentReview:
        current.prioritizePaymentReview ||
        actionType === "PRIORITIZE_PAYMENT_REVIEW_CARDS" ||
        Boolean(throttles.prioritizePaymentReview),
      prioritizeArrivalVisibility:
        current.prioritizeArrivalVisibility ||
        actionType === "PRIORITIZE_ARRIVAL_VISIBILITY" ||
        Boolean(throttles.prioritizeArrivalVisibility),
      recoveryCooldownMultiplier,
      rushLockActive:
        current.rushLockActive ||
        actionType === "ACTIVATE_RUSH_LOCK" ||
        Boolean(throttles.pauseLowPriorityOutbound),
      expiresAt,
    };
  }, DEFAULT_POLICY);

  return policy;
}

export function isCriticalOperationalCommunication(metadata?: Record<string, unknown>) {
  return (
    metadata?.critical === true ||
    metadata?.fulfillmentCritical === true ||
    metadata?.paymentTruthCritical === true ||
    metadata?.managerReviewRequired === true ||
    metadata?.paymentRequestId !== undefined ||
    metadata?.providerReference !== undefined
  );
}
