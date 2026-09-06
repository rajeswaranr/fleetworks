-- ============ FleetWorks — IoT devices, telemetry and ADAS events ============
-- Three tables because the data has three different shapes and lifetimes:
--
--   devices        one slow-changing row per physical box — inventory and health
--   telemetry      continuous time series, high volume, mostly written once
--   device_events  discrete ADAS/DMS incidents someone has to act on
--
-- Folding events into telemetry was tempting and wrong: a lane-departure warning
-- needs acknowledgement, severity and a video link, while a speed reading needs
-- none of that and arrives a thousand times more often.
--
-- Telemetry is deliberately WIDE rather than (metric, value) rows. A fleet
-- dashboard almost always wants many parameters for one moment, which is one
-- row here versus a dozen-row pivot in the narrow shape. Anything vendor-
-- specific still survives in `raw`.

-- ---------- devices ----------
create table if not exists devices (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  vehicle_id    uuid references vehicles(id) on delete set null,
  imei          text not null,
  vendor        text,
  model         text,
  -- ais140 is the Indian mandate, jt808 the Chinese protocol most hardware
  -- speaks natively, fms the European standard. Recording it matters because
  -- the parser differs per protocol.
  protocol      text check (protocol in ('ais140','jt808','fms','obd2','proprietary')),
  sim_number    text,
  firmware      text,
  capabilities  text[],          -- gps, can, adas, dms, tpms, fuel_level, temp, door
  status        text not null default 'active' check (status in ('active','inactive','faulty','decommissioned')),
  installed_at  timestamptz,
  last_seen_at  timestamptz,
  -- Simulated devices are flagged at the source so demo data can never be
  -- mistaken for a real truck's, in a query or on a screen.
  simulated     boolean not null default false,
  notes         text,
  created_at    timestamptz not null default now(),
  unique (org_id, imei)
);
create index if not exists idx_devices_org on devices(org_id);
create index if not exists idx_devices_lastseen on devices(org_id, last_seen_at desc nulls last);

-- ---------- telemetry ----------
create table if not exists telemetry (
  id                 bigserial primary key,
  device_id          uuid not null references devices(id) on delete cascade,
  org_id             uuid not null references organizations(id) on delete cascade,
  recorded_at        timestamptz not null default now(),

  latitude           numeric,
  longitude          numeric,
  speed_kmph         numeric,
  heading            numeric,
  ignition           boolean,

  odometer_km        numeric,
  engine_hours       numeric,
  engine_rpm         numeric,
  coolant_temp_c     numeric,
  battery_voltage    numeric,

  fuel_level_pct     numeric,
  fuel_rate_lph      numeric,

  tyre_pressure_min_psi numeric,
  ambient_temp_c     numeric,
  cargo_temp_c       numeric,

  raw                jsonb,
  simulated          boolean not null default false
);
-- The dashboard's dominant query is "latest readings for this org's devices",
-- so the index leads with org and descends on time.
create index if not exists idx_telemetry_org_time on telemetry(org_id, recorded_at desc);
create index if not exists idx_telemetry_device_time on telemetry(device_id, recorded_at desc);

-- ---------- ADAS / DMS events ----------
create table if not exists device_events (
  id            uuid primary key default gen_random_uuid(),
  device_id     uuid not null references devices(id) on delete cascade,
  org_id        uuid not null references organizations(id) on delete cascade,
  occurred_at   timestamptz not null default now(),
  event_type    text not null check (event_type in (
                  'lane_departure','forward_collision','headway_warning','pedestrian_warning',
                  'fatigue','distraction','phone_use','no_seatbelt','smoking',
                  'harsh_brake','harsh_accel','harsh_corner','overspeed',
                  'fuel_drop','tamper','power_cut','sos','panic')),
  severity      text not null default 'warning' check (severity in ('info','warning','critical')),
  latitude      numeric,
  longitude     numeric,
  speed_kmph    numeric,
  video_url     text,
  raw           jsonb,
  -- An event nobody has looked at is the whole point of the feed, so
  -- acknowledgement is first-class rather than a status string.
  acknowledged_at timestamptz,
  acknowledged_by uuid references auth.users(id),
  simulated     boolean not null default false,
  created_at    timestamptz not null default now()
);
create index if not exists idx_events_org_time on device_events(org_id, occurred_at desc);
create index if not exists idx_events_unack on device_events(org_id, acknowledged_at) where acknowledged_at is null;

-- ---------- RLS ----------
-- Owners see their own org; FleetWorks admins see everything, since a support
-- desk that cannot see a customer's offline tracker cannot support it.
alter table devices       enable row level security;
alter table telemetry     enable row level security;
alter table device_events enable row level security;

drop policy if exists devices_member_all on devices;
create policy devices_member_all on devices for all to authenticated
  using (is_org_member(org_id)) with check (is_org_member(org_id));

drop policy if exists telemetry_member_read on telemetry;
create policy telemetry_member_read on telemetry for select to authenticated
  using (is_org_member(org_id));

drop policy if exists events_member_all on device_events;
create policy events_member_all on device_events for all to authenticated
  using (is_org_member(org_id)) with check (is_org_member(org_id));

-- Telemetry is written by the ingest edge function under the service role,
-- which bypasses RLS — so there is deliberately no client insert policy. The
-- exception is simulated rows, which members may write so the simulator can run
-- from the browser without a service key ever reaching it.
drop policy if exists telemetry_member_insert_sim on telemetry;
create policy telemetry_member_insert_sim on telemetry for insert to authenticated
  with check (is_org_member(org_id) and simulated = true);

grant select, insert, update, delete on devices to authenticated;
grant select, insert on telemetry to authenticated;
grant usage, select on sequence telemetry_id_seq to authenticated;
grant select, insert, update, delete on device_events to authenticated;

-- Verify after running:
--   select count(*) from devices;
--   select count(*) from telemetry where simulated;
