// FleetSafe backend migrations, executed against Postgres 16 in-process (PGlite).
// Runs the two logic migrations on top of minimal stand-ins for the tables they touch,
// then drives them the way the ingest pipeline does: insert readings and incidents,
// run the scheduled job functions, and check what the triggers wrote.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const MIG = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "supabase", "migrations");
const db = new PGlite();
let failures = 0;
const ok = (m) => console.log("  ✓ " + m);
const check = (cond, m) => { if (cond) ok(m); else { failures++; console.log("  ✗ " + m); } };
const one = async (sql, p = []) => (await db.query(sql, p)).rows[0];
const count = async (sql, p = []) => Number((await one(sql, p)).n);

await db.exec(`
  create role authenticated; create role anon;
  create schema auth; create function auth.uid() returns uuid language sql as $$ select null::uuid $$;
  create table organizations (id uuid primary key default gen_random_uuid(), name text);
  create table memberships (org_id uuid, user_id uuid, role text);
  create table vehicles (id uuid primary key default gen_random_uuid(), org_id uuid references organizations(id), ext_id text, name text, tank_capacity numeric);
  create table devices (id uuid primary key default gen_random_uuid(), org_id uuid not null references organizations(id), vehicle_id uuid references vehicles(id),
    imei text not null, vendor text, model text, protocol text check (protocol in ('ais140','jt808','fms','obd2','proprietary')), capabilities text[],
    status text not null default 'active', installed_at timestamptz, last_seen_at timestamptz, simulated boolean not null default false, notes text);
  create table telemetry (id bigserial primary key, device_id uuid not null references devices(id), org_id uuid not null, recorded_at timestamptz not null default now(),
    latitude numeric, longitude numeric, speed_kmph numeric, heading numeric, ignition boolean, odometer_km numeric, engine_hours numeric, engine_rpm numeric,
    coolant_temp_c numeric, battery_voltage numeric, fuel_level_pct numeric, fuel_rate_lph numeric, tyre_pressure_min_psi numeric, ambient_temp_c numeric,
    cargo_temp_c numeric, raw jsonb, simulated boolean not null default false);
  create table device_events (id uuid primary key default gen_random_uuid(), device_id uuid not null references devices(id), org_id uuid not null,
    occurred_at timestamptz not null default now(), event_type text not null constraint device_events_event_type_check check (event_type in ('sos')),
    severity text not null default 'warning', latitude numeric, longitude numeric, speed_kmph numeric, video_url text, raw jsonb,
    acknowledged_at timestamptz, acknowledged_by uuid, simulated boolean not null default false, created_at timestamptz default now());
  create table vehicle_signals (path text primary key, datatype text, unit text, min_value numeric, max_value numeric, source_col text, is_ai boolean, description text);
  insert into vehicle_signals(path, datatype, description) values ('Vehicle.Cargo.Temperature','float','cargo');
  create table ai_events (id uuid primary key default gen_random_uuid(), org_id uuid not null, device_id uuid, vehicle_id uuid, occurred_at timestamptz not null default now(),
    event_type text not null, signal_path text references vehicle_signals(path), severity text not null default 'warning', confidence numeric, summary text not null,
    evidence jsonb not null default '{}', acknowledged_at timestamptz, acknowledged_by uuid, model text not null default 'rules-v1', simulated boolean not null default false,
    created_at timestamptz default now());
  create table driver_locations (id bigserial primary key, org_id uuid, driver_id uuid, vehicle_id uuid, latitude numeric, longitude numeric, speed_kmph numeric, recorded_at timestamptz, created_at timestamptz default now());
  create table geofences (id uuid primary key default gen_random_uuid(), org_id uuid, name text, purpose text, centre_lat numeric, centre_lng numeric, radius_m numeric,
    alert_on text default 'both', site_id uuid, is_active boolean default true, created_at timestamptz default now(), updated_at timestamptz default now());
  create table geofence_events (id uuid primary key default gen_random_uuid(), org_id uuid, geofence_id uuid, vehicle_id uuid, asset_id uuid, driver_id uuid,
    direction text check (direction in ('enter','exit')), occurred_at timestamptz, latitude numeric, longitude numeric, dwell_seconds integer, created_at timestamptz default now());
  create table cold_chain_config (id uuid primary key default gen_random_uuid(), org_id uuid, product_type text, min_temperature_celsius numeric, max_temperature_celsius numeric,
    ideal_temperature_celsius numeric, warning_deviation_celsius numeric, critical_deviation_celsius numeric, alert_sms_enabled boolean);
  create table cold_chain_vehicles (id uuid primary key default gen_random_uuid(), org_id uuid, vehicle_id uuid, sensor_id text, sensor_type text, compartments integer,
    product_type text, min_temp numeric, max_temp numeric, is_active boolean default true, last_reading_at timestamptz, current_temperature_celsius numeric,
    created_at timestamptz default now(), updated_at timestamptz default now());
  create table cold_chain_compliance (id uuid primary key default gen_random_uuid(), org_id uuid, vehicle_id uuid, compliance_date date, trip_date date, total_readings integer,
    readings_in_range integer, compliance_pct numeric, violation_count integer, critical_violations integer, fssai_compliant boolean, cold_chain_intact boolean,
    temperature_log_available boolean, status text, notes text, created_at timestamptz default now());
  create table rbac_table_registry (table_name text primary key, mode text, resource text, vehicle_col text, org_col text, notes text);
  create function rbac_apply(p text) returns void language sql as $$ select null::void $$;
`);

