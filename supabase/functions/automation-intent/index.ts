// FleetWorks — Automation Intent Parser (Supabase Edge Function, Deno).
//
// Accepts a natural-language description of what the fleet owner wants to
// automate and uses Claude to convert it into a structured automation_rules
// row (trigger_type + config, action_type + config). The client then lets
// the owner review and save the rule.
//
// Auth: signed-in owner or manager JWT.
//
// Secrets needed (shared with copilot):
//   ANTHROPIC_API_KEY
//
// Deploy:
//   supabase functions deploy automation-intent --no-verify-jwt

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL      = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY       = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") || "";
const MODEL             = "claude-haiku-4-5-20251001";

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
const errResp = (origin: string | null, status: number, message: string) =>
  new Response(JSON.stringify({ error: message }), { status, headers: cors(origin) });

const SYSTEM_PROMPT = `You are an automation rule parser for FleetWorks, India's fleet management platform.

Convert the fleet owner's plain-English intent into a structured automation rule.

AVAILABLE TRIGGER TYPES (pick exactly one):
1. "document_expiry"
   trigger_config: { "days_before": <number 1-90, default 30>, "documents": <array from ["insurance","puc","fitness","permit","roadtax"]> }
   Triggers when a vehicle document expires within the specified number of days.

2. "odometer_service"
   trigger_config: { "interval_km": <number, default 10000> }
   Triggers when km driven since last service work order exceeds the interval.

3. "expense_stale"
   trigger_config: { "days": <number 1-30, default 3> }
   Triggers when expense approval requests are pending longer than the specified days.

4. "high_issue_open"
   trigger_config: { "days": <number 1-30, default 7>, "severities": <array from ["High","Critical"]> }
   Triggers when high-severity issues remain open longer than the specified days.

5. "fuel_efficiency"
   trigger_config: { "drop_percent": <number 5-80, default 20>, "lookback_days": <number, default 30> }
   Triggers when recent average fuel efficiency drops by the given percentage vs historical.

AVAILABLE ACTION TYPES (pick exactly one):
1. "create_reminder"
   action_config: { "title_template": "<string with optional {vehicle}, {doc}, {days} placeholders>" }
   Creates a reminder visible on the fleet dashboard.

2. "create_work_order"
   action_config: { "title_template": "<string with optional {vehicle} placeholder>" }
   Creates an open work order for the vehicle.

3. "create_issue"
   action_config: { "title_template": "<string>", "severity": "Low"|"Medium"|"High" }
   Creates an issue report.

4. "whatsapp_notify"
   action_config: { "message_template": "<string with {vehicle}, {doc}, {days} placeholders>" }
   Sends a WhatsApp notification to the owner.

MATCHING RULES:
- Document expiry → prefer create_reminder
- Service due → prefer create_work_order
- Stale expenses → prefer create_reminder
- High issues open too long → prefer create_work_order
- Fuel efficiency drop → prefer create_issue
- If owner mentions "WhatsApp" or "notify" or "message", use whatsapp_notify instead
- If unclear which documents, default to all five

OUTPUT: Respond ONLY with a single valid JSON object. No markdown, no explanation.

{
  "name": "<concise rule name, max 60 chars>",
  "description": "<one sentence describing what this rule does>",
  "trigger_type": "<one of the 5 trigger types>",
  "trigger_config": { ... },
  "action_type": "<one of the 4 action types>",
  "action_config": { ... }
}

If the intent is too vague or doesn't map to any available trigger, respond with:
{ "error": "<brief explanation of what's unclear>" }`;

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST") return errResp(origin, 405, "POST only");

  if (!ANTHROPIC_API_KEY) {
    return errResp(origin, 503, "AI intent parsing not configured — contact FleetWorks support.");
  }

  const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return errResp(origin, 401, "Sign in first.");

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: callerRes } = await admin.auth.getUser(jwt);
  if (!callerRes?.user) return errResp(origin, 401, "Session expired — sign in again.");

  const { data: mem } = await admin
    .from("memberships")
    .select("role")
    .eq("user_id", callerRes.user.id)
    .limit(1)
    .single();
  if (!mem || !["owner", "manager"].includes(mem.role)) {
    return errResp(origin, 403, "Owner or manager access required.");
  }

  let body: { intent?: string };
  try { body = await req.json(); } catch { return errResp(origin, 400, "bad_json"); }
  const intent = (body.intent || "").trim().slice(0, 1000);
  if (!intent) return errResp(origin, 400, "Describe what you want to automate.");

  let aiResp: Response;
  try {
    aiResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 512,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: intent }],
      }),
    });
  } catch {
    return errResp(origin, 502, "Could not reach AI service — try again in a moment.");
  }

  const aiJson = await aiResp.json().catch(() => ({}));
  const text: string = aiJson?.content?.[0]?.text || "";

  let parsed: Record<string, unknown>;
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(jsonMatch ? jsonMatch[0] : text);
  } catch {
    return errResp(origin, 422, "AI could not parse that intent — try rephrasing it.");
  }

  if (parsed.error) {
    return new Response(
      JSON.stringify({ ok: false, ambiguous: true, message: parsed.error, intent }),
      { headers: cors(origin) },
    );
  }

  return new Response(
    JSON.stringify({ ok: true, rule: { ...parsed, intent_text: intent } }),
    { headers: cors(origin) },
  );
});
