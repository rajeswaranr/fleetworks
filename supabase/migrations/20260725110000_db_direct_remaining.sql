-- ============ FleetWorks — DB-direct remaining core entities ============
-- Run in Supabase SQL Editor AFTER schema-db-direct-core.sql (and after the
-- updated schema-normalized.sql, which now also excludes issues/work_orders/
-- reminders/inspections/parts/documents/tyre_readings from
-- sync_fleet_from_blob()). Idempotent.
--
-- Covers: issues, work_orders, reminders, inspections, parts, documents,
-- tyre_readings (existing tables, gaining columns) + trips, driver_ledger
-- (brand new tables — the local blob never had a Postgres projection for
-- these two). RLS follows the exact org_members_all_* pattern already used
-- by every other entity table.

-- ---- existing tables: add columns the local blob shape carries that the
-- read-model projection never needed ----
alter table inspections
  add column if not exists odo   numeric,
  add column if not exists notes text;

-- ---- trips (new) ----
create table if not exists trips (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  vehicle_id  uuid references vehicles(id) on delete cascade,
  trip_date   date,
  from_loc    text,
  to_loc      text,
  freight     numeric,
  km          numeric,
  created_at  timestamptz not null default now()
);
create index if not exists idx_trips_org     on trips(org_id);
create index if not exists idx_trips_vehicle on trips(vehicle_id);
alter table trips enable row level security;

-- ---- driver_ledger / khata (new) ----
create table if not exists driver_ledger (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  driver_id   uuid references drivers(id) on delete cascade,
  entry_date  date,
  type        text,
  amount      numeric,
  note        text,
  created_at  timestamptz not null default now()
);
create index if not exists idx_ledger_org    on driver_ledger(org_id);
create index if not exists idx_ledger_driver on driver_ledger(driver_id);
alter table driver_ledger enable row level security;

do $$
declare t text; p text;
begin
  foreach t in array array['trips','driver_ledger'] loop
    p := 'org_members_all_' || t;
    execute format('drop policy if exists %I on %I;', p, t);
    execute format(
      'create policy %I on %I for all to authenticated using (is_org_member(org_id)) with check (is_org_member(org_id));',
      p, t);
    execute format('grant select, insert, update, delete on %I to authenticated;', t);
  end loop;
end $$;

-- Verify after running:
--   select column_name from information_schema.columns where table_name = 'inspections' order by 1;
--   select column_name from information_schema.columns where table_name = 'trips' order by 1;
--   select column_name from information_schema.columns where table_name = 'driver_ledger' order by 1;
