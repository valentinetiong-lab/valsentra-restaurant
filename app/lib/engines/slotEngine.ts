export type SlotTimerInput = {
  slotHoldStartedAt?: string | null;
  slotHoldExpiresAt?: string | null;
  now?: Date;
};

function parseTime(value?: string | null) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function getSlotHoldStartedAt(input: SlotTimerInput) {
  return parseTime(input.slotHoldStartedAt);
}

export function getSlotHoldExpiresAt(input: SlotTimerInput) {
  return parseTime(input.slotHoldExpiresAt);
}

export function getSlotRemainingMs(input: SlotTimerInput) {
  const expiresAt = getSlotHoldExpiresAt(input);
  if (!expiresAt) return null;

  return Math.max(expiresAt.getTime() - (input.now ?? new Date()).getTime(), 0);
}

export function isSlotExpired(input: SlotTimerInput) {
  const expiresAt = getSlotHoldExpiresAt(input);
  if (!expiresAt) return false;

  return expiresAt.getTime() <= (input.now ?? new Date()).getTime();
}

export function formatSlotRemaining(ms: number | null) {
  if (ms === null) return "Not set";

  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
}
