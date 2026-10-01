// FleetWorks — vision intelligence on the live stream (Supabase Edge Function, Deno).
//
// "Intelligence on the video" without a GPU or a server to run: a frame sampled from the
// live cabin/road camera (by the driver's phone while monitoring, or the owner on demand
// from AI Vision) is POSTed here; Claude's vision model reads it and reports any fleet-safety
// condition it sees, from a FIXED vocabulary that matches our device_events types. Confident
// detections become device_events through the normal pipeline, so they show in Incident Triage
// and on the map exactly like a hardware camera's alerts.
//
// This is the managed, infra-free alternative to DeepStream/Frigate: no NVIDIA box, no RTSP
// pipeline — the phone already decodes the frame, and a hosted model does the inference. A
// future DeepStream/Jetson can feed the same device_events via device-ingest instead.
//
// POST multipart/form-data, caller's Supabase JWT:
//   file        a JPEG frame
//   vehicleId   uuid (or ext_id)
//   view        "cabin" | "road"   (which camera, picks the vocabulary)
//   latitude?, longitude?
//
// Secrets: ANTHROPIC_API_KEY (already set for copilot / incident-analysis).
// Deploy:  npx supabase functions deploy vision-analyze --no-verify-jwt

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") || "";
const MODEL = "claude-haiku-4-5";          // fast + cheap for per-frame vision
const MAX_BYTES = 4 * 1024 * 1024;         // a sampled JPEG frame is tiny; cap generously
const DEDUP_MS = 60_000;                   // don't re-fire the same condition within a minute
const CONF_MIN = 0.6;

// vocabulary per camera — ONLY device_events.event_type values, so results map cleanly
const CABIN = ["no_seatbelt", "phone_use", "smoking", "distraction", "fatigue"];
const ROAD = ["forward_collision", "lane_departure", "pedestrian_warning", "harsh_brake"];
const CRITICAL = new Set(["forward_collision", "fatigue", "pedestrian_warning"]);

