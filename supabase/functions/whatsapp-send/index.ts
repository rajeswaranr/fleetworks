// FleetWorks — WhatsApp send (Supabase Edge Function, Deno).
//
// The outbound half of the messaging schema that shipped without a sender.
// Sends driver allotments, wage confirmations, khata statements and attendance
// prompts through the Meta Cloud API, and records every attempt in
// whatsapp_messages so "we told you on the 3rd" is evidence rather than memory.
//
// CONSENT IS CHECKED HERE, NOT ASSUMED BY THE CALLER. A contact with no
// opted_in_at, or with opted_out_at set, is refused outright. WhatsApp's
// Business Policy requires opt-in before a business-initiated message and the
// DPDP Act 2023 requires that consent be recorded and withdrawable. A client
// that forgets to check must not be able to send anyway.
//
// COST IS A DESIGN CONSTRAINT, NOT A FOOTNOTE. Anything sent inside the 24-hour
// window opened by an inbound message is free; outside it, a utility template
// costs roughly a seventh of a marketing one. So this function prefers a
// free-form reply whenever the window is open and falls back to the template
// only when it must, and it records which happened in cost_category. That is
// also why the attendance prompt is worth sending: the driver's reply opens a
// free window for everything that follows.
//
// Deploy:
//   npx supabase functions deploy whatsapp-send
//   Meta direct:
//     npx supabase secrets set WHATSAPP_TOKEN=<permanent access token>
//     npx supabase secrets set WHATSAPP_PHONE_NUMBER_ID=<phone number id>
//   360dialog (same message format, different door):
//     npx supabase secrets set WHATSAPP_PROVIDER=360dialog
//     npx supabase secrets set WHATSAPP_TOKEN=<D360 API key>

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WA_TOKEN = Deno.env.get("WHATSAPP_TOKEN") || "";
const WA_PHONE_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") || "";
const GRAPH_VERSION = Deno.env.get("WHATSAPP_GRAPH_VERSION") || "v21.0";

// Which business solution provider carries the message. Meta direct is the
// default; 360dialog is a thin reseller of the same Cloud API, so it differs
// only in base URL and auth header and the message bodies below are unchanged.
//
// Providers with their OWN message format — AiSensy, WATI, Interakt, Gupshup —
// are deliberately not faked here. Each needs its own translation of the
// payload and its own webhook parsing, and pretending otherwise would produce
// a function that returns 200 while delivering nothing.
const PROVIDER = (Deno.env.get("WHATSAPP_PROVIDER") || "meta").toLowerCase();

