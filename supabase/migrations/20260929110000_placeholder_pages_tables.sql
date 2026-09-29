-- Tables for the pages that were still "Coming soon", so every sidebar page has a place
-- to keep its data:
--
--   Faults               vehicle_faults             engine / ABS / emission fault codes (J1939 SPN-FMI, OBD-II DTC)
--   DEF / AdBlue         def_logs                   AdBlue fills for BS6 trucks, like diesel fills
--   Recalls              vehicle_recalls            maker recalls and campaigns per vehicle, and whether done
--   EV Charging          ev_charging_sessions       one row per charge: energy, cost, state of charge
--   Service Programs     service_programs           a named bundle of recurring tasks (e.g. "BS6 HCV 10k service")
--                        service_program_tasks      the tasks and their km / day intervals
--                        service_program_vehicles   which vehicles follow which program
--   Inspection Schedules inspection_schedules       which checklist, which vehicle, how often, next due
--   Places               (no new table: sites + geofences)
--
-- Also fixes fleetsafe_settings, registered on 20260928 under a permission resource
-- ("settings") that no role has, which left alert settings unreadable for everyone.

-- ---------- Faults ----------
create table if not exists vehicle_faults (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id) on delete cascade,
  vehicle_id   uuid references vehicles(id) on delete cascade,
  device_id    uuid references devices(id) on delete set null,
  standard     text not null default 'obd2' check (standard in ('obd2','j1939','proprietary')),
  code         text not null,                 -- "P0420" or "SPN 3226 FMI 18"
  spn          integer, fmi integer,          -- J1939 parts, when known
  system       text,                          -- engine, aftertreatment, abs, transmission...
  description  text,
  severity     text not null default 'warning' check (severity in ('info','warning','critical')),
  status       text not null default 'active' check (status in ('active','cleared')),
  first_seen   timestamptz not null default now(),
  last_seen    timestamptz not null default now(),
  occurrences  integer not null default 1,
  cleared_at   timestamptz,
  work_order_id uuid references work_orders(id) on delete set null,
  simulated    boolean not null default false,
  created_at   timestamptz not null default now()
);
create unique index if not exists uq_vehicle_faults_active on vehicle_faults(vehicle_id, code) where status = 'active';
create index if not exists idx_vehicle_faults_org on vehicle_faults(org_id, last_seen desc);

-- ---------- DEF / AdBlue ----------
create table if not exists def_logs (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  vehicle_id  uuid references vehicles(id) on delete cascade,
  log_date    date not null default current_date,
  litres      numeric not null check (litres > 0),
  amount      numeric check (amount >= 0),
  odometer    numeric,
  vendor      text,
  level_pct_after numeric check (level_pct_after between 0 and 100),
  expense_id  uuid references expenses(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists idx_def_logs_vehicle on def_logs(vehicle_id, log_date desc);

-- ---------- Recalls ----------
create table if not exists vehicle_recalls (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id) on delete cascade,
  vehicle_id   uuid references vehicles(id) on delete cascade,
  make         text, model text,
  recall_ref   text,                           -- maker's campaign number
  title        text not null,
  description  text,
  remedy       text,
  issued_on    date,
  status       text not null default 'open' check (status in ('open','scheduled','completed','not_applicable')),
  completed_on date,
  work_order_id uuid references work_orders(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists idx_vehicle_recalls_org on vehicle_recalls(org_id, status);

-- ---------- EV charging ----------
create table if not exists ev_charging_sessions (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  vehicle_id  uuid references vehicles(id) on delete cascade,
  station     text,
  connector   text check (connector in ('ccs2','type2','gbt','chademo','bharat_ac','bharat_dc','other')),
  started_at  timestamptz not null,
  ended_at    timestamptz,
  kwh         numeric check (kwh >= 0),
  cost        numeric check (cost >= 0),
  soc_start   numeric check (soc_start between 0 and 100),
  soc_end     numeric check (soc_end between 0 and 100),
  odometer    numeric,
  created_at  timestamptz not null default now()
);
create index if not exists idx_ev_charging_vehicle on ev_charging_sessions(vehicle_id, started_at desc);

-- ---------- Service programs ----------
create table if not exists service_programs (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  name        text not null,
  description text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (org_id, name)
);
create table if not exists service_program_tasks (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  program_id    uuid not null references service_programs(id) on delete cascade,
  task          text not null,                 -- "Engine oil + filter", "Air filter", "Greasing"
  interval_km   integer check (interval_km > 0),
  interval_days integer check (interval_days > 0),
  est_cost      numeric,
  sort_order    integer not null default 0,
  check (interval_km is not null or interval_days is not null)
);
create table if not exists service_program_vehicles (
  org_id      uuid not null references organizations(id) on delete cascade,
  program_id  uuid not null references service_programs(id) on delete cascade,
  vehicle_id  uuid not null references vehicles(id) on delete cascade,
  started_on  date not null default current_date,
  start_odometer numeric,
  primary key (program_id, vehicle_id)
);

-- ---------- Inspection schedules ----------
create table if not exists inspection_schedules (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  vehicle_id    uuid not null references vehicles(id) on delete cascade,
  form_name     text not null default 'Daily 10-point check',
  frequency     text not null check (frequency in ('daily','weekly','monthly','every_n_days','every_n_km')),
  interval_n    integer check (interval_n > 0),       -- the n for every_n_days / every_n_km
  assignee_driver_id uuid references drivers(id) on delete set null,
  next_due_at   date,
  next_due_km   numeric,
  last_done_at  timestamptz,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  check (frequency not in ('every_n_days','every_n_km') or interval_n is not null)
);
create index if not exists idx_inspection_schedules_due on inspection_schedules(org_id, next_due_at) where is_active;

-- ---------- access: same RBAC generator as every other table ----------
insert into rbac_table_registry(table_name, mode, resource, vehicle_col, org_col, notes) values
 ('vehicle_faults',           'generated', 'telemetry',   'vehicle_id', 'org_id', 'fault codes (DTC / SPN-FMI)'),
 ('def_logs',                 'generated', 'fuel',        'vehicle_id', 'org_id', 'AdBlue fills'),
 ('vehicle_recalls',          'generated', 'work_orders', 'vehicle_id', 'org_id', 'maker recalls per vehicle'),
 ('ev_charging_sessions',     'generated', 'fuel',        'vehicle_id', 'org_id', 'EV charging sessions'),
 ('service_programs',         'generated', 'reminders',   null,         'org_id', 'recurring service programs'),
 ('service_program_tasks',    'generated', 'reminders',   null,         'org_id', 'tasks in a service program'),
 ('service_program_vehicles', 'generated', 'reminders',   'vehicle_id', 'org_id', 'vehicles on a service program'),
 ('inspection_schedules',     'generated', 'inspections', 'vehicle_id', 'org_id', 'recurring inspection schedule'),
 ('fleetsafe_settings',       'generated', 'devices',     null,         'org_id', 'FleetSafe notification settings')
on conflict (table_name) do update set mode = excluded.mode, resource = excluded.resource, vehicle_col = excluded.vehicle_col;
select rbac_apply(t) from unnest(array['vehicle_faults','def_logs','vehicle_recalls','ev_charging_sessions','service_programs',
  'service_program_tasks','service_program_vehicles','inspection_schedules','fleetsafe_settings']) t;
grant select, insert, update, delete on vehicle_faults, def_logs, vehicle_recalls, ev_charging_sessions, service_programs,
  service_program_tasks, service_program_vehicles, inspection_schedules to authenticated;
