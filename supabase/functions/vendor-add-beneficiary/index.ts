// FleetWorks — register a garage/workshop's bank account or UPI ID as a
// Cashfree Payouts beneficiary (Supabase Edge Function, Deno).
//
// Called by garage.html when the workshop owner fills in their bank/UPI
// details to receive fortnightly payouts. Raw account number / UPI handle
// passes through this function ONCE, straight to Cashfree — only the
// masked display string and beneficiary_id are stored in our DB.
//
// Auth: the garage must be signed in (their own auth session from garage.html).
//       No org/fleet membership required — garages are independent users.
//
// Secrets (same as payroll-add-beneficiary):
//   CASHFREE_CLIENT_ID, CASHFREE_CLIENT_SECRET, CASHFREE_ENV
//
// Deploy:
//   supabase functions deploy vendor-add-beneficiary --no-verify-jwt

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CF_CLIENT_ID     = Deno.env.get("CASHFREE_CLIENT_ID") || "";
const CF_CLIENT_SECRET = Deno.env.get("CASHFREE_CLIENT_SECRET") || "";
const CF_BASE = (Deno.env.get("CASHFREE_ENV") || "sandbox") === "production"
  ? "https://api.cashfree.com/payout"
  : "https://sandbox.cashfree.com/payout";

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

function maskUpi(vpa: string) {
  const [user, handle] = vpa.split("@");
  if (!handle) return "***";
  const shown = user.length > 2 ? user.slice(0, 2) : user[0] || "*";
  return `${shown}${"*".repeat(Math.max(1, user.length - shown.length))}@${handle}`;
}

interface Body {
  accountHolderName?: string;
  method?: "bank" | "upi";
  bankAccountNumber?: string;
  bankIfsc?: string;
  upiId?: string;
  gstin?: string;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST") return err(origin, 405, "POST only");
  if (!CF_CLIENT_ID || !CF_CLIENT_SECRET) {
    return err(origin, 503, "Payment gateway not configured — contact FleetWorks support.");
  }

  const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return err(origin, 401, "Sign in first.");

  let body: Body;
  try { body = await req.json(); } catch { return err(origin, 400, "bad_json"); }

  const method = body.method === "upi" ? "upi" : "bank";
  const accountHolderName = (body.accountHolderName || "").trim();
  const bankAccountNumber = (body.bankAccountNumber || "").replace(/\s+/g, "");
  const bankIfsc  = (body.bankIfsc  || "").trim().toUpperCase();
  const upiId     = (body.upiId    || "").trim();
  const gstin     = (body.gstin    || "").trim().toUpperCase().slice(0, 15) || null;

  if (!accountHolderName) return err(origin, 400, "Enter the account holder's name.");
  if (method === "bank" && (!bankAccountNumber || !bankIfsc)) {
    return err(origin, 400, "Enter both the current account number and IFSC code.");
  }
  if (method === "upi" && !upiId.includes("@")) {
    return err(origin, 400, "Enter a valid UPI ID (e.g. workshopname@bank).");
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: callerRes, error: callerErr } = await admin.auth.getUser(jwt);
  if (callerErr || !callerRes?.user) return err(origin, 401, "Session expired — sign in again.");
  const garageUserId = callerRes.user.id;

  const safeName = accountHolderName.replace(/[^a-zA-Z ]/g, "").trim().slice(0, 100) || "Workshop";
  const beneficiaryId = `fwv${garageUserId.replace(/-/g, "").slice(0, 12)}${Date.now().toString(36)}`.slice(0, 50);

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
    return err(origin, 400,
      cfJson.message || cfJson.error ||
      "Cashfree rejected these details — double-check account number/IFSC or UPI ID."
    );
  }

  const row = {
    garage_user_id:       garageUserId,
    method,
    account_holder_name:  safeName,
    bank_ifsc:            method === "bank" ? bankIfsc : null,
    bank_account_last4:   method === "bank" ? bankAccountNumber.slice(-4) : null,
    upi_id_masked:        method === "upi"  ? maskUpi(upiId) : null,
    cf_beneficiary_id:    beneficiaryId,
    beneficiary_status:   (cfJson.beneficiary_status || "pending").toString().toLowerCase(),
    gstin,
    updated_at:           new Date().toISOString(),
  };

  // Upsert — a garage re-registering replaces the old beneficiary (new details = new Cashfree id).
  await admin.from("vendor_payout_details").delete().eq("garage_user_id", garageUserId);
  const { error: insErr } = await admin.from("vendor_payout_details").insert(row);
  if (insErr) {
    return err(origin, 500, "Beneficiary registered at Cashfree but saving it here failed: " + insErr.message);
  }

  return new Response(JSON.stringify({
    ok: true,
    method,
    last4: row.bank_account_last4,
    upiMasked: row.upi_id_masked,
    beneficiaryStatus: row.beneficiary_status,
  }), { headers: cors(origin) });
});
