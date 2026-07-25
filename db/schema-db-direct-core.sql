-- ============ FleetWorks — DB-direct core entities ============
-- Run in Supabase SQL Editor AFTER db/schema-team-access.sql (and after
-- re-running the updated db/schema-normalized.sql, which now excludes
-- vehicles/drivers/expenses/fuel_logs from sync_fleet_from_blob()). Idempotent.
--
-- Adds the columns these 4 tables were missing versus what the app's local
-- blob shape actually carries (they were originally created narrower, back
-- when they were just a read-model projection of the blob — now that the
-- client writes them directly, they need to hold everything the UI does).
-- RLS is untouched here — vehicles/drivers/expenses/fuel_logs already have
-- correct role-aware policies from schema-team-access.sql (select scoped to
-- can_view_vehicle*, write scoped to can_update_vehicle*/is_org_admin);
-- nothing about direct writes changes that scoping.

alter table vehicles
  add column if not exists status                text default 'Active',
  add column if not exists make                   text,
  add column if not exists model                  text,
  add column if not exists year                   int,
  add column if not exists chassis_no             text,
  add column if not exists engine_no              text,
  add column if not exists ownership              text,
  add column if not exists fleet_group            text,
  add column if not exists depot                  text,
  add column if not exists emission                text,
  add column if not exists fuel_type               text,
  add column if not exists tank_capacity           numeric,
  add column if not exists color                   text,
  add column if not exists gvw                     numeric,
  add column if not exists payload                 numeric,
  add column if not exists axle_config             text,
  add column if not exists tyre_front_psi          numeric,
  add column if not exists tyre_rear_psi           numeric,
  add column if not exists tyre_size               text,
  add column if not exists rto                     text,
  add column if not exists purchase_date           date,
  add column if not exists purchase_price          numeric,
  add column if not exists purchase_vendor         text,
  add column if not exists in_service_date         date,
  add column if not exists service_life_months     int,
  add column if not exists resale_value            numeric,
  add column if not exists notes                   text;

alter table drivers
  add column if not exists upi_id       text,
  add column if not exists bank_account text,
  add column if not exists bank_ifsc    text;

-- items: bill line items captured by OCR (desc/partNo/amount), kept as jsonb
-- since it's a genuinely variable-length nested list — this is a normal
-- relational-column pattern, not "the blob" (the blob was one JSON object
-- holding the ENTIRE fleet; this is one small array scoped to one expense
-- row, queried/written through a real table with real RLS, same as
-- driver_payout_details/salary_payments already do elsewhere).
alter table expenses
  add column if not exists odo       numeric,
  add column if not exists title     text,
  add column if not exists vendor    text,
  add column if not exists gstin     text,
  add column if not exists bill_no   text,
  add column if not exists bill_path text,
  add column if not exists items     jsonb;

alter table fuel_logs
  add column if not exists opening boolean not null default false;

-- Verify after running:
--   select column_name from information_schema.columns where table_name = 'vehicles' order by 1;
--   select column_name from information_schema.columns where table_name = 'drivers' order by 1;
--   select column_name from information_schema.columns where table_name = 'expenses' order by 1;
