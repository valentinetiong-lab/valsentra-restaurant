import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/admin";

function mapStaffFromDb(row: any) {
  return {
    id: String(row.id),
    name: row.name ?? "Staff",
    role: row.role ?? "staff",
    createdAt: row.created_at ?? undefined,
  };
}

export async function GET() {
  const { data, error } = await supabaseAdmin
    .from("staff")
    .select("id, name, role, created_at")
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json((data ?? []).map(mapStaffFromDb));
}
