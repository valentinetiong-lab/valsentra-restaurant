-- Payment request persistence for provider-backed payment truth.

create table if not exists public.payment_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null,
  location_id text null,
  order_id text not null,
  provider text not null,
  provider_reference text not null,
  expected_amount numeric not null,
  currency text not null default 'MYR',
  status text not null default 'pending',
  expires_at timestamptz null,
  customer_phone text null,
  metadata jsonb null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'payment_requests_status_check'
  ) then
    alter table public.payment_requests
      add constraint payment_requests_status_check
      check (
        status in (
          'pending',
          'created',
          'sent',
          'confirmed',
          'amount_mismatch',
          'expired',
          'cancelled',
          'failed',
          'provider_not_configured'
        )
      ) not valid;
  end if;
end $$;

create unique index if not exists idx_payment_requests_org_provider_reference
  on public.payment_requests (organization_id, provider, provider_reference);

create index if not exists idx_payment_requests_org_order
  on public.payment_requests (organization_id, order_id, created_at desc);

create index if not exists idx_payment_requests_status_expires
  on public.payment_requests (organization_id, status, expires_at);
