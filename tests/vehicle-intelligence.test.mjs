// Rules behind the vehicle digital twin: signal mapping, fuel theft / leak, tyre loss,
// engine temperature, battery, de-duplication and the health scores.
import test from "node:test";
import assert from "node:assert/strict";
import { toSignals, detect, healthScores, AI, SIGNAL_PATHS } from "../supabase/functions/telemetry-ingest/intelligence.ts";

const t = (min) => new Date(Date.UTC(2026, 8, 23, 10, min)).toISOString();
const r = (min, o = {}) => ({ recorded_at: t(min), ignition: true, speed_kmph: 60, fuel_level_pct: 70, tyre_pressure_min_psi: 105, coolant_temp_c: 88, battery_voltage: 13.6, ...o });

test("readings map to canonical VSS signal paths", () => {
  const s = toSignals(r(0, { latitude: 11.0, longitude: 77.0 }));
  assert.equal(s["Vehicle.Speed"].v, 60);
  assert.equal(s["Vehicle.Powertrain.FuelSystem.RelativeLevel"].v, 70);
  assert.equal(s["Vehicle.Powertrain.CombustionEngine.IsRunning"].v, true);
  assert.equal(s["Vehicle.CurrentLocation.Latitude"].v, 11);
  assert.ok(!("Vehicle.Cargo.Temperature" in s), "missing values are not invented");
});

test("every telemetry column maps to a path under Vehicle.", () => {
  for (const path of Object.values(SIGNAL_PATHS)) assert.match(path, /^Vehicle\./);
});

test("healthy consecutive readings raise nothing", () => {
  assert.deepEqual(detect(r(0), r(5, { fuel_level_pct: 69.5 })), []);
});

test("fuel dropping while parked is theft, with confidence and evidence", () => {
  const ev = detect(r(0, { ignition: false, speed_kmph: 0 }), r(10, { ignition: false, speed_kmph: 0, fuel_level_pct: 50 }));
  assert.equal(ev.length, 1);
  assert.equal(ev[0].event_type, "fuel_theft");
  assert.equal(ev[0].severity, "critical");
  assert.ok(ev[0].confidence >= 0.75 && ev[0].confidence <= 0.98);
  assert.equal(ev[0].evidence.drop_pct, 20);
  assert.equal(ev[0].signal_path, AI.fuelTheft);
});

test("a small drop while parked is not theft", () => {
  assert.deepEqual(detect(r(0, { ignition: false, speed_kmph: 0 }), r(10, { ignition: false, speed_kmph: 0, fuel_level_pct: 66 })), []);
});

test("a fast fuel fall while driving is a leak, not theft", () => {
  const ev = detect(r(0), r(6, { fuel_level_pct: 55 }));
  assert.equal(ev[0].event_type, "fuel_leak");
});

test("normal fuel burn while driving is not a leak", () => {
  assert.deepEqual(detect(r(0), r(2, { fuel_level_pct: 69.65 })), []);
  assert.equal(detect(r(0), r(2, { fuel_level_pct: 65 }))[0].event_type, "fuel_leak");
});

test("rapid tyre pressure loss is a puncture, low pressure is a warning", () => {
  const loss = detect(r(0), r(10, { tyre_pressure_min_psi: 88 }));
  assert.equal(loss[0].event_type, "tyre_pressure_loss");
  assert.ok(loss[0].confidence > 0.6);
  const low = detect(r(0, { tyre_pressure_min_psi: 84 }), r(60, { tyre_pressure_min_psi: 83 }));
  assert.equal(low[0].event_type, "tyre_low_pressure");
  assert.equal(low[0].severity, "warning");
  const crit = detect(null, r(0, { tyre_pressure_min_psi: 60 }));
  assert.equal(crit[0].severity, "critical");
});

test("engine overheating and low battery", () => {
  assert.equal(detect(null, r(0, { coolant_temp_c: 108 }))[0].severity, "warning");
  const hot = detect(null, r(0, { coolant_temp_c: 118 }));
  assert.equal(hot[0].severity, "critical");
  assert.equal(detect(null, r(0, { battery_voltage: 10.5 }))[0].event_type, "low_battery");
  assert.deepEqual(detect(null, r(0, { battery_voltage: 10.5, ignition: false })), [], "parked with ignition off is normal");
});

test("the same event is suppressed for 15 minutes, then allowed again", () => {
  const recent = {};
  assert.equal(detect(null, r(0, { coolant_temp_c: 110 }), recent).length, 1);
  assert.equal(detect(null, r(5, { coolant_temp_c: 111 }), recent).length, 0);
  assert.equal(detect(null, r(20, { coolant_temp_c: 111 }), recent).length, 1);
});

test("health scores drop with problems and stay 0-100", () => {
  const good = healthScores(toSignals(r(0)), []);
  assert.deepEqual(good, { fuel: 100, tyres: 100, engine: 100, driver: 100 });
  const bad = { ...toSignals(r(0, { tyre_pressure_min_psi: 62, coolant_temp_c: 118 })) };
  const events = detect(null, r(0, { tyre_pressure_min_psi: 62, coolant_temp_c: 118 }));
  const h = healthScores(bad, events);
  for (const v of Object.values(h)) assert.ok(v >= 0 && v <= 100);
  assert.ok(h.tyres < 50 && h.engine < 60);
});