for (const f of ["20260928105000_device_integration.sql", "20260928110000_fleetsafe_backend.sql"]) {
  try { await db.exec(readFileSync(join(MIG, f), "utf8")); ok(`migration ${f} applies`); }
  catch (e) { failures++; console.log(`  ✗ migration ${f}: ${e.message}`); }
}
// idempotent: a re-run must not fail
try { await db.exec(readFileSync(join(MIG, "20260928110000_fleetsafe_backend.sql"), "utf8")); ok("fleetsafe_backend can be re-applied"); }
catch (e) { failures++; console.log("  ✗ re-apply: " + e.message); }

const org = (await one(`insert into organizations(name) values ('SR Transports') returning id`)).id;
const veh = (await one(`insert into vehicles(org_id, ext_id, name, tank_capacity) values ($1,'v1','TN-01-AB-1234',400) returning id`, [org])).id;
const dev = (await one(`insert into devices(org_id, vehicle_id, imei, protocol, kind) values ($1,$2,'862095050000001','jt808','mdvr') returning id`, [org, veh])).id;
const fence = (await one(`insert into geofences(org_id, name, purpose, centre_lat, centre_lng, radius_m, alert_on) values ($1,'Port yard','restricted',11.0,78.0,500,'both') returning id`, [org])).id;
const at = (min) => new Date(Date.UTC(2026, 8, 28, 4, min)).toISOString();
const reading = (min, lat, lng, extra = {}) => db.query(
  `insert into telemetry(device_id, org_id, recorded_at, latitude, longitude, speed_kmph, cargo_temp_c) values ($1,$2,$3,$4,$5,$6,$7)`,
  [dev, org, at(min), lat, lng, extra.speed ?? 40, extra.temp ?? null]);

console.log("\ngeofences");
await reading(0, 11.02, 78.0);                     // ~2.2 km away: outside
check(await count(`select count(*) n from geofence_events`) === 0, "first sight outside a fence records nothing");
await reading(5, 11.001, 78.0);                    // ~110 m: inside
check(await count(`select count(*) n from geofence_events where direction='enter'`) === 1, "entering records an enter event");
const a1 = await one(`select * from fleet_alerts where kind='geofence'`);
check(a1 && a1.severity === "critical" && /entered Port yard/.test(a1.title), "entering a restricted zone raises a critical alert");
await reading(6, 11.0015, 78.0);
check(await count(`select count(*) n from geofence_events`) === 1, "staying inside records nothing more");
await reading(2, 11.03, 78.0);                     // late, older reading from outside
check(await count(`select count(*) n from geofence_events`) === 1, "a late, out-of-order reading does not flip the state");
await reading(25, 11.02, 78.0);
const ex = await one(`select * from geofence_events where direction='exit'`);
check(ex && ex.dwell_seconds === 1200, "leaving records an exit with the time spent inside (20 min)");
await db.query(`insert into driver_locations(org_id, vehicle_id, latitude, longitude, recorded_at) values ($1,$2,11.0,78.0,$3)`, [org, veh, at(40)]);
check(await count(`select count(*) n from geofence_events where direction='enter'`) === 2, "the driver app's positions drive the same geofence logic");

