import { supabaseAdmin } from "@/app/lib/admin";
import type { RestaurantOrder, WaitlistLead, RecoveryState } from "@/app/lib/domain/restaurant";
import { mapAndEnrichOrderFromDb, mapOrderToDb } from "@/app/lib/domain/orderMapper";
import { buildOperationalEvent } from "@/app/lib/intelligence/operationalEventModel";
import { appendOperationalTimelineFromAudit } from "@/app/lib/operationalTimelineMemoryEngine";
import { publishOperationalCommand } from "@/app/lib/operationalCommandBus";
import { buildOperationalPartition } from "@/app/lib/operationalPartitionEngine";
import { getActiveOperationalPacingPolicy } from "@/app/lib/operationalPacingPolicyStore";
import { executeDirectCommunication } from "@/app/lib/providers/communication/communicationExecutionService";
import { runWaitlistCascade } from "@/app/lib/waitlistCascadeService";

export type WaitlistRecoveryStage = "FIRST_CANDIDATE" | "NEXT_CANDIDATE" | "BROAD_CASCADE" | "OWNER_ALERT" | "EXPIRE";

export type RankedWaitlistCandidate = WaitlistLead & {
  recoveryScore: number;
  scoringReasons: string[];
};

export type RecoveryAutopilotResult = {
  ok: boolean;
  orderId: string;
  recoveryState: RecoveryState;
  stage: WaitlistRecoveryStage;
  selectedCandidate?: RankedWaitlistCandidate;
  cascade?: Awaited<ReturnType<typeof runWaitlistCascade>>;
  nextRunAfter?: string;
  reason: string;
};

const STAGE_DELAYS: Record<Exclude<WaitlistRecoveryStage, "EXPIRE">, number> = {
  FIRST_CANDIDATE: 3,
  NEXT_CANDIDATE: 5,
  BROAD_CASCADE: 7,
  OWNER_ALERT: 5,
};

