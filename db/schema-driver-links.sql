-- ============ FleetWorks — Driver Links ============
-- Run once in the Supabase SQL Editor (Dashboard → SQL → New query).
-- Idempotent: safe to re-run.
--
-- Drivers get a no-login page (driver.html?o=<owner>&t=<token>&n=<name>&v=<vehicle>)
-- from which they post diesel fills, problem reports and daily checks.
-- Rows land here via the anon role; the owner's app (signed in) reads its
-- own rows, merges them into the fleet store, and marks them consumed.

create table if not exists public.driver_entries (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null,
  token        text not null,
  driver_name  text,
  vehicle_name text,
  kind         text not null check (kind in ('fuel', 'issue', 'inspection')),
  payload      jsonb not null default '{}'::jsonb,
  consumed     boolean not null default false,
  created_at   timestamptz not null default now()
);

create index if not exists driver_entries_owner_pending
  on public.driver_entries (owner_id, consumed, created_at);

alter table public.driver_entries enable row level security;

-- Drivers (anon role) may only INSERT — never read anyone's data.
drop policy if exists driver_entries_insert on public.driver_entries;
create policy driver_entries_insert on public.driver_entries
  for insert to anon
  with check (owner_id is not null and length(token) between 6 and 64);

-- Owners see and update only their own rows.
drop policy if exists driver_entries_owner_select on public.driver_entries;
create policy driver_entries_owner_select on public.driver_entries
  for select to authenticated
  using (auth.uid() = owner_id);

drop policy if exists driver_entries_owner_update on public.driver_entries;
create policy driver_entries_owner_update on public.driver_entries
  for update to authenticated
  using (auth.uid() = owner_id);

-- Verification:
--   select count(*) from public.driver_entries;
--   (then submit a test entry from a driver link and re-run)
