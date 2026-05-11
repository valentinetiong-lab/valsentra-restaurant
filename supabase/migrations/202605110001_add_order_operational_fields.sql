alter table public.orders
  add column if not exists organization_id text null,
  add column if not exists location_id text null,
  add column if not exists location_name text null,
  add column if not exists slot_hold_started_at timestamptz null,
  add column if not exists slot_hold_expires_at timestamptz null,
  add column if not exists last_reminder_sent_at timestamptz null,
  add column if not exists auto_release_eligible boolean not null default true,
  add column if not exists recovery_source_order_id text null,
  add column if not exists awaiting_details boolean not null default false;

create index if not exists orders_slot_hold_expires_at_idx
  on public.orders (slot_hold_expires_at);

create index if not exists orders_recovery_source_order_id_idx
  on public.orders (recovery_source_order_id);

create index if not exists orders_location_id_idx
  on public.orders (location_id);
