-- ============ FleetWorks — normalized multi-tenant core ============
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Idempotent —
-- safe to re-run any time.
-- Prerequisite: schema-fleet.sql (the `fleets` blob table) must already exist.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS DOES
--   1. Tenancy: organizations + memberships (user <-> org, with a role).
--   2. Entity tables (vehicles, drivers, documents, tyre_readings, fuel_logs,
--      expenses, issues, work_orders, parts, reminders, inspections) — every
--      row carries org_id and is RLS-scoped.
--   3. is_org_member(): the single RLS predicate (member of the org, or a
--      global admin via app_metadata.role = 'admin').
--   4. sync_fleet_from_blob(): upserts one owner's organization row from the
--      settings in their fleets.data blob (business name, GSTIN, city, etc).
--   5. A trigger on `fleets` that calls it on every insert/update.
--   6. FK indexes, an updated_at trigger, explicit grants to `authenticated`
--      (RLS still decides which rows).
--
-- STATUS (as of the DB-direct core migration, see js/dbcore.js)
--   All 12 entity types (vehicles, drivers, expenses, fuel_logs, issues,
--   work_orders, reminders, inspections, parts, documents, tyre_readings,
--   plus trips/driver_ledger from schema-db-direct-remaining.sql) are now
--   written straight to these tables by the client when signed in — never
--   through the blob. sync_fleet_from_blob() no longer deletes or
--   re-projects any of them; its only remaining job is the organizations
--   upsert from settings, since Settings itself is still blob-based.
--
-- VALIDATION
--   Executed and iterated against Postgres 16 (PGlite/WASM): schema runs
--   clean, tenant isolation proven (no cross-org leakage, non-member
--   blocked, admin sees all), nasty inputs handled. See db/tests/.
-- ---------------------------------------------------------------------------

-- ========================= 1. TENANCY =========================

