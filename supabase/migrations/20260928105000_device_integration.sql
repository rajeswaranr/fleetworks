-- Generic device integration: one model for trackers, dashcams, MDVRs, 360° (AVM) and
-- cargo cameras, fuel-level and temperature sensors, TPMS and OBD dongles.
--
--   devices (extended)   kind, integration path, gateway id, parent device
--   device_channels      camera channels: role (front road, cabin DMS, 360°, cargo...), live link
--   device_sensors       "this parameter from this device is that signal": scale/offset or a
--                        calibration table (fuel tanks), so any sensor plugs in without code
--   device_media         clips and snapshots, stored in the private device-media bucket
--   integration_keys     one ingest key per fleet (hashed); a key only reaches its own devices
--   ingest_log           every POST: accepted, rejected, unknown device. What an integrator
--                        looks at when "the tracker isn't showing up"
--
-- Wire formats are handled by adapters in supabase/functions/_shared/devices/adapters.ts:
-- FleetWorks JSON, flespi and Traccar. Binary protocols (Teltonika, GT06, JT/T 808/1078,
-- AIS-140) arrive through one of those gateways.

-- ---------- devices ----------
alter table devices add column if not exists kind text not null default 'tracker';
alter table devices add column if not exists integration text not null default 'native';
alter table devices add column if not exists external_id text;
alter table devices add column if not exists parent_device_id uuid references devices(id) on delete set null;
alter table devices drop constraint if exists devices_kind_check;
alter table devices add constraint devices_kind_check check (kind in
  ('tracker','dashcam','mdvr','avm_360','cargo_camera','fuel_sensor','temp_sensor','tpms','obd','other'));
alter table devices drop constraint if exists devices_integration_check;
alter table devices add constraint devices_integration_check check (integration in ('native','flespi','traccar','vendor_api','manual'));
alter table devices drop constraint if exists devices_protocol_check;
alter table devices add constraint devices_protocol_check check (protocol in
  ('ais140','jt808','jt1078','fms','obd2','teltonika','gt06','queclink','onvif','rtsp','http','mqtt','proprietary'));
create index if not exists idx_devices_imei on devices(imei);

-- the new event types cameras and DMS units report
alter table device_events drop constraint if exists device_events_event_type_check;
alter table device_events add constraint device_events_event_type_check check (event_type in (
  'lane_departure','forward_collision','headway_warning','pedestrian_warning','collision',
  'fatigue','distraction','phone_use','no_seatbelt','smoking','yawning','driver_absent',
  'camera_blocked','camera_fault','harsh_brake','harsh_accel','harsh_corner','overspeed',
  'fuel_drop','tamper','power_cut','sos','panic','cargo_door_open','idling'));

-- ---------- canonical signals the sensors map to ----------
insert into vehicle_signals(path, datatype, unit, min_value, max_value, source_col, is_ai, description) values
 ('Vehicle.CurrentLocation.Altitude', 'float', 'm', -500, 9000, null, false, 'Altitude above sea level'),
 ('Vehicle.Powertrain.FuelSystem.AbsoluteLevel', 'float', 'l', 0, 3000, null, false, 'Fuel in the tank, litres (from a level sensor and its calibration table)'),
 ('Vehicle.Cargo.Door.IsOpen', 'bool', null, null, null, null, false, 'Cargo door switch (FleetWorks extension)'),
 ('Vehicle.Driver.Identifier.Subject', 'string', null, null, null, null, false, 'Driver ID from an RFID card or iButton')
on conflict (path) do nothing;

-- ---------- camera channels ----------
create table if not exists device_channels (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  device_id   uuid not null references devices(id) on delete cascade,
  vehicle_id  uuid references vehicles(id) on delete set null,
  channel_no  integer not null check (channel_no between 1 and 32),
  role        text not null default 'other' check (role in
                ('front_road','cabin_dms','left','right','rear','cargo','surround_avm','tank','other')),
  label       text,
  -- a live link the vendor cloud or gateway serves: HLS (.m3u8), WebRTC (WHEP) or MP4.
  -- JT/T 1078 and RTSP streams need such a gateway; browsers cannot play them directly.
  live_url    text check (live_url is null or live_url ~* '^https://'),
  live_kind   text check (live_kind in ('hls','webrtc','mp4','mjpeg')),
  enabled     boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (device_id, channel_no)
);
create index if not exists idx_device_channels_vehicle on device_channels(vehicle_id);

