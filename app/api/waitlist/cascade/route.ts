import { NextResponse } from "next/server";
import { runWaitlistCascade } from "@/app/lib/waitlistCascadeService";

export async function POST(req: Request) {
  try {
    const { orderId, staffName } = await req.json();

    const result = await runWaitlistCascade({
      orderId,
      staffName: staffName ?? "Staff",
    });

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: result.duplicate ? 409 : 400 }
      );
    }

    return NextResponse.json({
      message: "Waitlist cascade success",
      newOrder: result.newOrder,
      lead: result.lead,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Cascade failed" },
      { status: 500 }
    );
  }
}