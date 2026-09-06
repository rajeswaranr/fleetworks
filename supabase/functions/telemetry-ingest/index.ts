// FleetWorks — telemetry ingest (Supabase Edge Function, Deno).
//
// The endpoint a device vendor's webhook posts to. Built now, against the
// simulator, so the contract is settled and proven before any hardware exists —
// when a supplier integration lands, only the field mapping changes.
//
// Auth is a shared ingest key rather than a user JWT: the caller is a machine,
// often a vendor's server, and it has no session. The key is checked in constant
// time and the function then writes under the service role, so RLS never has to
// admit an anonymous writer.
//
// Deploy:
//   npx supabase functions deploy telemetry-ingest --no-verify-jwt
//   npx supabase secrets set TELEMETRY_INGEST_KEY=<long random string>

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const INGEST_KEY = Deno.env.get("TELEMETRY_INGEST_KEY") || "";

const CORS = {
  "Access-Control-Allow-Origin": "*",           // machine-to-machine; auth is the key, not the origin
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, x-ingest-key",
  "Content-Type": "application/json",
};
const err = (status: number, message: string) =>
  new Response(JSON.stringify({ error: message }), { status, headers: CORS });

// Constant-time compare so a wrong key cannot be discovered by timing the
// response. Cheap, and this endpoint is public by design.
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const EVENT_TYPES = new Set([
  "lane_departure", "forward_collision", "headway_warning", "pedestrian_warning",
  "fatigue", "distraction", "phone_use", "no_seatbelt", "smoking",
  "harsh_brake", "harsh_accel", "harsh_corner", "overspeed",
  "fuel_drop", "tamper", "power_cut", "sos", "panic",
]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return err(405, "POST only");
  if (!INGEST_KEY) return err(503, "Ingest is not configured — set TELEMETRY_INGEST_KEY.");

  const key = req.headers.get("x-ingest-key") || "";
  if (!safeEqual(key, INGEST_KEY)) return err(401, "Bad ingest key.");

  let body: {
    imei?: string;
    readings?: Record<string, unknown>[];
    events?: Record<string, unknown>[];
  };
  try { body = await req.json(); } catch { return err(400, "bad_json"); }

  const imei = String(body.imei || "").trim();
  if (!imei) return err(400, "imei is required — it identifies the device.");

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // The device must already be registered. Auto-creating one on first sight
  // would let anyone holding the ingest key invent devices in an org they have
  // nothing to do with — and would quietly attach telemetry to no vehicle.
  const { data: device, error: devErr } = await admin
    .from("devices").select("id, org_id, simulated").eq("imei", imei).maybeSingle();
  if (devErr) return err(500, "Device lookup failed: " + devErr.message);
  if (!device) return err(404, `No device registered with IMEI ${imei}. Add it first.`);

  const readings = Array.isArray(body.readings) ? body.readings.slice(0, 500) : [];
  const events = Array.isArray(body.events) ? body.events.slice(0, 200) : [];

  let wroteReadings = 0, wroteEvents = 0;
  let latest: string | null = null;

  if (readings.length) {
    const rows = readings.map((r) => {
      const ts = r.recorded_at ? String(r.recorded_at) : new Date().toISOString();
      if (!latest || ts > latest) latest = ts;
      return {
        device_id: device.id, org_id: device.org_id, recorded_at: ts,
        latitude: num(r.latitude), longitude: num(r.longitude),
        speed_kmph: num(r.speed_kmph), heading: num(r.heading),
        ignition: typeof r.ignition === "boolean" ? r.ignition : null,
        odometer_km: num(r.odometer_km), engine_hours: num(r.engine_hours),
        engine_rpm: num(r.engine_rpm), coolant_temp_c: num(r.coolant_temp_c),
        battery_voltage: num(r.battery_voltage),
        fuel_level_pct: num(r.fuel_level_pct), fuel_rate_lph: num(r.fuel_rate_lph),
        tyre_pressure_min_psi: num(r.tyre_pressure_min_psi),
        ambient_temp_c: num(r.ambient_temp_c), cargo_temp_c: num(r.cargo_temp_c),
        raw: r, simulated: device.simulated,
      };
    });
    const { error, count } = await admin.from("telemetry").insert(rows, { count: "exact" });
    if (error) return err(500, "Telemetry insert failed: " + error.message);
    wroteReadings = count ?? rows.length;
  }

  if (events.length) {
    // Drop unknown event types rather than failing the whole batch — a vendor
    // adding a new alert should never stop the readings in the same POST.
    const rows = events
      .filter((e) => EVENT_TYPES.has(String(e.event_type)))
      .map((e) => ({
        device_id: device.id, org_id: device.org_id,
        occurred_at: e.occurred_at ? String(e.occurred_at) : new Date().toISOString(),
        event_type: String(e.event_type),
        severity: ["info", "warning", "critical"].includes(String(e.severity)) ? String(e.severity) : "warning",
        latitude: num(e.latitude), longitude: num(e.longitude), speed_kmph: num(e.speed_kmph),
        video_url: e.video_url ? String(e.video_url) : null,
        raw: e, simulated: device.simulated,
      }));
    if (rows.length) {
      const { error, count } = await admin.from("device_events").insert(rows, { count: "exact" });
      if (error) return err(500, "Event insert failed: " + error.message);
      wroteEvents = count ?? rows.length;
    }
  }

  // last_seen_at is what the dashboard's online/offline badge reads, so it is
  // stamped on every accepted post even when the batch carried only events.
  await admin.from("devices")
    .update({ last_seen_at: latest || new Date().toISOString() })
    .eq("id", device.id);

  return new Response(JSON.stringify({
    ok: true, imei, readings: wroteReadings, events: wroteEvents,
    skippedEvents: events.length - wroteEvents,
  }), { headers: CORS });
});
