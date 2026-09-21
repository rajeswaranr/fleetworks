-- Vehicle intelligence layer: one canonical signal model, a live digital twin per
-- device, and one canonical AI event table. Signal paths follow the COVESA Vehicle
-- Signal Specification (VSS); FleetWorks-specific and AI signals live under the same
-- tree (Vehicle.AI..., Vehicle.Chassis.Tyre...).
--   vehicle_signals  the catalogue: path, unit, range, and which telemetry column it comes from
--   vehicle_twin     latest value of every signal for a device, refreshed on every ingest
--   ai_events        anything the rules or a model detect: fuel theft, tyre loss, overheating

create table if not exists vehicle_signals (
  path        text primary key,
  datatype    text not null check (datatype in ('float','int','bool','string')),
  unit        text,
  min_value   numeric,
  max_value   numeric,
  source_col  text,                 -- column of telemetry it is read from (null for derived / AI signals)
  is_ai       boolean not null default false,
  description text not null
);
alter table vehicle_signals enable row level security;
drop policy if exists vehicle_signals_read on vehicle_signals;
create policy vehicle_signals_read on vehicle_signals for select to authenticated using (true);
grant select on vehicle_signals to authenticated;

insert into vehicle_signals(path, datatype, unit, min_value, max_value, source_col, is_ai, description) values
 ('Vehicle.CurrentLocation.Latitude',  'float', 'degrees', -90, 90,   'latitude', false, 'GNSS latitude'),
 ('Vehicle.CurrentLocation.Longitude', 'float', 'degrees', -180, 180, 'longitude', false, 'GNSS longitude'),
 ('Vehicle.Speed', 'float', 'km/h', 0, 250, 'speed_kmph', false, 'Vehicle speed'),
 ('Vehicle.CurrentLocation.Heading', 'float', 'degrees', 0, 360, 'heading', false, 'Direction of travel'),
 ('Vehicle.Powertrain.CombustionEngine.IsRunning', 'bool', null, null, null, 'ignition', false, 'Ignition / engine on'),
 ('Vehicle.Powertrain.CombustionEngine.Speed', 'float', 'rpm', 0, 6000, 'engine_rpm', false, 'Engine speed'),
 ('Vehicle.Powertrain.CombustionEngine.ECT', 'float', 'celsius', -40, 150, 'coolant_temp_c', false, 'Engine coolant temperature'),
 ('Vehicle.Powertrain.CombustionEngine.EngineHours', 'float', 'h', 0, null, 'engine_hours', false, 'Engine running hours'),
 ('Vehicle.Powertrain.FuelSystem.RelativeLevel', 'float', 'percent', 0, 100, 'fuel_level_pct', false, 'Fuel tank level'),
 ('Vehicle.Powertrain.FuelSystem.InstantConsumption', 'float', 'l/h', 0, 200, 'fuel_rate_lph', false, 'Fuel burn rate'),
 ('Vehicle.TravelledDistance', 'float', 'km', 0, null, 'odometer_km', false, 'Odometer'),
 ('Vehicle.LowVoltageBattery.CurrentVoltage', 'float', 'V', 0, 36, 'battery_voltage', false, 'Battery voltage'),
 ('Vehicle.Chassis.Tyre.MinPressure', 'float', 'psi', 0, 200, 'tyre_pressure_min_psi', false, 'Lowest tyre pressure across the vehicle (FleetWorks extension)'),
 ('Vehicle.Cabin.HVAC.AmbientAirTemperature', 'float', 'celsius', -50, 80, 'ambient_temp_c', false, 'Ambient air temperature'),
 ('Vehicle.Cargo.Temperature', 'float', 'celsius', -50, 60, 'cargo_temp_c', false, 'Cargo or reefer temperature (FleetWorks extension)'),
 ('Vehicle.AI.Fuel.FuelTheftProbability', 'float', 'ratio', 0, 1, null, true, 'Probability that a fuel drop is theft'),
 ('Vehicle.AI.Tyre.PunctureProbability', 'float', 'ratio', 0, 1, null, true, 'Probability of a puncture or slow leak'),
 ('Vehicle.AI.Maintenance.EngineFailureProbability', 'float', 'ratio', 0, 1, null, true, 'Engine overheating or failure risk'),
 ('Vehicle.AI.Safety.Driver.HarshEventRisk', 'float', 'ratio', 0, 1, null, true, 'Risk from harsh braking, over-speed and similar'),
 ('Vehicle.AI.Safety.Driver.Drowsiness', 'float', 'ratio', 0, 1, null, true, 'Driver drowsiness (from the driver-facing camera)'),
 ('Vehicle.AI.Safety.ADAS.ForwardCollisionRisk', 'float', 'ratio', 0, 1, null, true, 'Forward collision risk (from the ADAS camera)')
on conflict (path) do update set datatype = excluded.datatype, unit = excluded.unit, min_value = excluded.min_value,
  max_value = excluded.max_value, source_col = excluded.source_col, is_ai = excluded.is_ai, description = excluded.description;

create table if not exists vehicle_twin (
  device_id   uuid primary key references devices(id) on delete cascade,
  org_id      uuid not null references organizations(id) on delete cascade,
  vehicle_id  uuid references vehicles(id) on delete set null,
  state       jsonb not null default '{}'::jsonb,        -- signal path -> { v: value, ts: iso time }
  health      jsonb not null default '{}'::jsonb,        -- fuel / tyres / engine / driver scores, 0-100
  last_reading_at timestamptz,
  simulated   boolean not null default false,
  updated_at  timestamptz not null default now()
);
create index if not exists idx_vehicle_twin_org on vehicle_twin(org_id);
alter table vehicle_twin enable row level security;

create table if not exists ai_events (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id) on delete cascade,
  device_id    uuid references devices(id) on delete cascade,
  vehicle_id   uuid references vehicles(id) on delete set null,
  occurred_at  timestamptz not null default now(),
  event_type   text not null,               -- fuel_theft, tyre_pressure_loss, tyre_low_pressure, engine_overheat, low_battery, harsh_driving, overspeed
  signal_path  text references vehicle_signals(path),
  severity     text not null default 'warning' check (severity in ('info','warning','critical')),
  confidence   numeric check (confidence is null or (confidence >= 0 and confidence <= 1)),
  summary      text not null,
  evidence     jsonb not null default '{}'::jsonb,
  acknowledged_at timestamptz,
  acknowledged_by uuid,
  model        text not null default 'rules-v1',
  simulated    boolean not null default false,
  created_at   timestamptz not null default now()
);
create index if not exists idx_ai_events_org_time on ai_events(org_id, occurred_at desc);
create index if not exists idx_ai_events_vehicle on ai_events(vehicle_id, occurred_at desc);
alter table ai_events enable row level security;

insert into rbac_table_registry(table_name, mode, resource, vehicle_col, org_col, notes) values
 ('vehicle_twin', 'generated', 'telemetry', 'vehicle_id', 'org_id', 'live state per device'),
 ('ai_events',    'generated', 'telemetry', 'vehicle_id', 'org_id', 'canonical AI event'),
 ('vehicle_signals', 'custom', null, null, 'org_id', 'global signal catalogue, read-only')
on conflict (table_name) do update set mode = excluded.mode, resource = excluded.resource, vehicle_col = excluded.vehicle_col;
select rbac_apply('vehicle_twin');
select rbac_apply('ai_events');
grant select, insert, update, delete on vehicle_twin, ai_events to authenticated;
