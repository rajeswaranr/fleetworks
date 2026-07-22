-- ============ FleetWorks — normalized multi-tenant core (Phase 5 / Migration Phase 1) ============
-- Run in Supabase: SQL Editor -> New query -> paste -> Run.
-- Prerequisite: schema-fleet.sql (the `fleets` blob table) must already exist.
-- Safe to run on the live product: it only ADDS tables + a read-model
-- projection. The current app keeps writing the fleets.data blob exactly as
-- before; a trigger fans each write out into these normalized tables.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS DOES
--   1. Tenancy: organizations + memberships (user <-> org, with a role).
--   2. Normalized entity tables (vehicles, drivers, documents, tyre_readings,
--      fuel_logs, expenses, issues, work_orders, parts, reminders,
--      inspections) — every row carries org_id and is RLS-scoped.
--   3. is_org_member(): the single RLS predicate (member of the org, or a
--      global admin via app_metadata.role = 'admin').
--   4. sync_fleet_from_blob(): projects one owner's fleets.data blob into the
--      tables (create-org-if-missing, then replace that org's rows).
--   5. A trigger on `fleets` that calls it on every insert/update — the
--      DUAL-WRITE BRIDGE. No frontend change needed in this phase.
--   6. A one-time backfill for every existing fleet.
--
-- MIGRATION SHAPE
--   Phase 1 (this file): blob is still the source of truth; tables are a live,
--     always-consistent read-model. Nothing user-facing changes.
--   Phase 2 (later): point the new app's READS at these tables.
--   Phase 3 (later): switch WRITES to these tables, drop the trigger + blob.
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

  -- clear this org's rows (child -> parent order), then re-project
  delete from documents     where org_id = v_org;
  delete from tyre_readings where org_id = v_org;
  delete from fuel_logs     where org_id = v_org;
  delete from expenses      where org_id = v_org;
  delete from inspections   where org_id = v_org;
  delete from reminders     where org_id = v_org;
  delete from work_orders   where org_id = v_org;
  delete from issues        where org_id = v_org;
  delete from parts         where org_id = v_org;
  delete from drivers       where org_id = v_org;
  delete from vehicles      where org_id = v_org;

  -- vehicles
  insert into vehicles (org_id, ext_id, name, type, km_per_month,
                        insurance_till, puc_till, fitness_till, permit_till, roadtax_till)
  select v_org, v ->> 'id', v ->> 'name', v ->> 'type',
         (nullif(v ->> 'kmPerMonth',''))::numeric,
         (nullif(v -> 'compliance' ->> 'insurance',''))::date,
         (nullif(v -> 'compliance' ->> 'puc',''))::date,
         (nullif(v -> 'compliance' ->> 'fitness',''))::date,
         (nullif(v -> 'compliance' ->> 'permit',''))::date,
         (nullif(v -> 'compliance' ->> 'roadtax',''))::date
  from jsonb_array_elements(coalesce(p_data -> 'vehicles', '[]'::jsonb)) v;

  -- drivers (resolve assigned vehicle by ext_id)
  insert into drivers (org_id, ext_id, name, phone, dl_no, dl_expiry, vehicle_id)
  select v_org, d ->> 'id', d ->> 'name', d ->> 'phone', d ->> 'dlNo',
         (nullif(d ->> 'dlExpiry',''))::date,
         veh.id
  from jsonb_array_elements(coalesce(p_data -> 'drivers', '[]'::jsonb)) d
  left join vehicles veh on veh.org_id = v_org and veh.ext_id = d ->> 'vehicleId';

  -- issues (before work_orders, which reference them)
  insert into issues (org_id, ext_id, vehicle_id, title, severity, status, reported_at, resolved_at, source)
  select v_org, i ->> 'id', veh.id, i ->> 'title', i ->> 'severity', i ->> 'status',
         (nullif(i ->> 'createdAt',''))::date, (nullif(i ->> 'resolvedAt',''))::date, i ->> 'source'
  from jsonb_array_elements(coalesce(p_data -> 'issues', '[]'::jsonb)) i
  left join vehicles veh on veh.org_id = v_org and veh.ext_id = i ->> 'vehicleId';

  -- work orders (resolve vehicle + issue by ext_id)
  insert into work_orders (org_id, ext_id, vehicle_id, issue_id, title, vendor, est_cost, final_cost, status, opened_at, completed_at)
  select v_org, w ->> 'id', veh.id, iss.id, w ->> 'title', w ->> 'vendor',
         (nullif(w ->> 'estCost',''))::numeric, (nullif(w ->> 'finalCost',''))::numeric,
         w ->> 'status', (nullif(w ->> 'createdAt',''))::date, (nullif(w ->> 'completedAt',''))::date
  from jsonb_array_elements(coalesce(p_data -> 'workOrders', '[]'::jsonb)) w
  left join vehicles veh on veh.org_id = v_org and veh.ext_id = w ->> 'vehicleId'
  left join issues   iss on iss.org_id = v_org and iss.ext_id = w ->> 'issueId';

  -- documents (polymorphic: vehicle or driver, resolved by ext_id)
  insert into documents (org_id, entity_type, vehicle_id, driver_id, doc_type, number, issue_date, expiry_date, note)
  select v_org, d ->> 'entityType',
         case when d ->> 'entityType' = 'vehicle'
              then (select id from vehicles where org_id = v_org and ext_id = d ->> 'entityId') end,
         case when d ->> 'entityType' = 'driver'
              then (select id from drivers  where org_id = v_org and ext_id = d ->> 'entityId') end,
         d ->> 'docType', d ->> 'number',
         (nullif(d ->> 'issueDate',''))::date, (nullif(d ->> 'expiryDate',''))::date, d ->> 'note'
  from jsonb_array_elements(coalesce(p_data -> 'documents', '[]'::jsonb)) d
  -- skip rows whose entity could not be resolved (keeps the CHECK constraint happy)
  where ( d ->> 'entityType' = 'vehicle' and exists (select 1 from vehicles where org_id = v_org and ext_id = d ->> 'entityId') )
     or ( d ->> 'entityType' = 'driver'  and exists (select 1 from drivers  where org_id = v_org and ext_id = d ->> 'entityId') );

  -- tyre readings
  insert into tyre_readings (org_id, vehicle_id, position, tread_depth_mm, pressure_psi, odometer, reading_date)
  select v_org, veh.id, t ->> 'position',
         (nullif(t ->> 'treadDepth',''))::numeric, (nullif(t ->> 'pressure',''))::numeric,
         (nullif(t ->> 'odo',''))::numeric, (nullif(t ->> 'date',''))::date
  from jsonb_array_elements(coalesce(p_data -> 'tyreReadings', '[]'::jsonb)) t
  left join vehicles veh on veh.org_id = v_org and veh.ext_id = t ->> 'vehicleId';

  -- fuel logs
  insert into fuel_logs (org_id, vehicle_id, log_date, litres, amount, odometer)
  select v_org, veh.id, (nullif(fl ->> 'date',''))::date,
         (nullif(fl ->> 'litres',''))::numeric, (nullif(fl ->> 'amount',''))::numeric, (nullif(fl ->> 'odo',''))::numeric
  from jsonb_array_elements(coalesce(p_data -> 'fuelLogs', '[]'::jsonb)) fl
  left join vehicles veh on veh.org_id = v_org and veh.ext_id = fl ->> 'vehicleId';

  -- expenses
  insert into expenses (org_id, vehicle_id, expense_date, category, amount)
  select v_org, veh.id, (nullif(e ->> 'date',''))::date, e ->> 'category', (nullif(e ->> 'amount',''))::numeric
  from jsonb_array_elements(coalesce(p_data -> 'expenses', '[]'::jsonb)) e
  left join vehicles veh on veh.org_id = v_org and veh.ext_id = e ->> 'vehicleId';

  -- parts
  insert into parts (org_id, name, part_number, make, category, sourcing, vendor, vendor_contact,
                     unit_cost, qty, min_qty, location, purchase_date, warranty_expiry)
  select v_org, p ->> 'name', p ->> 'partNumber', p ->> 'make', p ->> 'category', p ->> 'sourcing',
         p ->> 'vendor', p ->> 'vendorContact',
         (nullif(p ->> 'unitCost',''))::numeric, (nullif(p ->> 'qty',''))::numeric, (nullif(p ->> 'minQty',''))::numeric,
         p ->> 'location', (nullif(p ->> 'purchaseDate',''))::date, (nullif(p ->> 'warrantyExpiry',''))::date
  from jsonb_array_elements(coalesce(p_data -> 'parts', '[]'::jsonb)) p;

  -- reminders
  insert into reminders (org_id, vehicle_id, task, every_months, last_date)
  select v_org, veh.id, r ->> 'task', (nullif(r ->> 'everyMonths',''))::int, (nullif(r ->> 'lastDate',''))::date
  from jsonb_array_elements(coalesce(p_data -> 'reminders', '[]'::jsonb)) r
  left join vehicles veh on veh.org_id = v_org and veh.ext_id = r ->> 'vehicleId';

  -- inspections
  insert into inspections (org_id, vehicle_id, inspection_date, passed, results)
  select v_org, veh.id, (nullif(ins ->> 'date',''))::date, (ins ->> 'passed')::boolean, ins -> 'results'
  from jsonb_array_elements(coalesce(p_data -> 'inspections', '[]'::jsonb)) ins
  left join vehicles veh on veh.org_id = v_org and veh.ext_id = ins ->> 'vehicleId';

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
