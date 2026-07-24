// FleetWorks — invite a supervisor or driver (Supabase Edge Function, Deno).
// Creates a real auth account for the team member, adds them to the owner's
// org, and assigns the vehicles they can see/update. Runs with the
// service-role key — auto-injected into every Supabase edge function as
// SUPABASE_SERVICE_ROLE_KEY, never present in the browser. The caller's own
// JWT is verified first, so only an existing owner/manager of an org can
// invite into it.
//
// Deploy:
//   supabase functions deploy team-invite --no-verify-jwt
// (verification is done manually inside — see below — because the function
// also needs the service-role client for the privileged writes)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const ALLOW_ORIGINS = [
  "https://fleetworks.in",
  "https://www.fleetworks.in",
  "http://localhost:8642",
  "http://127.0.0.1:8642",
];
function cors(origin: string | null) {
  const o = origin && ALLOW_ORIGINS.includes(origin) ? origin : ALLOW_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": o,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, authorization, apikey",
    "Content-Type": "application/json",
  };
}
function err(origin: string | null, status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), { status, headers: cors(origin) });
}

interface Body {
  email?: string;
  password?: string;
  name?: string;
  role?: "supervisor" | "driver";
  vehicles?: { extId: string; access: "view" | "update" }[];
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST") return err(origin, 405, "POST only");

  const authHeader = req.headers.get("authorization") || "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt) return err(origin, 401, "Sign in first.");

  let body: Body;
  try { body = await req.json(); } catch { return err(origin, 400, "bad_json"); }

  const email = (body.email || "").trim().toLowerCase();
  const password = (body.password || "").trim();
  const name = (body.name || "").trim();
  const role = body.role === "driver" ? "driver" : "supervisor";
  const vehicles = Array.isArray(body.vehicles) ? body.vehicles.slice(0, 200) : [];

  if (!email || !email.includes("@")) return err(origin, 400, "Enter a valid email.");
  if (!password || password.length < 6) return err(origin, 400, "Password must be at least 6 characters.");
  if (!vehicles.length) return err(origin, 400, "Assign at least one vehicle.");

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

  // 1. Identify the caller from their own JWT (never trust a client-sent id).
  const { data: callerRes, error: callerErr } = await admin.auth.getUser(jwt);
  if (callerErr || !callerRes?.user) return err(origin, 401, "Session expired — sign in again.");
  const callerId = callerRes.user.id;

  // 2. Confirm the caller is an owner/manager of some org, and get it.
  const { data: membership, error: memErr } = await admin
    .from("memberships")
    .select("org_id")
    .eq("user_id", callerId)
    .in("role", ["owner", "manager"])
    .limit(1)
    .maybeSingle();
  if (memErr || !membership) return err(origin, 403, "Only the fleet owner or a manager can invite team members.");
  const orgId = membership.org_id as string;

  // 3. Create the team member's real auth account.
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
    user_metadata: { full_name: name || undefined, fleetworks_role: role },
  });
  if (createErr || !created?.user) {
    const msg = /already.*registered|already exists/i.test(createErr?.message || "")
      ? "That email already has a FleetWorks account."
      : (createErr?.message || "Could not create the account.");
    return err(origin, 400, msg);
  }
  const newUserId = created.user.id;

  // 4. Membership + vehicle assignments (service role bypasses RLS — this
  //    is the one privileged path that's allowed to write memberships for
  //    someone other than the caller).
  const { error: mErr } = await admin.from("memberships").insert({ org_id: orgId, user_id: newUserId, role });
  if (mErr) return err(origin, 500, "Account created but membership failed: " + mErr.message);

  const rows = vehicles
    .filter(v => v && v.extId)
    .map(v => ({ org_id: orgId, user_id: newUserId, vehicle_ext_id: String(v.extId), access: v.access === "update" ? "update" : "view" }));
  if (rows.length) {
    const { error: vErr } = await admin.from("vehicle_assignments").insert(rows);
    if (vErr) return err(origin, 500, "Account + role created but vehicle assignment failed: " + vErr.message);
  }

  return new Response(JSON.stringify({ ok: true, userId: newUserId, email, role, vehicleCount: rows.length }), { headers: cors(origin) });
});
