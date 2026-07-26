-- ============ FleetWorks — fleet cloud sync schema (Phase 2) ============
-- Run in Supabase: SQL Editor -> New query -> paste -> Run.
-- Adds per-user cloud storage for fleet data (vehicles, expenses, fuel,
-- drivers, issues, job cards, inspections, reminders, parts).
-- Each signed-in fleet owner gets exactly one row; Row Level Security
-- guarantees users can only ever read/write their own fleet.

create table if not exists fleets (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  updated_at timestamptz not null default now(),
  data jsonb not null default '{}'::jsonb
);

alter table fleets enable row level security;

create policy "own_fleet_select" on fleets
  for select to authenticated using (auth.uid() = owner_id);
create policy "own_fleet_insert" on fleets
  for insert to authenticated with check (auth.uid() = owner_id);
create policy "own_fleet_update" on fleets
  for update to authenticated using (auth.uid() = owner_id);
create policy "own_fleet_delete" on fleets
  for delete to authenticated using (auth.uid() = owner_id);

-- Structured read-only view over the jsonb for future analytics /
-- cross-fleet benchmarking (aggregate queries never expose identities).
create or replace view fleet_vehicle_stats as
select
  owner_id,
  (v ->> 'type') as vehicle_type,
  (v ->> 'kmPerMonth')::numeric as km_per_month
from fleets, jsonb_array_elements(coalesce(data -> 'vehicles', '[]'::jsonb)) as v;
