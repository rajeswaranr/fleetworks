// Device payload adapters: every supported wire format → one canonical message.
//
// Pure functions, no I/O, so the edge functions and the unit tests run the same code.
//
// Why adapters and not "a device protocol": trackers and cameras speak binary TCP
// protocols (Teltonika Codec 8/8E, Concox GT06, JT/T 808 + JT/T 1078, AIS-140, ...).
// Supabase edge functions only accept HTTPS, so those devices reach FleetWorks through
// a protocol gateway that decodes them and forwards JSON: flespi (hosted, 700+
// protocols) or Traccar (open source, 200+). Devices and vendor clouds that can POST
// JSON themselves use the FleetWorks format directly. Supporting a new gateway means
// adding one adapter here; nothing downstream changes.
//
// The canonical message keeps every parameter the device sent (params), under the
// name the device used, so per-device sensor mappings (device_sensors) can pick up any
// sensor a tracker carries (fuel level sensors, temperature probes, door switches)
// without code changes. Well-known parameters are also mapped to canonical VSS signals
// (signals) here.

export type Scalar = number | string | boolean;

export interface MediaRef {
  channel?: number | string;      // camera channel number or role
  kind?: "clip" | "snapshot";
  url: string;                    // https URL the gateway or camera serves the file at
  mime?: string;
}

export interface CanonicalEvent {
  type: string;                   // FleetWorks event type (see EVENT_ALIASES)
  raw_type: string;               // what the device called it
  severity: "info" | "warning" | "critical";
  ts: string;
  params: Record<string, Scalar>;
  media: MediaRef[];
}

export interface CanonicalMessage {
  ident: string;                  // IMEI / serial / gateway device ident
  ts: string;                     // ISO-8601, device time
  signals: Record<string, Scalar>;  // canonical VSS path → value
  params: Record<string, Scalar>;   // everything the device sent, flat, original names
  events: CanonicalEvent[];
  media: MediaRef[];              // media not tied to an event (e.g. periodic snapshots)
}

export type Format = "fleetworks" | "flespi" | "traccar" | "mqtt";
export const FORMATS: Format[] = ["fleetworks", "flespi", "traccar", "mqtt"];

// ── canonical signal paths (COVESA VSS, FleetWorks extensions where VSS has none) ──
export const SIG = {
  lat: "Vehicle.CurrentLocation.Latitude",
  lng: "Vehicle.CurrentLocation.Longitude",
  heading: "Vehicle.CurrentLocation.Heading",
  altitude: "Vehicle.CurrentLocation.Altitude",
  speed: "Vehicle.Speed",
  ignition: "Vehicle.Powertrain.CombustionEngine.IsRunning",
  rpm: "Vehicle.Powertrain.CombustionEngine.Speed",
  coolant: "Vehicle.Powertrain.CombustionEngine.ECT",
  engineHours: "Vehicle.Powertrain.CombustionEngine.EngineHours",
  fuelPct: "Vehicle.Powertrain.FuelSystem.RelativeLevel",
  fuelLitres: "Vehicle.Powertrain.FuelSystem.AbsoluteLevel",
  fuelRate: "Vehicle.Powertrain.FuelSystem.InstantConsumption",
  odometer: "Vehicle.TravelledDistance",
  battery: "Vehicle.LowVoltageBattery.CurrentVoltage",
  tyreMin: "Vehicle.Chassis.Tyre.MinPressure",
  ambient: "Vehicle.Cabin.HVAC.AmbientAirTemperature",
  cargoTemp: "Vehicle.Cargo.Temperature",
  cargoDoor: "Vehicle.Cargo.Door.IsOpen",
  driverId: "Vehicle.Driver.Identifier.Subject",
} as const;

