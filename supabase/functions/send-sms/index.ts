// FleetWorks — send-sms (Supabase Edge Function, Deno)
//
// Sends transactional SMS via MSG91 Flow API.
// All message types use pre-approved DLT templates.
//
// Secrets required (set in Supabase Dashboard → Edge Functions → Secrets):
//   MSG91_AUTH_KEY        — your MSG91 auth key
//   MSG91_SENDER_ID       — FLTWRK  (6-char DLT sender ID)
//   MSG91_TPL_SOS         — template_id for SOS alert
//   MSG91_TPL_HALT        — template_id for vehicle halt/breakdown
//   MSG91_TPL_DISPATCH    — template_id for dispatch plan ready
//   MSG91_TPL_WORKORDER   — template_id for new job card raised
//   MSG91_TPL_DOCUMENT    — template_id for document expiry reminder
//   MSG91_TPL_PAYMENT     — template_id for payment request
//
// Payload (POST JSON):
//   {
//     "event":  "sos" | "halt" | "dispatch" | "workorder" | "document" | "payment",
//     "recipients": [
//       { "mobile": "919876543210", "var1": "...", "var2": "...", ... }
//     ]
//   }
//
// Mobile numbers must include country code (91 for India), no + prefix.
//
// Deploy:
//   npx supabase functions deploy send-sms

const AUTH_KEY  = Deno.env.get("MSG91_AUTH_KEY")  || "";
const SENDER_ID = Deno.env.get("MSG91_SENDER_ID") || "FLTWRK";

const TEMPLATE_IDS: Record<string, string> = {
  sos:       Deno.env.get("MSG91_TPL_SOS")       || "",
  halt:      Deno.env.get("MSG91_TPL_HALT")      || "",
  dispatch:  Deno.env.get("MSG91_TPL_DISPATCH")  || "",
  workorder: Deno.env.get("MSG91_TPL_WORKORDER") || "",
  document:  Deno.env.get("MSG91_TPL_DOCUMENT")  || "",
  payment:   Deno.env.get("MSG91_TPL_PAYMENT")   || "",
};

const MSG91_API = "https://api.msg91.com/api/v5/flow/";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, content-type",
      },
    });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  let body: { event: string; recipients: Record<string, string>[] };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const { event, recipients } = body;

  if (!event || !recipients?.length) {
    return json({ error: "event and recipients[] are required" }, 400);
  }

  const templateId = TEMPLATE_IDS[event];
  if (!templateId) {
    return json({ error: `No template configured for event: ${event}. Set MSG91_TPL_${event.toUpperCase()} secret.` }, 400);
  }

  if (!AUTH_KEY) {
    return json({ error: "MSG91_AUTH_KEY secret not set" }, 500);
  }

  // Normalize mobile numbers — strip spaces/dashes, ensure 91 prefix
  const normalised = recipients.map((r) => ({
    ...r,
    mobiles: normaliseMobile(r.mobile || r.mobiles || ""),
  })).filter((r) => r.mobiles.length >= 12);

  if (!normalised.length) {
    return json({ error: "No valid mobile numbers after normalisation" }, 400);
  }

  const payload = {
    template_id: templateId,
    short_url:   "0",
    realTimeResponse: "1",
    recipients:  normalised,
  };

  const res = await fetch(MSG91_API, {
    method:  "POST",
    headers: {
      "Content-Type": "application/JSON",
      authkey:         AUTH_KEY,
      origin:          "fleetworks.in",
    },
    body: JSON.stringify(payload),
  });

  const result = await res.json().catch(() => ({ raw: await res.text() }));

  if (!res.ok || result?.type === "error") {
    console.error("MSG91 error", result);
    return json({ error: "MSG91 rejected the request", detail: result }, 502);
  }

  console.log(`SMS sent — event:${event} count:${normalised.length}`);
  return json({ ok: true, sent: normalised.length, msg91: result });
});

function normaliseMobile(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return "91" + digits;          // bare 10-digit Indian number
  if (digits.length === 12 && digits.startsWith("91")) return digits;
  if (digits.length === 13 && digits.startsWith("091")) return digits.slice(1);
  return digits;
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type":                "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
