-- Waitlist Recovery Autopilot v2 state fields.
-- Additive and nullable-first so existing recovery behavior keeps working.

do $$
begin
  if to_regclass('public.orders') is not null then
    alter table public.orders add column if not exists recovery_state text null;
    alter table public.orders add column if not exists recovery_started_at timestamptz null;
    alter table public.orders add column if not exists recovery_updated_at timestamptz null;
    alter table public.orders add column if not exists recovery_expires_at timestamptz null;
    alter table public.orders add column if not exists recovery_attempt_count integer null default 0;
    alter table public.orders add column if not exists recovery_selected_lead_id text null;

    if not exists (
      select 1 from pg_constraint where conname = 'orders_recovery_state_check'
    ) then
      alter table public.orders
        add constraint orders_recovery_state_check
        check (
          recovery_state is null or recovery_state in (
            'OPEN_RECOVERY',
            'OFFER_SENT',
            'WAITING_RESPONSE',
            'RECOVERED',
            'EXPIRED',
            'FAILED_RECOVERY'
          )
        ) not valid;
    end if;
  end if;
end $$;

do $$
begin
  if to_regclass('public.orders') is not null then
    create index if not exists idx_orders_org_recovery_state
      on public.orders (organization_id, recovery_state, recovery_updated_at desc)
      where recovery_state is not null;

    create index if not exists idx_orders_org_recovery_source
      on public.orders (organization_id, recovery_source_order_id)
      where recovery_source_order_id is not null;
  end if;
end $$;
