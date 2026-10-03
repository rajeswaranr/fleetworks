// FleetWorks — driver phone-DMS safety event (Supabase Edge Function, Deno).
//
// The driver's Safe Drive screen (team portal) posts here when its on-phone drowsiness
// detector fires. The driver's own phone becomes a Driver Monitoring camera: the alert
// lands as a device_event on the vehicle, which the fs_on_incident trigger turns into a
// FleetSafe alert — so it reaches the owner's Incident Triage and Command Centre exactly
// like a hardware dashcam's DMS.
//
// POST { vehicleId, kind, occurredAt }   with the driver's JWT (team-portal session).
//   kind: long_blink | blink_rate | head_tilt  (mapped to fatigue / distraction)
//
// The caller's membership in the vehicle's org is verified before anything is written.
// Repeated alerts are collapsed: at most one event per vehicle per kind per minute.
//
// Deploy:  npx supabase functions deploy driver-safety-event --no-verify-jwt

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ALLOW = ["https://fleetworks.in", "https://www.fleetworks.in", "http://localhost:8642", "http://127.0.0.1:8642"];
const cors = (o: string | null) => ({
  "Access-Control-Allow-Origin": o && ALLOW.includes(o) ? o : ALLOW[0],
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, authorization, apikey",
  "Content-Type": "application/json",
});

// phone-DMS alert → FleetSafe event type. The Safe Drive camera rates several conditions;
// they map onto the two DMS event types the fleet backend already knows.
const MAP: Record<string, string> = {
  drowsiness: "fatigue", sleepiness: "fatigue", fatigue: "fatigue", yawning: "fatigue", impairment: "fatigue",
  distraction: "distraction",
  long_blink: "fatigue", blink_rate: "fatigue", head_tilt: "distraction",   // legacy kinds
  // phone motion telematics (accelerometer + GPS): harsh driving + overspeed, pass-through
  harsh_brake: "harsh_brake", harsh_accel: "harsh_accel", harsh_corner: "harsh_corner", overspeed: "overspeed",
};
const LABEL: Record<string, string> = {
  drowsiness: "drowsiness", sleepiness: "sleepiness / micro-sleep", fatigue: "tiredness", yawning: "yawning",
  impairment: "impairment signs (unfit to drive)", distraction: "distraction",
  harsh_brake: "harsh braking", harsh_accel: "harsh acceleration", harsh_corner: "harsh cornering", overspeed: "overspeeding",
};
// minor stays in-app (info); major → warning; critical → critical (may SMS per fleet settings)
const SEV: Record<string, string> = { minor: "info", major: "warning", critical: "critical" };

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  const reply = (s: number, b: unknown) => new Response(JSON.stringify(b), { status: s, headers: cors(origin) });
  if (req.method !== "POST") return reply(405, { error: "POST only" });

  const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return reply(401, { error: "Sign in first." });
  let body: { vehicleId?: string; kind?: string; severity?: string; occurredAt?: string; latitude?: number; longitude?: number; speedKmph?: number };
  try { body = await req.json(); } catch { return reply(400, { error: "bad_json" }); }
  const vehicleId = String(body.vehicleId || "");
  const kind = String(body.kind || "");
  const severity = SEV[String(body.severity || "")] || "warning";   // in-app-only minor, else surfaced
  const lat = Number.isFinite(Number(body.latitude)) && Math.abs(Number(body.latitude)) <= 90 ? Number(body.latitude) : null;
  const lng = Number.isFinite(Number(body.longitude)) && Math.abs(Number(body.longitude)) <= 180 ? Number(body.longitude) : null;
  const speed = Number.isFinite(Number(body.speedKmph)) ? Number(body.speedKmph) : null;
  if (!/^[0-9a-f-]{36}$/i.test(vehicleId)) return reply(400, { error: "vehicleId is required." });
  if (!MAP[kind]) return reply(400, { error: "Unknown alert kind." });
  const at = body.occurredAt && !Number.isNaN(Date.parse(body.occurredAt)) ? new Date(body.occurredAt).toISOString() : new Date().toISOString();

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: caller } = await admin.auth.getUser(jwt);
  if (!caller?.user) return reply(401, { error: "Session expired — sign in again." });

  const { data: veh } = await admin.from("vehicles").select("id, org_id, name").eq("id", vehicleId).maybeSingle();
  if (!veh) return reply(404, { error: "Vehicle not found." });
  const { data: mem } = await admin.from("memberships").select("org_id").eq("user_id", caller.user.id).eq("org_id", veh.org_id).maybeSingle();
  if (!mem) return reply(403, { error: "You are not on this vehicle's fleet." });

  // one phone-DMS device per vehicle, reused
  const imei = "PHONE-DMS-" + vehicleId.replace(/-/g, "").slice(0, 12);
  let deviceId: string | null = null;
  const { data: dev } = await admin.from("devices").select("id").eq("org_id", veh.org_id).eq("imei", imei).maybeSingle();
  deviceId = dev?.id ?? null;
  if (!deviceId) {
    const { data: made, error } = await admin.from("devices").insert({
      org_id: veh.org_id, vehicle_id: vehicleId, imei, kind: "dashcam", protocol: "proprietary", integration: "native",
      vendor: "FleetWorks Safe Drive", model: "Driver phone (DMS)", capabilities: ["dms"], status: "active", simulated: false,
      notes: "The driver's phone running Safe Drive.",
    }).select("id").single();
    if (error) return reply(500, { error: "Could not register the phone camera: " + error.message });
    deviceId = made.id;
    await admin.from("device_channels").insert({ org_id: veh.org_id, device_id: deviceId, vehicle_id: vehicleId, channel_no: 1, role: "cabin_dms", label: "Driver phone" });
  }

  // collapse repeats: skip the same condition+severity for this device within a minute
  const mapped = MAP[kind];
  const { data: recent } = await admin.from("device_events").select("id, raw")
    .eq("device_id", deviceId).eq("event_type", mapped).eq("severity", severity)
    .gte("occurred_at", new Date(Date.parse(at) - 60000).toISOString()).limit(5);
  if ((recent || []).some((r) => (r.raw as { alert?: string } | null)?.alert === kind)) return reply(200, { ok: true, deduped: true });

  const { data: evRow, error: evErr } = await admin.from("device_events").insert({
    device_id: deviceId, org_id: veh.org_id, occurred_at: at, event_type: mapped, severity,
    latitude: lat, longitude: lng, speed_kmph: speed,
    raw: { source: "phone_safe_drive", alert: kind, condition: LABEL[kind] || kind, severity_reported: body.severity || null, driver_user: caller.user.id }, simulated: false,
  }).select("id").single();
  if (evErr) return reply(500, { error: "Could not log the alert: " + evErr.message });
  await admin.from("devices").update({ last_seen_at: new Date().toISOString() }).eq("id", deviceId);
  return reply(200, { ok: true, event_type: mapped, severity, eventId: evRow.id });
});
