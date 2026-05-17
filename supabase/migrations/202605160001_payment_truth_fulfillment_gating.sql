-- Payment Truth & Fulfillment Gating v1
-- Additive, nullable-first rollout. These fields let Valsentra separate
-- customer/staff proof from server-side provider truth and manager overrides.

do $$
begin
  if to_regclass('public.orders') is not null then
    alter table public.orders add column if not exists payment_intent_id text null;
    alter table public.orders add column if not exists payment_provider_reference text null;
    alter table public.orders add column if not exists payment_expected_amount numeric null;
    alter table public.orders add column if not exists payment_paid_amount numeric null;
    alter table public.orders add column if not exists payment_currency text null default 'MYR';
    alter table public.orders add column if not exists payment_truth_status text null;
    alter table public.orders add column if not exists payment_truth_source text null;
    alter table public.orders add column if not exists payment_provider_verified_at timestamptz null;
    alter table public.orders add column if not exists payment_mismatch_reason text null;
    alter table public.orders add column if not exists payment_provider_metadata jsonb null;
    alter table public.orders add column if not exists payment_manager_override_by uuid null;
    alter table public.orders add column if not exists payment_manager_override_at timestamptz null;
    alter table public.orders add column if not exists payment_manager_override_reason text null;

    if not exists (
      select 1 from pg_constraint where conname = 'orders_payment_truth_status_check'
    ) then
      alter table public.orders
        add constraint orders_payment_truth_status_check
        check (
          payment_truth_status is null or payment_truth_status in (
            'PENDING_PROVIDER',
            'SCREENSHOT_ONLY',
            'PROVIDER_CONFIRMED',
            'AMOUNT_MISMATCH',
            'FAILED',
            'MANAGER_OVERRIDE'
          )
        ) not valid;
    end if;

    if not exists (
      select 1 from pg_constraint where conname = 'orders_payment_truth_source_check'
    ) then
      alter table public.orders
        add constraint orders_payment_truth_source_check
        check (
          payment_truth_source is null or payment_truth_source in (
            'CUSTOMER_SCREENSHOT',
            'STAFF_TERMINAL_CHECK',
            'PROVIDER_CALLBACK',
            'MANAGER_OVERRIDE',
            'SYSTEM'
          )
        ) not valid;
    end if;
  end if;
end $$;

do $$
begin
  if to_regclass('public.orders') is not null then
    create index if not exists idx_orders_org_payment_provider_reference
      on public.orders (organization_id, payment_provider_reference)
      where payment_provider_reference is not null;

    create index if not exists idx_orders_org_payment_intent_id
      on public.orders (organization_id, payment_intent_id)
      where payment_intent_id is not null;

    create index if not exists idx_orders_org_payment_truth_status
      on public.orders (organization_id, payment_truth_status)
      where payment_truth_status is not null;
  end if;
end $$;
