-- Sites & Projects — fleet deployment units
--
-- A "site" is where a set of trucks is deployed: a construction yard, customer
-- depot, logistics hub, or route. A "project" is a time-bound work package.
-- Both map to the same table; project_type gives the movement/work category.
-- Each has one manager and one supervisor (stored as name + optional user FK
-- so an owner can enter them before the team member has signed up).
-- Vehicles are assigned to a site via site_vehicle_assignments; the app
-- enforces one active site per vehicle at a time.

-- ── sites ──────────────────────────────────────────────────────────────────
create table if not exists sites (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations(id) on delete cascade,

  name            text not null,
  -- top-level category
  site_type       text not null default 'site'
                  check (site_type in ('site','project')),
  -- movement / work category
  project_type    text not null default 'other'
                  check (project_type in (
                    'intercity','local_movement','long_haul',
                    'depot','yard','customer_site',
                    'construction','mining','agriculture',
                    'logistics_hub','other'
                  )),

  location        text,   -- city / district
  address         text,   -- full address / GPS tag

  -- manager: the person responsible for the site / project
  manager_name    text,
  manager_user_id uuid references auth.users(id) on delete set null,

  -- supervisor: on-site daily coordinator
  supervisor_name    text,
  supervisor_user_id uuid references auth.users(id) on delete set null,

  start_date      date,
  end_date        date,
  status          text not null default 'active'
                  check (status in ('active','completed','paused','cancelled')),
  notes           text,

  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create or replace function fn_sites_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end;
$$;
drop trigger if exists trg_sites_updated_at on sites;
create trigger trg_sites_updated_at
  before update on sites
  for each row execute function fn_sites_updated_at();

-- ── site_vehicle_assignments ───────────────────────────────────────────────
-- One active site per vehicle enforced in app logic (remove old before adding
-- new). We keep past assignments (removed_date set) for history.
create table if not exists site_vehicle_assignments (
  id              uuid primary key default gen_random_uuid(),
  site_id         uuid not null references sites(id) on delete cascade,
  vehicle_id      uuid not null references vehicles(id) on delete cascade,
  org_id          uuid not null references organizations(id) on delete cascade,
  assigned_date   date not null default current_date,
  removed_date    date,   -- null = currently active
  notes           text,
  created_at      timestamptz not null default now()
);

-- Only one ACTIVE assignment per vehicle at a time
create unique index if not exists idx_sva_active_vehicle
  on site_vehicle_assignments(vehicle_id)
  where removed_date is null;

create index if not exists idx_sites_org         on sites(org_id);
create index if not exists idx_sva_site          on site_vehicle_assignments(site_id);
create index if not exists idx_sva_vehicle       on site_vehicle_assignments(vehicle_id);
create index if not exists idx_sva_org           on site_vehicle_assignments(org_id);

-- ── RLS ───────────────────────────────────────────────────────────────────
alter table sites                    enable row level security;
alter table site_vehicle_assignments enable row level security;

-- Owners and managers: full access
create policy sites_org_admin on sites
  for all using (is_org_admin(org_id));

create policy sva_org_admin on site_vehicle_assignments
  for all using (is_org_admin(org_id));

-- Supervisors: read their own assigned sites (via supervisor_user_id)
create policy sites_supervisor_read on sites
  for select using (
    supervisor_user_id = auth.uid()
    or exists (
      select 1 from memberships m
      where m.user_id = auth.uid()
        and m.org_id = sites.org_id
        and m.role in ('owner','manager')
    )
  );

create policy sva_supervisor_read on site_vehicle_assignments
  for select using (
    exists (
      select 1 from sites s
      where s.id = site_vehicle_assignments.site_id
        and (s.supervisor_user_id = auth.uid() or is_org_admin(site_vehicle_assignments.org_id))
    )
  );

-- ── site_staff_assignments ─────────────────────────────────────────────────
-- Assigns drivers or team members (supervisors, helpers) to a site/project.
-- driver_ext_id links to the local drivers table (not a Postgres FK, to avoid
-- coupling to that ext_id column; the app resolves it in memory).
-- user_id is set for team-portal users (supervisors, managers).
-- Both can be set at once (e.g. a supervisor who is also a team member).
create table if not exists site_staff_assignments (
  id              uuid primary key default gen_random_uuid(),
  site_id         uuid not null references sites(id) on delete cascade,
  org_id          uuid not null references organizations(id) on delete cascade,

  -- one of these must be set
  driver_ext_id   text,   -- matches drivers.ext_id
  user_id         uuid references auth.users(id) on delete set null,

  -- role at this site
  staff_role      text not null default 'driver'
                  check (staff_role in ('manager','supervisor','driver','helper','operator')),

  staff_name      text not null,   -- denormalised name for display
  joined_date     date not null default current_date,
  left_date       date,            -- null = currently active
  notes           text,
  created_at      timestamptz not null default now()
);

create index if not exists idx_ssa_site    on site_staff_assignments(site_id);
create index if not exists idx_ssa_driver  on site_staff_assignments(driver_ext_id) where driver_ext_id is not null;
create index if not exists idx_ssa_user    on site_staff_assignments(user_id) where user_id is not null;

alter table site_staff_assignments enable row level security;

create policy ssa_org_admin on site_staff_assignments
  for all using (is_org_admin(org_id));
