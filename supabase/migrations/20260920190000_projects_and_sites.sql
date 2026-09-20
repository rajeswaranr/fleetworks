-- Projects and sites as separate, many-to-many entities
--
--   sites          a PLACE: yard, depot, quarry, customer site, hub
--   projects       a commercial work package: client, contract, billing terms
--   project_sites  which sites a project runs at (and each site's role in it:
--                  operating / loading point / unloading point / both)
--
-- One project can run at many sites; one site can host many projects.
-- Vehicle and staff deployments (site_vehicle_assignments /
-- site_staff_assignments) gain a project_id, so a truck is deployed to a
-- project AT a site. The existing "one active deployment per vehicle" rule is
-- unchanged.
--
-- Existing data: every sites row that carried commercial details (site_type
-- 'project', or a client / contract value / rate) gets a matching project,
-- linked back to that site; its vehicle and staff deployments are attached to
-- the new project. Safe to re-run.

-- ── wider billing basis list ───────────────────────────────────────────────
-- trip, tonnage, tonne_km, km_based, cubic_metre, per_unit, per_delivery,
-- hourly, shift, daily_rental, weekly_rental, monthly_rental, lump_sum, custom
alter table sites drop constraint if exists sites_billing_basis_check;
alter table sites add constraint sites_billing_basis_check
  check (billing_basis in ('trip','tonnage','tonne_km','km_based','cubic_metre','per_unit',
    'per_delivery','hourly','shift','daily_rental','weekly_rental','monthly_rental','lump_sum','custom'));

alter table site_vehicle_assignments drop constraint if exists site_vehicle_assignments_billing_basis_check;
alter table site_vehicle_assignments add constraint site_vehicle_assignments_billing_basis_check
  check (billing_basis in ('site_default','trip','tonnage','tonne_km','km_based','cubic_metre','per_unit',
    'per_delivery','hourly','shift','daily_rental','weekly_rental','monthly_rental','lump_sum','custom'));

