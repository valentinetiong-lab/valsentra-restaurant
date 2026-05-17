-- Operational Timeline Memory Engine v1
-- Append-only, tenant-scoped black-box recorder for restaurant operations.

create extension if not exists pgcrypto;

create table if not exists public.operational_timeline_events (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null,
  location_id text null,
  order_id text null,
  actor_source text null,
  actor_user_id text null,
  event_type text not null,
  summary text not null,
  severity text not null default 'INFO',
  category text not null,
  event_timestamp timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  trace_id text null,
  execution_id text null,
  correlation_id text null,
  idempotency_key text not null,
  created_at timestamptz not null default now()
);

alter table public.operational_timeline_events
  add column if not exists organization_id text,
  add column if not exists location_id text,
  add column if not exists order_id text,
  add column if not exists actor_source text,
  add column if not exists actor_user_id text,
  add column if not exists event_type text,
  add column if not exists summary text,
  add column if not exists severity text default 'INFO',
  add column if not exists category text,
  add column if not exists event_timestamp timestamptz default now(),
  add column if not exists metadata jsonb default '{}'::jsonb,
  add column if not exists trace_id text,
  add column if not exists execution_id text,
  add column if not exists correlation_id text,
  add column if not exists idempotency_key text,
  add column if not exists created_at timestamptz default now();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'operational_timeline_events_org_idempotency_key'
  ) then
    alter table public.operational_timeline_events
      add constraint operational_timeline_events_org_idempotency_key
      unique (organization_id, idempotency_key);
  end if;
end $$;

create index if not exists operational_timeline_events_org_time_idx
  on public.operational_timeline_events (organization_id, event_timestamp desc);

create index if not exists operational_timeline_events_org_order_time_idx
  on public.operational_timeline_events (organization_id, order_id, event_timestamp desc);

create index if not exists operational_timeline_events_org_category_time_idx
  on public.operational_timeline_events (organization_id, category, event_timestamp desc);

create index if not exists operational_timeline_events_org_type_time_idx
  on public.operational_timeline_events (organization_id, event_type, event_timestamp desc);

comment on table public.operational_timeline_events is
  'Append-only operational black-box recorder for booking, payment, recovery, communication, worker, and fulfillment events.';

comment on column public.operational_timeline_events.idempotency_key is
  'Stable tenant-scoped key that prevents duplicated operational timeline memory events.';

comment on column public.operational_timeline_events.metadata is
  'Structured event context for incident replay. Do not store secrets or provider credentials here.';
