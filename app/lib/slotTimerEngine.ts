export function getTimeRemaining(expiresAt?: string | null) {
  if (!expiresAt) return null;

  const expiry = new Date(expiresAt).getTime();
  if (Number.isNaN(expiry)) return null;

  return expiry - Date.now();
}

export function formatTimeRemaining(ms: number | null) {
  if (ms === null) return "Not set";
  if (ms <= 0) return "Expired";

  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

export function isExpired(expiresAt?: string | null) {
  if (!expiresAt) return false;

  const expiry = new Date(expiresAt).getTime();
  if (Number.isNaN(expiry)) return false;

  return expiry <= Date.now();
}
