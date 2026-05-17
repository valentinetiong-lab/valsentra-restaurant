-- Database & RLS Hardening Phase v1
-- Additive tenant foundation only. Safe to run multiple times on partially
-- migrated Supabase databases.

create table if not exists public.organizations (
  id text primary key,
  name text not null default 'Valsentra Organization',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.locations (
  id text primary key,
  organization_id text not null references public.organizations(id) on delete cascade,
  name text not null default 'Primary Location',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id)
);

insert into public.organizations (id, name)
values ('org-valsentra', 'Valsentra Restaurant')
on conflict (id) do nothing;

insert into public.locations (id, organization_id, name)
values ('loc-primary', 'org-valsentra', 'Primary Location')
on conflict (id) do nothing;

do $$
begin
  if to_regclass('public.orders') is not null then
    alter table public.orders
      add column if not exists organization_id text null,
      add column if not exists location_id text null,
      add column if not exists location_name text null,
      add column if not exists created_by uuid null,
      add column if not exists updated_by uuid null;

    update public.orders
    set organization_id = coalesce(organization_id, 'org-valsentra'),
        location_id = coalesce(location_id, 'loc-primary'),
        location_name = coalesce(location_name, 'Primary Location')
    where organization_id is null
       or location_id is null
       or location_name is null;

    create index if not exists orders_organization_id_idx on public.orders (organization_id);
    create index if not exists orders_location_id_idx on public.orders (location_id);
    create index if not exists orders_org_status_idx on public.orders (organization_id, status);
    create index if not exists orders_org_payment_state_idx on public.orders (organization_id, payment_state);
    create index if not exists orders_org_reservation_time_idx on public.orders (organization_id, reservation_time);

    comment on column public.orders.organization_id is
      'Tenant scope. All server-side operational reads/writes must filter by organization_id.';
    comment on table public.orders is
      'RLS-ready: tenant reads/writes should require organization_id = public.current_organization_id().';
  end if;
end $$;

do $$
begin
  if to_regclass('public.audit_logs') is not null then
    alter table public.audit_logs
      add column if not exists organization_id text null,
      add column if not exists location_id text null,
      add column if not exists created_by uuid null,
      add column if not exists updated_by uuid null,
      add column if not exists updated_at timestamptz null;

    update public.audit_logs
    set organization_id = coalesce(organization_id, meta->>'organizationId', 'org-valsentra'),
        location_id = coalesce(location_id, meta->>'locationId', 'loc-primary')
    where organization_id is null
       or location_id is null;

    create index if not exists audit_logs_organization_id_idx on public.audit_logs (organization_id);
    create index if not exists audit_logs_location_id_idx on public.audit_logs (location_id);
    create index if not exists audit_logs_org_created_at_idx on public.audit_logs (organization_id, created_at desc);
    create index if not exists audit_logs_order_id_idx on public.audit_logs (order_id);
    create index if not exists audit_logs_meta_event_key_idx on public.audit_logs ((meta->>'eventKey'));
    create index if not exists audit_logs_meta_idempotency_key_idx on public.audit_logs ((meta->>'idempotencyKey'));

    comment on column public.audit_logs.organization_id is
      'Tenant scope copied from audit metadata for fast filtering and RLS preparation.';
    comment on table public.audit_logs is
      'RLS-ready: tenant reads should require organization_id = public.current_organization_id(); inserts must attach actor metadata.';
  end if;
end $$;

do $$
begin
  if to_regclass('public.staff') is not null then
    alter table public.staff
      add column if not exists organization_id text null,
      add column if not exists location_id text null,
      add column if not exists user_id uuid null,
      add column if not exists created_by uuid null,
      add column if not exists updated_by uuid null,
      add column if not exists updated_at timestamptz null;

    update public.staff
    set organization_id = coalesce(organization_id, 'org-valsentra'),
        location_id = coalesce(location_id, 'loc-primary')
    where organization_id is null
       or location_id is null;

    create index if not exists staff_organization_id_idx on public.staff (organization_id);
    create index if not exists staff_user_id_idx on public.staff (user_id);

    comment on table public.staff is
      'RLS-ready: staff records are organization-owned and may map auth.users via user_id.';
  end if;
end $$;

do $$
begin
  if to_regclass('public.restaurant_settings') is not null then
    alter table public.restaurant_settings
      add column if not exists organization_id text null,
      add column if not exists location_id text null,
      add column if not exists created_by uuid null,
      add column if not exists updated_by uuid null;

    update public.restaurant_settings
    set organization_id = coalesce(organization_id, 'org-valsentra'),
        location_id = coalesce(location_id, 'loc-primary')
    where organization_id is null
       or location_id is null;

    create unique index if not exists restaurant_settings_org_unique_idx
      on public.restaurant_settings (organization_id);

    comment on table public.restaurant_settings is
      'RLS-ready: one settings record per organization; owner/manager updates only.';
  end if;
end $$;

