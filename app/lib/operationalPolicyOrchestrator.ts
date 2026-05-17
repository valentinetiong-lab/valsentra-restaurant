import {
  buildLiveServiceCoordinationSnapshot,
  type LiveServiceCoordinationSnapshot,
} from "@/app/lib/liveServiceCoordinationEngine";
import {
  publishOperationalCommand,
  subscribeOperationalCommands,
} from "@/app/lib/operationalCommandBus";
import { buildOperationalPartition } from "@/app/lib/operationalPartitionEngine";
import { getActiveOperationalPacingPolicy } from "@/app/lib/operationalPacingPolicyStore";
import { getProviderHealthSnapshot } from "@/app/lib/providers/providerHealth";

export type OperationalPolicyState =
  | "POLICY_NORMAL"
  | "POLICY_RUSH_PRIORITY"
  | "POLICY_PAYMENT_CRITICAL"
  | "POLICY_RECOVERY_LIMITED"
  | "POLICY_PROVIDER_DEGRADED"
  | "POLICY_COLLAPSE_PROTECTION";

export type OperationalPolicyResolution = {
  organizationId: string;
  locationId: string | null;
  activePolicyState: OperationalPolicyState;
  ownerSummary: string;
  staffGuidance: string[];
  activeSuppressions: string[];
  activeThrottles: string[];
  recoveryPacingState: "NORMAL" | "SLOWED" | "STAGGERED" | "COOLDOWN";
  providerDegraded: boolean;
  conflictResolutions: string[];
  coordinationState: LiveServiceCoordinationSnapshot["state"];
  commandStream: Awaited<ReturnType<typeof subscribeOperationalCommands>> extends { events: infer T } ? T : [];
  generatedAt: string;
};

function resolveState({
  coordination,
  providerDegraded,
}: {
  coordination: LiveServiceCoordinationSnapshot;
  providerDegraded: boolean;
}): OperationalPolicyState {
  if (coordination.capacityState === "COLLAPSE_RISK" || coordination.state === "RUSH_LOCK") return "POLICY_COLLAPSE_PROTECTION";
  if (providerDegraded || coordination.state === "FULFILLMENT_DELAY") return "POLICY_PROVIDER_DEGRADED";
  if (coordination.state === "PAYMENT_BOTTLENECK") return "POLICY_PAYMENT_CRITICAL";
  if (coordination.state === "RECOVERY_SATURATION") return "POLICY_RECOVERY_LIMITED";
  if (coordination.state === "ARRIVAL_WAVE" || coordination.state === "SERVICE_STRAIN") return "POLICY_RUSH_PRIORITY";
  return "POLICY_NORMAL";
}

function ownerSummary(state: OperationalPolicyState) {
  if (state === "POLICY_COLLAPSE_PROTECTION") return "Collapse protection is active. Valsentra is prioritizing urgent service work and limiting non-critical noise.";
  if (state === "POLICY_PROVIDER_DEGRADED") return "Provider degradation detected. Valsentra is keeping message failures visible and retry-safe.";
  if (state === "POLICY_PAYMENT_CRITICAL") return "Payment review is the current priority. Blocked releases stay ahead of lower-priority work.";
  if (state === "POLICY_RECOVERY_LIMITED") return "Recovery pacing is limited so waitlist activity does not overload the floor.";
  if (state === "POLICY_RUSH_PRIORITY") return "Rush priority is active. Arrival and payment work are being kept prominent.";
  return "Operational policy is normal.";
}

function staffGuidance(state: OperationalPolicyState) {
  if (state === "POLICY_COLLAPSE_PROTECTION") return ["Rush Protection Active", "Only critical work", "Manager attention"];
  if (state === "POLICY_PROVIDER_DEGRADED") return ["Messages may be delayed", "Retry visible", "Check customer replies"];
  if (state === "POLICY_PAYMENT_CRITICAL") return ["Payments first", "Do Not Release blocked orders", "Manager review"];
  if (state === "POLICY_RECOVERY_LIMITED") return ["Recovery slowed", "Avoid repeat contact", "Wait for customer"];
  if (state === "POLICY_RUSH_PRIORITY") return ["Rush priority", "Arrivals first", "Reduce noise"];
  return ["Normal flow"];
}

