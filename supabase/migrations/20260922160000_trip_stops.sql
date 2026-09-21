-- Every loading and unloading on a trip, logged by the driver with time, place,
-- party, material and quantity. Access follows the trips permissions: a driver
-- logs (and reads) stops only on their assigned vehicles; owners and managers see all.
create table if not exists trip_stops (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  trip_id     uuid not null references trips(id) on delete cascade,
  vehicle_id  uuid references vehicles(id) on delete set null,
  driver_id   uuid references drivers(id) on delete set null,
  kind        text not null check (kind in ('loading','unloading')),
  place       text,
  party       text,
  material    text,
  quantity    numeric check (quantity is null or quantity >= 0),
  unit        text,
  odometer    numeric,
  note        text,
  happened_at timestamptz not null default now(),
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now()
);
create index if not exists idx_trip_stops_trip on trip_stops(trip_id, happened_at);
create index if not exists idx_trip_stops_org  on trip_stops(org_id, happened_at desc);
alter table trip_stops enable row level security;

insert into rbac_table_registry(table_name, mode, resource, vehicle_col, driver_col, org_col, notes)
values ('trip_stops', 'generated', 'trips', 'vehicle_id', 'driver_id', 'org_id', 'loading / unloading log')
on conflict (table_name) do update set mode = excluded.mode, resource = excluded.resource,
  vehicle_col = excluded.vehicle_col, driver_col = excluded.driver_col, org_col = excluded.org_col;
select rbac_apply('trip_stops');
grant select, insert, update, delete on trip_stops to authenticated;
