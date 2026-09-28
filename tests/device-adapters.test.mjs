// Device payload adapters: FleetWorks JSON, flespi and Traccar all become the same
// canonical message; vendor event names map to FleetWorks event types; sensor
// mappings and tank calibration tables turn raw values into signals.
import test from "node:test";
import assert from "node:assert/strict";
import {
  adapt, applySensors, calibrate, deriveFuel, eventType, fromFlespi, fromFleetworks, fromTraccar,
  hasReading, severityFor, SIG, toTelemetryRow, validate,
} from "../supabase/functions/_shared/devices/adapters.ts";

test("FleetWorks JSON keeps the telemetry column contract", () => {
  const [m] = fromFleetworks({ imei: "862095050000001", readings: [{
    recorded_at: "2026-09-28T10:00:00Z", latitude: 11.2, longitude: 78.1, speed_kmph: 54, ignition: true,
    fuel_level_pct: 62, cargo_temp_c: 3.5, escort_lls_1: 2048,
  }] });
  assert.equal(m.ident, "862095050000001");
  assert.equal(m.signals[SIG.speed], 54);
  assert.equal(m.signals[SIG.ignition], true);
  assert.equal(m.signals[SIG.cargoTemp], 3.5);
  assert.equal(m.params.escort_lls_1, 2048, "unknown keys are kept for sensor mappings");
  const row = toTelemetryRow(m);
  assert.equal(row.fuel_level_pct, 62);
  assert.equal(row.recorded_at, "2026-09-28T10:00:00.000Z");
});

test("FleetWorks events travel even without readings, with media", () => {
  const msgs = fromFleetworks({ imei: "A1", events: [{ event_type: "FCW", occurred_at: "2026-09-28T10:01:00Z", speed_kmph: 64,
    media: [{ channel: 1, url: "https://cdn.vendor.example/clip.mp4" }, { url: "http://insecure/clip.mp4" }] }] });
  assert.equal(msgs.length, 1);
  const e = msgs[0].events[0];
  assert.equal(e.type, "forward_collision");
  assert.equal(e.severity, "critical");
  assert.equal(e.media.length, 1, "only https media is accepted");
  assert.equal(hasReading(msgs[0]), true, "the event's location still makes a reading");
});

test("flespi messages map dotted parameters and unix timestamps", () => {
  const msgs = fromFlespi([{ ident: "352093081234567", timestamp: 1790580000, "position.latitude": 11.66, "position.longitude": 78.15,
    "position.speed": 48, "position.valid": true, "engine.ignition.status": true, "can.fuel.level": 71, "vehicle.mileage": 184233.5,
    "escort.lls.value.1": 1830, "ble.sensor.temperature.1": -18.2 }]);
  const m = msgs[0];
  assert.equal(m.ident, "352093081234567");
  assert.equal(m.ts, new Date(1790580000 * 1000).toISOString());
  assert.equal(m.signals[SIG.speed], 48);
  assert.equal(m.signals[SIG.fuelPct], 71);
  assert.equal(m.signals[SIG.odometer], 184233.5);
  assert.equal(m.params["escort.lls.value.1"], 1830);
});

test("flespi: an invalid GPS fix never becomes a position", () => {
  const [m] = fromFlespi({ ident: "X", timestamp: 1790580000, "position.latitude": 0, "position.longitude": 0, "position.valid": false });
  assert.ok(!(SIG.lat in m.signals));
});

test("flespi ADAS/DMS alarms become events", () => {
  const [m] = fromFlespi([{ ident: "MDVR1", timestamp: 1790580000, "dms.event.type": "phone call" }]);
  assert.equal(m.events[0].type, "phone_use");
});

