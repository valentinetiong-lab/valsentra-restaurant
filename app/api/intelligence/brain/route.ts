import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/admin";
import { buildOperationalBrainInsights } from "@/app/lib/intelligence/operationalBrainEngine";

export async function GET() {
  try {
    const [
      { data: ordersRaw, error: ordersError },
      { data: auditRaw, error: auditError },
      { data: waitlistRaw, error: waitlistError },
    ] =
      await Promise.all([
        supabaseAdmin.from("orders").select("*").order("created_at", { ascending: false }),
        supabaseAdmin
          .from("audit_logs")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(200),
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

    const insights = buildOperationalBrainInsights({
      ordersRaw: ordersRaw ?? [],
      auditRaw: auditRaw ?? [],
      waitlistRaw: waitlistRaw ?? [],
    });

    return NextResponse.json(insights);
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Failed to build operational brain insights" },
      { status: 500 }
    );
  }
}
