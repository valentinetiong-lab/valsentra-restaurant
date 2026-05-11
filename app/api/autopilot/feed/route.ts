import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/admin";

function formatAuditTime(value?: string | null) {
  if (!value) return "Not set";

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Not set";

  return parsed.toLocaleString("en-MY", {
    timeZone: "Asia/Kuala_Lumpur",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function classifyAuditAction(action: string) {
  const lower = action.toLowerCase();

  if (lower.includes("waitlist cascade") || lower.includes("recovered slot")) {
    return {
      status: "Recovered (Waitlist)",
      title: "Waitlist recovery completed",
    };
  }

  if (
    lower.includes("slot expired without verified payment") ||
    lower.includes("auto release") ||
    lower.includes("auto-released") ||
    lower.includes("released")
  ) {
    return {
      status: "Auto Released",
      title: "Slot auto-released",
    };
  }

  if (lower.includes("final reminder")) {
    return {
      status: "Final Reminder Sent",
      title: "Final reminder sent",
    };
  }

  if (lower.includes("reminder")) {
    return {
      status: "Reminder Sent",
      title: "Reminder sent",
    };
  }

  if (lower.includes("verified")) {
    return {
      status: "Payment Verified",
      title: "Payment verified",
    };
  }

  if (lower.includes("cancelled") || lower.includes("canceled")) {
    return {
      status: "Order Cancelled",
      title: "Order cancelled",
    };
  }

  if (lower.includes("created order") || lower.includes("created")) {
    return {
      status: "Order Created",
      title: "Order created",
    };
  }

  return {
    status: "Audit Event",
    title: "Audit event",
  };
}

function mapAuditToFeedItem(row: Record<string, any>) {
  const action = String(row.action ?? "Audit event");
  const meta = row.meta ?? {};
  const classified = classifyAuditAction(action);
  const orderId = String(row.order_id ?? "Unknown order");
  const staff = String(row.staff ?? "Unknown");

  return {
    id: String(row.id),
    title: classified.title,
    detail: action,
    status: classified.status,
    staff,
    orderId,
    timeLabel: formatAuditTime(row.created_at),
    createdAt: row.created_at,

    rule: meta.rule ?? null,
    reason: meta.reason ?? null,
    explanation: meta.explanation ?? null,
    confidence: meta.confidence ?? meta.recoveryScore ?? null,
    riskLevel: meta.riskLevel ?? null,
    recoverableRevenue: meta.recoverableRevenue ?? null,
    orderAmount: meta.orderAmount ?? null,
    requiresHumanAction: Boolean(meta.requiresHumanAction),
    humanActionReason: meta.humanActionReason ?? null,
  };
}

export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from("audit_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json((data ?? []).map(mapAuditToFeedItem));
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Failed to fetch autopilot feed" },
      { status: 500 }
    );
  }
}