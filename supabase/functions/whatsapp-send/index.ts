// FleetWorks — WhatsApp send (Supabase Edge Function, Deno).
//
// Sends driver allotments, wage confirmations, khata statements and attendance
// prompts. Supports three providers: Meta Cloud API (default), 360dialog, and
// AiSensy. The provider is selected via WHATSAPP_PROVIDER secret.
//
// CONSENT IS CHECKED HERE, NOT ASSUMED BY THE CALLER. A contact with no
// opted_in_at, or with opted_out_at set, is refused outright. WhatsApp's
// Business Policy requires opt-in before a business-initiated message.
//
// PROVIDER NOTES
//   meta / 360dialog — same Cloud API payload; differ only in endpoint + auth.
//                      Supports free-form text inside the 24-hour window.
//   aisensy          — completely different payload shape: `campaignName` (not
//                      `template.name`), `templateParams` array (not components),
//                      `destination` without leading +, auth key in body not header.
//                      Free-form text NOT supported; every send must use a campaign.
//
// Secrets required:
//   Meta direct:
//     WHATSAPP_TOKEN=<permanent access token>
//     WHATSAPP_PHONE_NUMBER_ID=<phone number id>
//   360dialog:
//     WHATSAPP_PROVIDER=360dialog
//     WHATSAPP_TOKEN=<D360 API key>
//   AiSensy:
//     WHATSAPP_PROVIDER=aisensy
//     AISENSY_API_KEY=<your AiSensy API key>
//
// Deploy:
//   npx supabase functions deploy whatsapp-send

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PROVIDER     = (Deno.env.get("WHATSAPP_PROVIDER") || "meta").toLowerCase();

// Meta / 360dialog credentials
const WA_TOKEN     = Deno.env.get("WHATSAPP_TOKEN") || "";
const WA_PHONE_ID  = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") || "";
const GRAPH_VER    = Deno.env.get("WHATSAPP_GRAPH_VERSION") || "v21.0";

// AiSensy credentials
const AISENSY_KEY  = Deno.env.get("AISENSY_API_KEY") || "";
// AiSensy endpoint (v2 Campaign API)
const AISENSY_URL  = "https://backend.aisensy.com/campaign/t1/api/v2";

