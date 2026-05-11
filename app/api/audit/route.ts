import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "../../lib/admin";

function mapAuditFromDb(row: Record<string, any>) {
  return {
    id: row.id,
    action: row.action,
    staff: row.staff,
    orderId: row.order_id,
    meta: row.meta ?? {},
    createdAt: row.created_at,
  };
}

export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from("audit_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json((data ?? []).map(mapAuditFromDb));
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Failed to fetch audit logs" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const payload = {
      action: body.action,
      staff: body.staff,
      order_id: body.orderId,
      meta: body.meta ?? {},
    };

    const { data, error } = await supabaseAdmin
      .from("audit_logs")
      .insert(payload)
      .select("*")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(mapAuditFromDb(data));
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Failed to create audit log" },
      { status: 500 }
    );
  }
}