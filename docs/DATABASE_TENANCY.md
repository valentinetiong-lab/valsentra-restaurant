# Valsentra Database Tenancy

Valsentra uses organization-first data ownership.

## Tenant Model

- `organizations.id` is the tenant boundary.
- `locations.organization_id` links branches to one organization.
- Operational tables must carry `organization_id`.
- Location-aware tables should also carry `location_id`.
- Server routes must resolve an authenticated actor before operational reads/writes.

## Operational Tables

- `orders`: organization/location scoped. Core operational record.
- `audit_logs`: organization/location scoped via top-level columns and metadata.
- `staff`: organization/location scoped, optionally mapped to Supabase `auth.users` by `user_id`.
- `restaurant_settings`: one settings row per organization.
- `waitlist_leads`: organization/location scoped for recovery matching.
- `operational_idempotency_keys`: durable replay protection for sends, webhooks, recovery actions, and audit events.

## RLS Preparation

The migration adds `public.current_organization_id()` and table comments describing future RLS policy shape. RLS is not aggressively enabled yet so the app can complete a safe rollout while server-side tenant filters are enforced first.

## Ownership Rules

- Reads must filter by `organization_id`.
- Updates/deletes must filter by `organization_id`.
- Inserts must attach `organization_id`, `location_id` when available, and actor metadata.
- Audit/security events must include `organizationId`, `actorUserId`, `actorRole`, and `requestTraceId`.
