import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/admin";
import { mapAndEnrichOrderFromDb } from "@/app/lib/domain/orderMapper";
import { buildMultiLocationIntelligenceSnapshot } from "@/app/lib/intelligence/multiLocationIntelligenceEngine";
import { buildOperationalDigitalTwin } from "@/app/lib/operationalDigitalTwinEngine";
import { buildCommunicationClimate } from "@/app/lib/communicationOrchestrationEngine";
import {
  createOperationalMemorySnapshot,
  getAdaptiveDecisionContext,
} from "@/app/lib/operationalMemoryEngine";
import { resolveOperationalPolicy } from "@/app/lib/policyEngine";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [
      { data: ordersRaw, error: ordersError },
      { data: auditRaw, error: auditError },
      { data: waitlistRaw, error: waitlistError },
    ] = await Promise.all([
      supabaseAdmin.from("orders").select("*").order("created_at", { ascending: false }),
      supabaseAdmin
        .from("audit_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500),
      supabaseAdmin.from("waitlist_leads").select("id").limit(200),
    ]);

    if (ordersError) {
      return NextResponse.json({ error: ordersError.message }, { status: 500 });
    }

    if (auditError) {
      return NextResponse.json({ error: auditError.message }, { status: 500 });
    }
    if (waitlistError) {
      return NextResponse.json({ error: waitlistError.message }, { status: 500 });
    }

    const orders = (ordersRaw ?? []).map(mapAndEnrichOrderFromDb);
    const snapshot = buildMultiLocationIntelligenceSnapshot({
      orders,
      auditRows: auditRaw ?? [],
    });
    const memory = createOperationalMemorySnapshot({
      orders,
      auditRows: auditRaw ?? [],
    });
    const twin = buildOperationalDigitalTwin({
      orders,
      auditRows: auditRaw ?? [],
      memory,
      organization: snapshot,
      waitlistCount: waitlistRaw?.length ?? 0,
    });
    const communication = buildCommunicationClimate({
      orders,
      auditRows: auditRaw ?? [],
      memory,
      digitalTwin: twin,
    });

    return NextResponse.json({
      ...snapshot,
      learning: {
        organization: memory.organizationLearning,
        branches: memory.branchProfiles,
        actionProfiles: memory.actionProfiles,
        communication: memory.communicationLearning,
        memoryConfidence: memory.memoryConfidence,
      },
      policies: memory.branchProfiles.map((branch) => {
        const learningContext = getAdaptiveDecisionContext({
          snapshot: memory,
          action: "OFFER_WAITLIST",
          locationId: branch.locationId,
        });
        const policy = resolveOperationalPolicy({
          organizationId: branch.organizationId,
          locationId: branch.locationId,
          memory,
          learningContext,
          digitalTwin: twin,
        });

        return {
          locationId: branch.locationId,
          locationName: branch.locationName,
          automationAggressiveness: policy.automationAggressiveness,
          fraudSensitivity: policy.fraudSensitivity,
          recoveryAggressiveness: policy.recoveryAggressiveness,
          releaseTolerance: policy.releaseTolerance,
          escalationSpeed: policy.escalationSpeed,
          confidenceThresholds: policy.confidenceThresholds,
          explanation: policy.explanation,
        };
      }),
      digitalTwin: twin,
      communication,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Failed to build organization intelligence" },
      { status: 500 }
    );
  }
}