function clamp(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function minutesUntil(value?: string | null) {
  if (!value) return 999;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 999;
  return Math.round((date.getTime() - Date.now()) / 60_000);
}

export function isRecoverableSlot(order: Pick<RestaurantOrder, "status" | "paymentState" | "notes" | "recoveryState" | "recoverySourceOrderId">) {
  if (order.recoverySourceOrderId) return false;
  if (order.recoveryState === "RECOVERED" || order.recoveryState === "FAILED_RECOVERY") return false;

  const notes = String(order.notes ?? "").toLowerCase();
  return (
    order.status === "CANCELLED" ||
    order.status === "NO_SHOW" ||
    order.paymentState === "FAILED" ||
    order.paymentState === "BLOCKED" ||
    notes.includes("auto release") ||
    notes.includes("auto-released") ||
    notes.includes("reservation timeout") ||
    notes.includes("payment expired")
  );
}

function timeOverlapScore(order: RestaurantOrder, lead: WaitlistLead) {
  const minutes = minutesUntil(order.reservationTime);
  let score = 20;
  const preferredTypeMatch = lead.preferredType === order.orderType ? 15 : -5;
  if (minutes <= 30) score += 18;
  else if (minutes <= 90) score += 12;
  else if (minutes <= 180) score += 6;
  return score + preferredTypeMatch;
}

export function rankRecoveryCandidates({
  order,
  waitlist,
  recentOfferLeadIds = new Set<string>(),
}: {
  order: RestaurantOrder;
  waitlist: WaitlistLead[];
  recentOfferLeadIds?: Set<string>;
}): RankedWaitlistCandidate[] {
  return waitlist
    .filter((lead) => !recentOfferLeadIds.has(String(lead.id)))
    .map((lead) => {
      const reliability = Number(lead.reliabilityScore ?? 50);
      const responsiveness = Number(lead.responseSpeedScore ?? 50);
      const acceptance = Number(lead.showProbability ?? 50);
      const spendWeight = Math.min(Number(order.amount ?? 0) / 25, 18);
      const vipWeight = reliability >= 88 && acceptance >= 85 ? 8 : 0;
      const recentEngagement = responsiveness >= 80 ? 7 : responsiveness >= 60 ? 4 : 0;
      const overlap = timeOverlapScore(order, lead);
      const recoveryScore = clamp(
        reliability * 0.28 +
          responsiveness * 0.24 +
          acceptance * 0.24 +
          overlap +
          spendWeight +
          vipWeight +
          recentEngagement
      );

      return {
        ...lead,
        recoveryScore,
        scoringReasons: [
          `Reliability ${reliability}/100.`,
          `Response speed ${responsiveness}/100.`,
          `Show probability ${acceptance}/100.`,
          lead.preferredType === order.orderType
            ? "Preferred service type matches the lost slot."
            : "Preferred service type is not an exact match.",
          vipWeight > 0 ? "VIP-quality recovery signal." : "Standard waitlist priority.",
        ],
      };
    })
    .sort((a, b) => b.recoveryScore - a.recoveryScore);
}

function nextStage(stage: WaitlistRecoveryStage): WaitlistRecoveryStage {
  if (stage === "FIRST_CANDIDATE") return "NEXT_CANDIDATE";
  if (stage === "NEXT_CANDIDATE") return "BROAD_CASCADE";
  if (stage === "BROAD_CASCADE") return "OWNER_ALERT";
  return "EXPIRE";
}

function stateForStage(stage: WaitlistRecoveryStage): RecoveryState {
  if (stage === "FIRST_CANDIDATE") return "OFFER_SENT";
  if (stage === "NEXT_CANDIDATE" || stage === "BROAD_CASCADE") return "WAITING_RESPONSE";
  if (stage === "OWNER_ALERT") return "OPEN_RECOVERY";
  return "FAILED_RECOVERY";
}

async function recentOfferLeadIds(orderId: string, organizationId: string) {
  const since = new Date(Date.now() - 20 * 60_000).toISOString();
  const { data } = await supabaseAdmin
    .from("audit_logs")
    .select("meta")
    .eq("organization_id", organizationId)
    .eq("order_id", orderId)
    .gte("created_at", since)
    .or("meta->>operationalEvent.eq.WAITLIST_RECOVERY_OFFER,meta->>operationalEvent.eq.WAITLIST_RECOVERY_AUTOPILOT");

  return new Set(
    (data ?? [])
      .map((row) => row.meta?.selectedLeadId ?? row.meta?.recoveryOfferCandidateId)
      .filter(Boolean)
      .map(String)
  );
}

async function writeRecoveryEvent({
  order,
  state,
  action,
  title,
  summary,
  confidence,
  meta,
}: {
  order: RestaurantOrder;
  state: RecoveryState;
  action: string;
  title: string;
  summary: string;
  confidence: number;
  meta: Record<string, unknown>;
}) {
  const audit = buildOperationalEvent({
    eventKey: String(meta.eventKey),
    category: "WAITLIST",
    severity: state === "FAILED_RECOVERY" ? "WARNING" : "INFO",
    action,
    staff: "Waitlist Recovery Autopilot",
    orderId: order.id,
    title,
    summary,
    recommendedAction:
      state === "RECOVERED"
        ? "Finish setup for the recovered booking."
        : state === "FAILED_RECOVERY"
          ? "Owner review required for unrecovered revenue."
          : "Keep recovery active and avoid duplicate customer contact.",
    confidence,
    meta: {
      operationalEvent: "WAITLIST_RECOVERY_AUTOPILOT",
      recoveryState: state,
      organizationId: order.organizationId,
      locationId: order.locationId,
      recoverableRevenue: order.amount,
      ...meta,
    },
  });

  await supabaseAdmin.from("audit_logs").insert(audit);
  await appendOperationalTimelineFromAudit({
    action: audit.action,
    staff: audit.staff,
    orderId: audit.order_id,
    organizationId: String(audit.organization_id),
    locationId: typeof audit.location_id === "string" ? audit.location_id : null,
    meta: audit.meta,
  });
}

async function scheduleNextRecoveryStage({
  order,
  stage,
  organizationId,
  locationId,
}: {
  order: RestaurantOrder;
  stage: WaitlistRecoveryStage;
  organizationId: string;
  locationId?: string | null;
}) {
  if (stage === "EXPIRE") return undefined;
  const pacing = await getActiveOperationalPacingPolicy({ organizationId, locationId });
  const partition = await buildOperationalPartition({ organizationId, locationId });
  const delay = Math.ceil((STAGE_DELAYS[stage] ?? 5) * Math.max(1, pacing.recoveryCooldownMultiplier));
  if (
    pacing.reduceRecoveryEscalation ||
    pacing.recoveryCooldownMultiplier > 1 ||
    partition.state === "PARTITION_REBALANCING" ||
    partition.state === "PARTITION_FAILOVER"
  ) {
    await publishOperationalCommand({
      eventType: partition.state === "PARTITION_FAILOVER" ? "EXECUTION_REASSIGNED" : "RECOVERY_THROTTLED",
      organizationId,
      locationId,
      source: "Waitlist Recovery Autopilot",
      summary:
        partition.state === "PARTITION_FAILOVER"
          ? "Waitlist recovery execution reassigned during worker failover protection."
          : "Recovery pacing slowed automatically during live service pressure.",
      severity: "WATCH",
      correlationId: `waitlist-recovery-throttle:${order.id}:${stage}`,
      payload: {
        orderId: order.id,
        stage,
        recoveryCooldownMultiplier: pacing.recoveryCooldownMultiplier,
        partitionState: partition.state,
        ownerWorkerId: partition.ownerWorkerId,
        runAfter: new Date(Date.now() + delay * 60_000).toISOString(),
      },
    });
  }
  const runAfter = new Date(Date.now() + delay * 60_000).toISOString();
  const next = nextStage(stage);
  const payload = { orderId: order.id, stage: next };
  await supabaseAdmin.from("operational_jobs").upsert(
    {
      organization_id: organizationId,
      location_id: locationId ?? null,
      job_type: "waitlist_recovery_autopilot",
      status: "pending",
      priority: next === "OWNER_ALERT" || next === "EXPIRE" ? "high" : "normal",
      run_after: runAfter,
      max_attempts: 4,
      idempotency_key: `waitlist-recovery:${organizationId}:${order.id}:${next}`,
      request_fingerprint: Buffer.from(JSON.stringify(payload)).toString("base64").slice(0, 500),
      payload,
      actor_user_id: "waitlist-recovery-autopilot",
      actor_role: "internal",
      source: "worker",
    },
    {
      onConflict: "organization_id,idempotency_key",
      ignoreDuplicates: true,
    }
  );
  return runAfter;
}

export async function executeWaitlistRecoveryAutopilot({
  orderId,
  organizationId,
  stage = "FIRST_CANDIDATE",
}: {
  orderId: string;
  organizationId: string;
  stage?: WaitlistRecoveryStage;
}): Promise<RecoveryAutopilotResult> {
  const { data: orderRow, error: orderError } = await supabaseAdmin
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (orderError || !orderRow) {
    return { ok: false, orderId, recoveryState: "FAILED_RECOVERY", stage, reason: orderError?.message ?? "Order not found." };
  }

  const order = mapAndEnrichOrderFromDb(orderRow);
  const locationId = order.locationId ?? null;

  if (!isRecoverableSlot(order)) {
    return { ok: true, orderId, recoveryState: order.recoveryState ?? "OPEN_RECOVERY", stage, reason: "Slot is not currently recoverable." };
  }

  const { data: existingRecovery } = await supabaseAdmin
    .from("orders")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("recovery_source_order_id", order.id)
    .maybeSingle();

  if (existingRecovery) {
    await supabaseAdmin
      .from("orders")
      .update(mapOrderToDb({ recoveryState: "RECOVERED", recoveryUpdatedAt: new Date().toISOString() }))
      .eq("id", order.id)
      .eq("organization_id", organizationId);
    return { ok: true, orderId, recoveryState: "RECOVERED", stage, reason: "Slot already has a recovered replacement." };
  }

  const now = new Date().toISOString();
  const expiresAt = order.recoveryExpiresAt ?? new Date(Date.now() + 20 * 60_000).toISOString();

  if (stage === "EXPIRE" || new Date(expiresAt).getTime() <= Date.now()) {
    await supabaseAdmin
      .from("orders")
      .update(mapOrderToDb({ recoveryState: "FAILED_RECOVERY", recoveryUpdatedAt: now }))
      .eq("id", order.id)
      .eq("organization_id", organizationId);
    await writeRecoveryEvent({
      order,
      state: "FAILED_RECOVERY",
      action: `Waitlist recovery failed for ${order.id}.`,
      title: "Recovery failed",
      summary: "The slot could not be refilled before the recovery window closed.",
      confidence: 60,
      meta: { eventKey: `waitlist-recovery-expired:${order.id}`, stage },
    });
    return { ok: false, orderId, recoveryState: "FAILED_RECOVERY", stage, reason: "Recovery window expired." };
  }

  const { data: waitlistRows, error: waitlistError } = await supabaseAdmin
    .from("waitlist_leads")
    .select("*")
    .eq("organization_id", organizationId);

  if (waitlistError) {
    return { ok: false, orderId, recoveryState: "FAILED_RECOVERY", stage, reason: waitlistError.message };
  }

  const waitlist: WaitlistLead[] = (waitlistRows ?? []).map((row) => ({
    id: row.id,
    customerName: row.customer_name,
    phone: row.phone,
    preferredType: row.preferred_type,
    showProbability: Number(row.show_probability ?? 50),
    responseSpeedScore: Number(row.response_speed_score ?? 50),
    reliabilityScore: Number(row.reliability_score ?? 50),
    createdAt: row.created_at,
  }));

  const recentLeadIds = await recentOfferLeadIds(order.id, organizationId);
  const ranked = rankRecoveryCandidates({ order, waitlist, recentOfferLeadIds: recentLeadIds });
  const selected = ranked[0];

  if (!selected) {
    const nextRunAfter = await scheduleNextRecoveryStage({ order, stage, organizationId, locationId });
    await supabaseAdmin
      .from("orders")
      .update(mapOrderToDb({
        recoveryState: stage === "OWNER_ALERT" ? "FAILED_RECOVERY" : "OPEN_RECOVERY",
        recoveryStartedAt: order.recoveryStartedAt ?? now,
        recoveryUpdatedAt: now,
        recoveryExpiresAt: expiresAt,
        recoveryAttemptCount: Number(order.recoveryAttemptCount ?? 0) + 1,
      }))
      .eq("id", order.id)
      .eq("organization_id", organizationId);
    await writeRecoveryEvent({
      order,
      state: stage === "OWNER_ALERT" ? "FAILED_RECOVERY" : "OPEN_RECOVERY",
      action: `Waitlist recovery is still searching for ${order.id}.`,
      title: stage === "OWNER_ALERT" ? "Recovery needs owner review" : "Recovery still searching",
      summary: "No suitable waitlist candidate was available without over-contacting customers.",
      confidence: 45,
      meta: { eventKey: `waitlist-recovery-no-candidate:${order.id}:${stage}`, stage, nextRunAfter },
    });
    return { ok: false, orderId, recoveryState: stage === "OWNER_ALERT" ? "FAILED_RECOVERY" : "OPEN_RECOVERY", stage, nextRunAfter, reason: "No contactable candidate available." };
  }

  const state = stateForStage(stage);
  const message = `Hi ${selected.customerName}, a ${order.orderType.replaceAll("_", " ").toLowerCase()} slot may be available at Valsentra. Reply if you can take it.`;
  const communication = selected.phone
    ? await executeDirectCommunication({
        channel: "WHATSAPP",
        to: selected.phone,
        message,
        orderId: order.id,
        customerName: selected.customerName,
        metadata: {
          organizationId,
          locationId,
          recoveryOfferCandidateId: selected.id,
          recoveryState: state,
          stage,
          idempotencyKey: `waitlist-offer:${organizationId}:${order.id}:${selected.id}:${stage}`,
        },
      })
    : null;

  const cascade = stage === "BROAD_CASCADE"
    ? await runWaitlistCascade({
        orderId: order.id,
        staffName: "Waitlist Recovery Autopilot",
        organizationId,
      })
    : undefined;

  const finalState: RecoveryState = cascade?.ok ? "RECOVERED" : state;
  const nextRunAfter = finalState === "RECOVERED"
    ? undefined
    : await scheduleNextRecoveryStage({ order, stage, organizationId, locationId });

  await supabaseAdmin
    .from("orders")
    .update(mapOrderToDb({
      recoveryState: finalState,
      recoveryStartedAt: order.recoveryStartedAt ?? now,
      recoveryUpdatedAt: now,
      recoveryExpiresAt: expiresAt,
      recoveryAttemptCount: Number(order.recoveryAttemptCount ?? 0) + 1,
      recoverySelectedLeadId: selected.id,
    }))
    .eq("id", order.id)
    .eq("organization_id", organizationId);

  await writeRecoveryEvent({
    order,
    state: finalState,
    action: finalState === "RECOVERED"
      ? `Waitlist recovery found a replacement for ${order.id}.`
      : `Waitlist recovery offer sent for ${order.id}.`,
    title: finalState === "RECOVERED" ? "Replacement found" : "Recovery offer sent",
    summary: finalState === "RECOVERED"
      ? `Recovered with ${cascade?.lead?.customerName ?? selected.customerName}.`
      : `Offered the slot to ${selected.customerName}; waiting for response.`,
    confidence: selected.recoveryScore,
    meta: {
      eventKey: `waitlist-recovery-offer:${order.id}:${selected.id}:${stage}`,
      stage,
      selectedLeadId: selected.id,
      selectedLeadName: selected.customerName,
      candidateScore: selected.recoveryScore,
      candidateReasoning: selected.scoringReasons,
      communicationStatus: communication?.status ?? "SKIPPED",
      communicationProvider: communication?.provider ?? null,
      realMessageSent: communication?.realMessageSent ?? false,
      nextRunAfter,
      cascade,
    },
  });

  return {
    ok: true,
    orderId,
    recoveryState: finalState,
    stage,
    selectedCandidate: selected,
    cascade,
    nextRunAfter,
    reason: finalState === "RECOVERED" ? "Replacement found." : "Offer sent and recovery remains active.",
  };
}
