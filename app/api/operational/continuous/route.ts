import { NextResponse } from "next/server";
import {
  getContinuousOperationalLoopState,
  runContinuousOperationalLoopOnce,
  startContinuousOperationalLoop,
  stopContinuousOperationalLoop,
} from "@/app/lib/continuousOperationalScheduler";

export const dynamic = "force-dynamic";

export async function GET() {
  const state = getContinuousOperationalLoopState();

  return NextResponse.json({
    running: state.running,
    lastRunAt: state.lastRunAt ?? null,
    lastResult: state.lastResult ?? null,
    lastError: state.lastError ?? null,
  });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const action = body.action ?? "run";

  if (action === "start") {
    const state = startContinuousOperationalLoop();
    return NextResponse.json({
      running: state.running,
      lastRunAt: state.lastRunAt ?? null,
      lastResult: state.lastResult ?? null,
      lastError: state.lastError ?? null,
    });
  }

  if (action === "stop") {
    const state = stopContinuousOperationalLoop();
    return NextResponse.json({
      running: state.running,
      lastRunAt: state.lastRunAt ?? null,
      lastResult: state.lastResult ?? null,
      lastError: state.lastError ?? null,
    });
  }

  const result = await runContinuousOperationalLoopOnce();
  return NextResponse.json({
    running: getContinuousOperationalLoopState().running,
    result,
  });
}
