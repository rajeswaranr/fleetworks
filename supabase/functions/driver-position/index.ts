// FleetWorks — driver phone live position (Supabase Edge Function, Deno).
//
// While Safe Drive is running, the phone posts its GPS position here every ~15s so a
// phone-only vehicle (no hardware tracker) still shows a live location — on Fleet View and on
// a Live Share link. It updates the vehicle's digital twin (vehicle_twin) for the phone-DMS
// device with the standard location signals, exactly as a tracker's ingest would.
//
// POST { vehicleId, lat, lng, speed?, heading? }  with the driver's JWT. Membership checked.
// Deploy:  npx supabase functions deploy driver-position --no-verify-jwt

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

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  const reply = (s: number, b: unknown) => new Response(JSON.stringify(b), { status: s, headers: cors(origin) });
  if (req.method !== "POST") return reply(405, { error: "POST only" });

  const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return reply(401, { error: "Sign in first." });
  let body: { vehicleId?: string; lat?: number; lng?: number; speed?: number; heading?: number };
  try { body = await req.json(); } catch { return reply(400, { error: "bad_json" }); }
  const vehicleId = String(body.vehicleId || "");
  const lat = Number(body.lat), lng = Number(body.lng);
  if (!/^[0-9a-f-]{36}$/i.test(vehicleId)) return reply(400, { error: "vehicleId required." });
  if (!Number.isFinite(lat) || Math.abs(lat) > 90 || !Number.isFinite(lng) || Math.abs(lng) > 180) return reply(400, { error: "valid lat/lng required." });
  const speed = Number.isFinite(Number(body.speed)) ? Number(body.speed) : null;
  const heading = Number.isFinite(Number(body.heading)) ? Number(body.heading) : null;

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: caller } = await admin.auth.getUser(jwt);
  if (!caller?.user) return reply(401, { error: "Session expired - sign in again." });
  const { data: veh } = await admin.from("vehicles").select("id, org_id").eq("id", vehicleId).maybeSingle();
  if (!veh) return reply(404, { error: "Vehicle not found." });
  const { data: mem } = await admin.from("memberships").select("org_id").eq("user_id", caller.user.id).eq("org_id", veh.org_id).maybeSingle();
  if (!mem) return reply(403, { error: "You are not on this vehicle's fleet." });

  // reuse the phone-DMS device (vehicle_twin is keyed by device_id)
  const imei = "PHONE-DMS-" + vehicleId.replace(/-/g, "").slice(0, 12);
  let deviceId: string | null = (await admin.from("devices").select("id").eq("org_id", veh.org_id).eq("imei", imei).maybeSingle()).data?.id ?? null;
  if (!deviceId) {
    const { data: made, error } = await admin.from("devices").insert({
      org_id: veh.org_id, vehicle_id: vehicleId, imei, kind: "dashcam", protocol: "proprietary", integration: "native",
      vendor: "FleetWorks Safe Drive", model: "Driver phone (DMS)", capabilities: ["dms", "gps"], status: "active", simulated: false,
      notes: "The driver's phone running Safe Drive.",
    }).select("id").single();
    if (error) return reply(500, { error: "Could not register the phone: " + error.message });
    deviceId = made.id;
  }

  const now = new Date().toISOString();
  const { data: existing } = await admin.from("vehicle_twin").select("state").eq("device_id", deviceId).maybeSingle();
  const state = (existing?.state || {}) as Record<string, unknown>;
  state["Vehicle.CurrentLocation.Latitude"] = { v: lat, ts: now };
  state["Vehicle.CurrentLocation.Longitude"] = { v: lng, ts: now };
  if (heading != null) state["Vehicle.CurrentLocation.Heading"] = { v: heading, ts: now };
  if (speed != null) state["Vehicle.Speed"] = { v: speed, ts: now };
  const { error: upErr } = await admin.from("vehicle_twin").upsert(
    { device_id: deviceId, org_id: veh.org_id, vehicle_id: vehicleId, state, last_reading_at: now, simulated: false, updated_at: now },
    { onConflict: "device_id" },
  );
  if (upErr) return reply(500, { error: upErr.message });
  await admin.from("devices").update({ last_seen_at: now }).eq("id", deviceId);
  return reply(200, { ok: true });
});