export async function resolveOperationalPolicyState({
  organizationId,
  locationId = null,
}: {
  organizationId: string;
  locationId?: string | null;
}): Promise<OperationalPolicyResolution> {
  const [coordination, pacing, providers, commands, partition] = await Promise.all([
    buildLiveServiceCoordinationSnapshot({ organizationId, locationId }),
    getActiveOperationalPacingPolicy({ organizationId, locationId }),
    Promise.resolve(getProviderHealthSnapshot()),
    subscribeOperationalCommands({ eventType: "ALL", organizationId, locationId, limit: 25 }),
    buildOperationalPartition({ organizationId, locationId }),
  ]);
  const providerDegraded = providers.degradedCount > 0;
  const activePolicyState = resolveState({ coordination, providerDegraded });
  const activeSuppressions = [
    pacing.suppressNonCriticalReminders ? "Non-critical reminders suppressed" : "",
    pacing.delayNonCriticalNotifications ? "Low-priority notifications delayed" : "",
    pacing.suppressNoisyDiagnostics ? "Noisy diagnostics reduced" : "",
  ].filter(Boolean);
  const activeThrottles = [
    pacing.reduceRecoveryEscalation ? "Recovery escalation slowed" : "",
    pacing.prioritizePaymentReview ? "Payment review prioritized" : "",
    pacing.prioritizeArrivalVisibility ? "Arrival visibility prioritized" : "",
    pacing.rushLockActive ? "Rush lock active" : "",
  ].filter(Boolean);
  const recoveryPacingState =
    pacing.recoveryCooldownMultiplier > 1.5
      ? "COOLDOWN"
      : pacing.reduceRecoveryEscalation
        ? "SLOWED"
        : coordination.state === "RECOVERY_SATURATION"
          ? "STAGGERED"
          : "NORMAL";
  const conflictResolutions = [
    activePolicyState === "POLICY_PAYMENT_CRITICAL"
      ? "Payment-critical messages and manager review override reminder suppression."
      : "",
    activePolicyState === "POLICY_COLLAPSE_PROTECTION"
      ? "Collapse protection overrides recovery aggressiveness and low-priority outreach."
      : "",
    providerDegraded
      ? "Provider degradation keeps failed sends visible and retry-safe."
      : "",
    recoveryPacingState !== "NORMAL"
      ? "Recovery cooldowns take precedence over rapid waitlist escalation."
      : "",
    partition.state === "PARTITION_FAILOVER" || partition.state === "PARTITION_DEGRADED"
      ? "Worker mesh isolation takes precedence over non-critical execution."
      : "",
  ].filter(Boolean);

  await publishOperationalCommand({
    eventType:
      activePolicyState === "POLICY_COLLAPSE_PROTECTION"
        ? "COLLAPSE_PROTECTION_ENABLED"
        : activePolicyState === "POLICY_PROVIDER_DEGRADED"
          ? "PROVIDER_DEGRADED"
          : activePolicyState === "POLICY_PAYMENT_CRITICAL"
            ? "PAYMENT_PRIORITY_ENABLED"
            : activePolicyState === "POLICY_RECOVERY_LIMITED"
              ? "RECOVERY_THROTTLED"
              : activeSuppressions.length > 0
                ? "REMINDERS_SUPPRESSED"
                : "PRESSURE_STATE_CHANGED",
    organizationId,
    locationId,
    source: "Operational Policy Orchestrator",
    summary: ownerSummary(activePolicyState),
    severity:
      activePolicyState === "POLICY_COLLAPSE_PROTECTION"
        ? "CRITICAL"
        : activePolicyState === "POLICY_NORMAL"
          ? "INFO"
          : "WARNING",
    correlationId: `policy:${activePolicyState}:${new Date().toISOString().slice(0, 13)}`,
    payload: {
      activePolicyState,
      coordinationState: coordination.state,
      capacityState: coordination.capacityState,
      activeSuppressions,
      activeThrottles,
      recoveryPacingState,
      providerDegraded,
      conflictResolutions,
      workerPartitionState: partition.state,
      workerOwner: partition.ownerWorkerId,
      executionPressure: partition.executionPressure,
    },
  });

  return {
    organizationId,
    locationId,
    activePolicyState,
    ownerSummary: ownerSummary(activePolicyState),
    staffGuidance: staffGuidance(activePolicyState),
    activeSuppressions,
    activeThrottles,
    recoveryPacingState,
    providerDegraded,
    conflictResolutions,
    coordinationState: coordination.state,
    commandStream: commands.ok ? commands.events : [],
    generatedAt: new Date().toISOString(),
  };
}
