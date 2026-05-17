-- Account Creation & Staff Invite Foundation v1
-- Additive columns for linking Supabase Auth users to Valsentra staff records.

do $$
begin
  if to_regclass('public.staff') is not null then
    alter table public.staff
      add column if not exists email text null,
      add column if not exists invite_status text not null default 'active',
      add column if not exists invited_at timestamptz null,
      add column if not exists accepted_at timestamptz null;

    create unique index if not exists staff_organization_email_unique_idx
      on public.staff (organization_id, lower(email))
      where email is not null;

    create unique index if not exists staff_user_id_unique_idx
      on public.staff (user_id)
      where user_id is not null;
  end if;
end $$;
