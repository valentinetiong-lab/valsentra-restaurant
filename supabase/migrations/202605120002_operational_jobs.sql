-- Operational Worker & Durable Execution Phase v1
-- Durable tenant-scoped job model for background-safe execution.

create table if not exists public.operational_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references public.organizations(id),
  location_id text null,
  job_type text not null,
  status text not null default 'pending'
    check (status in ('pending', 'running', 'completed', 'failed', 'retrying', 'dead_letter', 'cancelled')),
  priority text not null default 'normal'
    check (priority in ('low', 'normal', 'high', 'critical')),
  run_after timestamptz not null default now(),
  locked_at timestamptz null,
  locked_by text null,
  heartbeat_at timestamptz null,
  attempt_count integer not null default 0,
  max_attempts integer not null default 4,
  last_error text null,
  dead_letter_reason text null,
  idempotency_key text not null,
  request_fingerprint text null,
  payload jsonb not null default '{}'::jsonb,
  execution_metadata jsonb not null default '{}'::jsonb,
  execution_trace_id text null,
  actor_user_id text null,
  actor_role text null,
  source text null,
  started_at timestamptz null,
  completed_at timestamptz null,
  cancelled_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, idempotency_key)
);

create index if not exists operational_jobs_org_status_run_after_idx
  on public.operational_jobs (organization_id, status, run_after);

create index if not exists operational_jobs_priority_idx
  on public.operational_jobs (priority, run_after);

create index if not exists operational_jobs_locked_at_idx
  on public.operational_jobs (locked_at);

create index if not exists operational_jobs_job_type_idx
  on public.operational_jobs (organization_id, job_type);

create index if not exists operational_jobs_dead_letter_idx
  on public.operational_jobs (organization_id, status)
  where status = 'dead_letter';

comment on table public.operational_jobs is
  'Tenant-scoped durable execution queue for continuous operations, communication sends, recovery actions, waitlist cascades, and infrastructure repair tasks.';

comment on column public.operational_jobs.idempotency_key is
  'Durable replay key. Unique within organization_id to prevent duplicate operational execution.';

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'operational_jobs' and policyname = 'tenant_select_operational_jobs'
  ) then
    create policy tenant_select_operational_jobs on public.operational_jobs
      for select using (organization_id = public.current_organization_id());
  end if;
end $$;
