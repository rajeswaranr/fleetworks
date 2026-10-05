-- Link core operational tables by vehicle AND driver, so everything can be filtered/joined
-- per vehicle and per driver (360° vehicle and driver views).
--
-- Scope: operational activity tables only. Config/financial/reference tables (rbac, gst config,
-- parties, items, memberships, payments, vendors, …) are deliberately left alone — a vehicle/
-- driver column there would be meaningless.
--
-- device_events is the keystone: it previously linked to a vehicle only through device_id. We add
-- vehicle_id + driver_id (denormalised), backfill from the device and the vehicle's current driver,
-- and add a trigger so new rows populate automatically from their device.

-- 1) device_events ---------------------------------------------------------
alter table device_events add column if not exists vehicle_id uuid references vehicles(id) on delete set null;
alter table device_events add column if not exists driver_id  uuid references drivers(id)  on delete set null;
create index if not exists idx_device_events_vehicle on device_events(vehicle_id, occurred_at desc);
create index if not exists idx_device_events_driver  on device_events(driver_id, occurred_at desc);

update device_events e set vehicle_id = d.vehicle_id
  from devices d where e.device_id = d.id and e.vehicle_id is null and d.vehicle_id is not null;
update device_events e set driver_id = dr.id
  from drivers dr where dr.vehicle_id = e.vehicle_id and e.driver_id is null;

create or replace function device_events_set_links() returns trigger language plpgsql as $$
begin
  if new.vehicle_id is null and new.device_id is not null then
    select d.vehicle_id into new.vehicle_id from devices d where d.id = new.device_id;
  end if;
  if new.driver_id is null and new.vehicle_id is not null then
    select dr.id into new.driver_id from drivers dr where dr.vehicle_id = new.vehicle_id limit 1;
  end if;
  return new;
end $$;
drop trigger if exists trg_device_events_links on device_events;
create trigger trg_device_events_links before insert on device_events
  for each row execute function device_events_set_links();

-- 2) driver-activity tables that had a vehicle but no driver ---------------
alter table expenses    add column if not exists driver_id uuid references drivers(id) on delete set null;
alter table fuel_logs   add column if not exists driver_id uuid references drivers(id) on delete set null;
alter table inspections add column if not exists driver_id uuid references drivers(id) on delete set null;
alter table issues      add column if not exists driver_id uuid references drivers(id) on delete set null;

create index if not exists idx_expenses_driver    on expenses(driver_id);
create index if not exists idx_fuel_logs_driver   on fuel_logs(driver_id);
create index if not exists idx_inspections_driver on inspections(driver_id);
create index if not exists idx_issues_driver      on issues(driver_id);

-- Backfill driver from the vehicle's current driver (drivers.vehicle_id is the assignment).
update expenses    x set driver_id = dr.id from drivers dr where dr.vehicle_id = x.vehicle_id and x.driver_id is null;
update fuel_logs   x set driver_id = dr.id from drivers dr where dr.vehicle_id = x.vehicle_id and x.driver_id is null;
update inspections x set driver_id = dr.id from drivers dr where dr.vehicle_id = x.vehicle_id and x.driver_id is null;
update issues      x set driver_id = dr.id from drivers dr where dr.vehicle_id = x.vehicle_id and x.driver_id is null;
