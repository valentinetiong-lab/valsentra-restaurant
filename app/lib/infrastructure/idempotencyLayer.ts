import { supabaseAdmin } from "@/app/lib/admin";

export type IdempotencyScope =
  | "WHATSAPP_SEND"
  | "RECOVERY_ACTION"
  | "AUDIT_EVENT"
  | "PAYMENT_TRANSITION"
  | "AUTONOMOUS_EXECUTION"
  | "WEBHOOK";

export type IdempotencyCheck = {
  key: string;
  scope: IdempotencyScope;
  duplicate: boolean;
  matchedAuditId?: string | number;
  reason: string;
};

export function buildIdempotencyKey({
  scope,
  organizationId,
  orderId,
  action,
  providerMessageId,
  bucket,
}: {
  scope: IdempotencyScope;
  organizationId?: string | null;
  orderId?: string | null;
  action: string;
  providerMessageId?: string | number | null;
  bucket?: string | null;
}) {
  return [
    scope,
    organizationId ?? "org-default",
    orderId ?? "system",
    action,
    providerMessageId ?? "no-provider-message",
    bucket ?? "stable",
  ]
    .map((part) => String(part).replace(/\s+/g, "_").toLowerCase())
    .join(":");
}

export async function checkIdempotencyKey({
  key,
  scope,
}: {
  key: string;
  scope: IdempotencyScope;
}): Promise<IdempotencyCheck> {
  const { data, error } = await supabaseAdmin
    .from("audit_logs")
    .select("id, meta")
    .or(`meta->>idempotencyKey.eq.${key},meta->>eventKey.eq.${key}`)
    .limit(1);

  if (error) {
    return {
      key,
      scope,
      duplicate: false,
      reason: `Idempotency lookup failed open for visibility only: ${error.message}`,
    };
  }

  const match = data?.[0];

  return {
    key,
    scope,
    duplicate: Boolean(match),
    matchedAuditId: match?.id,
    reason: match
      ? `${scope} duplicate blocked by existing audit metadata.`
      : `${scope} idempotency key is clear.`,
  };
}
