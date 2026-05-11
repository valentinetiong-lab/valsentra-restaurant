import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/admin";
import { runWaitlistCascade } from "@/app/lib/waitlistCascadeService";
import { evaluateAutoRelease } from "@/app/lib/autoReleaseEngine";
import { buildReliabilityProfileFromOrders } from "@/app/lib/reliabilityEngine";
import { createContinuousLearningEntry } from "@/app/lib/continuousLearningLedger";
import {
  mapAndEnrichOrderFromDb,
  mapOrderToDb,
} from "@/app/lib/domain/orderMapper";
import { parseReservationTime } from "@/app/lib/domain/reservationTimeParser";
import { normalisePaymentState } from "@/app/lib/engines/paymentEngine";
import {
  shouldExecuteAutoRelease,
  shouldExecuteWaitlist,
  shouldSilent,
  type AutopilotMode,
} from "@/app/lib/autopilotMode";

function createLearningEntryForOrder(
  order: any,
  eventType: Parameters<typeof createContinuousLearningEntry>[0]["eventType"],
  outcome: Parameters<typeof createContinuousLearningEntry>[0]["outcome"],
  notes?: string
) {
  return createContinuousLearningEntry({
    orderId: order.id,
    customerName: order.customerName,
    phone: order.phone,
    eventType,
    outcome,
    collapseProbability: order.collapseProbability,
    collapseRiskTier: order.collapseRiskTier,
    recommendedIntervention: order.recommendedIntervention,
    ghostPingUrgency: order.ghostPingUrgency,
    ghostPingMessageType: order.ghostPingMessageType,
    reliabilityScore: order.reliabilityScore,
    amount: order.amount,
    orderType: order.orderType,
    notes,
  });
}

function buildIntelligenceMeta(order: any) {
  return {
    collapseProbability: order.collapseProbability,
    collapseRiskTier: order.collapseRiskTier,
    recommendedIntervention: order.recommendedIntervention,
    instabilityFactors: order.instabilityFactors,
    collapseExplanation: order.collapseExplanation,
    ghostPingShouldSend: order.ghostPingShouldSend,
    ghostPingUrgency: order.ghostPingUrgency,
    ghostPingMessageType: order.ghostPingMessageType,
    ghostPingEscalationStage: order.ghostPingEscalationStage,
    ghostPingRecommendedDelayMinutes: order.ghostPingRecommendedDelayMinutes,
    ghostPingReasoning: order.ghostPingReasoning,
  };
}

function addMinutesToIso(baseIso: string, minutes: number) {
  return new Date(
    new Date(baseIso).getTime() + minutes * 60 * 1000
  ).toISOString();
}

async function getAutopilotMode(): Promise<AutopilotMode> {
  const { data, error } = await supabaseAdmin
    .from("restaurant_settings")
    .select("autopilot_mode")
    .eq("id", 1)
    .single();

  if (error) {
    console.warn("Failed to load autopilot mode. Falling back to SEMI_AUTO.", error);
    return "SEMI_AUTO";
  }

  const mode = data?.autopilot_mode;

  if (mode === "MANUAL" || mode === "SEMI_AUTO" || mode === "FULL_AUTO") {
    return mode;
  }

  return "SEMI_AUTO";
}

export async function GET() {
  const { data, error } = await supabaseAdmin
    .from("orders")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const orders = (data ?? []).map(mapAndEnrichOrderFromDb);

  return NextResponse.json(orders);
}

export async function POST(req: Request) {
  const body = await req.json();

  const createdAt = body.createdAt ?? new Date().toISOString();
  const parsedReservationTime = parseReservationTime(String(body.reservationTime ?? ""));

  if (!parsedReservationTime.ok) {
    return NextResponse.json({ error: parsedReservationTime.error }, { status: 400 });
  }

  const payload = mapOrderToDb({
    ...body,
    createdAt,
    reservationTime: parsedReservationTime.reservationTime,
    paymentState: normalisePaymentState(body.paymentState),
    slotHoldStartedAt: body.slotHoldStartedAt ?? createdAt,
    slotHoldExpiresAt: body.slotHoldExpiresAt ?? addMinutesToIso(createdAt, 15),
    autoReleaseEligible: body.autoReleaseEligible ?? true,
    reliabilityScore: body.reliabilityScore ?? 70,
    assignedStaff: body.assignedStaff ?? "Staff",
  });

  const { data, error } = await supabaseAdmin
    .from("orders")
    .insert(payload)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(mapAndEnrichOrderFromDb(data));
}