const ALLOW = ["https://fleetworks.in", "https://www.fleetworks.in", "http://localhost:8642", "http://127.0.0.1:8642"];
const cors = (o: string | null) => ({
  "Access-Control-Allow-Origin": o && ALLOW.includes(o) ? o : ALLOW[0],
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, authorization, apikey",
  "Content-Type": "application/json",
});
const toB64 = (bytes: Uint8Array) => { let s = ""; for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return btoa(s); };

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  const reply = (s: number, b: unknown) => new Response(JSON.stringify(b), { status: s, headers: cors(origin) });
  if (req.method !== "POST") return reply(405, { error: "POST only" });
  if (!ANTHROPIC_API_KEY) return reply(503, { error: "Vision analysis is not configured (ANTHROPIC_API_KEY)." });
  if (!(req.headers.get("content-type") || "").startsWith("multipart/form-data")) return reply(400, { error: "Send the frame as multipart form-data." });

  const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return reply(401, { error: "Sign in first." });

  let form: FormData;
  try { form = await req.formData(); } catch { return reply(400, { error: "Could not read the upload." }); }
  const file = form.get("file");
  const vehicleId = String(form.get("vehicleId") || "");
  const view = String(form.get("view") || "cabin") === "road" ? "road" : "cabin";
  const latNum = Number(form.get("latitude")); const lat = Number.isFinite(latNum) ? latNum : null;
  const lngNum = Number(form.get("longitude")); const lng = Number.isFinite(lngNum) ? lngNum : null;
  if (!(file instanceof File)) return reply(400, { error: "The frame 'file' is required." });
  if (!vehicleId) return reply(400, { error: "vehicleId is required." });
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!bytes.length) return reply(400, { error: "The frame is empty." });
  if (bytes.length > MAX_BYTES) return reply(413, { error: "Frame too large." });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: caller } = await admin.auth.getUser(jwt);
  if (!caller?.user) return reply(401, { error: "Session expired - sign in again." });
  const { data: mems } = await admin.from("memberships").select("org_id").eq("user_id", caller.user.id);
  const orgIds = (mems || []).map((m) => m.org_id);
  if (!orgIds.length) return reply(403, { error: "You are not on any fleet." });
  const isUuid = /^[0-9a-f-]{36}$/i.test(vehicleId);
  const vq = admin.from("vehicles").select("id, org_id").in("org_id", orgIds);
  const { data: veh } = await (isUuid ? vq.eq("id", vehicleId) : vq.eq("ext_id", vehicleId)).maybeSingle();
  if (!veh) return reply(404, { error: "Vehicle not found on your fleet." });

  // ── ask Claude's vision model, constrained to our vocabulary ──
  const vocab = view === "road" ? ROAD : CABIN;
  const sys = `You are a fleet-safety vision model looking at one ${view} camera frame from a truck. ` +
    `Report ONLY conditions you can clearly see, each strictly from this list: ${vocab.join(", ")}. ` +
    `Reply with JSON only: {"detections":[{"type":"<one of the list>","confidence":0..1,"note":"<=8 words"}]}. ` +
    `Empty list if nothing applies. Do not invent types outside the list.`;
  let detections: { type: string; confidence: number; note?: string }[] = [];
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: MODEL, max_tokens: 400,
        system: sys,
        messages: [{ role: "user", content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: toB64(bytes) } },
          { type: "text", text: "What do you see? JSON only." },
        ] }],
      }),
    });
    if (!r.ok) return reply(502, { error: "Vision model error (" + r.status + ")." });
    const j = await r.json();
    const text = (j.content || []).map((c: { text?: string }) => c.text || "").join("");
    const m = text.match(/\{[\s\S]*\}/);
    if (m) detections = (JSON.parse(m[0]).detections || []);
  } catch (e) { return reply(502, { error: "Vision call failed: " + (e as Error).message }); }

  // keep only confident, in-vocabulary detections
  detections = detections.filter((d) => d && vocab.includes(d.type) && Number(d.confidence) >= CONF_MIN);
  if (!detections.length) return reply(200, { ok: true, detections: [] });

  // reuse the vehicle's phone-DMS device
  const imei = "PHONE-DMS-" + String(veh.id).replace(/-/g, "").slice(0, 12);
  let deviceId: string | null = (await admin.from("devices").select("id").eq("org_id", veh.org_id).eq("imei", imei).maybeSingle()).data?.id ?? null;
  if (!deviceId) {
    const { data: made } = await admin.from("devices").insert({
      org_id: veh.org_id, vehicle_id: veh.id, imei, kind: "dashcam", protocol: "proprietary", integration: "native",
      vendor: "FleetWorks Safe Drive", model: "Driver phone (DMS)", capabilities: ["dms"], status: "active", simulated: false,
      notes: "AI vision on the phone camera.",
    }).select("id").single();
    deviceId = made?.id ?? null;
  }
  if (!deviceId) return reply(500, { error: "Could not register the camera device." });

  // create an event per detection, deduped per type per minute
  const since = new Date(Date.now() - DEDUP_MS).toISOString();
  const logged: string[] = [];
  for (const d of detections) {
    const { data: recent } = await admin.from("device_events").select("id")
      .eq("device_id", deviceId).eq("event_type", d.type).gt("occurred_at", since).limit(1);
    if (recent?.length) continue;
    const severity = CRITICAL.has(d.type) ? "critical" : "warning";
    await admin.from("device_events").insert({
      device_id: deviceId, org_id: veh.org_id, event_type: d.type, severity,
      latitude: lat, longitude: lng, occurred_at: new Date().toISOString(), simulated: false,
      raw: { source: "ai_vision", model: MODEL, confidence: d.confidence, note: d.note || null, view },
    });
    logged.push(d.type);
  }
  await admin.from("devices").update({ last_seen_at: new Date().toISOString() }).eq("id", deviceId);
  return reply(200, { ok: true, detections, logged });
});
