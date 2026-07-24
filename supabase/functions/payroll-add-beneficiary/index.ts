// FleetWorks — register a driver's bank account or UPI ID as a Cashfree
// Payouts beneficiary (Supabase Edge Function, Deno). The raw account
// number / UPI handle passes through this function ONCE, straight to
// Cashfree, and is never written to our own database — only Cashfree's
// beneficiary_id plus a masked display string are stored.
//
// Requires these Supabase secrets (set once, like ANTHROPIC_API_KEY was
// for the copilot function):
//   supabase secrets set CASHFREE_CLIENT_ID=xxxx
//   supabase secrets set CASHFREE_CLIENT_SECRET=xxxx
//   supabase secrets set CASHFREE_ENV=sandbox   (or "production" when ready)
//
// Deploy:
//   supabase functions deploy payroll-add-beneficiary --no-verify-jwt

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
  driverName?: string;
  method?: "bank" | "upi";
  bankAccountNumber?: string;
  bankIfsc?: string;
  upiId?: string;
}

function maskUpi(vpa: string) {
  const [user, handle] = vpa.split("@");
  if (!handle) return "***";
  const shown = user.length > 2 ? user.slice(0, 2) : user[0] || "*";
  return `${shown}${"*".repeat(Math.max(1, user.length - shown.length))}@${handle}`;
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
  const driverName = (body.driverName || "").trim();
  const method = body.method === "upi" ? "upi" : "bank";
  const bankAccountNumber = (body.bankAccountNumber || "").replace(/\s+/g, "");
  const bankIfsc = (body.bankIfsc || "").trim().toUpperCase();
  const upiId = (body.upiId || "").trim();

  if (!driverExtId) return err(origin, 400, "Missing driver.");
  if (!driverName) return err(origin, 400, "Enter the account holder's name.");
  if (method === "bank" && (!bankAccountNumber || !bankIfsc)) return err(origin, 400, "Enter both the bank account number and IFSC code.");
  if (method === "upi" && !upiId.includes("@")) return err(origin, 400, "Enter a valid UPI ID (e.g. name@bank).");

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
  if (memErr || !membership) return err(origin, 403, "Only the fleet owner or a manager can set up driver payouts.");
  const orgId = membership.org_id as string;

  // Cashfree beneficiary_id: max 50 chars, alphanumeric + _ | . — a fresh id
  // per save (rather than reusing one) since a beneficiary's bank/UPI details
  // can't be edited in place once created.
  const safeExt = driverExtId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 12);
  const beneficiaryId = `fw${orgId.replace(/-/g, "").slice(0, 8)}${safeExt}${Date.now().toString(36)}`.slice(0, 50);
  const safeName = driverName.replace(/[^a-zA-Z ]/g, "").trim().slice(0, 100) || "Driver";

  const cfBody: Record<string, unknown> = {
    beneficiary_id: beneficiaryId,
    beneficiary_name: safeName,
    beneficiary_instrument_details: method === "bank"
      ? { bank_account_number: bankAccountNumber, bank_ifsc: bankIfsc }
      : { vpa: upiId },
  };

  let cfRes: Response;
  try {
    cfRes = await fetch(CF_BASE + "/beneficiary", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-client-id": CF_CLIENT_ID,
        "x-client-secret": CF_CLIENT_SECRET,
        "x-api-version": "2024-01-01",
      },
      body: JSON.stringify(cfBody),
    });
  } catch {
    return err(origin, 502, "Could not reach the payment gateway — try again in a moment.");
  }
  const cfJson = await cfRes.json().catch(() => ({}));
  if (!cfRes.ok) {
    return err(origin, 400, cfJson.message || cfJson.error || "Cashfree rejected these details — double-check the account number/IFSC or UPI ID.");
  }

  const row = {
    org_id: orgId,
    driver_ext_id: driverExtId,
    method,
    account_holder_name: safeName,
    bank_ifsc: method === "bank" ? bankIfsc : null,
    bank_account_last4: method === "bank" ? bankAccountNumber.slice(-4) : null,
    upi_id_masked: method === "upi" ? maskUpi(upiId) : null,
    cf_beneficiary_id: beneficiaryId,
    beneficiary_status: (cfJson.beneficiary_status || "pending").toString().toLowerCase(),
    updated_at: new Date().toISOString(),
  };

  await admin.from("driver_payout_details").delete().eq("org_id", orgId).eq("driver_ext_id", driverExtId);
  const { error: insErr } = await admin.from("driver_payout_details").insert(row);
  if (insErr) return err(origin, 500, "Beneficiary created at Cashfree but saving it here failed: " + insErr.message);

  return new Response(JSON.stringify({
    ok: true,
    method,
    last4: row.bank_account_last4,
    upiMasked: row.upi_id_masked,
    beneficiaryStatus: row.beneficiary_status,
  }), { headers: cors(origin) });
});
