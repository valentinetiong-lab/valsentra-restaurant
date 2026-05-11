export type AutopilotMode = "MANUAL" | "SEMI_AUTO" | "FULL_AUTO";

export function shouldExecuteAutoRelease(mode: AutopilotMode) {
  if (mode === "MANUAL") return false;
  return true;
}

export function shouldExecuteWaitlist(mode: AutopilotMode) {
  if (mode === "MANUAL") return false;
  return true;
}

export function shouldSilent(mode: AutopilotMode) {
  return mode === "FULL_AUTO";
}