-- ── projects ───────────────────────────────────────────────────────────────
create table if not exists projects (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references organizations(id) on delete cascade,

  name             text not null,
  code             text,                       -- owner's own reference / PO / contract no.
  work_type        text not null default 'other',
  status           text not null default 'active'
                   check (status in ('planned','active','paused','completed','cancelled')),

  client_name      text,
  client_contact   text,

  -- commercial terms
  billing_basis    text not null default 'trip'
                   check (billing_basis in ('trip','tonnage','tonne_km','km_based','cubic_metre','per_unit',
                     'per_delivery','hourly','shift','daily_rental','weekly_rental','monthly_rental','lump_sum','custom')),
  rate_per_unit    numeric(12,2),
  unit_label       text,
  target_quantity  numeric(12,2),              -- planned trips / MT / days / months ...
  min_guarantee_qty numeric(12,2),             -- rentals: minimum billable km / hours per period
  extra_rate       numeric(12,2),              -- rate beyond the minimum (extra km / extra hour)
  fuel_policy      text not null default 'owner' check (fuel_policy in ('owner','client','shared')),
  toll_policy      text not null default 'owner' check (toll_policy in ('owner','client','shared')),
  gst_percent      numeric(5,2),
  payment_terms_days integer,
  contract_value   numeric(14,2),
  contract_start   date,
  contract_end     date,

  manager_name       text,
  manager_user_id    uuid references auth.users(id) on delete set null,
  supervisor_name    text,
  supervisor_user_id uuid references auth.users(id) on delete set null,

  vehicle_types    text[] default '{}',
  notes            text,

  legacy_site_id   uuid,                       -- set when created from an old sites row (backfill idempotency)
  created_by       uuid references auth.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create or replace function fn_projects_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end;
$$;
drop trigger if exists trg_projects_updated_at on projects;
create trigger trg_projects_updated_at
  before update on projects
  for each row execute function fn_projects_updated_at();

create index if not exists idx_projects_org    on projects(org_id);
create index if not exists idx_projects_status on projects(org_id, status);
create unique index if not exists idx_projects_legacy_site on projects(legacy_site_id) where legacy_site_id is not null;

-- ── project_sites (many-to-many) ───────────────────────────────────────────
create table if not exists project_sites (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references projects(id) on delete cascade,
  site_id          uuid not null references sites(id) on delete cascade,
  org_id           uuid not null references organizations(id) on delete cascade,
  site_role        text not null default 'operating'
                   check (site_role in ('operating','loading','unloading','both')),
  target_quantity  numeric(12,2),              -- optional share of the project target at this site
  notes            text,
  created_at       timestamptz not null default now(),
  unique (project_id, site_id)
);
create index if not exists idx_project_sites_project on project_sites(project_id);
create index if not exists idx_project_sites_site    on project_sites(site_id);
create index if not exists idx_project_sites_org     on project_sites(org_id);

-- ── deployments belong to a project ────────────────────────────────────────
alter table site_vehicle_assignments add column if not exists project_id uuid references projects(id) on delete set null;
alter table site_staff_assignments   add column if not exists project_id uuid references projects(id) on delete set null;
create index if not exists idx_sva_project on site_vehicle_assignments(project_id);
create index if not exists idx_ssa_project on site_staff_assignments(project_id);

-- ── RLS ────────────────────────────────────────────────────────────────────
alter table projects      enable row level security;
alter table project_sites enable row level security;

drop policy if exists projects_org_admin on projects;
create policy projects_org_admin on projects
  for all using (is_org_admin(org_id)) with check (is_org_admin(org_id));

drop policy if exists project_sites_org_admin on project_sites;
create policy project_sites_org_admin on project_sites
  for all using (is_org_admin(org_id)) with check (is_org_admin(org_id));

-- Supervisors: read projects that run at a site they supervise
drop policy if exists projects_supervisor_read on projects;
create policy projects_supervisor_read on projects
  for select using (
    exists (
      select 1 from project_sites ps
      join sites s on s.id = ps.site_id
      where ps.project_id = projects.id and s.supervisor_user_id = auth.uid()
    )
  );

drop policy if exists project_sites_supervisor_read on project_sites;
create policy project_sites_supervisor_read on project_sites
  for select using (
    exists (
      select 1 from sites s
      where s.id = project_sites.site_id and s.supervisor_user_id = auth.uid()
    )
  );

-- ── backfill from existing sites ───────────────────────────────────────────
insert into projects (
  org_id, name, work_type, status, client_name, client_contact,
  billing_basis, rate_per_unit, unit_label, target_quantity, contract_value,
  contract_start, contract_end, manager_name, manager_user_id,
  supervisor_name, supervisor_user_id, vehicle_types, notes, legacy_site_id, created_by, created_at
)
select
  s.org_id, s.name, coalesce(s.project_type, 'other'),
  case when s.status in ('active','paused','completed','cancelled') then s.status else 'active' end,
  s.client_name, s.client_contact,
  coalesce(s.billing_basis, 'trip'), nullif(s.rate_per_unit, 0), s.unit_label, s.target_quantity, s.contract_value,
  coalesce(s.contract_start, s.start_date), coalesce(s.contract_end, s.end_date),
  s.manager_name, s.manager_user_id, s.supervisor_name, s.supervisor_user_id,
  coalesce(s.vehicle_types, '{}'), s.notes, s.id, s.created_by, s.created_at
from sites s
where (s.site_type = 'project'
       or s.client_name is not null
       or s.contract_value is not null
       or coalesce(s.rate_per_unit, 0) > 0)
  and not exists (select 1 from projects p where p.legacy_site_id = s.id);

insert into project_sites (project_id, site_id, org_id)
select p.id, p.legacy_site_id, p.org_id
from projects p
where p.legacy_site_id is not null
  and exists (select 1 from sites s where s.id = p.legacy_site_id)
on conflict (project_id, site_id) do nothing;

update site_vehicle_assignments a
   set project_id = p.id
  from projects p
 where p.legacy_site_id = a.site_id and a.project_id is null;

update site_staff_assignments a
   set project_id = p.id
  from projects p
 where p.legacy_site_id = a.site_id and a.project_id is null;

-- The old row is now just the place; the commercial side lives in projects.
update sites set site_type = 'site'
 where site_type = 'project'
   and id in (select legacy_site_id from projects where legacy_site_id is not null);
