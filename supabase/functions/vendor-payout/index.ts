// FleetWorks — send a workshop's fortnightly payout via Cashfree Payouts
// (Supabase Edge Function, Deno). Called by FleetWorks admin to settle
// completed job cards every fortnight (1st & 16th of each month).
//
// Auth: caller must be signed in and have app_metadata.role = 'admin'.
//       Garages cannot trigger their own payout — only FleetWorks admin can.
//
// The gross_amount is the total job value; platform_fee defaults to 10%;
// the actual transfer amount is gross - fee. Both are recorded for GST books.
//
// Secrets:
//   CASHFREE_CLIENT_ID, CASHFREE_CLIENT_SECRET, CASHFREE_ENV
//   PLATFORM_FEE_PCT  — optional, defaults to "10" (percent as a string)
//
// Deploy:
//   supabase functions deploy vendor-payout --no-verify-jwt

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL  = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CF_CLIENT_ID     = Deno.env.get("CASHFREE_CLIENT_ID") || "";
const CF_CLIENT_SECRET = Deno.env.get("CASHFREE_CLIENT_SECRET") || "";
const CF_BASE = (Deno.env.get("CASHFREE_ENV") || "sandbox") === "production"
  ? "https://api.cashfree.com/payout"
  : "https://sandbox.cashfree.com/payout";
const PLATFORM_FEE_PCT = parseFloat(Deno.env.get("PLATFORM_FEE_PCT") || "10") / 100;

const ALLOW_ORIGINS = [
  "https://fleetworks.in", "https://www.fleetworks.in",
  "http://localhost:8642", "http://127.0.0.1:8642",
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
const err = (origin: string | null, status: number, message: string) =>
  new Response(JSON.stringify({ error: message }), { status, headers: cors(origin) });

interface Body {
  garageUserId?: string;
  grossAmount?: number;
  period?: string;
  notes?: string;
  overridePlatformFee?: number;   // optional: override the configured fee for this payout
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST") return err(origin, 405, "POST only");
  if (!CF_CLIENT_ID || !CF_CLIENT_SECRET) {
    return err(origin, 503, "Payment gateway not configured — add Cashfree secrets.");
  }

  const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return err(origin, 401, "Sign in first.");

  let body: Body;
  try { body = await req.json(); } catch { return err(origin, 400, "bad_json"); }

  const grossAmount = Number(body.grossAmount);
  const period      = (body.period || "").trim().slice(0, 20);
  const notes       = (body.notes  || "").trim().slice(0, 200);
  const garageUserId = (body.garageUserId || "").trim();

  if (!garageUserId) return err(origin, 400, "garageUserId is required.");
  if (!grossAmount || grossAmount <= 0) return err(origin, 400, "grossAmount must be positive.");

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: callerRes, error: callerErr } = await admin.auth.getUser(jwt);
  if (callerErr || !callerRes?.user) return err(origin, 401, "Session expired.");

  const callerMeta = callerRes.user.app_metadata || {};
  if (callerMeta.role !== "admin") {
    return err(origin, 403, "Only FleetWorks admin can trigger vendor payouts.");
  }

  const { data: payout, error: poErr } = await admin
    .from("vendor_payout_details")
    .select("cf_beneficiary_id, method")
    .eq("garage_user_id", garageUserId)
    .maybeSingle();
  if (poErr || !payout) {
    return err(origin, 400, "This workshop has no bank/UPI details on file — they need to register first.");
  }

  const feePct       = typeof body.overridePlatformFee === "number" ? body.overridePlatformFee / 100 : PLATFORM_FEE_PCT;
  const platformFee  = Math.round(grossAmount * feePct * 100) / 100;
  const netAmount    = Math.round((grossAmount - platformFee) * 100) / 100;

  if (netAmount <= 0) return err(origin, 400, "Net amount after platform fee is zero or negative.");

  const transferRef = `ven${garageUserId.replace(/-/g, "").slice(0, 8)}${Date.now().toString(36)}`.slice(0, 40);

  let cfRes: Response;
  try {
    cfRes = await fetch(CF_BASE + "/transfers", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-client-id": CF_CLIENT_ID,
        "x-client-secret": CF_CLIENT_SECRET,
        "x-api-version": "2024-01-01",
      },
      body: JSON.stringify({
        transfer_id:      transferRef,
        transfer_amount:  netAmount,
        transfer_currency: "INR",
        beneficiary_details: { beneficiary_id: payout.cf_beneficiary_id },
      }),
    });
  } catch {
    return err(origin, 502, "Could not reach the payment gateway — try again in a moment.");
  }

  const cfJson = await cfRes.json().catch(() => ({}));

  if (!cfRes.ok) {
    await admin.from("vendor_payments").insert({
      garage_user_id: garageUserId, period, gross_amount: grossAmount,
      platform_fee: platformFee, amount: netAmount, method: payout.method,
      status: "failed", transfer_ref: transferRef, notes,
      failure_reason: cfJson.message || cfJson.error || `Cashfree returned ${cfRes.status}`,
      initiated_by: callerRes.user.id,
    });
    return err(origin, 400, cfJson.message || cfJson.error || "Cashfree rejected this transfer.");
  }

  const cfStatus = (cfJson.status || "PENDING").toString().toUpperCase();
  const status = cfStatus === "SUCCESS" ? "success"
    : cfStatus === "FAILED" || cfStatus === "REJECTED" ? "failed"
    : "processing";

  const { error: insErr } = await admin.from("vendor_payments").insert({
    garage_user_id: garageUserId, period, gross_amount: grossAmount,
    platform_fee: platformFee, amount: netAmount, method: payout.method,
    status, transfer_ref: transferRef,
    cf_transfer_id: cfJson.cf_transfer_id ? String(cfJson.cf_transfer_id) : null,
    utr: cfJson.transfer_utr || null,
    notes, initiated_by: callerRes.user.id,
    completed_at: status === "success" ? new Date().toISOString() : null,
  });
  if (insErr) {
    return err(origin, 500, "Cashfree accepted the transfer but saving the record failed: " + insErr.message);
  }

  return new Response(JSON.stringify({ ok: true, status, transferRef, netAmount, platformFee }), {
    headers: cors(origin),
  });
});
