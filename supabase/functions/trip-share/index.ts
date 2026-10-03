// FleetWorks — Live Share (Supabase Edge Function, Deno).
//
// A customer-facing, read-only live-location link for one vehicle (Samsara "Live Sharing").
// The owner/supervisor mints a time-limited token; anyone with the link sees ONLY that
// vehicle's current position and speed — nothing else. The public view never touches the DB
// directly; it goes through this function (service role) so RLS and privacy stay intact.
//
// Owner (JWT):
//   { action: "create", vehicleId, hours?, label? }   -> { token, url, expires_at }
//   { action: "revoke", id }                           -> { ok }
//   { action: "list", vehicleId }                      -> { shares: [...] }
// Public (no auth):
//   { action: "status", token }  -> { vehicle, lat, lng, speed, heading, at }  (or { expired })
//
// Deploy:  npx supabase functions deploy trip-share --no-verify-jwt

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SITE = "https://fleetworks.in";
const cors = {
  "Access-Control-Allow-Origin": "*",      // the public view is any device; token is the key
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, authorization, apikey",
  "Content-Type": "application/json",
};
const S = {
  lat: "Vehicle.CurrentLocation.Latitude", lng: "Vehicle.CurrentLocation.Longitude",
  heading: "Vehicle.CurrentLocation.Heading", speed: "Vehicle.Speed",
};
const sig = (state: Record<string, { v?: unknown }> | null, path: string) => {
  const n = state && state[path] ? Number(state[path].v) : NaN; return Number.isFinite(n) ? n : null;
};
const newToken = () => { const a = new Uint8Array(18); crypto.getRandomValues(a); return btoa(String.fromCharCode(...a)).replace(/[+/=]/g, "").slice(0, 22); };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const reply = (s: number, b: unknown) => new Response(JSON.stringify(b), { status: s, headers: cors });
  if (req.method !== "POST") return reply(405, { error: "POST only" });
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  let body: { action?: string; vehicleId?: string; token?: string; id?: string; hours?: number; label?: string };
  try { body = await req.json(); } catch { return reply(400, { error: "bad_json" }); }
  const action = String(body.action || "");

  // ── public: current position by token ──
  if (action === "status") {
    const token = String(body.token || "");
    if (!token) return reply(400, { error: "token required" });
    const { data: sh } = await admin.from("trip_shares").select("vehicle_id, org_id, expires_at, revoked_at").eq("token", token).maybeSingle();
    if (!sh) return reply(404, { error: "This link is not valid." });
    if (sh.revoked_at || new Date(sh.expires_at) < new Date()) return reply(200, { expired: true });
    const { data: veh } = await admin.from("vehicles").select("name").eq("id", sh.vehicle_id).maybeSingle();
    const { data: twin } = await admin.from("vehicle_twin").select("state, last_reading_at").eq("vehicle_id", sh.vehicle_id).order("updated_at", { ascending: false }).limit(1).maybeSingle();
    const state = (twin?.state || {}) as Record<string, { v?: unknown }>;
    return reply(200, {
      vehicle: veh?.name || "Vehicle", lat: sig(state, S.lat), lng: sig(state, S.lng),
      speed: sig(state, S.speed), heading: sig(state, S.heading), at: twin?.last_reading_at || null,
    });
  }

  // ── owner/supervisor actions ──
  const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return reply(401, { error: "Sign in first." });
  const { data: caller } = await admin.auth.getUser(jwt);
  if (!caller?.user) return reply(401, { error: "Session expired - sign in again." });
  const { data: mems } = await admin.from("memberships").select("org_id, role").eq("user_id", caller.user.id);
  const canManage = (org: string) => (mems || []).some((m) => m.org_id === org && ["owner", "manager", "supervisor"].includes(String(m.role)));

  if (action === "create") {
    const vehicleId = String(body.vehicleId || "");
    if (!/^[0-9a-f-]{36}$/i.test(vehicleId)) return reply(400, { error: "vehicleId required." });
    const { data: veh } = await admin.from("vehicles").select("id, org_id, name").eq("id", vehicleId).maybeSingle();
    if (!veh || !canManage(veh.org_id)) return reply(403, { error: "Not allowed for this vehicle." });
    const hours = Math.min(168, Math.max(1, Number(body.hours) || 24));
    const token = newToken();
    const expires_at = new Date(Date.now() + hours * 3600e3).toISOString();
    const { error } = await admin.from("trip_shares").insert({ org_id: veh.org_id, vehicle_id: vehicleId, token, label: String(body.label || "").slice(0, 80) || null, created_by: caller.user.id, expires_at });
    if (error) return reply(500, { error: error.message });
    return reply(200, { token, url: `${SITE}/share.html?t=${token}`, expires_at, vehicle: veh.name });
  }
  if (action === "revoke") {
    const id = String(body.id || "");
    const { data: sh } = await admin.from("trip_shares").select("id, org_id").eq("id", id).maybeSingle();
    if (!sh || !canManage(sh.org_id)) return reply(403, { error: "Not allowed." });
    await admin.from("trip_shares").update({ revoked_at: new Date().toISOString() }).eq("id", id);
    return reply(200, { ok: true });
  }
  if (action === "list") {
    const vehicleId = String(body.vehicleId || "");
    const { data: shares } = await admin.from("trip_shares").select("id, token, label, expires_at, revoked_at, created_at")
      .eq("vehicle_id", vehicleId).order("created_at", { ascending: false }).limit(20);
    return reply(200, { shares: shares || [] });
  }
  return reply(400, { error: "Unknown action." });
});