console.log("\ncold chain");
await db.query(`insert into cold_chain_vehicles(org_id, vehicle_id, sensor_id, product_type, min_temp, max_temp) values ($1,$2,'S1','vaccines',2,8)`, [org, veh]);
await reading(50, 11.5, 78.5, { temp: 5 });
check(await count(`select count(*) n from ai_events where event_type='cargo_temp_breach'`) === 0, "a temperature in range raises nothing");
check(Number((await one(`select current_temperature_celsius t from cold_chain_vehicles`)).t) === 5, "the reefer's live temperature is updated");
await reading(51, 11.5, 78.5, { temp: 12.5 });
const br = await one(`select * from ai_events where event_type='cargo_temp_breach'`);
check(br && br.severity === "critical" && Number(br.evidence.deviation_c) === 4.5, "4.5 °C over the limit is a critical breach with evidence");
await reading(55, 11.5, 78.5, { temp: 13 });
check(await count(`select count(*) n from ai_events where event_type='cargo_temp_breach'`) === 1, "a reefer that stays warm is one breach per 30 minutes, not one per reading");
check(await count(`select count(*) n from fleet_alerts where kind='cold_chain'`) === 1, "the breach reaches the alert inbox as a cold-chain alert");
await db.query(`select fs_cold_chain_daily($1::date)`, ["2026-09-28"]);
const cc = await one(`select * from cold_chain_compliance`);
check(cc && cc.total_readings === 3 && cc.readings_in_range === 1 && cc.status === "violation" && cc.fssai_compliant === false,
  "the nightly job writes the day's compliance record (3 readings, 1 in range, violation)");

console.log("\nalerts and delivery");
await db.query(`alter table device_events drop constraint device_events_event_type_check`);
await db.query(`insert into device_events(device_id, org_id, event_type, severity, speed_kmph) values ($1,$2,'fatigue','critical',58)`, [dev, org]);
let al = await one(`select * from fleet_alerts where source='device_events' order by created_at desc limit 1`);
check(al && al.title === "Driver drowsiness: TN-01-AB-1234" && al.delivery === "in_app", "a camera incident lands in the inbox; SMS off means in-app only");
await db.query(`insert into fleetsafe_settings(org_id, notify_sms, alert_phones) values ($1, true, array['9840012345'])`, [org]);
await db.query(`insert into device_events(device_id, org_id, event_type, severity) values ($1,$2,'forward_collision','critical')`, [dev, org]);
al = await one(`select * from fleet_alerts where title like 'Forward collision%'`);
check(al && al.delivery === "pending", "with SMS on, a critical incident is queued for the dispatcher");
await db.query(`insert into device_events(device_id, org_id, event_type, severity) values ($1,$2,'lane_departure','warning')`, [dev, org]);
al = await one(`select * from fleet_alerts where title like 'Lane departure%'`);
check(al && al.delivery === "in_app", "warnings stay in-app unless the fleet asked for warning SMS too");
await db.query(`insert into device_events(device_id, org_id, event_type, severity, simulated) values ($1,$2,'sos','critical',true)`, [dev, org]);
al = await one(`select * from fleet_alerts where title like 'SOS%'`);
check(al && al.delivery === "in_app" && al.simulated, "test incidents never go out by SMS");
await db.query(`insert into device_events(device_id, org_id, event_type, severity) values ($1,$2,'idling','info')`, [dev, org]);
check(await count(`select count(*) n from fleet_alerts where title like 'Engine idling%'`) === 0, "info-level events do not create alerts");

console.log("\ntracker health");
await db.query(`update devices set last_seen_at = now() - interval '2 hours' where id=$1`, [dev]);
await db.query(`select fs_device_health()`);
await db.query(`select fs_device_health()`);
check(await count(`select count(*) n from fleet_alerts where kind='device_offline'`) === 1, "a tracker silent for 2 h raises one offline alert, not one per run");
await db.query(`update devices set last_seen_at = now() where id=$1`, [dev]);
await db.query(`select fs_device_health()`);
check(await count(`select count(*) n from fleet_alerts where kind='device_back'`) === 1, "when it reports again, one back-online alert");
const sim = (await one(`insert into devices(org_id, vehicle_id, imei, simulated, last_seen_at) values ($1,$2,'SIM1',true, now() - interval '5 hours') returning id`, [org, veh])).id;
await db.query(`select fs_device_health()`);
check(await count(`select count(*) n from fleet_alerts where kind='device_offline'`) === 1, "stopping the simulator is not an incident");

console.log("\nretention");
await db.query(`insert into telemetry(device_id, org_id, recorded_at, simulated) values ($1,$2, now() - interval '10 days', true), ($1,$2, now() - interval '1 day', true)`, [sim, org]);
await db.query(`insert into telemetry(device_id, org_id, recorded_at) values ($1,$2, now() - interval '200 days')`, [dev, org]);
const r = (await one(`select fs_retention() r`)).r;
check(r.simulated_telemetry === 1 && r.telemetry >= 1, "old test data (7 d) and readings past the fleet's retention (180 d) are pruned");
check(await count(`select count(*) n from telemetry where device_id=$1`, [sim]) === 1, "recent test data is kept");

console.log(failures ? `\n${failures} check(s) failed` : "\nall FleetSafe backend checks passed");
process.exit(failures ? 1 : 0);
