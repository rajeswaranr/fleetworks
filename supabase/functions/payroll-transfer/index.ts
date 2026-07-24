// FleetWorks — send a driver's salary via Cashfree Payouts (Supabase Edge
// Function, Deno). Looks up the driver's already-registered beneficiary_id
// (see payroll-add-beneficiary), asks Cashfree to move the money, and
// records the outcome in salary_payments. Final status for anything not
// immediately final also arrives via payroll-webhook.
//
// NOTE ON THE CASHFREE CALL: built against Cashfree Payouts v2's documented
// conventions (same auth headers and snake_case field style as the
// confirmed /beneficiary endpoint). Cashfree's transfer endpoint request
// body could not be pulled from their docs with full certainty — if the
// first real sandbox transfer comes back with a 400, the error message from
// Cashfree (returned verbatim in this function's response) will say exactly
// which field name to fix.
//
// Deploy:
//   supabase functions deploy payroll-transfer --no-verify-jwt

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CF_CLIENT_ID = Deno.env.get("CASHFREE_CLIENT_ID") || "";
const CF_CLIENT_SECRET = Deno.env.get("CASHFREE_CLIENT_SECRET") || "";
const CF_BASE = (Deno.env.get("CASHFREE_ENV") || "sandbox") === "production"
  ? "https://api.cashfree.com/payout"
  : "https://sandbox.cashfree.com/payout";

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
  driverExtId?: string;
  amount?: number;
  period?: string;
  notes?: string;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST") return err(origin, 405, "POST only");
  if (!CF_CLIENT_ID || !CF_CLIENT_SECRET) return err(origin, 500, "Payment gateway not configured yet — ask FleetWorks support to finish Cashfree setup.");

  const authHeader = req.headers.get("authorization") || "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt) return err(origin, 401, "Sign in first.");

  let body: Body;
  try { body = await req.json(); } catch { return err(origin, 400, "bad_json"); }

  const driverExtId = (body.driverExtId || "").trim();
  const amount = Number(body.amount);
  const period = (body.period || "").trim().slice(0, 20);
  const notes = (body.notes || "").trim().slice(0, 200);

  if (!driverExtId) return err(origin, 400, "Missing driver.");
  if (!amount || amount <= 0) return err(origin, 400, "Enter a valid amount.");

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

  const { data: callerRes, error: callerErr } = await admin.auth.getUser(jwt);
  if (callerErr || !callerRes?.user) return err(origin, 401, "Session expired — sign in again.");
  const callerId = callerRes.user.id;

  const { data: membership, error: memErr } = await admin
    .from("memberships")
    .select("org_id")
    .eq("user_id", callerId)
    .in("role", ["owner", "manager"])
    .limit(1)
    .maybeSingle();
  if (memErr || !membership) return err(origin, 403, "Only the fleet owner or a manager can send salary payments.");
  const orgId = membership.org_id as string;

  const { data: payout, error: poErr } = await admin
    .from("driver_payout_details")
    .select("cf_beneficiary_id, method")
    .eq("org_id", orgId)
    .eq("driver_ext_id", driverExtId)
    .maybeSingle();
  if (poErr || !payout) return err(origin, 400, "This driver has no bank/UPI details on file yet — set that up first.");

  const transferRef = `sal${orgId.replace(/-/g, "").slice(0, 8)}${Date.now().toString(36)}`.slice(0, 40);

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
        transfer_id: transferRef,
        transfer_amount: amount,
        transfer_currency: "INR",
        beneficiary_details: { beneficiary_id: payout.cf_beneficiary_id },
      }),
    });
  } catch {
    return err(origin, 502, "Could not reach the payment gateway — try again in a moment.");
  }
  const cfJson = await cfRes.json().catch(() => ({}));

  if (!cfRes.ok) {
    // Record the failed attempt too — visible in the payroll history, not just a toast that vanishes.
    await admin.from("salary_payments").insert({
      org_id: orgId, driver_ext_id: driverExtId, period, amount, method: payout.method,
      status: "failed", transfer_ref: transferRef, notes,
      failure_reason: cfJson.message || cfJson.error || `Cashfree returned ${cfRes.status}`,
      initiated_by: callerId,
    });
    return err(origin, 400, cfJson.message || cfJson.error || "Cashfree rejected this transfer.");
  }

  const cfStatus = (cfJson.status || "PENDING").toString().toUpperCase();
  const status = cfStatus === "SUCCESS" ? "success" : cfStatus === "FAILED" || cfStatus === "REJECTED" ? "failed" : "processing";

  const { error: insErr } = await admin.from("salary_payments").insert({
    org_id: orgId, driver_ext_id: driverExtId, period, amount, method: payout.method,
    status, transfer_ref: transferRef,
    cf_transfer_id: cfJson.cf_transfer_id ? String(cfJson.cf_transfer_id) : null,
    utr: cfJson.transfer_utr || null,
    notes, initiated_by: callerId,
    completed_at: status === "success" ? new Date().toISOString() : null,
  });
  if (insErr) return err(origin, 500, "Cashfree accepted the transfer but saving the record failed: " + insErr.message);

  return new Response(JSON.stringify({ ok: true, status, transferRef }), { headers: cors(origin) });
});
