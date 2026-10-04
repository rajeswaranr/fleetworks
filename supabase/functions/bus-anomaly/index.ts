// FleetWorks — passenger-transport anomaly detection (Supabase Edge Function, Deno).
//
// For school / passenger buses and trains. Looks at a vehicle's recent telemetry + events and
// flags anomalies, two layers:
//   • rules      — deterministic (overspeed vs the route's limit) from the vehicle twin.
//   • Gemma      — contextual: an LLM reads the recent activity and flags what is *unusual for
//                  this route/time* (unscheduled stop, prolonged idle, off-route, unusual
//                  pattern) with a plain-language reason. Runs only when GOOGLE_API_KEY is set;
//                  without it the function still returns the rule anomalies.
// Detected anomalies become device_events (passenger-anomaly types) → Incident Triage + the
// Passenger Safety console.
//
// Callers:
//   • owner/manager/supervisor JWT: { vehicleId, speedLimit? }
//   • pg_cron (x-cron-key): sweeps active passenger vehicles (kind in bus/train/coach)
//
// Secrets: GOOGLE_API_KEY (Google AI Studio, free tier) + GEMMA_MODEL (default gemma-3-27b-it);
//          FLEETSAFE_CRON_KEY for the sweep.
// Deploy:  npx supabase functions deploy bus-anomaly --no-verify-jwt

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GOOGLE_API_KEY = Deno.env.get("GOOGLE_API_KEY") || Deno.env.get("GEMMA_API_KEY") || "";
const GEMMA_MODEL = Deno.env.get("GEMMA_MODEL") || "gemma-3-27b-it";
const CRON_KEY = Deno.env.get("FLEETSAFE_CRON_KEY") || "";
const DEFAULT_LIMIT = 60;          // km/h default for passenger vehicles
const DEDUP_MS = 30 * 60 * 1000;
const ANOMALIES = ["route_deviation", "unscheduled_stop", "schedule_deviation", "prolonged_idle", "speed_zone_violation", "door_open_moving", "overcrowding", "child_left_behind", "unusual_pattern"];
const CRITICAL = new Set(["child_left_behind", "door_open_moving", "overcrowding"]);
const ALLOW = ["https://fleetworks.in", "https://www.fleetworks.in", "http://localhost:8642", "http://127.0.0.1:8642"];
const cors = (o: string | null) => ({
  "Access-Control-Allow-Origin": o && ALLOW.includes(o) ? o : ALLOW[0],
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, authorization, apikey, x-cron-key",
  "Content-Type": "application/json",
});
const sig = (st: Record<string, { v?: unknown }> | null, p: string) => { const n = st && st[p] ? Number(st[p].v) : NaN; return Number.isFinite(n) ? n : null; };

async function recentEvents(admin: SupabaseClient, deviceIds: string[]) {
  if (!deviceIds.length) return [];
  const since = new Date(Date.now() - 2 * 3600e3).toISOString();
  const { data } = await admin.from("device_events").select("event_type, severity, occurred_at").in("device_id", deviceIds).gt("occurred_at", since).order("occurred_at", { ascending: false }).limit(50);
  return data || [];
}

