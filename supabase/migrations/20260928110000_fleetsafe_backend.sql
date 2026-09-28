-- FleetSafe backend: what has to happen when a reading or an incident arrives, with
-- nobody watching a screen.
--
--   fleetsafe_settings   per fleet: who is told, how, and the thresholds and retention
--   fleet_alerts         one row per thing an owner should hear about: the in-app inbox
--                        and the delivery log for SMS
--   geofence_presence    inside/outside per vehicle per fence, so "entered" and "left"
--                        are edges rather than every reading inside a fence
--
-- Triggers (all in the database, so the ingest function, the driver app and the
-- simulator get identical behaviour without each re-implementing it):
--   telemetry insert        → geofence enter/exit, cold-chain temperature check
--   driver_locations insert → geofence enter/exit
--   ai_events / device_events insert → fleet_alerts
--
-- Job functions, run by the scheduler (see 20260928120000_fleetsafe_schedule.sql):
--   fs_device_health()      tracker gone quiet, and back again
--   fs_cold_chain_daily()   yesterday's temperature compliance per reefer
--   fs_retention()          prune old readings so the database stays small

-- ---------- settings ----------
create table if not exists fleetsafe_settings (
  org_id                   uuid primary key references organizations(id) on delete cascade,
  -- warnings always reach the in-app inbox; this decides what is also sent by SMS
  sms_min_severity         text not null default 'critical' check (sms_min_severity in ('warning','critical')),
  notify_sms               boolean not null default false,
  alert_phones             text[] not null default '{}',
  offline_after_min        integer not null default 30 check (offline_after_min between 5 and 1440),
  telemetry_retention_days integer not null default 180 check (telemetry_retention_days between 30 and 730),
  updated_at               timestamptz not null default now()
);

-- ---------- alerts ----------
create table if not exists fleet_alerts (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations(id) on delete cascade,
  vehicle_id      uuid references vehicles(id) on delete set null,
  kind            text not null check (kind in ('incident','geofence','cold_chain','device_offline','device_back')),
  source          text,                 -- table the alert came from
  source_id       uuid,                 -- row in that table
  severity        text not null default 'warning' check (severity in ('info','warning','critical')),
  title           text not null,
  body            text,
  simulated       boolean not null default false,
  created_at      timestamptz not null default now(),
  read_at         timestamptz,
  read_by         uuid,
  -- in_app: inbox only. pending: waiting for the dispatcher to send SMS.
  delivery        text not null default 'in_app' check (delivery in ('in_app','pending','sent','failed','skipped')),
  delivery_detail text,
  delivered_at    timestamptz,
  attempts        integer not null default 0
);
create index if not exists idx_fleet_alerts_org_time on fleet_alerts(org_id, created_at desc);
create index if not exists idx_fleet_alerts_pending on fleet_alerts(created_at) where delivery = 'pending';
create unique index if not exists uq_fleet_alerts_source on fleet_alerts(source, source_id) where source_id is not null;

-- ---------- geofence state ----------
create table if not exists geofence_presence (
  geofence_id uuid not null references geofences(id) on delete cascade,
  vehicle_id  uuid not null references vehicles(id) on delete cascade,
  org_id      uuid not null references organizations(id) on delete cascade,
  inside      boolean not null,
  since       timestamptz not null,
  primary key (geofence_id, vehicle_id)
);

alter table devices add column if not exists offline_alerted_at timestamptz;

-- ---------- helpers ----------
create or replace function fs_distance_m(lat1 numeric, lng1 numeric, lat2 numeric, lng2 numeric)
returns double precision language sql immutable as $$
  select 6371000 * 2 * asin(sqrt(
    power(sin(radians((lat2 - lat1)::float8) / 2), 2)
    + cos(radians(lat1::float8)) * cos(radians(lat2::float8)) * power(sin(radians((lng2 - lng1)::float8) / 2), 2)))
$$;