-- ---------- sensor mappings ----------
create table if not exists device_sensors (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id) on delete cascade,
  device_id    uuid not null references devices(id) on delete cascade,
  source_key   text not null,                    -- param name as sent, e.g. "escort.lls.value.1", "io.270", "temp1"
  signal_path  text not null references vehicle_signals(path),
  transform    text not null default 'none' check (transform in ('none','linear','table')),
  scale        numeric,
  "offset"     numeric,
  calibration  jsonb,                            -- [[raw, value], ...] for transform = 'table'
  label        text,
  enabled      boolean not null default true,
  created_at   timestamptz not null default now(),
  unique (device_id, source_key),
  check (transform <> 'table' or jsonb_typeof(calibration) = 'array')
);

-- ---------- media ----------
create table if not exists device_media (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id) on delete cascade,
  device_id    uuid references devices(id) on delete set null,
  vehicle_id   uuid references vehicles(id) on delete set null,
  event_id     uuid references device_events(id) on delete set null,
  channel_no   integer,
  role         text,
  kind         text not null check (kind in ('clip','snapshot')),
  storage_path text,                             -- object in the device-media bucket
  source_url   text,                             -- where it came from, when it could not be copied
  mime         text,
  bytes        bigint,
  captured_at  timestamptz not null default now(),
  simulated    boolean not null default false,
  created_at   timestamptz not null default now()
);
create index if not exists idx_device_media_vehicle on device_media(vehicle_id, captured_at desc);
create index if not exists idx_device_media_event on device_media(event_id);

-- ---------- ingest keys ----------
create table if not exists integration_keys (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id) on delete cascade,
  name         text not null,
  key_hash     text not null unique,             -- sha256 hex; the key itself is shown once and never stored
  key_prefix   text not null,                    -- first characters, so the owner can tell keys apart
  created_by   uuid,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);

create or replace function create_integration_key(p_name text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare org uuid; raw text; kid uuid;
begin
  select m.org_id into org from memberships m where m.user_id = auth.uid() and m.role in ('owner','manager') limit 1;
  if org is null then raise exception 'Only a fleet owner or manager can create an integration key.'; end if;
  if (select count(*) from integration_keys where org_id = org and revoked_at is null) >= 20 then
    raise exception 'This fleet already has 20 active keys. Revoke one first.';
  end if;
  raw := 'fwk_' || encode(gen_random_bytes(24), 'hex');
  insert into integration_keys(org_id, name, key_hash, key_prefix, created_by)
  values (org, left(coalesce(nullif(trim(p_name), ''), 'Integration'), 60), encode(digest(raw, 'sha256'), 'hex'), left(raw, 12), auth.uid())
  returning id into kid;
  return jsonb_build_object('id', kid, 'key', raw, 'prefix', left(raw, 12));
end $$;
revoke execute on function create_integration_key(text) from public, anon;
grant execute on function create_integration_key(text) to authenticated;

-- ---------- ingest log ----------
create table if not exists ingest_log (
  id           bigint generated always as identity primary key,
  org_id       uuid references organizations(id) on delete cascade,
  key_id       uuid references integration_keys(id) on delete set null,
  endpoint     text not null,                    -- device-ingest | device-media | telemetry-ingest
  format       text,
  ident        text,
  status       text not null check (status in ('ok','partial','unknown_device','rejected','error')),
  detail       text,
  readings     integer not null default 0,
  events       integer not null default 0,
  media        integer not null default 0,
  received_at  timestamptz not null default now()
);
create index if not exists idx_ingest_log_org on ingest_log(org_id, received_at desc);

-- ---------- access ----------
insert into rbac_table_registry(table_name, mode, resource, vehicle_col, org_col, notes) values
 ('device_channels',  'generated', 'devices',   'vehicle_id', 'org_id', 'camera channels and live links'),
 ('device_sensors',   'generated', 'devices',   null,         'org_id', 'per-device sensor mapping and calibration'),
 ('device_media',     'generated', 'telemetry', 'vehicle_id', 'org_id', 'clips and snapshots'),
 ('integration_keys', 'generated', 'devices',   null,         'org_id', 'hashed ingest keys'),
 ('ingest_log',       'generated', 'devices',   null,         'org_id', 'ingest audit trail')
on conflict (table_name) do update set mode = excluded.mode, resource = excluded.resource, vehicle_col = excluded.vehicle_col;
select rbac_apply('device_channels');
select rbac_apply('device_sensors');
select rbac_apply('device_media');
select rbac_apply('integration_keys');
select rbac_apply('ingest_log');
grant select, insert, update, delete on device_channels, device_sensors to authenticated;
grant select on device_media, ingest_log to authenticated;
grant select, update on integration_keys to authenticated;      -- update = revoke; creation only via create_integration_key()
