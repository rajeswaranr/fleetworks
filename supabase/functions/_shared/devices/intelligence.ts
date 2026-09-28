// FleetWorks vehicle intelligence: pure functions (no I/O) so they run the same in the
// edge function and in the unit tests.
//
//   toSignals(reading)            telemetry reading -> canonical signal values (VSS paths)
//   detect(prev, cur, recent)     consecutive readings -> AI events with a confidence
//   healthScores(state, events)   0-100 scores the digital twin shows
//
// The rules are deliberately simple and explainable ("rules-v1"). Every event carries
// the evidence it was based on, so an owner can see why it fired, and a learned model
// can later replace a rule without changing anything downstream.

export type Reading = Record<string, unknown>;

export interface AiEvent {
  event_type: string;
  signal_path: string;
  severity: "info" | "warning" | "critical";
  confidence: number;
  summary: string;
  evidence: Record<string, unknown>;
  occurred_at: string;
}

// telemetry column -> canonical signal path (mirrors the vehicle_signals catalogue)
export const SIGNAL_PATHS: Record<string, string> = {
  latitude: "Vehicle.CurrentLocation.Latitude",
  longitude: "Vehicle.CurrentLocation.Longitude",
  speed_kmph: "Vehicle.Speed",
  heading: "Vehicle.CurrentLocation.Heading",
  ignition: "Vehicle.Powertrain.CombustionEngine.IsRunning",
  engine_rpm: "Vehicle.Powertrain.CombustionEngine.Speed",
  coolant_temp_c: "Vehicle.Powertrain.CombustionEngine.ECT",
  engine_hours: "Vehicle.Powertrain.CombustionEngine.EngineHours",
  fuel_level_pct: "Vehicle.Powertrain.FuelSystem.RelativeLevel",
  fuel_rate_lph: "Vehicle.Powertrain.FuelSystem.InstantConsumption",
  odometer_km: "Vehicle.TravelledDistance",
  battery_voltage: "Vehicle.LowVoltageBattery.CurrentVoltage",
  tyre_pressure_min_psi: "Vehicle.Chassis.Tyre.MinPressure",
  ambient_temp_c: "Vehicle.Cabin.HVAC.AmbientAirTemperature",
  cargo_temp_c: "Vehicle.Cargo.Temperature",
};

export const AI = {
  fuelTheft: "Vehicle.AI.Fuel.FuelTheftProbability",
  puncture: "Vehicle.AI.Tyre.PunctureProbability",
  engine: "Vehicle.AI.Maintenance.EngineFailureProbability",
  harsh: "Vehicle.AI.Safety.Driver.HarshEventRisk",
};

// Heavy commercial vehicle tyres run ~100-120 psi cold.
export const TYRE = { low: 85, critical: 70, dropPsi: 4, dropWindowMin: 30 };
export const ENGINE = { warm: 105, hot: 112 };
export const BATTERY = { low: 11.8, critical: 11.0 };
// normal burn is ~0.2 %/min; a leak while driving is a fall of at least 3% at 1 %/min or faster
export const FUEL = { theftDropPct: 8, leakMinDropPct: 3, leakRatePctPerMin: 1, leakWindowMin: 10 };
export const SUPPRESS_MIN = 15;     // same event type for the same device at most once per 15 minutes

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const round2 = (v: number) => Math.round(v * 100) / 100;
const minutesBetween = (a: unknown, b: unknown) => {
  const ta = Date.parse(String(a)), tb = Date.parse(String(b));
  return Number.isNaN(ta) || Number.isNaN(tb) ? null : Math.abs(tb - ta) / 60000;
};

export function toSignals(reading: Reading): Record<string, { v: unknown; ts: string }> {
  const ts = reading.recorded_at ? String(reading.recorded_at) : new Date().toISOString();
  const out: Record<string, { v: unknown; ts: string }> = {};
  for (const [col, path] of Object.entries(SIGNAL_PATHS)) {
    const raw = reading[col];
    if (raw === null || raw === undefined || raw === "") continue;
    out[path] = { v: col === "ignition" ? Boolean(raw) : num(raw), ts };
  }
  return out;
}

