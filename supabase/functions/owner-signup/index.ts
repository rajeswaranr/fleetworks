// FleetWorks — server-side owner signup (Supabase Edge Function, Deno).
// Creates a confirmed Supabase Auth user plus organization/membership so
// owner signup does not depend on Supabase confirmation email delivery.
//
// Deploy:
//   supabase functions deploy owner-signup --no-verify-jwt
//
// Then set FW_BACKEND.ownerSignupUrl in js/backend.js to:
//   https://<project-ref>.supabase.co/functions/v1/owner-signup

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const ALLOW_ORIGINS = [
  "https://fleetworks.in",
  "https://www.fleetworks.in",
  "http://localhost:8080",
  "http://127.0.0.1:8080",
  "http://localhost:8090",
  "http://127.0.0.1:8090",
  "http://localhost:8642",
  "http://127.0.0.1:8642",
];

function cors(origin: string | null) {
  const dev = origin && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin);
  const o = origin && (ALLOW_ORIGINS.includes(origin) || dev) ? origin : ALLOW_ORIGINS[0];
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
  profile?: {
    full_name?: string;
    transport_name?: string;
    gst_pan?: string;
    gst_pan_type?: string;
    mobile?: string;
    fleet_size?: number | null;
    trial_started?: string;
  };
}

function cleanText(value: unknown) {
  return String(value || "").trim();
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST") return err(origin, 405, "POST only");

  let body: Body;
  try { body = await req.json(); } catch { return err(origin, 400, "bad_json"); }

  const email = cleanText(body.email).toLowerCase();
  const password = cleanText(body.password);
  const profile = body.profile || {};
  const fullName = cleanText(profile.full_name);
  const orgName = cleanText(profile.transport_name) || "My Fleet";

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return err(origin, 400, "Enter a valid email.");
  if (password.length < 6) return err(origin, 400, "Password must be at least 6 characters.");
  if (!fullName) return err(origin, 400, "Please enter your name.");
  if (!orgName) return err(origin, 400, "Please enter your transport / company name.");

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      ...profile,
      full_name: fullName,
      transport_name: orgName,
      fleetworks_role: "owner",
    },
  });

  if (createErr || !created?.user) {
    const msg = /already.*registered|already exists|already been registered/i.test(createErr?.message || "")
      ? "That email already has a FleetWorks account. Sign in or reset the password."
      : (createErr?.message || "Could not create the account.");
    return err(origin, 400, msg);
  }

  const userId = created.user.id;
  const { data: org, error: orgErr } = await admin
    .from("organizations")
    .insert({
      name: orgName,
      gstin: cleanText(profile.gst_pan) || null,
      city: null,
    })
    .select("id")
    .single();

  if (orgErr || !org?.id) return err(origin, 500, "Account created but organization setup failed: " + (orgErr?.message || "unknown error"));

  const { error: memErr } = await admin
    .from("memberships")
    .insert({ org_id: org.id, user_id: userId, role: "owner" });

  if (memErr) return err(origin, 500, "Account created but owner membership setup failed: " + memErr.message);

  return new Response(JSON.stringify({ ok: true, userId, orgId: org.id, email }), { headers: cors(origin) });
});
