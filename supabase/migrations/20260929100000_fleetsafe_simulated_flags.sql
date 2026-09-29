-- Simulated FleetSafe data for signed-in fleets ("Load simulated data" in Device Hub).
-- The device-layer tables already carry a simulated flag. These are the remaining
-- tables the simulator writes to; the flag lets the pages label test rows and lets
-- "Remove simulated data" delete exactly what the simulator created and nothing else.
alter table geofences         add column if not exists simulated boolean not null default false;
alter table assets            add column if not exists simulated boolean not null default false;
alter table cold_chain_vehicles add column if not exists simulated boolean not null default false;
alter table coaching_sessions add column if not exists simulated boolean not null default false;
alter table driver_locations  add column if not exists simulated boolean not null default false;

-- Simulated positions and fences must never drive a real alert.
create or replace function fs_on_driver_location() returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    perform fs_track_position(new.org_id, new.vehicle_id, new.driver_id, new.latitude, new.longitude, new.recorded_at, coalesce(new.simulated, false));
  exception when others then
    raise warning 'fs_on_driver_location: %', sqlerrm;
  end;
  return null;
end $$;