test("Traccar: knots, metres and milliseconds are converted", () => {
  const [m] = fromTraccar({
    device: { uniqueId: "123456789012345", name: "TN01" },
    position: { fixTime: "2026-09-28T10:00:00.000+00:00", latitude: 11.1, longitude: 77.3, speed: 30, course: 90, valid: true,
      attributes: { ignition: true, odometer: 1500000, hours: 7200000, fuel: 212, alarm: "hardBraking,sos", temp1: 4.2 } },
  });
  assert.equal(m.ident, "123456789012345");
  assert.equal(m.signals[SIG.speed], 55.6);            // 30 kn
  assert.equal(m.signals[SIG.odometer], 1500);         // m → km
  assert.equal(m.signals[SIG.engineHours], 2);         // ms → h
  assert.equal(m.signals[SIG.fuelLitres], 212);
  assert.equal(m.signals[SIG.cargoTemp], 4.2);
  assert.deepEqual(m.events.map((e) => e.type), ["harsh_brake", "sos"]);
});

test("adapt() dispatches by format", () => {
  assert.equal(adapt("flespi", [{ ident: "a", timestamp: 1 }])[0].ident, "a");
  assert.equal(adapt("traccar", { device: { uniqueId: "b" }, position: {} })[0].ident, "b");
  assert.equal(adapt("fleetworks", { imei: "c", readings: [{}] })[0].ident, "c");
});

test("vendor event names map to FleetWorks types", () => {
  for (const [raw, want] of [["LDW", "lane_departure"], ["HMW", "headway_warning"], ["fatigueDriving", "fatigue"], ["powerCut", "power_cut"],
    ["Camera Blocked", "camera_blocked"], ["no_driver", "driver_absent"], ["overspeed", "overspeed"], ["door", "cargo_door_open"]]) {
    assert.equal(eventType(raw), want, raw);
  }
  assert.equal(eventType("geofenceEnter"), null, "non-safety events are not invented");
  assert.equal(severityFor("fatigue"), "critical");
  assert.equal(severityFor("idling"), "info");
  assert.equal(severityFor("lane_departure", "high"), "critical");
});

test("tank calibration table interpolates and clamps", () => {
  const table = [[0, 0], [1000, 100], [2000, 220], [4095, 450]];
  assert.equal(calibrate(500, table), 50);
  assert.equal(calibrate(1500, table), 160);
  assert.equal(calibrate(-5, table), 0);
  assert.equal(calibrate(9999, table), 450);
  assert.equal(calibrate(10, []), null);
});

test("sensor mappings: table, linear and passthrough", () => {
  const base = fromFlespi([{ ident: "T", timestamp: 1790580000, "escort.lls.value.1": 1500, "io.72": 215, "ibutton.code": "01AB" }])[0];
  const m = applySensors(base, [
    { source_key: "escort.lls.value.1", signal_path: SIG.fuelLitres, transform: "table", calibration: [[0, 0], [1000, 100], [2000, 220]] },
    { source_key: "io.72", signal_path: SIG.cargoTemp, transform: "linear", scale: 0.1, offset: -20 },
    { source_key: "missing", signal_path: SIG.rpm, transform: "none" },
  ]);
  assert.equal(m.signals[SIG.fuelLitres], 160);
  assert.equal(m.signals[SIG.cargoTemp], 1.5);
  assert.ok(!(SIG.rpm in m.signals));
  assert.equal(m.signals[SIG.driverId], "01AB");
});

test("fuel litres and percent derive from each other with the tank size", () => {
  assert.equal(deriveFuel({ [SIG.fuelLitres]: 150 }, 300)[SIG.fuelPct], 50);
  assert.equal(deriveFuel({ [SIG.fuelPct]: 25 }, 400)[SIG.fuelLitres], 100);
  assert.ok(!(SIG.fuelPct in deriveFuel({ [SIG.fuelLitres]: 150 }, null)), "no tank size, no guess");
});

test("range checks catch impossible values", () => {
  const [m] = fromFleetworks({ imei: "V", readings: [{ latitude: 95, longitude: 10 }] });
  assert.match(validate(m), /latitude/);
  const [ok] = fromFleetworks({ imei: "V", readings: [{ latitude: 11, longitude: 78, speed_kmph: 60 }] });
  assert.equal(validate(ok), null);
});