// Ask Gemma (Google AI Studio) to flag contextual anomalies from a compact activity summary.
async function gemmaAnomalies(summary: string): Promise<{ type: string; severity: string; reason: string }[]> {
  if (!GOOGLE_API_KEY) return [];
  const prompt = `You monitor a passenger/school bus or train for safety. From this recent activity, list only genuine anomalies, each strictly one of: ${ANOMALIES.join(", ")}. Reply JSON only: {"anomalies":[{"type":"<one>","severity":"info|warning|critical","reason":"<=12 words"}]}. Empty list if normal.\n\nActivity:\n${summary}`;
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMMA_MODEL}:generateContent?key=${GOOGLE_API_KEY}`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.2, maxOutputTokens: 400 } }),
    });
    if (!r.ok) return [];
    const j = await r.json();
    const text = (j.candidates?.[0]?.content?.parts || []).map((p: { text?: string }) => p.text || "").join("");
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return [];
    return (JSON.parse(m[0]).anomalies || []).filter((a: { type: string }) => ANOMALIES.includes(a.type));
  } catch { return []; }
}

async function assess(admin: SupabaseClient, veh: { id: string; org_id: string; name: string }, limit: number) {
  const imei = "PHONE-DMS-" + veh.id.replace(/-/g, "").slice(0, 12);
  // all devices on this vehicle (tracker, dashcam, phone)
  const { data: devs } = await admin.from("devices").select("id").eq("org_id", veh.org_id).eq("vehicle_id", veh.id);
  const deviceIds = (devs || []).map((d) => d.id);
  let deviceId = deviceIds[0] || null;
  const { data: twin } = await admin.from("vehicle_twin").select("state, last_reading_at").eq("vehicle_id", veh.id).limit(1).maybeSingle();
  const st = (twin?.state || {}) as Record<string, { v?: unknown }>;
  const speed = sig(st, "Vehicle.Speed");
  const evs = await recentEvents(admin, deviceIds);

  const found: { type: string; severity: string; reason: string }[] = [];
  // rule: overspeed vs the route limit
  if (speed != null && speed > limit) found.push({ type: "speed_zone_violation", severity: speed > limit + 20 ? "critical" : "warning", reason: `${Math.round(speed)} km/h over the ${limit} limit` });

  // contextual: let Gemma read the recent picture
  const summary = `Vehicle: ${veh.name}. Now: speed ${speed == null ? "unknown" : Math.round(speed) + " km/h"}, last reading ${twin?.last_reading_at || "unknown"}. Recent events (newest first): ${evs.length ? evs.map((e) => `${e.event_type}/${e.severity}@${e.occurred_at}`).join("; ") : "none"}.`;
  for (const a of await gemmaAnomalies(summary)) if (!found.some((f) => f.type === a.type)) found.push(a);

  if (!found.length) return { vehicle: veh.name, anomalies: [], ai: !!GOOGLE_API_KEY };
  if (!deviceId) { // ensure a device to hang events on
    const { data: made } = await admin.from("devices").insert({ org_id: veh.org_id, vehicle_id: veh.id, imei, kind: "tracker", protocol: "proprietary", integration: "native", vendor: "FleetWorks", model: "Passenger anomaly", status: "active", simulated: false }).select("id").single();
    deviceId = made?.id ?? null;
  }
  const since = new Date(Date.now() - DEDUP_MS).toISOString();
  const logged: string[] = [];
  for (const a of found) {
    const { data: recent } = await admin.from("device_events").select("id").eq("device_id", deviceId).eq("event_type", a.type).gt("occurred_at", since).limit(1);
    if (recent?.length) continue;
    const severity = ["info", "warning", "critical"].includes(a.severity) ? a.severity : (CRITICAL.has(a.type) ? "critical" : "warning");
    await admin.from("device_events").insert({ device_id: deviceId, org_id: veh.org_id, event_type: a.type, severity, latitude: sig(st, "Vehicle.CurrentLocation.Latitude"), longitude: sig(st, "Vehicle.CurrentLocation.Longitude"), speed_kmph: speed, occurred_at: new Date().toISOString(), simulated: false, raw: { source: "bus_anomaly", reason: a.reason, engine: GOOGLE_API_KEY ? "gemma+rules" : "rules" } });
    logged.push(a.type);
  }
  return { vehicle: veh.name, anomalies: found, logged, ai: !!GOOGLE_API_KEY };
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  const reply = (s: number, b: unknown) => new Response(JSON.stringify(b), { status: s, headers: cors(origin) });
  if (req.method !== "POST") return reply(405, { error: "POST only" });
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

  const cron = req.headers.get("x-cron-key") || "";
  if (cron) {
    if (!CRON_KEY || cron !== CRON_KEY) return reply(401, { error: "Not allowed." });
    const { data: buses } = await admin.from("vehicles").select("id, org_id, name").in("type", ["bus", "school_bus", "coach", "train", "passenger"]).limit(500);
    const out = [];
    for (const v of buses || []) out.push(await assess(admin, v, DEFAULT_LIMIT));
    return reply(200, { ok: true, checked: out.length, results: out });
  }

  const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return reply(401, { error: "Sign in first." });
  let body: { vehicleId?: string; speedLimit?: number };
  try { body = await req.json(); } catch { return reply(400, { error: "bad_json" }); }
  const vehicleId = String(body.vehicleId || "");
  if (!vehicleId) return reply(400, { error: "vehicleId is required." });
  const { data: caller } = await admin.auth.getUser(jwt);
  if (!caller?.user) return reply(401, { error: "Session expired - sign in again." });
  const { data: mems } = await admin.from("memberships").select("org_id, role").eq("user_id", caller.user.id);
  const orgIds = (mems || []).map((m) => m.org_id);
  if (!orgIds.length) return reply(403, { error: "You are not on any fleet." });
  const isUuid = /^[0-9a-f-]{36}$/i.test(vehicleId);
  const vq = admin.from("vehicles").select("id, org_id, name").in("org_id", orgIds);
  const { data: veh } = await (isUuid ? vq.eq("id", vehicleId) : vq.eq("ext_id", vehicleId)).maybeSingle();
  if (!veh) return reply(404, { error: "Vehicle not found on your fleet." });
  const limit = Number(body.speedLimit) > 0 ? Number(body.speedLimit) : DEFAULT_LIMIT;
  return reply(200, await assess(admin, veh, limit));
});
