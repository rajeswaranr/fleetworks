// FleetWorks — WhatsApp webhook (Supabase Edge Function, Deno).
//
// The inbound half. Meta posts here when a driver replies and when a message
// we sent changes state. Two jobs:
//
//   1. Open the free 24-hour window on the contact, so everything FleetWorks
//      sends for the next day costs nothing.
//   2. Turn an attendance reply into a driver_attendance row. That is the whole
//      point of the attendance template: the daily- and trip-basis drivers this
//      fleet runs on are paid days-worked x rate, and without a record that
//      number gets typed from memory at the end of the month.
//
// THIS ENDPOINT IS PUBLIC AND UNAUTHENTICATED, so the signature check is the
// only thing standing between a stranger and the ability to mark attendance,
// fabricate inbound messages, and open free messaging windows on other people's
// contacts. Meta signs every payload with HMAC-SHA256 over the raw body using
// the app secret; we recompute it and compare in constant time. Unsigned or
// mismatched payloads are refused before anything is parsed. Without
// WHATSAPP_APP_SECRET set, the function refuses everything rather than running
// unverified — an open webhook is worse than no webhook.
//
// Deploy (must skip JWT verification — Meta has no Supabase session):
//   npx supabase functions deploy whatsapp-webhook --no-verify-jwt
//   npx supabase secrets set WHATSAPP_VERIFY_TOKEN=<random string, also in the provider dashboard>
//   npx supabase secrets set WHATSAPP_APP_SECRET=<Meta app secret, or the 360dialog signing secret>
//   For 360dialog also: npx supabase secrets set WHATSAPP_PROVIDER=360dialog

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VERIFY_TOKEN = Deno.env.get("WHATSAPP_VERIFY_TOKEN") || "";
const APP_SECRET = Deno.env.get("WHATSAPP_APP_SECRET") || "";
const PROVIDER = (Deno.env.get("WHATSAPP_PROVIDER") || "meta").toLowerCase();

// Which header carries the signature. 360dialog forwards Meta's event bodies
// unchanged — the parsing below is untouched — but signs them itself under
// x-360dialog-signature.
//
// I could NOT confirm 360dialog's signing algorithm from their public docs.
// The HMAC-SHA256-over-raw-body check below is Meta's scheme and is applied to
// both; if 360dialog differs, every payload fails the check and nothing is
// processed. That is the correct way round for a public endpoint that can mark
// attendance: verify against their docs before switching PROVIDER, because it
// will fail closed and silently, not open.
const SIG_HEADER = PROVIDER === "360dialog" ? "x-360dialog-signature" : "x-hub-signature-256";

const WINDOW_HOURS = 24;

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// HMAC-SHA256 over the EXACT bytes Meta sent. Re-serialising parsed JSON would
// change whitespace and key order and never match, so the raw text is read once
// and used for both the check and the parse.
async function signatureOk(raw: string, header: string | null): Promise<boolean> {
  if (!APP_SECRET || !header) return false;
  const provided = header.startsWith("sha256=") ? header.slice(7) : header;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(APP_SECRET),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw));
  const expected = Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return constantTimeEqual(expected, provided.toLowerCase());
}

// The attendance template asks the driver to reply 1-4. Accept the digit or the
// obvious words, in English and transliterated Tamil/Hindi, because a driver
// answering "on duty" instead of "1" has still answered.
function readAttendance(text: string): string | null {
  const t = text.trim().toLowerCase();
  if (/^1\b/.test(t) || /\b(on duty|duty|present|haazir|hazir|iruken|irukken)\b/.test(t)) return "present";
  // Deliberately NOT the bare vehicle nouns (gaadi, vandi): "gaadi kharab hai"
  // is a driver reporting a breakdown, and reading that as "on trip" marks a
  // working day from a message that said the opposite.
  if (/^2\b/.test(t) || /\b(on trip|trip|load)\b/.test(t)) return "on_trip";
  if (/^3\b/.test(t) || /\b(rest|holiday|off|leave day|weekly off)\b/.test(t)) return "rest";
  if (/^4\b/.test(t) || /\b(leave|chutti|selavu|absent)\b/.test(t)) return "leave";
  return null;
}

Deno.serve(async (req) => {
  const url = new URL(req.url);

  // ---- Subscription handshake. Meta calls this once when the webhook is set up.
  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge") || "";
    if (mode === "subscribe" && VERIFY_TOKEN && token && constantTimeEqual(token, VERIFY_TOKEN)) {
      return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
    }
    return new Response("forbidden", { status: 403 });
  }

  if (req.method !== "POST") return new Response("POST only", { status: 405 });

  const raw = await req.text();
  if (!await signatureOk(raw, req.headers.get(SIG_HEADER))) {
    return new Response("bad signature", { status: 401 });
  }

  let payload: any;
  try { payload = JSON.parse(raw); } catch { return new Response("bad json", { status: 400 }); }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value ?? {};

      // ---- Delivery receipts: correct the status of what we sent.
      for (const st of value.statuses ?? []) {
        const status = ["sent", "delivered", "read", "failed"].includes(st.status) ? st.status : null;
        if (!status || !st.id) continue;
        await admin.from("whatsapp_messages").update({
          status,
          error_code: st.errors?.[0]?.code ? String(st.errors[0].code) : null,
          error_detail: st.errors?.[0]?.title ?? null,
        }).eq("wa_message_id", st.id);
      }

      // ---- Inbound messages.
      for (const msg of value.messages ?? []) {
        const from = String(msg.from || "");
        if (!from) continue;
        // Meta reports the number without a leading +; our contacts are E.164.
        const phone = from.startsWith("+") ? from : "+" + from;
        const text = msg.text?.body ?? msg.button?.text ?? msg.interactive?.list_reply?.title ?? "";

        const { data: contacts } = await admin.from("whatsapp_contacts")
          .select("id, org_id, driver_id, name").eq("phone", phone);
        if (!contacts || !contacts.length) continue;   // unknown number: nothing to attach it to

        const expires = new Date(Date.now() + WINDOW_HOURS * 3600 * 1000).toISOString();

        for (const c of contacts) {
          await admin.from("whatsapp_contacts").update({
            window_expires_at: expires,
            wa_id: value.contacts?.[0]?.wa_id ?? null,
          }).eq("id", c.id);

          await admin.from("whatsapp_messages").insert({
            org_id: c.org_id, contact_id: c.id, direction: "in",
            body: text, status: "received", wa_message_id: msg.id ?? null,
            cost_category: "free", ref_type: "inbound",
          });
        }

        // ---- Attendance, only when the answer is unambiguous.
        //
        // The same phone can be a contact in two fleets — a driver who works for
        // more than one owner. In that case there is no way to know whose
        // attendance "1" refers to, so the reply is recorded as a message and
        // deliberately NOT turned into an attendance row. Guessing would put a
        // day's wage on the wrong fleet's books.
        const status = readAttendance(text);
        const linked = contacts.filter((c) => c.driver_id);
        if (status && linked.length === 1) {
          const c = linked[0];
          const today = new Date().toISOString().slice(0, 10);
          await admin.from("driver_attendance").upsert({
            org_id: c.org_id, driver_id: c.driver_id,
            attendance_date: today, status, source: "whatsapp",
            marked_at: new Date().toISOString(),
          }, { onConflict: "org_id,driver_id,attendance_date" });
        }
      }
    }
  }

  // Meta retries anything that is not a 200, so acknowledge once the work is done.
  return new Response("ok", { status: 200 });
});