export async function PATCH(req: Request) {
  const body = await req.json();
  const payload = mapOrderToDb(body);

  const { data, error } = await supabaseAdmin
    .from("orders")
    .update(payload)
    .eq("id", body.id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(mapAndEnrichOrderFromDb(data));
}

export async function PUT() {
  const mode = await getAutopilotMode();

  const { data: ordersRaw, error } = await supabaseAdmin.from("orders").select("*");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const allOrders = (ordersRaw ?? []).map(mapAndEnrichOrderFromDb);

  const logs: string[] = [];

  for (const order of allOrders) {
    const customerOrders = allOrders.filter((candidate) => {
      if (order.phone && candidate.phone) {
        return candidate.phone === order.phone;
      }

      return candidate.customerName === order.customerName;
    });

    const customerProfile = buildReliabilityProfileFromOrders(customerOrders);

    const decision = evaluateAutoRelease({
      ...order,
      customerProfile,
    });

    if (!decision.shouldRelease) {
      if (decision.requiresHumanAction) {
        logs.push(`${order.id}: needs human review (${decision.reason})`);

        const learningEntry = createLearningEntryForOrder(
          order,
          "GHOST_PING_RECOMMENDED",
          "UNKNOWN",
          `Human review required before release. ${decision.reason}`
        );

        if (!shouldSilent(mode)) {
          await supabaseAdmin.from("audit_logs").insert({
            action: `Human review required for ${order.id}. Rule: ${decision.rule}.`,
            staff: "Autopilot",
            order_id: order.id,
            meta: {
              mode,
              rule: decision.rule,
              reason: decision.reason,
              explanation: decision.explanation,
              confidence: decision.confidence,
              riskLevel: decision.riskLevel,
              orderAmount: order.amount ?? 0,
              ...buildIntelligenceMeta(order),
              learningEntry,
              requiresHumanAction: true,
              humanActionReason: decision.reason,
            },
          });
        }
      }

      continue;
    }

    if (!shouldExecuteAutoRelease(mode)) {
      logs.push(`${order.id}: suggested release only (${mode})`);

      const learningEntry = createLearningEntryForOrder(
        order,
        "AUTO_RELEASED",
        "UNKNOWN",
        `Auto release was suggested but not executed because autopilot mode is ${mode}.`
      );

      if (!shouldSilent(mode)) {
        await supabaseAdmin.from("audit_logs").insert({
          action: `Auto release suggested for ${order.id}. Rule: ${decision.rule}. Confidence: ${decision.confidence}%.`,
          staff: "Autopilot",
          order_id: order.id,
          meta: {
            mode,
            rule: decision.rule,
            reason: decision.reason,
            explanation: decision.explanation,
            confidence: decision.confidence,
            riskLevel: decision.riskLevel,
            orderAmount: order.amount ?? 0,
            ...buildIntelligenceMeta(order),
            learningEntry,
            requiresHumanAction: true,
            humanActionReason:
              "Autopilot is in manual mode, so this action requires approval.",
          },
        });
      }

      continue;
    }

    const { error: updateError } = await supabaseAdmin
      .from("orders")
      .update(
        mapOrderToDb({
          id: order.id,
          status: "CANCELLED",
          autoReleaseEligible: false,
          notes: `${order.notes || ""} | ${decision.reason}`,
        })
      )
      .eq("id", order.id);

    if (updateError) {
      logs.push(`${order.id}: release failed (${updateError.message})`);
      continue;
    }

    logs.push(`${order.id}: released`);

    const releaseLearningEntry = createLearningEntryForOrder(
      order,
      "AUTO_RELEASED",
      "NEGATIVE",
      decision.reason
    );

    if (!shouldSilent(mode)) {
      await supabaseAdmin.from("audit_logs").insert({
        action: `Auto release: ${order.id}. Rule: ${decision.rule}. Confidence: ${decision.confidence}%.`,
        staff: "Autopilot",
        order_id: order.id,
        meta: {
          mode,
          rule: decision.rule,
          reason: decision.reason,
          explanation: decision.explanation,
          confidence: decision.confidence,
          riskLevel: decision.riskLevel,
          orderAmount: order.amount ?? 0,
          ...buildIntelligenceMeta(order),
          learningEntry: releaseLearningEntry,
          requiresHumanAction: decision.requiresHumanAction,
        },
      });
    }

    if (shouldExecuteWaitlist(mode)) {
      const cascade = await runWaitlistCascade({
        orderId: order.id,
        staffName: "Autopilot",
      });

      const recoveryLearningEntry = createLearningEntryForOrder(
        order,
        cascade.ok && cascade.lead
          ? "WAITLIST_RECOVERY_SUCCEEDED"
          : "WAITLIST_RECOVERY_FAILED",
        cascade.ok && cascade.lead ? "POSITIVE" : "NEGATIVE",
        cascade.ok && cascade.lead
          ? `Recovered with ${cascade.lead.customerName}.`
          : `Recovery failed. ${cascade.error ?? "No recovery lead found."}`
      );

      if (cascade.ok && cascade.lead) {
        logs.push(`${order.id}: recovered with ${cascade.lead.customerName}`);
      } else {
        logs.push(`${order.id}: not recovered (${cascade.error})`);
      }

      if (!shouldSilent(mode)) {
        await supabaseAdmin.from("audit_logs").insert({
          action:
            cascade.ok && cascade.lead
              ? `Waitlist recovery succeeded for ${order.id} with ${cascade.lead.customerName}.`
              : `Waitlist recovery failed for ${order.id}.`,
          staff: "Autopilot",
          order_id: order.id,
          meta: {
            mode,
            orderAmount: order.amount ?? 0,
            ...buildIntelligenceMeta(order),
            cascade,
            learningEntry: recoveryLearningEntry,
          },
        });
      }
    } else {
      logs.push(`${order.id}: waitlist skipped (${mode})`);

      const waitlistSkippedLearningEntry = createLearningEntryForOrder(
        order,
        "WAITLIST_RECOVERY_ATTEMPTED",
        "NEUTRAL",
        `Waitlist recovery skipped because autopilot mode is ${mode}.`
      );

      if (!shouldSilent(mode)) {
        await supabaseAdmin.from("audit_logs").insert({
          action: `Waitlist recovery skipped for ${order.id} because autopilot mode is ${mode}.`,
          staff: "Autopilot",
          order_id: order.id,
          meta: {
            mode,
            orderAmount: order.amount ?? 0,
            ...buildIntelligenceMeta(order),
            learningEntry: waitlistSkippedLearningEntry,
          },
        });
      }
    }
  }

  return NextResponse.json({
    message: `Autopilot run complete (${mode})`,
    mode,
    logs,
  });
}