function metaEndpoint(phoneId: string, graphVersion: string, token: string) {
  return {
    url: `https://graph.facebook.com/${graphVersion}/${phoneId}/messages`,
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
  };
}
function d360Endpoint(token: string) {
  return {
    url: "https://waba-v2.360dialog.io/v1/messages",
    headers: { "D360-API-KEY": token, "Content-Type": "application/json" },
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
const err = (origin: string | null, status: number, msg: string) =>
  new Response(JSON.stringify({ error: msg }), { status, headers: cors(origin) });

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST") return err(origin, 405, "POST only");

  // Fail fast with a clear message when credentials are missing.
  if (PROVIDER === "aisensy" && !AISENSY_KEY) {
    return err(origin, 503, "AiSensy API key not configured. Add AISENSY_API_KEY via Supabase secrets.");
  }
  if (PROVIDER !== "aisensy" && (!WA_TOKEN || !WA_PHONE_ID)) {
    return err(origin, 503, "WhatsApp not connected — WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID not set.");
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

  const { data: mem } = await admin.from("memberships")
    .select("role").eq("user_id", caller.user.id).eq("org_id", contact.org_id).maybeSingle();
  if (!mem) return err(origin, 403, "That contact belongs to another fleet.");

  if (!contact.opted_in_at) return err(origin, 403, "That contact has not opted in to WhatsApp messages yet.");
  if (contact.opted_out_at) return err(origin, 403, "That contact has opted out of WhatsApp messages.");

  const windowOpen = contact.window_expires_at && new Date(contact.window_expires_at) > new Date();

  let payload: Record<string, unknown>;
  let sendUrl: string;
  let sendHeaders: Record<string, string>;
  let templateName: string | null = null;
  let renderedBody = "";
  let costCategory = "utility";

  // ================================================================
  // AISENSY PATH — different payload shape; templates only
  // ================================================================
  if (PROVIDER === "aisensy") {
    if (!body.template) {
      return err(origin, 400, "AiSensy requires a campaign/template name — free-form text is not supported outside a chat session.");
    }
    const { data: tpl } = await admin.from("whatsapp_templates")
      .select("*").eq("name", body.template).maybeSingle();
    if (!tpl) return err(origin, 404, "Unknown template: " + body.template);

    const vars: string[] = (tpl.variables || []).map(
      (name: string) => String((body.variables || {})[name] ?? "").trim() || "-",
    );
    templateName = tpl.name;
    costCategory  = tpl.category || "utility";
    renderedBody  = String(tpl.body || "").replace(/\{\{(\d+)\}\}/g, (_m, n) => vars[Number(n) - 1] ?? "");

    // AiSensy expects the phone without a leading +
    const destination = contact.phone.replace(/^\+/, "");

    payload = {
      apiKey:         AISENSY_KEY,
      campaignName:   tpl.name,           // must match the campaign name in AiSensy dashboard
      destination,
      userName:       contact.name || "Driver",
      templateParams: vars,               // positional, {{1}} → vars[0]
      source:         "fleetworks-api",
      media:          {},
      buttons:        [],
      carouselCards:  [],
      location:       {},
    };
    sendUrl     = AISENSY_URL;
    sendHeaders = { "Content-Type": "application/json" };

  // ================================================================
  // META / 360DIALOG PATH — same Cloud API payload
  // ================================================================
  } else {
    if (windowOpen && body.text) {
      renderedBody  = String(body.text).slice(0, 4096);
      costCategory  = "free";
      payload = {
        messaging_product: "whatsapp", recipient_type: "individual",
        to: contact.phone, type: "text", text: { body: renderedBody },
      };
    } else {
      if (!body.template) return err(origin, 400, "Outside the 24-hour window a template is required.");
      const { data: tpl } = await admin.from("whatsapp_templates")
        .select("*").eq("name", body.template).maybeSingle();
      if (!tpl) return err(origin, 404, "Unknown template: " + body.template);

      const vars: string[] = (tpl.variables || []).map(
        (name: string) => String((body.variables || {})[name] ?? "").trim() || "-",
      );
      templateName = tpl.name;
      costCategory  = tpl.category || "utility";
      renderedBody  = String(tpl.body || "").replace(/\{\{(\d+)\}\}/g, (_m, n) => vars[Number(n) - 1] ?? "");
      payload = {
        messaging_product: "whatsapp", recipient_type: "individual",
        to: contact.phone, type: "template",
        template: {
          name:       tpl.name,
          language:   { code: tpl.language || "en" },
          components: vars.length
            ? [{ type: "body", parameters: vars.map((t) => ({ type: "text", text: t })) }]
            : [],
        },
      };
    }
    const ep  = PROVIDER === "360dialog" ? d360Endpoint(WA_TOKEN) : metaEndpoint(WA_PHONE_ID, GRAPH_VER, WA_TOKEN);
    sendUrl     = ep.url;
    sendHeaders = ep.headers;
  }

  // Record attempt before the network call so a send that succeeds at the
  // provider but times out on the way back is not silently lost.
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
    const r = await fetch(sendUrl, {
      method: "POST", headers: sendHeaders, body: JSON.stringify(payload),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      // AiSensy returns { error, message } on failure; Meta returns { error: { code, message } }
      const detail = PROVIDER === "aisensy"
        ? String(j?.message ?? j?.error ?? "send failed")
        : String(j?.error?.message ?? "send failed");
      sendErr = { code: String(j?.error?.code ?? r.status), detail };
    } else {
      // AiSensy returns { "Message Sent Successfully", ... }; Meta returns { messages: [{id}] }
      waId = PROVIDER === "aisensy"
        ? (j?.messageId ?? j?.message_id ?? null)
        : (j?.messages?.[0]?.id ?? null);
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
    JSON.stringify({ ok: true, messageId: row?.id ?? null, waMessageId: waId, cost: costCategory, provider: PROVIDER }),
    { headers: cors(origin) },
  );
});
