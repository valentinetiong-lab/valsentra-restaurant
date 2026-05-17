import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/admin";
import {
  buildTimelineSummary,
  classifyTimelineCategory,
  classifyTimelineSeverity,
  getTimelineEventTitle,
} from "@/app/lib/intelligence/timelineClassifier";
import { requireRouteRole } from "@/app/lib/security/routeProtection";

function mapTimelineFromAudit(row: Record<string, any>) {
  const meta = row.meta ?? {};
  const action = row.action ?? "Audit event";
  const category = classifyTimelineCategory(action, meta);
  const severity = classifyTimelineSeverity(action, meta);

  return {
    id: row.id,
    orderId: row.order_id,
    organizationId: meta?.organizationId ?? meta?.organization_id ?? null,
    locationId: meta?.locationId ?? meta?.location_id ?? null,
    locationName: meta?.locationName ?? meta?.location_name ?? null,
    staff: row.staff ?? "System",
    action,
    title: meta?.title ?? getTimelineEventTitle(category),
    summary: buildTimelineSummary(action, meta),
    category,
    severity,
    collapseProbability: meta?.collapseProbability ?? null,
    collapseRiskTier: meta?.collapseRiskTier ?? null,
    recommendedIntervention: meta?.recommendedIntervention ?? null,
    ghostPingUrgency: meta?.ghostPingUrgency ?? null,
    ghostPingMessageType: meta?.ghostPingMessageType ?? null,
    ghostPingReasoning: meta?.ghostPingReasoning ?? null,
    learningEntry: meta?.learningEntry ?? null,
    createdAt: row.created_at,
  };
}

export async function GET(request: Request) {
  const access = await requireRouteRole({
    request,
    route: "/api/intelligence/timeline",
    allowedRoles: ["staff", "manager", "owner", "admin", "internal"],
  });
  if (!access.ok) return access.response;

  try {
    const { data, error } = await supabaseAdmin
      .from("audit_logs")
      .select("*")
      .eq("meta->>organizationId", access.actor.organizationId)
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json((data ?? []).map(mapTimelineFromAudit));
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Failed to fetch intelligence timeline" },
      { status: 500 }
    );
  }
}