// ── event vocabulary ────────────────────────────────────────────────────────
// FleetWorks event types, and the names devices and gateways use for them: Traccar
// alarm names, JT/T 808 / JT/T 1078 ADAS + DMS alarm names as gateways usually spell
// them, and the short codes AI dashcam vendors use (FCW, LDW, HMW...).
export const EVENT_TYPES = [
  "lane_departure", "forward_collision", "headway_warning", "pedestrian_warning", "collision",
  "fatigue", "distraction", "phone_use", "no_seatbelt", "smoking", "yawning", "driver_absent",
  "camera_blocked", "camera_fault", "harsh_brake", "harsh_accel", "harsh_corner", "overspeed",
  "fuel_drop", "tamper", "power_cut", "sos", "panic", "cargo_door_open", "idling",
] as const;

const ALIAS: Record<string, string> = {
  // traccar alarm attribute values
  sos: "sos", overspeed: "overspeed", powercut: "power_cut", lowpower: "power_cut", fatiguedriving: "fatigue",
  tampering: "tamper", hardbraking: "harsh_brake", hardacceleration: "harsh_accel", hardcornering: "harsh_corner",
  lanechange: "lane_departure", fuelleak: "fuel_drop", accident: "collision", door: "cargo_door_open", idle: "idling",
  gpsantennacut: "tamper", jamming: "tamper", removing: "tamper", vibration: "collision",
  // ADAS
  fcw: "forward_collision", forwardcollision: "forward_collision", forward_collision_warning: "forward_collision",
  ldw: "lane_departure", lanedeparture: "lane_departure", lane_departure_warning: "lane_departure",
  hmw: "headway_warning", headway: "headway_warning", headwaymonitoring: "headway_warning", distancetooclose: "headway_warning",
  pcw: "pedestrian_warning", pedestriancollision: "pedestrian_warning", pedestrian: "pedestrian_warning",
  // DMS
  fatigue: "fatigue", drowsiness: "fatigue", eyesclosed: "fatigue", eyeclose: "fatigue",
  phone: "phone_use", phonecall: "phone_use", calling: "phone_use", phone_call: "phone_use",
  smoking: "smoking", smoke: "smoking", distraction: "distraction", distracted: "distraction", lookaround: "distraction",
  yawn: "yawning", yawning: "yawning", nodriver: "driver_absent", driverabsent: "driver_absent", driver_abnormal: "driver_absent",
  nobelt: "no_seatbelt", noseatbelt: "no_seatbelt", seatbelt: "no_seatbelt",
  cameracover: "camera_blocked", camerablocked: "camera_blocked", infraredblocking: "camera_blocked", lensblocked: "camera_blocked",
  camerafault: "camera_fault", videolost: "camera_fault", videoloss: "camera_fault",
  // driving behaviour
  harshbrake: "harsh_brake", harsh_braking: "harsh_brake", rapiddeceleration: "harsh_brake",
  harshaccel: "harsh_accel", rapidacceleration: "harsh_accel", sharpturn: "harsh_corner", harshturn: "harsh_corner",
  collision: "collision", crash: "collision", rollover: "collision",
  panic: "panic", emergency: "sos", fuel_theft: "fuel_drop", fueldrop: "fuel_drop", fuel_drop: "fuel_drop",
};
const CRITICAL = new Set(["forward_collision", "collision", "fatigue", "sos", "panic", "fuel_drop", "tamper", "pedestrian_warning", "driver_absent"]);
const INFO = new Set(["idling", "yawning", "camera_fault"]);

/** Vendor event name → FleetWorks event type, or null when it is not a safety event we track. */
export function eventType(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (!s) return null;
  if ((EVENT_TYPES as readonly string[]).includes(s)) return s;
  const k = s.toLowerCase().replace(/[\s-]+/g, "_");
  return ALIAS[k] ?? ALIAS[k.replace(/_/g, "")] ?? null;
}
export function severityFor(type: string, given?: unknown): "info" | "warning" | "critical" {
  const g = String(given ?? "").toLowerCase();
  if (g === "info" || g === "warning" || g === "critical") return g;
  if (g === "high" || g === "alarm" || g === "2") return "critical";
  return CRITICAL.has(type) ? "critical" : INFO.has(type) ? "info" : "warning";
}