create or replace function fs_label(p_type text) returns text language sql immutable as $$
  select coalesce((jsonb_build_object(
    'fuel_theft','Fuel theft','fuel_leak','Fuel leak','fuel_drop','Sudden fuel drop','tyre_pressure_loss','Tyre pressure loss',
    'tyre_low_pressure','Low tyre pressure','engine_overheat','Engine overheating','low_battery','Low battery',
    'cargo_temp_breach','Cargo temperature out of range','forward_collision','Forward collision warning',
    'headway_warning','Following too close','pedestrian_warning','Pedestrian warning','lane_departure','Lane departure',
    'fatigue','Driver drowsiness','distraction','Driver distraction','phone_use','Phone use while driving',
    'no_seatbelt','No seatbelt','smoking','Smoking in cab','harsh_brake','Harsh braking','harsh_accel','Harsh acceleration',
    'harsh_corner','Harsh cornering','overspeed','Overspeeding','tamper','Tamper','power_cut','Tracker power cut',
    'sos','SOS','panic','Panic button','collision','Collision detected','yawning','Driver yawning',
    'driver_absent','Driver not in seat','camera_blocked','Camera blocked','camera_fault','Camera fault',
    'cargo_door_open','Cargo door opened','idling','Engine idling') ->> p_type), initcap(replace(p_type, '_', ' ')))
$$;

-- Decides whether an alert also goes out by SMS. Test data never leaves the building.
create or replace function fs_delivery_for(p_org uuid, p_severity text, p_simulated boolean)
returns text language sql stable security definer set search_path = public as $$
  select case
    when p_simulated then 'in_app'
    when s.org_id is null or not s.notify_sms or cardinality(s.alert_phones) = 0 then 'in_app'
    when p_severity = 'critical' or (p_severity = 'warning' and s.sms_min_severity = 'warning') then 'pending'
    else 'in_app' end
  from (select 1) one left join fleetsafe_settings s on s.org_id = p_org
$$;

