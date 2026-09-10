-- Daily Dispatch Board
-- One record per vehicle per day. Supervisors create the day's plan (Planned),
-- then update status as vehicles move (Running → Halt → Maintenance → Completed).
-- Owners and managers see the full fleet; supervisors see their site's vehicles.

create table if not exists daily_dispatch (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references organizations(id) on delete cascade,
  site_id             uuid references sites(id) on delete set null,
  vehicle_id          uuid not null references vehicles(id) on delete cascade,

  dispatch_date       date not null default current_date,

  -- driver for today (may differ from the standing assignment)
  driver_ext_id       text,    -- matches drivers.ext_id in the local drivers table
  driver_name         text,    -- denormalised for quick display

  -- movement status
  status              text not null default 'planned'
                      check (status in (
                        'planned','running','halt','maintenance','completed','cancelled'
                      )),
  status_updated_at   timestamptz not null default now(),
  status_updated_by   text,      -- supervisor name who last changed it

  -- task details
  task_type           text not null default 'trip'
                      check (task_type in (
                        'trip','loading','unloading','standby','service','idle','other'
                      )),
  task_description    text,
  destination         text,
  load_detail         text,     -- e.g. "20 MT sand", "4 containers"
  planned_start       time,
  actual_start        time,
  completed_at        time,

  -- supervisor
  supervisor_name     text,
  supervisor_user_id  uuid references auth.users(id) on delete set null,

  notes               text,
  created_by          uuid references auth.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  -- only one dispatch record per vehicle per day per org
  unique (org_id, vehicle_id, dispatch_date)
);

create or replace function fn_dispatch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  if new.status <> old.status then
    new.status_updated_at := now();
  end if;
  return new;
end;
$$;
drop trigger if exists trg_dispatch_updated_at on daily_dispatch;
create trigger trg_dispatch_updated_at
  before update on daily_dispatch
  for each row execute function fn_dispatch_updated_at();

create index if not exists idx_dispatch_org_date   on daily_dispatch(org_id, dispatch_date);
create index if not exists idx_dispatch_vehicle    on daily_dispatch(vehicle_id);
create index if not exists idx_dispatch_site       on daily_dispatch(site_id);
create index if not exists idx_dispatch_supervisor on daily_dispatch(supervisor_user_id);

-- ── RLS ───────────────────────────────────────────────────────────────────
alter table daily_dispatch enable row level security;

-- Owners and managers: full access
create policy dd_org_admin on daily_dispatch
  for all using (is_org_admin(org_id));

-- Supervisors: access records for vehicles at their assigned site
create policy dd_supervisor on daily_dispatch
  for all using (
    supervisor_user_id = auth.uid()
    or exists (
      select 1
      from sites s
      join site_vehicle_assignments sva on sva.site_id = s.id and sva.removed_date is null
      where s.supervisor_user_id = auth.uid()
        and sva.vehicle_id = daily_dispatch.vehicle_id
        and s.org_id = daily_dispatch.org_id
    )
  );