do $$
begin
  if to_regclass('public.waitlist_leads') is not null then
    alter table public.waitlist_leads
      add column if not exists organization_id text null,
      add column if not exists location_id text null,
      add column if not exists created_by uuid null,
      add column if not exists updated_by uuid null,
      add column if not exists updated_at timestamptz null;

    update public.waitlist_leads
    set organization_id = coalesce(organization_id, 'org-valsentra'),
        location_id = coalesce(location_id, 'loc-primary')
    where organization_id is null
       or location_id is null;

    create index if not exists waitlist_leads_org_match_idx
      on public.waitlist_leads (organization_id, preferred_type, show_probability desc, response_speed_score desc);
    create index if not exists waitlist_leads_location_id_idx on public.waitlist_leads (location_id);

    comment on table public.waitlist_leads is
      'RLS-ready: waitlist matching must remain organization-scoped and optionally location-scoped.';
  end if;
end $$;

do $$
begin
  if to_regclass('public.autopilot_rules') is not null then
    alter table public.autopilot_rules
      add column if not exists organization_id text null,
      add column if not exists location_id text null,
      add column if not exists created_by uuid null,
      add column if not exists updated_by uuid null,
      add column if not exists created_at timestamptz not null default now(),
      add column if not exists updated_at timestamptz null;

    update public.autopilot_rules
    set organization_id = coalesce(organization_id, 'org-valsentra'),
        location_id = coalesce(location_id, 'loc-primary')
    where organization_id is null
       or location_id is null;

    create index if not exists autopilot_rules_organization_id_idx
      on public.autopilot_rules (organization_id);
  end if;
end $$;

create table if not exists public.operational_idempotency_keys (
  id bigserial primary key,
  organization_id text not null default 'org-valsentra',
  location_id text null,
  scope text not null,
  idempotency_key text not null,
  request_fingerprint text null,
  order_id text null,
  actor_user_id uuid null,
  status text not null default 'RECORDED',
  replay_count integer not null default 0,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz null,
  metadata jsonb not null default '{}'::jsonb,
  unique (organization_id, scope, idempotency_key)
);

create index if not exists operational_idempotency_expiry_idx
  on public.operational_idempotency_keys (expires_at);
create index if not exists operational_idempotency_order_idx
  on public.operational_idempotency_keys (organization_id, order_id);

comment on table public.operational_idempotency_keys is
  'Durable replay protection for autonomous sends, webhook handling, audit events, and recovery execution.';

create or replace function public.current_organization_id()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb ->> 'organization_id', ''),
    nullif(coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb -> 'app_metadata' ->> 'organization_id', ''),
    nullif(coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb -> 'user_metadata' ->> 'organization_id', '')
  )
$$;

comment on function public.current_organization_id() is
  'RLS helper for future Supabase policies. Policies should compare table.organization_id to this value.';

do $$
begin
  if to_regclass('public.orders') is not null and not exists (
    select 1 from pg_constraint where conname = 'orders_organization_id_fkey'
  ) then
    alter table public.orders
      add constraint orders_organization_id_fkey
      foreign key (organization_id) references public.organizations(id)
      not valid;
  end if;

  if to_regclass('public.audit_logs') is not null and not exists (
    select 1 from pg_constraint where conname = 'audit_logs_organization_id_fkey'
  ) then
    alter table public.audit_logs
      add constraint audit_logs_organization_id_fkey
      foreign key (organization_id) references public.organizations(id)
      not valid;
  end if;

  if to_regclass('public.staff') is not null and not exists (
    select 1 from pg_constraint where conname = 'staff_organization_id_fkey'
  ) then
    alter table public.staff
      add constraint staff_organization_id_fkey
      foreign key (organization_id) references public.organizations(id)
      not valid;
  end if;

  if to_regclass('public.restaurant_settings') is not null and not exists (
    select 1 from pg_constraint where conname = 'restaurant_settings_organization_id_fkey'
  ) then
    alter table public.restaurant_settings
      add constraint restaurant_settings_organization_id_fkey
      foreign key (organization_id) references public.organizations(id)
      not valid;
  end if;

  if to_regclass('public.waitlist_leads') is not null and not exists (
    select 1 from pg_constraint where conname = 'waitlist_leads_organization_id_fkey'
  ) then
    alter table public.waitlist_leads
      add constraint waitlist_leads_organization_id_fkey
      foreign key (organization_id) references public.organizations(id)
      not valid;
  end if;
end $$;

do $$
begin
  if to_regclass('public.orders') is not null and not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'orders' and policyname = 'tenant_select_orders'
  ) then
    create policy tenant_select_orders on public.orders
      for select using (organization_id = public.current_organization_id());
  end if;

  if to_regclass('public.audit_logs') is not null and not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'audit_logs' and policyname = 'tenant_select_audit_logs'
  ) then
    create policy tenant_select_audit_logs on public.audit_logs
      for select using (organization_id = public.current_organization_id());
  end if;

  if to_regclass('public.staff') is not null and not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'staff' and policyname = 'tenant_select_staff'
  ) then
    create policy tenant_select_staff on public.staff
      for select using (organization_id = public.current_organization_id());
  end if;

  if to_regclass('public.restaurant_settings') is not null and not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'restaurant_settings' and policyname = 'tenant_select_restaurant_settings'
  ) then
    create policy tenant_select_restaurant_settings on public.restaurant_settings
      for select using (organization_id = public.current_organization_id());
  end if;

  if to_regclass('public.waitlist_leads') is not null and not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'waitlist_leads' and policyname = 'tenant_select_waitlist_leads'
  ) then
    create policy tenant_select_waitlist_leads on public.waitlist_leads
      for select using (organization_id = public.current_organization_id());
  end if;
end $$;
