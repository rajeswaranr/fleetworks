#!/usr/bin/env node
// FleetWorks device simulator: drives virtual trucks through the same public ingest
// endpoint a real telematics gateway will use, so the twin, alerts and rules are
// exercised end to end before any hardware exists. Nothing here touches the database
// directly: it is just an HTTP client with the ingest key.
//
//   TELEMETRY_INGEST_KEY=<key> node tools/device-simulator.mjs --imei SIM0001,SIM0002 --scenario all
//
// Options
//   --imei a,b,c         IMEIs of devices already registered as simulated (required)
//   --scenario NAME      normal | fuel-theft | puncture | overheat | leak | all  (default all:
//                        each device gets a different problem, the first stays healthy)
//   --ticks N            readings per device (default 30)
//   --step-min N         simulated minutes between readings (default 2)
//   --url URL            ingest endpoint (default: the FleetWorks project)
//
// The key is read from the environment and never printed or stored.

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith("--")) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : "true"]);
  return acc;
}, []));

const KEY = process.env.TELEMETRY_INGEST_KEY || "";
const URL_ = args.url || "https://crdblxeufbhysglbbtxi.supabase.co/functions/v1/telemetry-ingest";
const IMEIS = String(args.imei || "").split(",").map((s) => s.trim()).filter(Boolean);
const TICKS = +args.ticks || 30, STEP = +args["step-min"] || 2;
const SCENARIO = args.scenario || "all";
if (!KEY) { console.error("Set TELEMETRY_INGEST_KEY in the environment."); process.exit(1); }
if (!IMEIS.length) { console.error("Pass --imei SIM0001,SIM0002 (devices must already be registered as simulated)."); process.exit(1); }

const SCENARIOS = ["normal", "fuel-theft", "puncture", "overheat", "leak"];
const scenarioFor = (i) => SCENARIO === "all" ? SCENARIOS[i % SCENARIOS.length] : SCENARIO;

// A loop around Coimbatore, so the twin has a believable track.
const ROUTE = [[11.0168, 76.9558], [11.03, 76.98], [11.05, 77.01], [11.07, 77.03], [11.05, 77.05], [11.02, 77.03], [11.0, 77.0]];

function reading(i, tick, t0, sc) {
  const at = new Date(t0 + tick * STEP * 60000);
  const seg = Math.floor((tick / TICKS) * (ROUTE.length - 1)), f = ((tick / TICKS) * (ROUTE.length - 1)) % 1;
  const a = ROUTE[seg], b = ROUTE[Math.min(seg + 1, ROUTE.length - 1)];
  let r = {
    recorded_at: at.toISOString(),
    latitude: +(a[0] + (b[0] - a[0]) * f).toFixed(5), longitude: +(a[1] + (b[1] - a[1]) * f).toFixed(5),
    speed_kmph: 55 + ((tick * 7 + i * 5) % 20), heading: 90, ignition: true,
    engine_rpm: 1500 + ((tick * 37) % 400), coolant_temp_c: 88 + ((tick + i) % 4),
    battery_voltage: 13.6, fuel_level_pct: +(80 - tick * 0.35).toFixed(1), fuel_rate_lph: 22,
    odometer_km: 120000 + tick * 1.8, tyre_pressure_min_psi: 104 - ((tick + i) % 3) * 0.5, ambient_temp_c: 31,
  };
  const half = Math.floor(TICKS / 2);
  if (sc === "fuel-theft" && tick >= half) {                        // parked, then 25% of the tank disappears
    r = { ...r, ignition: false, speed_kmph: 0, engine_rpm: 0, fuel_level_pct: tick === half ? 44 : 44 - (tick - half) * 0.05 };
  }
  if (sc === "leak" && tick >= half) r.fuel_level_pct = +(80 - half * 0.35 - (tick - half) * 4).toFixed(1);   // fast fall while moving
  if (sc === "puncture" && tick >= half) r.tyre_pressure_min_psi = +(104 - (tick - half) * 5).toFixed(1);
  if (sc === "overheat" && tick >= half) r.coolant_temp_c = 96 + (tick - half) * 3;
  return r;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function post(imei, readings) {
  const res = await fetch(URL_, {
    method: "POST", headers: { "content-type": "application/json", "x-ingest-key": KEY },
    body: JSON.stringify({ imei, readings }),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

const t0 = Date.now() - TICKS * STEP * 60000;
let failed = 0;
for (const [i, imei] of IMEIS.entries()) {
  const sc = scenarioFor(i);
  const batch = Array.from({ length: TICKS }, (_, tick) => reading(i, tick, t0, sc));
  // send in chunks of 5 readings, the way a gateway batches while a signal is weak
  let events = 0, ai = 0;
  for (let k = 0; k < batch.length; k += 5) {
    const { status, body } = await post(imei, batch.slice(k, k + 5));
    if (status !== 200) { console.error(`${imei}: HTTP ${status} ${JSON.stringify(body)}`); failed++; break; }
    events += body.derivedEvents || 0; ai += body.aiEvents || 0;
    await sleep(150);
  }
  console.log(`${imei}  scenario=${sc.padEnd(10)}  readings=${TICKS}  aiEvents=${ai}`);
}
process.exit(failed ? 1 : 0);
