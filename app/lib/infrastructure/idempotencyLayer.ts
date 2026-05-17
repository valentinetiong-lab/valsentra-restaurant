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
  matchedIdempotencyId?: string | number;
  reason: string;
};

function fingerprint(value: unknown) {
  return Buffer.from(JSON.stringify(value ?? {})).toString("base64").slice(0, 500);
}

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
  organizationId = "org-valsentra",
  locationId = null,
  orderId = null,
  requestFingerprint,
  metadata = {},
}: {
  key: string;
  scope: IdempotencyScope;
  organizationId?: string | null;
  locationId?: string | null;
  orderId?: string | null;
  requestFingerprint?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<IdempotencyCheck> {
  const durable = await supabaseAdmin
    .from("operational_idempotency_keys")
    .upsert(
      {
        organization_id: organizationId ?? "org-valsentra",
        location_id: locationId,
        scope,
        idempotency_key: key,
        request_fingerprint: requestFingerprint ?? fingerprint(metadata),
        order_id: orderId,
        last_seen_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString(),
        metadata,
      },
      {
        onConflict: "organization_id,scope,idempotency_key",
        ignoreDuplicates: true,
      }
    )
    .select("id")
    .maybeSingle();

  if (!durable.error && !durable.data) {
    const existing = await supabaseAdmin
      .from("operational_idempotency_keys")
      .select("id, replay_count")
      .eq("organization_id", organizationId ?? "org-valsentra")
      .eq("scope", scope)
      .eq("idempotency_key", key)
      .maybeSingle();

    if (existing.data) {
      await supabaseAdmin
        .from("operational_idempotency_keys")
        .update({
          replay_count: Number(existing.data.replay_count ?? 0) + 1,
          last_seen_at: new Date().toISOString(),
        })
        .eq("id", existing.data.id);

      return {
        key,
        scope,
        duplicate: true,
        matchedIdempotencyId: existing.data.id,
        reason: `${scope} duplicate blocked by durable idempotency table.`,
      };
    }
  }

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
    matchedIdempotencyId: durable.data?.id,
    reason: match
      ? `${scope} duplicate blocked by existing audit metadata.`
      : `${scope} idempotency key is clear and recorded durably.`,
  };
}
