// FleetWorks — driver Safe Drive clip upload (Supabase Edge Function, Deno).
//
// The driver's Safe Drive screen records the front camera in 2-minute segments and posts
// each one here. The clip is stored in the private device-media bucket against the
// vehicle's phone-DMS device and, when the segment contained a drowsiness/impairment
// event, linked to that incident — so the owner and supervisor see the footage in
// Incident Triage and the Command Centre, next to the alert it belongs to.
//
// POST multipart/form-data with the driver's JWT (team-portal session):
//   file        the clip (webm/mp4)
//   vehicleId   uuid
//   eventId?    device_events id to attach the clip to (the most severe alert in the segment)
//   capturedAt? ISO time the segment started
//
// Membership in the vehicle's org is verified before anything is written.
// Deploy:  npx supabase functions deploy driver-safety-clip --no-verify-jwt

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ALLOW = ["https://fleetworks.in", "https://www.fleetworks.in", "http://localhost:8642", "http://127.0.0.1:8642"];
const MAX_BYTES = 60 * 1024 * 1024;   // a 2-minute phone clip is well under this
const EXT: Record<string, string> = { "video/webm": "webm", "video/mp4": "mp4", "video/quicktime": "mov", "video/x-matroska": "mkv" };
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
  if (!(req.headers.get("content-type") || "").startsWith("multipart/form-data")) return reply(400, { error: "Send the clip as multipart form-data." });

  let form: FormData;
  try { form = await req.formData(); } catch { return reply(400, { error: "Could not read the upload." }); }
  const file = form.get("file");
  const vehicleId = String(form.get("vehicleId") || "");
  const eventId = String(form.get("eventId") || "");
  const capturedAt = String(form.get("capturedAt") || "");
  if (!(file instanceof File)) return reply(400, { error: "The clip 'file' is required." });
  if (!/^[0-9a-f-]{36}$/i.test(vehicleId)) return reply(400, { error: "vehicleId is required." });
  let mime = (file.type || "").toLowerCase().split(";")[0]; if (!EXT[mime]) mime = "video/webm";
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!bytes.length) return reply(400, { error: "The clip is empty." });
  if (bytes.length > MAX_BYTES) return reply(413, { error: "Clip over 60 MB." });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: caller } = await admin.auth.getUser(jwt);
  if (!caller?.user) return reply(401, { error: "Session expired — sign in again." });
  const { data: veh } = await admin.from("vehicles").select("id, org_id").eq("id", vehicleId).maybeSingle();
  if (!veh) return reply(404, { error: "Vehicle not found." });
  const { data: mem } = await admin.from("memberships").select("org_id").eq("user_id", caller.user.id).eq("org_id", veh.org_id).maybeSingle();
  if (!mem) return reply(403, { error: "You are not on this vehicle's fleet." });

  // reuse the phone-DMS device driver-safety-event created (or make it)
  const imei = "PHONE-DMS-" + vehicleId.replace(/-/g, "").slice(0, 12);
  let deviceId: string | null = (await admin.from("devices").select("id").eq("org_id", veh.org_id).eq("imei", imei).maybeSingle()).data?.id ?? null;
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

  // verify the event belongs to this device before linking
  let linkEvent: string | null = null;
  if (/^[0-9a-f-]{36}$/i.test(eventId)) {
    const { data: ev } = await admin.from("device_events").select("id").eq("id", eventId).eq("device_id", deviceId).maybeSingle();
    linkEvent = ev?.id ?? null;
  }

  const at = capturedAt && !Number.isNaN(Date.parse(capturedAt)) ? new Date(capturedAt) : new Date();
  const path = `${veh.org_id}/${vehicleId}/${at.getUTCFullYear()}/${String(at.getUTCMonth() + 1).padStart(2, "0")}/${String(at.getUTCDate()).padStart(2, "0")}/${crypto.randomUUID()}.${EXT[mime]}`;
  const { error: upErr } = await admin.storage.from("device-media").upload(path, bytes, { contentType: mime, upsert: false });
  if (upErr) return reply(500, { error: "Could not store the clip: " + upErr.message });
  const { data: row, error: rowErr } = await admin.from("device_media").insert({
    org_id: veh.org_id, device_id: deviceId, vehicle_id: vehicleId, event_id: linkEvent, channel_no: 1, role: "cabin_dms",
    kind: "clip", storage_path: path, mime, bytes: bytes.length, captured_at: at.toISOString(), simulated: false,
  }).select("id").single();
  if (rowErr) return reply(500, { error: rowErr.message });
  if (linkEvent) await admin.from("device_events").update({ video_url: "storage:device-media/" + path }).eq("id", linkEvent).is("video_url", null);
  await admin.from("devices").update({ last_seen_at: new Date().toISOString() }).eq("id", deviceId);
  return reply(200, { ok: true, media_id: row.id, event_id: linkEvent, bytes: bytes.length });
});