-- ---------- geofences ----------
-- One position, every active fence of the fleet: record enter/exit on the edge and
-- alert when the fence asks for it, or whenever a restricted zone is entered.
create or replace function fs_track_position(p_org uuid, p_vehicle uuid, p_driver uuid,
                                             p_lat numeric, p_lng numeric, p_at timestamptz, p_simulated boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare
  g record; was record; now_in boolean; dir text; ev_id uuid; dwell integer; vname text;
begin
  if p_vehicle is null or p_lat is null or p_lng is null then return; end if;
  for g in select * from geofences where org_id = p_org and is_active loop
    now_in := fs_distance_m(p_lat, p_lng, g.centre_lat, g.centre_lng) <= g.radius_m;
    select * into was from geofence_presence where geofence_id = g.id and vehicle_id = p_vehicle;
    if not found then
      insert into geofence_presence(geofence_id, vehicle_id, org_id, inside, since) values (g.id, p_vehicle, p_org, now_in, p_at);
      if not now_in then continue; end if;          -- first sight outside: nothing happened
    elsif was.inside = now_in or p_at < was.since then
      continue;                                     -- no change, or a late reading that must not flip the state
    else
      update geofence_presence set inside = now_in, since = p_at where geofence_id = g.id and vehicle_id = p_vehicle;
    end if;
    dir := case when now_in then 'enter' else 'exit' end;
    dwell := case when not now_in and was.since is not null then extract(epoch from p_at - was.since)::integer end;
    insert into geofence_events(org_id, geofence_id, vehicle_id, driver_id, direction, occurred_at, latitude, longitude, dwell_seconds)
    values (p_org, g.id, p_vehicle, p_driver, dir, p_at, p_lat, p_lng, dwell)
    returning id into ev_id;
    if g.alert_on in (dir, 'both') or (g.purpose = 'restricted' and now_in) then
      select name into vname from vehicles where id = p_vehicle;
      insert into fleet_alerts(org_id, vehicle_id, kind, source, source_id, severity, title, body, simulated, delivery)
      values (p_org, p_vehicle, 'geofence', 'geofence_events', ev_id,
              case when g.purpose = 'restricted' and now_in then 'critical' else 'info' end,
              format('%s %s %s', coalesce(vname, 'Vehicle'), case when now_in then 'entered' else 'left' end, g.name),
              case when dwell is not null then format('Was inside for %s min.', round(dwell / 60.0)) when g.purpose = 'restricted' then 'This is a restricted zone.' end,
              p_simulated,
              fs_delivery_for(p_org, case when g.purpose = 'restricted' and now_in then 'critical' else 'info' end, p_simulated))
      on conflict do nothing;
    end if;
  end loop;
end $$;

-- ---------- cold chain ----------
create or replace function fs_check_cargo_temp(p_org uuid, p_vehicle uuid, p_device uuid, p_temp numeric,
                                               p_at timestamptz, p_simulated boolean)
returns void language plpgsql security definer set search_path = public as $$
declare cc record; cfg record; lo numeric; hi numeric; dev numeric; sev text; vname text;
begin
  select * into cc from cold_chain_vehicles where vehicle_id = p_vehicle and org_id = p_org and is_active limit 1;
  if not found then return; end if;
  update cold_chain_vehicles set current_temperature_celsius = p_temp, last_reading_at = p_at, updated_at = now()
   where id = cc.id and (last_reading_at is null or last_reading_at <= p_at);
  select * into cfg from cold_chain_config where org_id = p_org and product_type = cc.product_type limit 1;
  lo := coalesce(cc.min_temp, cfg.min_temperature_celsius);
  hi := coalesce(cc.max_temp, cfg.max_temperature_celsius);
  if lo is null and hi is null then return; end if;
  dev := greatest(coalesce(lo - p_temp, 0), coalesce(p_temp - hi, 0), 0);
  if dev <= 0 then return; end if;
  -- one breach event per vehicle per 30 minutes; a reefer that stays warm is one problem, not sixty
  if exists (select 1 from ai_events where vehicle_id = p_vehicle and event_type = 'cargo_temp_breach'
              and occurred_at > p_at - interval '30 minutes' and occurred_at <= p_at) then return; end if;
  sev := case when dev >= coalesce(cfg.critical_deviation_celsius, 3) then 'critical' else 'warning' end;
  select name into vname from vehicles where id = p_vehicle;
  insert into ai_events(org_id, device_id, vehicle_id, occurred_at, event_type, signal_path, severity, confidence, summary, evidence, model, simulated)
  values (p_org, p_device, p_vehicle, p_at, 'cargo_temp_breach', 'Vehicle.Cargo.Temperature', sev, 0.95,
          format('Cargo is at %s °C; %s must stay between %s and %s °C.', round(p_temp, 1), coalesce(cc.product_type, 'this load'),
                 coalesce(round(lo, 1)::text, 'any'), coalesce(round(hi, 1)::text, 'any')),
          jsonb_build_object('temp_c', p_temp, 'min_c', lo, 'max_c', hi, 'deviation_c', round(dev, 2), 'product', cc.product_type),
          'rules-v1', p_simulated);
end $$;

-- ---------- triggers ----------
create or replace function fs_on_telemetry() returns trigger language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  select vehicle_id into v from devices where id = new.device_id;
  if v is null then return null; end if;
  -- an error here must never lose the reading: the trigger reports and carries on
  begin
    perform fs_track_position(new.org_id, v, null, new.latitude, new.longitude, new.recorded_at, new.simulated);
    if new.cargo_temp_c is not null then
      perform fs_check_cargo_temp(new.org_id, v, new.device_id, new.cargo_temp_c, new.recorded_at, new.simulated);
    end if;
  exception when others then
    raise warning 'fs_on_telemetry: %', sqlerrm;
  end;
  return null;
end $$;
drop trigger if exists trg_fs_telemetry on telemetry;
create trigger trg_fs_telemetry after insert on telemetry for each row execute function fs_on_telemetry();

create or replace function fs_on_driver_location() returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    perform fs_track_position(new.org_id, new.vehicle_id, new.driver_id, new.latitude, new.longitude, new.recorded_at, false);
  exception when others then
    raise warning 'fs_on_driver_location: %', sqlerrm;
  end;
  return null;
end $$;
drop trigger if exists trg_fs_driver_location on driver_locations;
create trigger trg_fs_driver_location after insert on driver_locations for each row execute function fs_on_driver_location();

-- Every warning or critical incident lands in the inbox; SMS per fs_delivery_for.
create or replace function fs_on_incident() returns trigger language plpgsql security definer set search_path = public as $$
declare veh uuid; vname text; body text;
begin
  if new.severity not in ('warning', 'critical') then return null; end if;
  begin
    if tg_table_name = 'ai_events' then
      veh := new.vehicle_id; body := new.summary;
    else
      select vehicle_id into veh from devices where id = new.device_id;
      body := concat_ws(' · ', case when new.speed_kmph is not null then round(new.speed_kmph) || ' km/h' end,
                        case when new.video_url is not null then 'clip recorded' end);
    end if;
    select name into vname from vehicles where id = veh;
    insert into fleet_alerts(org_id, vehicle_id, kind, source, source_id, severity, title, body, simulated, delivery)
    values (new.org_id, veh, case when new.event_type = 'cargo_temp_breach' then 'cold_chain' else 'incident' end,
            tg_table_name, new.id, new.severity,
            format('%s: %s', fs_label(new.event_type), coalesce(vname, 'vehicle')), nullif(body, ''),
            new.simulated, fs_delivery_for(new.org_id, new.severity, new.simulated))
    on conflict do nothing;
  exception when others then
    raise warning 'fs_on_incident: %', sqlerrm;
  end;
  return null;
end $$;
drop trigger if exists trg_fs_ai_event on ai_events;
create trigger trg_fs_ai_event after insert on ai_events for each row execute function fs_on_incident();
drop trigger if exists trg_fs_device_event on device_events;
create trigger trg_fs_device_event after insert on device_events for each row execute function fs_on_incident();

-- ---------- scheduled jobs ----------
-- A tracker that stops reporting is either switched off, out of coverage, or pulled out.
-- Alert once when it goes quiet and once when it comes back. Simulated devices are left
-- alone: stopping the simulator is not an incident.
create or replace function fs_device_health() returns integer language plpgsql security definer set search_path = public as $$
declare d record; n integer := 0; mins integer;
begin
  for d in
    select dv.*, coalesce(s.offline_after_min, 30) as after_min, v.name as vname
      from devices dv
      left join fleetsafe_settings s on s.org_id = dv.org_id
      left join vehicles v on v.id = dv.vehicle_id
     where dv.status = 'active' and not dv.simulated and dv.last_seen_at is not null
  loop
    if d.offline_alerted_at is null and d.last_seen_at < now() - make_interval(mins => d.after_min) then
      mins := extract(epoch from now() - d.last_seen_at)::integer / 60;
      insert into fleet_alerts(org_id, vehicle_id, kind, source, severity, title, body, delivery)
      values (d.org_id, d.vehicle_id, 'device_offline', 'devices', 'warning',
              format('Tracker offline: %s', coalesce(d.vname, d.imei)),
              format('No data for %s min. It may be switched off, out of coverage or removed.', mins),
              fs_delivery_for(d.org_id, 'warning', false));
      update devices set offline_alerted_at = now() where id = d.id;
      n := n + 1;
    elsif d.offline_alerted_at is not null and d.last_seen_at > d.offline_alerted_at then
      insert into fleet_alerts(org_id, vehicle_id, kind, source, severity, title, body)
      values (d.org_id, d.vehicle_id, 'device_back', 'devices', 'info',
              format('Tracker back online: %s', coalesce(d.vname, d.imei)), null);
      update devices set offline_alerted_at = null where id = d.id;
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

-- Yesterday's temperature record per reefer: the document an FSSAI inspector or a
-- pharma customer asks for.
create or replace function fs_cold_chain_daily(p_day date default (now() at time zone 'Asia/Kolkata')::date - 1)
returns integer language plpgsql security definer set search_path = public as $$
declare cc record; cfg record; lo numeric; hi numeric; tot integer; inr integer; viol integer; crit integer; n integer := 0;
  t0 timestamptz := (p_day::timestamp at time zone 'Asia/Kolkata'); t1 timestamptz := ((p_day + 1)::timestamp at time zone 'Asia/Kolkata');
begin
  for cc in select * from cold_chain_vehicles where is_active loop
    select * into cfg from cold_chain_config where org_id = cc.org_id and product_type = cc.product_type limit 1;
    lo := coalesce(cc.min_temp, cfg.min_temperature_celsius); hi := coalesce(cc.max_temp, cfg.max_temperature_celsius);
    select count(*), count(*) filter (where (lo is null or t.cargo_temp_c >= lo) and (hi is null or t.cargo_temp_c <= hi))
      into tot, inr
      from telemetry t join devices dv on dv.id = t.device_id
     where dv.vehicle_id = cc.vehicle_id and t.cargo_temp_c is not null and t.recorded_at >= t0 and t.recorded_at < t1;
    if tot = 0 then continue; end if;
    select count(*), count(*) filter (where severity = 'critical') into viol, crit
      from ai_events where vehicle_id = cc.vehicle_id and event_type = 'cargo_temp_breach' and occurred_at >= t0 and occurred_at < t1;
    delete from cold_chain_compliance where vehicle_id = cc.vehicle_id and compliance_date = p_day;
    insert into cold_chain_compliance(org_id, vehicle_id, compliance_date, trip_date, total_readings, readings_in_range,
                                      compliance_pct, violation_count, critical_violations, fssai_compliant, cold_chain_intact,
                                      temperature_log_available, status, notes)
    values (cc.org_id, cc.vehicle_id, p_day, p_day, tot, inr, round(100.0 * inr / tot, 1), viol, crit,
            crit = 0 and inr::numeric / tot >= 0.95, crit = 0, true,
            case when crit > 0 then 'violation' when inr::numeric / tot < 0.95 then 'warning' else 'compliant' end,
            'Computed nightly from the reefer sensor.');
    n := n + 1;
  end loop;
  return n;
end $$;

-- Keep raw readings for the retention the fleet chose; test data for a week.
create or replace function fs_retention() returns jsonb language plpgsql security definer set search_path = public as $$
declare a integer; b integer; c integer; d integer;
begin
  delete from telemetry t using (select o.id, coalesce(s.telemetry_retention_days, 180) as days
                                   from organizations o left join fleetsafe_settings s on s.org_id = o.id) r
   where t.org_id = r.id and t.recorded_at < now() - make_interval(days => r.days);
  get diagnostics a = row_count;
  delete from telemetry where simulated and recorded_at < now() - interval '7 days';
  get diagnostics b = row_count;
  delete from driver_locations where recorded_at < now() - interval '180 days';
  get diagnostics c = row_count;
  delete from fleet_alerts where read_at is not null and created_at < now() - interval '90 days';
  get diagnostics d = row_count;
  return jsonb_build_object('telemetry', a, 'simulated_telemetry', b, 'driver_locations', c, 'alerts', d);
end $$;

-- the job functions run as the scheduler, never from the browser
revoke execute on function fs_device_health(), fs_cold_chain_daily(date), fs_retention() from public;

-- ---------- access ----------
insert into rbac_table_registry(table_name, mode, resource, vehicle_col, org_col, notes) values
 ('fleet_alerts',       'generated', 'telemetry', 'vehicle_id', 'org_id', 'FleetSafe alert inbox and SMS delivery log'),
 ('fleetsafe_settings', 'generated', 'settings',  null,         'org_id', 'FleetSafe notification settings'),
 ('geofence_presence',  'generated', 'geofences', 'vehicle_id', 'org_id', 'inside/outside state per vehicle per fence')
on conflict (table_name) do update set mode = excluded.mode, resource = excluded.resource, vehicle_col = excluded.vehicle_col;
select rbac_apply('fleet_alerts');
select rbac_apply('fleetsafe_settings');
select rbac_apply('geofence_presence');
grant select, update on fleet_alerts to authenticated;           -- update = mark as read
grant select, insert, update on fleetsafe_settings to authenticated;
grant select on geofence_presence to authenticated;