// ── helpers ─────────────────────────────────────────────────────────────────
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "" || typeof v === "boolean") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const bool = (v: unknown): boolean | null =>
  v === true || v === 1 || v === "1" || v === "true" || v === "on" ? true
    : v === false || v === 0 || v === "0" || v === "false" || v === "off" ? false : null;
const iso = (v: unknown): string | null => {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return new Date(v < 1e12 ? v * 1000 : v).toISOString();   // unix seconds or ms
  const t = Date.parse(String(v));
  return Number.isNaN(t) ? null : new Date(t).toISOString();
};
function flatten(obj: Record<string, unknown>, prefix = "", out: Record<string, Scalar> = {}): Record<string, Scalar> {
  for (const [k, v] of Object.entries(obj || {})) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v === null || v === undefined) continue;
    if (typeof v === "object" && !Array.isArray(v)) flatten(v as Record<string, unknown>, key, out);
    else if (typeof v === "number" || typeof v === "string" || typeof v === "boolean") out[key] = v;
  }
  return out;
}
function put(sig: Record<string, Scalar>, path: string, v: Scalar | null) { if (v !== null && v !== undefined && v !== "") sig[path] = v; }
function mediaList(v: unknown): MediaRef[] {
  const arr = Array.isArray(v) ? v : v ? [v] : [];
  return arr.map((m) => typeof m === "string" ? { url: m } : m as MediaRef)
    .filter((m) => m && typeof m.url === "string" && /^https:\/\//i.test(m.url));
}

// ── FleetWorks native format ────────────────────────────────────────────────
// { imei, readings: [{recorded_at, latitude, longitude, speed_kmph, ... any extra keys}],
//   events: [{event_type, severity, occurred_at, latitude, longitude, speed_kmph, video_url, media:[{channel,url}]}] }
// The reading keys are the telemetry column names, kept for the devices already
// posting to telemetry-ingest.
const FW_COLS: Record<string, string> = {
  latitude: SIG.lat, longitude: SIG.lng, heading: SIG.heading, speed_kmph: SIG.speed, ignition: SIG.ignition,
  engine_rpm: SIG.rpm, coolant_temp_c: SIG.coolant, engine_hours: SIG.engineHours, fuel_level_pct: SIG.fuelPct,
  fuel_litres: SIG.fuelLitres, fuel_rate_lph: SIG.fuelRate, odometer_km: SIG.odometer, battery_voltage: SIG.battery,
  tyre_pressure_min_psi: SIG.tyreMin, ambient_temp_c: SIG.ambient, cargo_temp_c: SIG.cargoTemp,
  cargo_door_open: SIG.cargoDoor, driver_id: SIG.driverId,
};
export function fromFleetworks(body: Record<string, unknown>): CanonicalMessage[] {
  const ident = String(body.imei ?? body.ident ?? "").trim();
  const readings = Array.isArray(body.readings) ? body.readings as Record<string, unknown>[] : [];
  const events = Array.isArray(body.events) ? body.events as Record<string, unknown>[] : [];
  const out: CanonicalMessage[] = readings.map((r) => {
    const params = flatten(r);
    const signals: Record<string, Scalar> = {};
    for (const [col, path] of Object.entries(FW_COLS)) {
      const v = r[col];
      put(signals, path, col === "ignition" || col === "cargo_door_open" ? bool(v) : col === "driver_id" ? (v == null ? null : String(v)) : num(v));
    }
    return { ident, ts: iso(r.recorded_at) ?? new Date().toISOString(), signals, params, events: [], media: mediaList(r.media) };
  });
  if (events.length) {
    const evs = events.map((e) => {
      const type = eventType(e.event_type) ?? String(e.event_type ?? "");
      const media = mediaList(e.media);
      if (typeof e.video_url === "string" && /^https:\/\//i.test(e.video_url)) media.push({ url: e.video_url, kind: "clip" });
      return { type, raw_type: String(e.event_type ?? ""), severity: severityFor(type, e.severity), ts: iso(e.occurred_at) ?? new Date().toISOString(), params: flatten(e), media };
    });
    // events ride on their own message so a batch of events without readings still lands
    const ts = evs[0].ts;
    const loc: Record<string, Scalar> = {};
    const e0 = events[0];
    put(loc, SIG.lat, num(e0.latitude)); put(loc, SIG.lng, num(e0.longitude)); put(loc, SIG.speed, num(e0.speed_kmph));
    out.push({ ident, ts, signals: loc, params: {}, events: evs, media: [] });
  }
  return out;
}

// ── flespi ──────────────────────────────────────────────────────────────────
// flespi HTTP stream: a JSON array of messages, flat dotted parameter names
// ("position.latitude", "engine.ignition.status", "can.fuel.level"...), unix-second
// timestamps, speed in km/h. Parameters we do not know stay in params for
// device_sensors to map.
const FLESPI: [string, string, "num" | "bool" | "str"][] = [
  ["position.latitude", SIG.lat, "num"], ["position.longitude", SIG.lng, "num"], ["position.direction", SIG.heading, "num"],
  ["position.altitude", SIG.altitude, "num"], ["position.speed", SIG.speed, "num"], ["vehicle.speed", SIG.speed, "num"],
  ["engine.ignition.status", SIG.ignition, "bool"], ["engine.rpm", SIG.rpm, "num"], ["can.engine.rpm", SIG.rpm, "num"],
  ["can.engine.temperature", SIG.coolant, "num"], ["engine.temperature", SIG.coolant, "num"], ["can.engine.coolant.temperature", SIG.coolant, "num"],
  ["engine.motorhours", SIG.engineHours, "num"], ["can.engine.motorhours", SIG.engineHours, "num"],
  ["can.fuel.level", SIG.fuelPct, "num"], ["fuel.level", SIG.fuelPct, "num"], ["can.fuel.volume", SIG.fuelLitres, "num"], ["fuel.volume", SIG.fuelLitres, "num"],
  ["can.fuel.consumption", SIG.fuelRate, "num"], ["fuel.flow.meter.fuel.consumption", SIG.fuelRate, "num"],
  ["vehicle.mileage", SIG.odometer, "num"], ["can.vehicle.mileage", SIG.odometer, "num"],
  ["external.powersource.voltage", SIG.battery, "num"],
  ["can.ambient.air.temperature", SIG.ambient, "num"],
  ["ibutton.code", SIG.driverId, "str"], ["driver.id", SIG.driverId, "str"], ["rfid.code", SIG.driverId, "str"],
];
export function fromFlespi(body: unknown): CanonicalMessage[] {
  const list = Array.isArray(body) ? body : body && typeof body === "object" && Array.isArray((body as { messages?: unknown[] }).messages)
    ? (body as { messages: unknown[] }).messages : body ? [body] : [];
  return (list as Record<string, unknown>[]).map((m) => {
    const params = flatten(m);
    const signals: Record<string, Scalar> = {};
    for (const [key, path, kind] of FLESPI) {
      if (!(key in params) || path in signals) continue;
      put(signals, path, kind === "bool" ? bool(params[key]) : kind === "str" ? String(params[key]) : num(params[key]));
    }
    // flespi reports a boolean "position.valid"; an invalid fix is kept as params only
    if (params["position.valid"] === false) { delete signals[SIG.lat]; delete signals[SIG.lng]; }
    const events: CanonicalEvent[] = [];
    const ts = iso(m.timestamp) ?? new Date().toISOString();
    // alarm-ish parameters gateways set: "alarm.event.trigger", "event.enum", "adas.event.type", "dms.event.type"
    for (const key of ["alarm.type", "alarm.event.type", "event.type", "adas.event.type", "dms.event.type", "adas.alarm.type", "dms.alarm.type"]) {
      const t = eventType(params[key]);
      if (t) events.push({ type: t, raw_type: String(params[key]), severity: severityFor(t, params["alarm.level"]), ts, params, media: mediaList(m["media"]) });
    }
    if (params["alarm.sos.status"] === true || params["sos.status"] === true) events.push({ type: "sos", raw_type: "sos", severity: "critical", ts, params, media: [] });
    return { ident: String(m.ident ?? params["device.ident"] ?? "").trim(), ts, signals, params, events, media: events.length ? [] : mediaList(m["media"]) };
  });
}

// ── Traccar ─────────────────────────────────────────────────────────────────
// Traccar position forwarding (forward.type=json) posts { position, device } per fix;
// event forwarding posts { event, position, device }. Units per the Traccar model:
// speed in knots, odometer and totalDistance in metres, hours in milliseconds.
export function fromTraccar(body: Record<string, unknown>): CanonicalMessage[] {
  const pos = (body.position ?? {}) as Record<string, unknown>;
  const dev = (body.device ?? {}) as Record<string, unknown>;
  const ev = body.event as Record<string, unknown> | undefined;
  const a = (pos.attributes ?? {}) as Record<string, unknown>;
  const ident = String(dev.uniqueId ?? pos.uniqueId ?? "").trim();
  const ts = iso(pos.fixTime ?? pos.deviceTime ?? ev?.eventTime) ?? new Date().toISOString();
  const params = flatten({ ...pos, attributes: undefined, ...a });
  const signals: Record<string, Scalar> = {};
  if (pos.valid !== false) { put(signals, SIG.lat, num(pos.latitude)); put(signals, SIG.lng, num(pos.longitude)); }
  put(signals, SIG.altitude, num(pos.altitude)); put(signals, SIG.heading, num(pos.course));
  const kn = num(pos.speed); put(signals, SIG.speed, kn === null ? null : +(kn * 1.852).toFixed(1));
  put(signals, SIG.ignition, bool(a.ignition)); put(signals, SIG.rpm, num(a.rpm));
  put(signals, SIG.coolant, num(a.coolantTemp)); put(signals, SIG.battery, num(a.power));
  const hrs = num(a.hours); put(signals, SIG.engineHours, hrs === null ? null : +(hrs / 3600000).toFixed(2));
  const odo = num(a.odometer) ?? num(a.totalDistance); put(signals, SIG.odometer, odo === null ? null : +(odo / 1000).toFixed(2));
  // Traccar "fuel" is litres on most protocols, "fuelLevel"/"fuel" percent on others; percent only when explicit
  put(signals, SIG.fuelPct, num(a.fuelLevel)); put(signals, SIG.fuelLitres, num(a.fuel));
  put(signals, SIG.fuelRate, num(a.fuelConsumption));
  put(signals, SIG.cargoTemp, num(a.temp1)); put(signals, SIG.driverId, a.driverUniqueId == null ? null : String(a.driverUniqueId));
  put(signals, SIG.cargoDoor, bool(a.door));
  const events: CanonicalEvent[] = [];
  const alarms = String(a.alarm ?? (ev?.attributes as Record<string, unknown> | undefined)?.alarm ?? "").split(",").filter(Boolean);
  for (const al of alarms) {
    const t = eventType(al);
    if (t) events.push({ type: t, raw_type: al, severity: severityFor(t), ts, params, media: [] });
  }
  if (ev && ev.type && ev.type !== "alarm") {
    const t = eventType(ev.type);   // deviceOverspeed etc.; most Traccar event types are not safety events
    if (t) events.push({ type: t, raw_type: String(ev.type), severity: severityFor(t), ts, params, media: [] });
  }
  return [{ ident, ts, signals, params, events, media: [] }];
}

// ── MQTT ──────────────────────────────────────────────────────────────────
// MQTT is a transport, not a payload format: a managed broker (HiveMQ Cloud, EMQX Cloud,
// flespi, AWS IoT Core...) receives what the vehicle publishes and forwards it here over
// HTTPS through its own rule/data-integration engine, so FleetWorks never runs a broker.
// The forwarded body is one message, or a batch under `messages` / a JSON array. Each item
// is either the FleetWorks device envelope directly, or a { topic, payload } pair the broker
// wraps it in. The device identity and the kind (telemetry vs event) come from explicit
// fields when present, otherwise from the topic:
//
//   topic    fleetworks/v1/<ident>/telemetry     payload = a reading  (latitude, speed_kmph, ...)
//            fleetworks/v1/<ident>/event         payload = an event   (event_type, severity, ...)
//   or       { vehicleId|deviceId|ident, type, timestamp, payload: { ... } }
//
// Reusing fromFleetworks keeps one mapping table: known keys become canonical signals, and
// anything unknown stays in params for per-device sensor mappings (device_sensors) to pick up.
export function fromMqtt(body: unknown): CanonicalMessage[] {
  const list = Array.isArray(body) ? body
    : body && typeof body === "object" && Array.isArray((body as { messages?: unknown[] }).messages) ? (body as { messages: unknown[] }).messages
    : body ? [body] : [];
  const ID_FIELDS = ["ident", "imei", "deviceId", "device_id", "vehicleId", "vehicle_id", "event_type", "readings", "events"];
  const out: CanonicalMessage[] = [];
  for (const raw of list as Record<string, unknown>[]) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const topic = typeof raw.topic === "string" ? raw.topic : "";
    // A pure broker wrapper is { topic, payload } with no identity of its own — the real
    // message is inside `payload`. A device envelope ({ deviceId, type, payload }) keeps its
    // identity as siblings of payload, so it is NOT unwrapped here.
    let msg: unknown = raw;
    if (topic && raw.payload !== undefined && !ID_FIELDS.some((k) => k in raw)) msg = raw.payload;
    if (typeof msg === "string") { try { msg = JSON.parse(msg); } catch { msg = { value: msg }; } }
    if (!msg || typeof msg !== "object" || Array.isArray(msg)) continue;
    const d = msg as Record<string, unknown>;
    const seg = topic.split("/").filter(Boolean);
    const ident = String(d.ident ?? d.imei ?? d.deviceId ?? d.device_id ?? d.vehicleId ?? d.vehicle_id ?? seg[2] ?? "").trim();
    if (!ident) continue;
    const ts = d.ts ?? d.timestamp ?? d.time ?? d.recorded_at ?? d.occurred_at;
    // the device envelope nests the sensor values under `payload`; a flat message is its own core
    const core = (d.payload && typeof d.payload === "object" && !Array.isArray(d.payload)) ? d.payload as Record<string, unknown> : d;
    const kind = String(d.type ?? seg[3] ?? "").toLowerCase();
    const isEvent = /event|alarm|alert|incident/.test(kind) || "event_type" in core || "event" in core;
    if (isEvent) {
      const ev = { ...core, event_type: core.event_type ?? core.event ?? d.type, occurred_at: ts ?? core.occurred_at };
      out.push(...fromFleetworks({ imei: ident, events: [ev] }));
    } else {
      out.push(...fromFleetworks({ imei: ident, readings: [{ ...core, recorded_at: ts ?? core.recorded_at }] }));
    }
  }
  return out;
}

export function adapt(format: Format, body: unknown): CanonicalMessage[] {
  if (format === "flespi") return fromFlespi(body);
  if (format === "traccar") return fromTraccar(body as Record<string, unknown>);
  if (format === "mqtt") return fromMqtt(body);
  return fromFleetworks(body as Record<string, unknown>);
}

// ── per-device sensor mapping (device_sensors rows) ─────────────────────────
export interface SensorMap {
  source_key: string;             // param name as the device sends it, e.g. "escort.lls.value.1", "io.270"
  signal_path: string;            // canonical target
  transform: "none" | "linear" | "table";
  scale?: number | null; offset?: number | null;
  calibration?: [number, number][] | null;   // [raw, value] points, e.g. a tank calibration table
}
/** Piecewise-linear interpolation through calibration points; clamps at both ends. */
export function calibrate(raw: number, points: [number, number][]): number | null {
  const p = [...(points || [])].filter((x) => Array.isArray(x) && Number.isFinite(x[0]) && Number.isFinite(x[1])).sort((a, b) => a[0] - b[0]);
  if (!p.length) return null;
  if (raw <= p[0][0]) return p[0][1];
  if (raw >= p[p.length - 1][0]) return p[p.length - 1][1];
  for (let i = 1; i < p.length; i++) {
    if (raw <= p[i][0]) {
      const [x0, y0] = p[i - 1], [x1, y1] = p[i];
      return y0 + (y1 - y0) * (raw - x0) / (x1 - x0);
    }
  }
  return null;
}
/** Applies the device's sensor mappings; mapped values win over the adapter's defaults. */
export function applySensors(msg: CanonicalMessage, maps: SensorMap[]): CanonicalMessage {
  const signals = { ...msg.signals };
  for (const m of maps) {
    if (!(m.source_key in msg.params)) continue;
    const raw = msg.params[m.source_key];
    if (m.transform === "none") { signals[m.signal_path] = raw; continue; }
    const n = num(raw); if (n === null) continue;
    const v = m.transform === "table" ? calibrate(n, m.calibration || []) : n * (m.scale ?? 1) + (m.offset ?? 0);
    if (v !== null && Number.isFinite(v)) signals[m.signal_path] = +v.toFixed(3);
  }
  return { ...msg, signals };
}

/** Fills the derived fuel signal: litres ⇄ percent when the tank capacity is known. */
export function deriveFuel(signals: Record<string, Scalar>, tankLitres: number | null): Record<string, Scalar> {
  const s = { ...signals };
  const pct = num(s[SIG.fuelPct]), l = num(s[SIG.fuelLitres]);
  if (tankLitres && tankLitres > 0) {
    if (pct === null && l !== null) s[SIG.fuelPct] = +Math.min(100, Math.max(0, l / tankLitres * 100)).toFixed(1);
    if (l === null && pct !== null) s[SIG.fuelLitres] = +(pct / 100 * tankLitres).toFixed(1);
  }
  return s;
}

// canonical signals → telemetry table columns (the wide row the dashboards read)
const COLS: Record<string, string> = {
  [SIG.lat]: "latitude", [SIG.lng]: "longitude", [SIG.heading]: "heading", [SIG.speed]: "speed_kmph",
  [SIG.ignition]: "ignition", [SIG.odometer]: "odometer_km", [SIG.engineHours]: "engine_hours", [SIG.rpm]: "engine_rpm",
  [SIG.coolant]: "coolant_temp_c", [SIG.battery]: "battery_voltage", [SIG.fuelPct]: "fuel_level_pct",
  [SIG.fuelRate]: "fuel_rate_lph", [SIG.tyreMin]: "tyre_pressure_min_psi", [SIG.ambient]: "ambient_temp_c",
  [SIG.cargoTemp]: "cargo_temp_c",
};
export function toTelemetryRow(msg: CanonicalMessage): Record<string, unknown> {
  const row: Record<string, unknown> = { recorded_at: msg.ts };
  for (const [path, col] of Object.entries(COLS)) {
    if (!(path in msg.signals)) continue;
    const v = msg.signals[path];
    row[col] = col === "ignition" ? bool(v) : num(v);
  }
  return row;
}
/** True when the message carries something worth a telemetry row (not just an event). */
export function hasReading(msg: CanonicalMessage): boolean {
  return Object.keys(msg.signals).some((p) => p in COLS);
}

/** Range checks on the canonical values; returns the first problem, or null. */
export function validate(msg: CanonicalMessage): string | null {
  const r = (p: string, lo: number, hi: number, label: string) => {
    const v = num(msg.signals[p]); return v !== null && (v < lo || v > hi) ? `${label} must be between ${lo} and ${hi}` : null;
  };
  return r(SIG.lat, -90, 90, "latitude") || r(SIG.lng, -180, 180, "longitude") || r(SIG.speed, 0, 250, "speed")
    || r(SIG.fuelPct, 0, 100, "fuel level %") || null;
}