// Takes its inputs rather than closing over the environment, so the routing can
// be tested without a Deno runtime. Meta direct is the default and the path
// FleetWorks actually runs on; anything unrecognised falls back to it rather
// than inventing a provider.
function endpoint(
  provider: string, token: string, phoneId: string, graphVersion: string,
): { url: string; headers: Record<string, string> } {
  if (provider === "360dialog") {
    return {
      url: "https://waba-v2.360dialog.io/v1/messages",
      headers: { "D360-API-KEY": token, "Content-Type": "application/json" },
    };
  }
  return {
    url: `https://graph.facebook.com/${graphVersion}/${phoneId}/messages`,
    headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" },
  };
}

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

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST") return err(origin, 405, "POST only");

  // Refuse clearly rather than half-working, the same way telemetry-ingest does
  // when its key is unset. Meta business verification is the long pole here.
  if (!WA_TOKEN || (PROVIDER === "meta" && !WA_PHONE_ID)) {
    return err(origin, 503, "WhatsApp is not connected yet — the FleetWorks business number is still pending verification.");
  }

  const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return err(origin, 401, "Sign in first.");

  let body: {
    contactId?: string; template?: string; variables?: Record<string, string>;
    text?: string; refType?: string; refId?: string;
  };
  try { body = await req.json(); } catch { return err(origin, 400, "bad_json"); }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: caller, error: callerErr } = await admin.auth.getUser(jwt);
  if (callerErr || !caller?.user) return err(origin, 401, "Session expired — sign in again.");

  if (!body.contactId) return err(origin, 400, "contactId is required.");
  const { data: contact } = await admin.from("whatsapp_contacts")
    .select("*").eq("id", body.contactId).maybeSingle();
  if (!contact) return err(origin, 404, "Contact not found.");

  // The caller must belong to the contact's org. Checked against the real JWT,
  // never against an org id supplied in the body.
  const { data: mem } = await admin.from("memberships")
    .select("role").eq("user_id", caller.user.id).eq("org_id", contact.org_id).maybeSingle();
  if (!mem) return err(origin, 403, "That contact belongs to another fleet.");

  if (!contact.opted_in_at) return err(origin, 403, "That contact has not opted in to WhatsApp messages yet.");
  if (contact.opted_out_at) return err(origin, 403, "That contact has opted out of WhatsApp messages.");

  // Inside the free window a plain reply is allowed and costs nothing; outside
  // it, only a registered template may open a conversation.
  const windowOpen = contact.window_expires_at && new Date(contact.window_expires_at) > new Date();

  let payload: Record<string, unknown>;
  let templateName: string | null = null;
  let renderedBody = "";
  let costCategory = "utility";

  if (windowOpen && body.text) {
    renderedBody = String(body.text).slice(0, 4096);
    templateName = null;
    costCategory = "free";
    payload = {
      messaging_product: "whatsapp", recipient_type: "individual",
      to: contact.phone, type: "text", text: { body: renderedBody },
    };
  } else {
    if (!body.template) return err(origin, 400, "Outside the 24-hour window a template is required.");
    const { data: tpl } = await admin.from("whatsapp_templates")
      .select("*").eq("name", body.template).maybeSingle();
    if (!tpl) return err(origin, 404, "Unknown template: " + body.template);

    // Variables are positional in Meta's payload, so they must be emitted in
    // the order the template declares — not in whatever order the caller's
    // object happened to be built.
    const vars: string[] = (tpl.variables || []).map(
      (name: string) => String((body.variables || {})[name] ?? "").trim() || "-",
    );
    templateName = tpl.name;
    costCategory = tpl.category || "utility";
    renderedBody = String(tpl.body || "").replace(/\{\{(\d+)\}\}/g, (_m, n) => vars[Number(n) - 1] ?? "");
    payload = {
      messaging_product: "whatsapp", recipient_type: "individual",
      to: contact.phone, type: "template",
      template: {
        name: tpl.name,
        language: { code: tpl.language || "en" },
        components: vars.length
          ? [{ type: "body", parameters: vars.map((t) => ({ type: "text", text: t })) }]
          : [],
      },
    };
  }

  // Record the attempt before the network call, so a send that succeeds at Meta
  // but fails on the way back to us is not silently lost. Status is corrected
  // below, and again later by the webhook's delivery receipts.
  const { data: row } = await admin.from("whatsapp_messages").insert({
    org_id: contact.org_id, contact_id: contact.id, direction: "out",
    template_name: templateName, body: renderedBody,
    variables: body.variables || null, status: "queued",
    ref_type: body.refType || null, ref_id: body.refId || null,
    cost_category: costCategory,
  }).select().single();

  let waId: string | null = null;
  let sendErr: { code?: string; detail?: string } | null = null;
  try {
    const ep = endpoint(PROVIDER, WA_TOKEN, WA_PHONE_ID, GRAPH_VERSION);
    const r = await fetch(ep.url, { method: "POST", headers: ep.headers, body: JSON.stringify(payload) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      sendErr = { code: String(j?.error?.code ?? r.status), detail: String(j?.error?.message ?? "send failed") };
    } else {
      waId = j?.messages?.[0]?.id ?? null;
    }
  } catch (e) {
    sendErr = { code: "network", detail: String((e as Error).message || e) };
  }

  if (row) {
    await admin.from("whatsapp_messages").update(
      sendErr
        ? { status: "failed", error_code: sendErr.code, error_detail: sendErr.detail }
        : { status: "sent", wa_message_id: waId, sent_at: new Date().toISOString() },
    ).eq("id", row.id);
  }

  if (sendErr) return err(origin, 502, "WhatsApp refused the message: " + sendErr.detail);

  return new Response(
    JSON.stringify({ ok: true, messageId: row?.id ?? null, waMessageId: waId, cost: costCategory }),
    { headers: cors(origin) },
  );
});