/** recent: event_type -> timestamp (ms) of the last emitted event of that type for this device. */
export function detect(prev: Reading | null, cur: Reading, recent: Record<string, number> = {}): AiEvent[] {
  const events: AiEvent[] = [];
  const at = cur.recorded_at ? String(cur.recorded_at) : new Date().toISOString();
  const nowMs = Date.parse(at);
  const push = (e: Omit<AiEvent, "occurred_at">) => {
    const last = recent[e.event_type];
    if (last !== undefined && !Number.isNaN(nowMs) && nowMs - last < SUPPRESS_MIN * 60000) return;
    recent[e.event_type] = Number.isNaN(nowMs) ? Date.now() : nowMs;
    events.push({ ...e, occurred_at: at });
  };

  const speed = num(cur.speed_kmph) ?? 0;
  const ignition = cur.ignition === undefined || cur.ignition === null ? null : Boolean(cur.ignition);
  const stationary = ignition === false || speed < 3;

  // ── fuel: theft when parked, leak when moving ──
  const fuel = num(cur.fuel_level_pct), priorFuel = prev ? num(prev.fuel_level_pct) : null;
  if (fuel !== null && priorFuel !== null && prev) {
    const drop = priorFuel - fuel;
    const gap = minutesBetween(prev.recorded_at, cur.recorded_at);
    if (drop >= FUEL.theftDropPct && stationary) {
      // bigger drop, stationary, short gap -> more likely theft
      const p = clamp(0.5 + drop / 40 + (ignition === false ? 0.15 : 0) - (gap !== null && gap > 120 ? 0.2 : 0), 0, 0.98);
      push({
        event_type: "fuel_theft", signal_path: AI.fuelTheft, confidence: round2(p),
        severity: p >= 0.75 ? "critical" : "warning",
        summary: `Fuel fell ${drop.toFixed(1)}% while the vehicle was stationary.`,
        evidence: { from_pct: priorFuel, to_pct: fuel, drop_pct: +drop.toFixed(1), minutes: gap !== null ? Math.round(gap) : null, ignition, speed_kmph: speed },
      });
    } else if (!stationary && gap !== null && gap > 0 && gap <= FUEL.leakWindowMin && drop >= FUEL.leakMinDropPct && drop / gap >= FUEL.leakRatePctPerMin) {
      push({
        event_type: "fuel_leak", signal_path: AI.fuelTheft, confidence: round2(clamp(0.4 + drop / 20 + (drop / gap) / 10, 0, 0.9)),
        severity: "warning",
        summary: `Fuel fell ${drop.toFixed(1)}% in ${Math.round(gap)} minutes while driving. Check for a leak.`,
        evidence: { from_pct: priorFuel, to_pct: fuel, drop_pct: +drop.toFixed(1), minutes: Math.round(gap), speed_kmph: speed },
      });
    }
  }

  // ── tyres: rapid loss (puncture) and low pressure ──
  const psi = num(cur.tyre_pressure_min_psi), priorPsi = prev ? num(prev.tyre_pressure_min_psi) : null;
  if (psi !== null) {
    const gap = prev ? minutesBetween(prev.recorded_at, cur.recorded_at) : null;
    const lost = priorPsi !== null ? priorPsi - psi : 0;
    if (priorPsi !== null && lost >= TYRE.dropPsi && gap !== null && gap <= TYRE.dropWindowMin) {
      const p = clamp(0.4 + lost / 15, 0, 0.97);
      push({
        event_type: "tyre_pressure_loss", signal_path: AI.puncture, confidence: round2(p),
        severity: p >= 0.7 || psi < TYRE.critical ? "critical" : "warning",
        summary: `Tyre pressure fell ${lost.toFixed(1)} psi in ${Math.round(gap)} minutes (now ${psi.toFixed(0)} psi): likely puncture or slow leak.`,
        evidence: { from_psi: priorPsi, to_psi: psi, lost_psi: +lost.toFixed(1), minutes: Math.round(gap) },
      });
    } else if (psi < TYRE.low) {
      push({
        event_type: "tyre_low_pressure", signal_path: AI.puncture,
        confidence: round2(clamp(0.5 + (TYRE.low - psi) / 40, 0, 0.9)),
        severity: psi < TYRE.critical ? "critical" : "warning",
        summary: `Lowest tyre pressure is ${psi.toFixed(0)} psi (recommended 100+).`,
        evidence: { psi, low_threshold: TYRE.low, critical_threshold: TYRE.critical },
      });
    }
  }

  // ── engine temperature ──
  const ect = num(cur.coolant_temp_c);
  if (ect !== null && ect >= ENGINE.warm) {
    push({
      event_type: "engine_overheat", signal_path: AI.engine,
      confidence: round2(clamp((ect - 95) / 25, 0, 0.99)),
      severity: ect >= ENGINE.hot ? "critical" : "warning",
      summary: `Coolant temperature is ${ect.toFixed(0)} °C.`,
      evidence: { coolant_temp_c: ect, warn_at: ENGINE.warm, critical_at: ENGINE.hot },
    });
  }

  // ── battery ──
  const volts = num(cur.battery_voltage);
  if (volts !== null && volts < BATTERY.low && ignition !== false) {
    push({
      event_type: "low_battery", signal_path: AI.engine,
      confidence: round2(clamp(0.5 + (BATTERY.low - volts) / 3, 0, 0.95)),
      severity: volts < BATTERY.critical ? "critical" : "warning",
      summary: `Battery voltage is ${volts.toFixed(1)} V.`,
      evidence: { battery_voltage: volts },
    });
  }
  return events;
}

/** 0-100 health scores (100 = healthy) from the latest state and this batch's events. */
export function healthScores(state: Record<string, { v: unknown }>, events: AiEvent[]) {
  const val = (p: string) => num(state[p]?.v);
  const worst = (path: string) => Math.max(0, ...events.filter((e) => e.signal_path === path).map((e) => e.confidence));
  const psi = val(SIGNAL_PATHS.tyre_pressure_min_psi);
  const ect = val(SIGNAL_PATHS.coolant_temp_c);
  return {
    fuel: Math.round(100 - worst(AI.fuelTheft) * 60),
    tyres: Math.round(clamp((psi === null ? 100 : clamp((psi - 60) / 40, 0, 1) * 100) - worst(AI.puncture) * 30, 0, 100)),
    engine: Math.round(clamp(100 - Math.max(0, (ect ?? 90) - 95) * 3 - worst(AI.engine) * 30, 0, 100)),
    driver: Math.round(100 - worst(AI.harsh) * 100),
  };
}