create table if not exists organizations (
  id               uuid primary key default gen_random_uuid(),
  name             text not null default 'My Fleet',
  gstin            text,
  city             text,
  warn_days        int not null default 30,
  min_tread_mm     numeric not null default 1.6,
  mileage_drop_pct numeric,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table if not exists memberships (
  id        uuid primary key default gen_random_uuid(),
  org_id    uuid not null references organizations(id) on delete cascade,
  user_id   uuid not null references auth.users(id) on delete cascade,
  role      text not null default 'owner' check (role in ('owner','manager','viewer')),
  created_at timestamptz not null default now(),
  unique (org_id, user_id)
);
create index if not exists idx_memberships_user on memberships(user_id);
create index if not exists idx_memberships_org  on memberships(org_id);

-- The one RLS predicate used everywhere: a signed-in member of the org, or a
-- global FleetWorks admin (BDA) flagged in app_metadata (see schema-roles.sql).
create or replace function is_org_member(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false)
    or exists (
      select 1 from memberships m
      where m.org_id = p_org and m.user_id = auth.uid()
    );
$$;

-- ========================= 2. ENTITY TABLES =========================
-- ext_id preserves the blob's client-side id (e.g. "v1", or a uid()) so child
-- rows can be re-linked during projection. Dropped once the app writes here.

create table if not exists vehicles (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(id) on delete cascade,
  ext_id         text,
  name           text not null,
  type           text,
  km_per_month   numeric,
  insurance_till date,
  puc_till       date,
  fitness_till   date,
  permit_till    date,
  roadtax_till   date,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (org_id, ext_id)
);
create index if not exists idx_vehicles_org on vehicles(org_id);

create table if not exists drivers (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  ext_id      text,
  name        text not null,
  phone       text,
  dl_no       text,
  dl_expiry   date,
  vehicle_id  uuid references vehicles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (org_id, ext_id)
);
create index if not exists idx_drivers_org on drivers(org_id);

create table if not exists documents (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  entity_type text not null check (entity_type in ('vehicle','driver')),
  vehicle_id  uuid references vehicles(id) on delete cascade,
  driver_id   uuid references drivers(id) on delete cascade,
  doc_type    text not null,
  number      text,
  issue_date  date,
  expiry_date date,
  note        text,
  file_path   text,               -- reserved for Supabase Storage / MinIO in Phase 2
  created_at  timestamptz not null default now(),
  -- exactly one of vehicle_id / driver_id must be set, matching entity_type
  check ( (entity_type = 'vehicle' and vehicle_id is not null and driver_id is null)
       or (entity_type = 'driver'  and driver_id  is not null and vehicle_id is null) )
);
create index if not exists idx_documents_org    on documents(org_id);
create index if not exists idx_documents_expiry on documents(expiry_date);

create table if not exists tyre_readings (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(id) on delete cascade,
  vehicle_id     uuid references vehicles(id) on delete cascade,
  position       text not null,
  tread_depth_mm numeric,
  pressure_psi   numeric,
  odometer       numeric,
  reading_date   date,
  created_at     timestamptz not null default now()
);
create index if not exists idx_tyres_org on tyre_readings(org_id);

create table if not exists fuel_logs (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  vehicle_id  uuid references vehicles(id) on delete cascade,
  log_date    date,
  litres      numeric,
  amount      numeric,
  odometer    numeric,
  created_at  timestamptz not null default now()
);
create index if not exists idx_fuel_org on fuel_logs(org_id);

create table if not exists expenses (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  vehicle_id    uuid references vehicles(id) on delete cascade,
  expense_date  date,
  category      text,
  amount        numeric,
  created_at    timestamptz not null default now()
);
create index if not exists idx_expenses_org on expenses(org_id);

create table if not exists issues (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  ext_id      text,
  vehicle_id  uuid references vehicles(id) on delete cascade,
  title       text,
  severity    text,
  status      text,
  reported_at date,
  resolved_at date,
  source      text,
  created_at  timestamptz not null default now(),
  unique (org_id, ext_id)
);
create index if not exists idx_issues_org on issues(org_id);

create table if not exists work_orders (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  ext_id        text,
  vehicle_id    uuid references vehicles(id) on delete cascade,
  issue_id      uuid references issues(id) on delete set null,
  title         text,
  vendor        text,
  est_cost      numeric,
  final_cost    numeric,
  status        text,
  opened_at     date,
  completed_at  date,
  created_at    timestamptz not null default now(),
  unique (org_id, ext_id)
);
create index if not exists idx_workorders_org on work_orders(org_id);

create table if not exists parts (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations(id) on delete cascade,
  name            text not null,
  part_number     text,
  make            text,
  category        text,
  sourcing        text,
  vendor          text,
  vendor_contact  text,
  unit_cost       numeric,
  qty             numeric,
  min_qty         numeric,
  location        text,
  purchase_date   date,
  warranty_expiry date,
  created_at      timestamptz not null default now()
);
create index if not exists idx_parts_org on parts(org_id);

create table if not exists reminders (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  vehicle_id    uuid references vehicles(id) on delete cascade,
  task          text,
  every_months  int,
  last_date     date,
  created_at    timestamptz not null default now()
);
create index if not exists idx_reminders_org on reminders(org_id);

create table if not exists inspections (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references organizations(id) on delete cascade,
  vehicle_id       uuid references vehicles(id) on delete cascade,
  inspection_date  date,
  passed           boolean,
  results          jsonb,            -- variable checklist kept as jsonb
  created_at       timestamptz not null default now()
);
create index if not exists idx_inspections_org on inspections(org_id);

-- foreign-key indexes for joins from the vehicle hub (and issue link)
create index if not exists idx_drivers_vehicle      on drivers(vehicle_id);
create index if not exists idx_documents_vehicle    on documents(vehicle_id);
create index if not exists idx_documents_driver     on documents(driver_id);
create index if not exists idx_tyres_vehicle        on tyre_readings(vehicle_id);
create index if not exists idx_fuel_vehicle         on fuel_logs(vehicle_id);
create index if not exists idx_expenses_vehicle     on expenses(vehicle_id);
create index if not exists idx_issues_vehicle       on issues(vehicle_id);
create index if not exists idx_workorders_vehicle   on work_orders(vehicle_id);
create index if not exists idx_workorders_issue     on work_orders(issue_id);
create index if not exists idx_reminders_vehicle    on reminders(vehicle_id);
create index if not exists idx_inspections_vehicle  on inspections(vehicle_id);

-- keep updated_at honest when the app writes these tables directly (Phase 2)
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;
do $$
declare t text;
begin
  foreach t in array array['organizations','vehicles','drivers'] loop
    execute format('drop trigger if exists set_updated_at_%1$s on %1$s;', t);
    execute format('create trigger set_updated_at_%1$s before update on %1$s for each row execute function set_updated_at();', t);
  end loop;
end $$;

-- ========================= 3. ROW LEVEL SECURITY =========================

alter table organizations enable row level security;
alter table memberships   enable row level security;
alter table vehicles      enable row level security;
alter table drivers       enable row level security;
alter table documents     enable row level security;
alter table tyre_readings enable row level security;
alter table fuel_logs     enable row level security;
alter table expenses      enable row level security;
alter table issues        enable row level security;
alter table work_orders   enable row level security;
alter table parts         enable row level security;
alter table reminders     enable row level security;
alter table inspections   enable row level security;

-- Org + membership: readable by members; writes go through the security-definer
-- projection (Phase 1) or will be granted explicitly per-role in Phase 2.
-- (drop-then-create so the whole file is safe to re-run)
drop policy if exists "org_read"        on organizations;
drop policy if exists "membership_read" on memberships;
create policy "org_read"        on organizations for select to authenticated using (is_org_member(id));
create policy "membership_read" on memberships  for select to authenticated using (user_id = auth.uid() or is_org_member(org_id));

-- Every entity table: members of the org get full access to their own rows;
-- admins (app_metadata.role='admin') pass is_org_member for every org.
-- These also enable direct writes when the app switches over in Phase 2.
do $$
declare t text; p text;
begin
  foreach t in array array[
    'vehicles','drivers','documents','tyre_readings','fuel_logs','expenses',
    'issues','work_orders','parts','reminders','inspections'
  ] loop
    p := 'org_members_all_' || t;
    execute format('drop policy if exists %I on %I;', p, t);
    execute format(
      'create policy %I on %I for all to authenticated using (is_org_member(org_id)) with check (is_org_member(org_id));',
      p, t);
  end loop;
end $$;

-- Table-level privileges. RLS decides WHICH rows; the role still needs the base
-- grant or PostgREST returns "permission denied". RLS remains the boundary, so
-- granting broadly to authenticated is safe. anon gets nothing (no policy +
-- no grant = fully denied).
grant usage on schema public to authenticated;
grant select, update on organizations to authenticated;
grant select on memberships to authenticated;
do $$
declare t text;
begin
  foreach t in array array[
    'vehicles','drivers','documents','tyre_readings','fuel_logs','expenses',
    'issues','work_orders','parts','reminders','inspections'
  ] loop
    execute format('grant select, insert, update, delete on %I to authenticated;', t);
  end loop;
end $$;

-- ========================= 4. BLOB -> TABLES PROJECTION =========================
-- Replaces one org's rows from its fleets.data blob. Security definer so it can
-- create the org, bypass RLS, and run inside the trigger regardless of caller.

create or replace function sync_fleet_from_blob(p_owner uuid, p_data jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  s jsonb := coalesce(p_data -> 'settings', '{}'::jsonb);
begin
  -- find (or create) the owner's organization
  select o.id into v_org
  from organizations o
  join memberships m on m.org_id = o.id
  where m.user_id = p_owner and m.role = 'owner'
  limit 1;

  if v_org is null then
    insert into organizations (name, gstin, city, warn_days, min_tread_mm, mileage_drop_pct)
    values (
      coalesce(nullif(s ->> 'businessName',''), 'My Fleet'),
      nullif(s ->> 'gstin',''),
      nullif(s ->> 'city',''),
      coalesce((s ->> 'warnDays')::int, 30),
      coalesce((s ->> 'minTread')::numeric, 1.6),
      (s ->> 'mileageDropPct')::numeric
    )
    returning id into v_org;
    insert into memberships (org_id, user_id, role) values (v_org, p_owner, 'owner');
  else
    update organizations set
      name             = coalesce(nullif(s ->> 'businessName',''), name),
      gstin            = nullif(s ->> 'gstin',''),
      city             = nullif(s ->> 'city',''),
      warn_days        = coalesce((s ->> 'warnDays')::int, warn_days),
      min_tread_mm     = coalesce((s ->> 'minTread')::numeric, min_tread_mm),
      mileage_drop_pct = (s ->> 'mileageDropPct')::numeric,
      updated_at       = now()
    where id = v_org;
  end if;

  -- Every entity table this function used to project (documents,
  -- tyre_readings, inspections, reminders, work_orders, issues, parts) is now
  -- DB-direct as of the full core migration — the client writes all 12
  -- entities straight to Postgres, never through the blob at all when signed
  -- in. This function's only remaining job is the organizations upsert from
  -- settings above; there is nothing left to delete or re-project.
  return v_org;
end;
$$;

-- ========================= 5. DUAL-WRITE TRIGGER =========================
-- Every time the app pushes a fleet blob, re-project it. This is the bridge
-- that keeps the normalized tables live without touching the frontend.

create or replace function trg_fleet_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Safety: the user's blob save is the source of truth in Phase 1. If the
  -- projection ever errors, log it and let the save succeed anyway — never
  -- let a read-model bug break the live app.
  begin
    perform sync_fleet_from_blob(new.owner_id, new.data);
  exception when others then
    raise warning 'fleet projection failed for owner %: %', new.owner_id, sqlerrm;
  end;
  return new;
end;
$$;

drop trigger if exists fleets_sync on fleets;
create trigger fleets_sync
  after insert or update of data on fleets
  for each row execute function trg_fleet_sync();

-- ========================= 6. ONE-TIME BACKFILL =========================
-- Project every fleet that already exists. Safe to re-run (it replaces rows).
select sync_fleet_from_blob(owner_id, data) from fleets;

-- ---------------------------------------------------------------------------
-- Quick checks after running:
--   select count(*) from organizations;          -- one per existing owner
--   select name, (select count(*) from vehicles v where v.org_id = o.id) as vehicles
--     from organizations o;
--   select category, entity, renewal_type, status from -- reuse v_renewals if desired
-- ---------------------------------------------------------------------------
