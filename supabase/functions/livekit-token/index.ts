// FleetWorks — LiveKit access token minting (Supabase Edge Function, Deno).
//
// Gives the driver's phone and the fleet's owner/supervisor a short-lived, vehicle-scoped
// LiveKit token so a Safe Drive session can stream true live video into the fleet dashboard.
// LiveKit Cloud (or a self-hosted LiveKit later — same API) does the media; FleetWorks only
// mints the token and decides who may publish vs watch. This is the one place that touches
// LiveKit; the browser talks to it through the portable MediaService seam (js/core/media-service.js).
//
// POST application/json, with the caller's Supabase JWT:
//   { vehicleId, role: "publish" | "view" }
//     publish  the driver on this vehicle broadcasts the cabin camera
//     view     the owner/supervisor watches it
//
// One room per vehicle: veh_<vehicleId>. A publisher can only publish; a viewer can only
// subscribe. Org membership is verified for both; viewing is limited to owner/manager/
// supervisor. Token lives 2 hours (a long drive), signed with the LiveKit API secret.
//
// Secrets (Supabase → Edge Functions → Secrets):
//   LIVEKIT_URL         wss://<your-project>.livekit.cloud
//   LIVEKIT_API_KEY     API key from LiveKit Cloud
//   LIVEKIT_API_SECRET  API secret from LiveKit Cloud
// Deploy:  npx supabase functions deploy livekit-token --no-verify-jwt

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LIVEKIT_URL = Deno.env.get("LIVEKIT_URL") || "";
const LIVEKIT_API_KEY = Deno.env.get("LIVEKIT_API_KEY") || "";
const LIVEKIT_API_SECRET = Deno.env.get("LIVEKIT_API_SECRET") || "";
const TTL_SECONDS = 2 * 60 * 60;
const ALLOW = ["https://fleetworks.in", "https://www.fleetworks.in", "http://localhost:8642", "http://127.0.0.1:8642"];
const cors = (o: string | null) => ({
  "Access-Control-Allow-Origin": o && ALLOW.includes(o) ? o : ALLOW[0],
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, authorization, apikey",
  "Content-Type": "application/json",
});

// base64url without padding, for the JWT header/body/signature
const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const enc = (s: string) => new TextEncoder().encode(s);

// A LiveKit access token is a JWT (HS256) whose `video` grant scopes it to one room.
async function mintLiveKitToken(identity: string, name: string, room: string, canPublish: boolean) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    iss: LIVEKIT_API_KEY,
    sub: identity,
    name,
    nbf: now,
    exp: now + TTL_SECONDS,
    video: {
      room,
      roomJoin: true,
      canPublish,
      canSubscribe: !canPublish ? true : false,   // publisher pushes; viewer only pulls
      canPublishData: false,
      hidden: !canPublish ? true : false,          // a watching owner is invisible in the room
    },
  };
  const signingInput = `${b64url(enc(JSON.stringify(header)))}.${b64url(enc(JSON.stringify(payload)))}`;
  const key = await crypto.subtle.importKey("raw", enc(LIVEKIT_API_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc(signingInput)));
  return `${signingInput}.${b64url(sig)}`;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  const reply = (s: number, b: unknown) => new Response(JSON.stringify(b), { status: s, headers: cors(origin) });
  if (req.method !== "POST") return reply(405, { error: "POST only" });
  if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) return reply(503, { error: "Live video is not configured yet. Add the LiveKit secrets." });

  const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return reply(401, { error: "Sign in first." });
  let body: { vehicleId?: string; role?: string };
  try { body = await req.json(); } catch { return reply(400, { error: "bad_json" }); }
  const vehicleId = String(body.vehicleId || "");
  const role = String(body.role || "");
  if (!vehicleId) return reply(400, { error: "vehicleId is required." });
  if (role !== "publish" && role !== "view") return reply(400, { error: "role must be publish or view." });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: caller } = await admin.auth.getUser(jwt);
  if (!caller?.user) return reply(401, { error: "Session expired - sign in again." });

  // The caller's fleets — needed to resolve a vehicle by its human number (ext_id), which is
  // only unique within an org. The driver app sends the DB UUID; the owner app's db.vehicles
  // keys by ext_id (see js/dbcore.js). Accept either and key the LiveKit room by the canonical
  // UUID, so both sides always meet in the same room.
  const { data: mems } = await admin.from("memberships").select("org_id, role").eq("user_id", caller.user.id);
  const orgIds = (mems || []).map((m) => m.org_id);
  if (!orgIds.length) return reply(403, { error: "You are not on any fleet." });

  const isUuid = /^[0-9a-f-]{36}$/i.test(vehicleId);
  const q = admin.from("vehicles").select("id, org_id, name").in("org_id", orgIds);
  const { data: veh } = await (isUuid ? q.eq("id", vehicleId) : q.eq("ext_id", vehicleId)).maybeSingle();
  if (!veh) return reply(404, { error: "Vehicle not found on your fleet." });
  const mem = (mems || []).find((m) => m.org_id === veh.org_id);
  if (!mem) return reply(403, { error: "You are not on this vehicle's fleet." });
  // only the owner / manager / supervisor may watch a driver's cabin
  if (role === "view" && !["owner", "manager", "supervisor"].includes(String(mem.role))) {
    return reply(403, { error: "Only the owner or a supervisor can watch live." });
  }

  const room = "veh_" + String(veh.id).replace(/-/g, "");
  const identity = (role === "publish" ? "drv_" : "view_") + caller.user.id.replace(/-/g, "");
  const name = role === "publish" ? "Driver phone" : "Watching";
  const token = await mintLiveKitToken(identity, name, room, role === "publish");
  return reply(200, { url: LIVEKIT_URL, token, room, identity, vehicle: veh.name });
});
