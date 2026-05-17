import { runContinuousOperationalPass } from "@/app/lib/continuousOperationalEngine";

const LOOP_INTERVAL_MS = 60_000;

type SchedulerState = {
  running: boolean;
  organizationId?: string;
  interval?: ReturnType<typeof setInterval>;
  lastRunAt?: string;
  lastResult?: Awaited<ReturnType<typeof runContinuousOperationalPass>>;
  lastError?: string;
};

const globalScheduler = globalThis as typeof globalThis & {
  __valsentraContinuousScheduler?: SchedulerState;
};

function getState() {
  if (!globalScheduler.__valsentraContinuousScheduler) {
    globalScheduler.__valsentraContinuousScheduler = {
      running: false,
    };
  }

  return globalScheduler.__valsentraContinuousScheduler;
}

export async function runContinuousOperationalLoopOnce({
  organizationId = "org-valsentra",
}: {
  organizationId?: string;
} = {}) {
  const state = getState();

  try {
    const result = await runContinuousOperationalPass({ organizationId });
    state.lastRunAt = new Date().toISOString();
    state.lastResult = result;
    state.lastError = undefined;
    return result;
  } catch (error: any) {
    state.lastRunAt = new Date().toISOString();
    state.lastError = error?.message ?? "Continuous operational pass failed";
    throw error;
  }
}

export function startContinuousOperationalLoop({
  organizationId = "org-valsentra",
}: {
  organizationId?: string;
} = {}) {
  const state = getState();

  if (state.running) return state;

  state.running = true;
  state.organizationId = organizationId;
  void runContinuousOperationalLoopOnce({ organizationId }).catch((error) => {
    console.warn("Initial continuous operational pass failed", error);
  });

  state.interval = setInterval(() => {
    void runContinuousOperationalLoopOnce({ organizationId: state.organizationId }).catch((error) => {
      console.warn("Continuous operational pass failed", error);
    });
  }, LOOP_INTERVAL_MS);

  return state;
}

export function stopContinuousOperationalLoop() {
  const state = getState();

  if (state.interval) {
    clearInterval(state.interval);
  }

  state.running = false;
  state.interval = undefined;
  return state;
}

export function getContinuousOperationalLoopState() {
  return getState();
}
