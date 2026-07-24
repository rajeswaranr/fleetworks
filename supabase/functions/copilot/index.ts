// FleetWorks Copilot — LLM edge function (Supabase / Deno).
// Holds ANTHROPIC_API_KEY server-side; the browser NEVER sees it. The app
// POSTs { question, fleet } (a compact JSON summary of the signed-in owner's
// fleet) and gets back Claude's plain-English answer. Deploy with:
//   supabase functions deploy copilot --no-verify-jwt
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
// (JWT off so demo/offline owners can use it too; the fleet summary is sent
// by the client, so no DB access or auth is required inside the function.)

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") || "";
const MODEL = "claude-opus-4-8";

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

const SYSTEM = `You are Copilot, the AI assistant inside FleetWorks — India's AI fleet-maintenance and management platform used by commercial-vehicle (truck, bus, tipper) fleet owners.

You are given a JSON summary of the signed-in owner's fleet (vehicles, expenses, fuel/mileage, issues, drivers, compliance renewals, reminders, service work). Answer their question strictly from that data plus general Indian commercial-vehicle knowledge.

Rules:
- Be concise and practical — a busy transporter is reading on a phone. Lead with the answer.
- Money in Indian format (₹, lakh/crore). Dates in "DD Mon" style.
- If the data doesn't contain the answer, say so plainly and tell them where in FleetWorks to add it. Never invent vehicles, numbers, or dates.
- Hindi/Hinglish is fine if the user writes that way.
- For maintenance/mileage/compliance, give the specific vehicle and number from the data, then a one-line recommendation.
- Keep it under ~120 words unless a list is genuinely needed. No markdown headers.`;

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "POST only" }), { status: 405, headers: cors(origin) });
  if (!ANTHROPIC_API_KEY) return new Response(JSON.stringify({ error: "not_configured" }), { status: 503, headers: cors(origin) });

  let body: { question?: string; fleet?: unknown };
  try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: "bad_json" }), { status: 400, headers: cors(origin) }); }
  const question = (body.question || "").toString().slice(0, 2000);
  if (!question.trim()) return new Response(JSON.stringify({ error: "empty" }), { status: 400, headers: cors(origin) });

  // Cap the fleet payload so a huge store can't blow the token budget.
  const fleetJson = JSON.stringify(body.fleet ?? {}).slice(0, 60000);

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        system: SYSTEM,
        messages: [
          { role: "user", content: `My fleet data (JSON):\n${fleetJson}\n\nQuestion: ${question}` },
        ],
      }),
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      return new Response(JSON.stringify({ error: "upstream", status: r.status, detail: detail.slice(0, 500) }), { status: 502, headers: cors(origin) });
    }
    const j = await r.json();
    const text = (j.content || []).filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join("\n").trim();
    return new Response(JSON.stringify({ answer: text || "(no answer)" }), { headers: cors(origin) });
  } catch (e) {
    return new Response(JSON.stringify({ error: "fetch_failed", detail: String(e).slice(0, 300) }), { status: 502, headers: cors(origin) });
  }
});
