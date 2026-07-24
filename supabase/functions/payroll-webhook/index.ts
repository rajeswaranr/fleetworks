// FleetWorks — Cashfree Payouts webhook receiver (Supabase Edge Function,
// Deno). Cashfree calls this directly (no Supabase JWT), so it verifies the
// request itself via HMAC-SHA256 over "timestamp + raw body" using the
// Cashfree client secret, per their v2 webhook signing scheme.
//
// Set this URL as the Payouts webhook endpoint in the Cashfree dashboard:
//   https://crdblxeufbhysglbbtxi.supabase.co/functions/v1/payroll-webhook
//
// Deploy:
//   supabase functions deploy payroll-webhook --no-verify-jwt

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CF_CLIENT_SECRET = Deno.env.get("CASHFREE_CLIENT_SECRET") || "";

async function verifySignature(rawBody: string, timestamp: string, signature: string) {
  if (!CF_CLIENT_SECRET || !timestamp || !signature) return false;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(CF_CLIENT_SECRET),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(timestamp + rawBody));
  const computed = btoa(String.fromCharCode(...new Uint8Array(mac)));
  return computed === signature;
}

function mapStatus(eventType: string) {
  if (eventType === "TRANSFER_SUCCESS" || eventType === "CREDIT_CONFIRMATION") return "success";
  if (eventType === "TRANSFER_FAILED" || eventType === "TRANSFER_REJECTED" || eventType === "BULK_TRANSFER_REJECTED") return "failed";
  if (eventType === "TRANSFER_REVERSED") return "reversed";
  return "processing"; // TRANSFER_ACKNOWLEDGED and anything else not-yet-final
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("POST only", { status: 405 });

  const rawBody = await req.text();
  const signature = req.headers.get("x-webhook-signature") || "";
  const timestamp = req.headers.get("x-webhook-timestamp") || "";

  if (!(await verifySignature(rawBody, timestamp, signature))) {
    return new Response(JSON.stringify({ error: "bad_signature" }), { status: 401 });
  }

  let payload: any;
  try { payload = JSON.parse(rawBody); } catch { return new Response("bad_json", { status: 400 }); }

  const data = payload.data || payload;
  const transferRef = data.transfer_id || data.transferId;
  const eventType = payload.type || payload.event || "";
  if (!transferRef) return new Response(JSON.stringify({ ok: true, skipped: "no transfer_id" }), { status: 200 });

  const status = mapStatus(eventType);
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

  await admin.from("salary_payments").update({
    status,
    cf_transfer_id: data.cf_transfer_id ? String(data.cf_transfer_id) : undefined,
    utr: data.transfer_utr || undefined,
    failure_reason: status === "failed" ? (data.status_code || data.status || "Transfer failed") : undefined,
    completed_at: (status === "success" || status === "failed" || status === "reversed") ? new Date().toISOString() : undefined,
  }).eq("transfer_ref", transferRef);

  // Always 200 — Cashfree retries on non-2xx, and a missing/unknown transfer_ref
  // (e.g. a test event) shouldn't trigger retries.
  return new Response(JSON.stringify({ ok: true }), { status: 200 });
});
