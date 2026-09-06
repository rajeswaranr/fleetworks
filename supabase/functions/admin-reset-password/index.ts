// FleetWorks — admin-issued password reset (Supabase Edge Function, Deno).
// A locked-out owner or partner rings their BDM; an admin looks them up here and
// reads out a temporary password. No SMTP, no email deliverability, no DNS —
// which is why this exists alongside the emailed self-service flow rather than
// instead of it.
//
// Runs with the service-role key (auto-injected, never in the browser) because
// setting another user's password requires the admin auth API. The caller's own
// JWT is verified first and must carry app_metadata.role = 'admin', so an owner
// or partner account cannot reach this even though the function is public.
//
// Deploy:
//   npx supabase functions deploy admin-reset-password --no-verify-jwt

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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

// Generated rather than admin-chosen: a human picking passwords all day ends up
// issuing "Welcome123" to every locked-out customer. Ambiguous characters are
// left out because this gets read aloud over a phone line.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
function tempPassword(len = 12): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST") return err(origin, 405, "POST only");

  const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return err(origin, 401, "Sign in first.");

  let body: { email?: string };
  try { body = await req.json(); } catch { return err(origin, 400, "bad_json"); }
  const email = (body.email || "").trim().toLowerCase();
  if (!email || !email.includes("@")) return err(origin, 400, "Enter the user's email address.");

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Admins only — same gate as the vendor_leads RLS policy, checked against the
  // caller's real JWT rather than anything the client sends.
  const { data: callerRes, error: callerErr } = await admin.auth.getUser(jwt);
  if (callerErr || !callerRes?.user) return err(origin, 401, "Session expired — sign in again.");
  // deno-lint-ignore no-explicit-any
  if ((callerRes.user.app_metadata as any)?.role !== "admin") return err(origin, 403, "Admins only.");
  const actor = callerRes.user;

  // listUsers has no server-side email filter, so page through and match. Fleet
  // counts here are in the hundreds, not millions; if that stops being true this
  // wants replacing with an RPC over auth.users.
  let target: { id: string; email?: string } | null = null;
  for (let page = 1; page <= 20 && !target; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) return err(origin, 500, "Could not look up users: " + error.message);
    if (!data.users.length) break;
    target = data.users.find((u) => (u.email || "").toLowerCase() === email) ?? null;
    if (data.users.length < 200) break;
  }
  if (!target) return err(origin, 404, `No FleetWorks account uses ${email}.`);

  const password = tempPassword();
  const { error: upErr } = await admin.auth.admin.updateUserById(target.id, { password });
  if (upErr) return err(origin, 500, "Could not set the password: " + upErr.message);

  // Audit before responding. If the write fails the reset has already happened,
  // so surface it rather than pretending it didn't — an untracked password
  // change is precisely what this table exists to prevent.
  const { error: logErr } = await admin.from("admin_password_resets").insert({
    target_user_id: target.id,
    target_email: email,
    performed_by: actor.id,
    performed_email: actor.email,
  });

  return new Response(JSON.stringify({
    ok: true,
    email,
    password,
    warning: logErr ? "Password was changed but the audit record failed: " + logErr.message : undefined,
  }), { headers: cors(origin) });
});
