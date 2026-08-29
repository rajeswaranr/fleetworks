// FleetWorks — AI vendor bill review (Supabase Edge Function, Deno).
//
// Reviews a workshop invoice against the fleet's OWN repair history and returns
// an assessment: approve / review / reject, with the reasoning shown.
//
// The split matters. Deterministic detectors find the candidates and compute
// the evidence from real rows — how many times this description has been
// billed, what it usually costs, when this part was last replaced. Only then
// does the model see anything, and its job is to judge severity and explain in
// plain language. It is never asked to invent a number, because it would.
//
// A clean bill never reaches the model at all: no findings means an automatic
// approve, which is faster, free, and more honest than asking an LLM to confirm
// that nothing is wrong.
//
// Deploy:
//   npx supabase functions deploy bill-review --no-verify-jwt
//   (reuses the ANTHROPIC_API_KEY secret already set for copilot)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") || "";
const MODEL = "claude-sonnet-5";

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

const money = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const norm = (s: string) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");

type Line = {
  id: string; line_no: number | null; line_type: string; description: string;
  part_number: string | null; qty: number | null; unit_rate: number | null;
  amount: number; hours: number | null;
};
type Finding = {
  code: string; severity: "low" | "medium" | "high";
  title: string; detail: string; evidence: Record<string, unknown>;
};

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST") return err(origin, 405, "POST only");

  const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return err(origin, 401, "Sign in first.");

  let body: { workOrderId?: string };
  try { body = await req.json(); } catch { return err(origin, 400, "bad_json"); }
  const woId = String(body.workOrderId || "");
  if (!woId) return err(origin, 400, "workOrderId is required.");

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: caller, error: callerErr } = await admin.auth.getUser(jwt);
  if (callerErr || !caller?.user) return err(origin, 401, "Session expired — sign in again.");

  const { data: wo, error: woErr } = await admin
    .from("work_orders")
    .select("id, org_id, vehicle_id, title, vendor, est_cost, final_cost, completed_at")
    .eq("id", woId).maybeSingle();
  if (woErr) return err(origin, 500, "Could not load the work order: " + woErr.message);
  if (!wo) return err(origin, 404, "Work order not found.");

  // Membership is checked against the caller's real JWT, not a client claim.
  const { data: mem } = await admin.from("memberships")
    .select("org_id").eq("user_id", caller.user.id).eq("org_id", wo.org_id).maybeSingle();
  if (!mem) return err(origin, 403, "That work order belongs to another fleet.");

  const { data: linesRaw } = await admin.from("work_order_lines")
    .select("*").eq("work_order_id", woId).order("line_no", { ascending: true });
  const lines: Line[] = linesRaw ?? [];
  if (!lines.length) return err(origin, 400, "This bill has no line items to review yet.");

  // ---- history: the fleet's own past lines, which is what makes this grounded ----
  const { data: histRaw } = await admin.from("work_order_lines")
    .select("description, line_type, amount, unit_rate, hours, work_order_id, created_at")
    .eq("org_id", wo.org_id).neq("work_order_id", woId).limit(4000);
  const history = histRaw ?? [];

  const byDesc = new Map<string, number[]>();
  const labourRates: number[] = [];
  for (const h of history) {
    const k = norm(h.description);
    if (!byDesc.has(k)) byDesc.set(k, []);
    byDesc.get(k)!.push(Number(h.amount));
    if (h.line_type === "labour" && h.unit_rate) labourRates.push(Number(h.unit_rate));
  }
  const fleetLabourRate = median(labourRates);

  // ---- deterministic detectors ----
  const findings: Finding[] = [];
  let sourceCount = 0;

  // 1. Identical lines billed twice.
  const seen = new Map<string, Line[]>();
  for (const l of lines) {
    const k = norm(l.description) + "|" + Number(l.amount).toFixed(2);
    if (!seen.has(k)) seen.set(k, []);
    seen.get(k)!.push(l);
  }
  for (const [, group] of seen) {
    if (group.length > 1) {
      findings.push({
        code: "duplicate_line", severity: "high",
        title: "Same line billed more than once",
        detail: `"${group[0].description}" appears ${group.length} times at ${money(group[0].amount)} each.`,
        evidence: { description: group[0].description, occurrences: group.length, amount: group[0].amount },
      });
    }
  }

  // 2. More than one diagnostic charge — the case in the brief.
  const diagnostics = lines.filter((l) => l.line_type === "diagnostic");
  if (diagnostics.length > 1) {
    findings.push({
      code: "repeat_diagnostic", severity: "medium",
      title: "Two diagnostic charges on one order",
      detail: `${diagnostics.length} diagnostic entries totalling ${money(diagnostics.reduce((s, l) => s + Number(l.amount), 0))}. Most repairs carry a single diagnostic fee.`,
      evidence: { count: diagnostics.length, lines: diagnostics.map((d) => ({ description: d.description, amount: d.amount })) },
    });
  }

  // 3. Priced above what this fleet has paid before. Needs at least three prior
  //    instances, or one unusual past job would set the benchmark.
  for (const l of lines) {
    const past = byDesc.get(norm(l.description));
    if (!past || past.length < 3) continue;
    sourceCount += past.length;
    const med = median(past)!;
    if (med > 0 && Number(l.amount) > med * 1.3) {
      const pct = Math.round((Number(l.amount) / med - 1) * 100);
      findings.push({
        code: "price_above_history", severity: pct > 60 ? "high" : "medium",
        title: "Priced above your usual",
        detail: `"${l.description}" is ${money(l.amount)}, about ${pct}% above your median of ${money(med)} across ${past.length} previous jobs.`,
        evidence: { description: l.description, amount: l.amount, median: med, samples: past.length, percentAbove: pct },
      });
    }
  }

  // 4. Labour rate out of line with the rest of the fleet's bills.
  if (fleetLabourRate) {
    sourceCount += labourRates.length;
    for (const l of lines) {
      if (l.line_type !== "labour" || !l.unit_rate) continue;
      if (Number(l.unit_rate) > fleetLabourRate * 1.4) {
        findings.push({
          code: "labour_rate_outlier", severity: "medium",
          title: "Labour rate above your normal",
          detail: `${money(Number(l.unit_rate))}/hr against a fleet median of ${money(fleetLabourRate)}/hr.`,
          evidence: { description: l.description, rate: l.unit_rate, fleetMedian: fleetLabourRate },
        });
      }
    }
  }

  // 5. A part replaced again unusually soon on the same vehicle.
  if (wo.vehicle_id) {
    const { data: recentWO } = await admin.from("work_orders")
      .select("id, completed_at").eq("vehicle_id", wo.vehicle_id).neq("id", woId)
      .not("completed_at", "is", null)
      .gte("completed_at", new Date(Date.now() - 180 * 86400000).toISOString().slice(0, 10));
    const recentIds = new Set((recentWO ?? []).map((w) => w.id));
    if (recentIds.size) {
      const recentDescs = new Set(
        history.filter((h) => recentIds.has(h.work_order_id)).map((h) => norm(h.description)),
      );
      sourceCount += recentIds.size;
      for (const l of lines) {
        if (l.line_type !== "part") continue;
        if (recentDescs.has(norm(l.description))) {
          findings.push({
            code: "premature_replacement", severity: "high",
            title: "Same part replaced again within six months",
            detail: `"${l.description}" was already replaced on this vehicle in the last 180 days. Either the first part failed early — which may be under warranty — or one of the two jobs did not happen.`,
            evidence: { description: l.description, windowDays: 180 },
          });
        }
      }
    }
  }

  // 6. Final well above the estimate the owner approved.
  if (wo.est_cost && wo.final_cost && Number(wo.final_cost) > Number(wo.est_cost) * 1.25) {
    const pct = Math.round((Number(wo.final_cost) / Number(wo.est_cost) - 1) * 100);
    findings.push({
      code: "exceeds_estimate", severity: pct > 50 ? "high" : "medium",
      title: "Final cost above the estimate",
      detail: `Billed ${money(Number(wo.final_cost))} against an estimate of ${money(Number(wo.est_cost))} — ${pct}% higher.`,
      evidence: { estimate: wo.est_cost, final: wo.final_cost, percentOver: pct },
    });
  }

  const total = lines.reduce((s, l) => s + Number(l.amount), 0);
  const computed = {
    lineCount: lines.length, total,
    historyLinesConsulted: history.length,
    fleetLabourRateMedian: fleetLabourRate,
    findingCodes: findings.map((f) => f.code),
  };

  // ---- clean bill: no model call ----
  if (!findings.length) {
    const row = {
      org_id: wo.org_id, work_order_id: woId,
      assessment: "approve", confidence: history.length >= 20 ? "high" : "medium",
      source_count: history.length, model: null,
      summary: history.length
        ? `Nothing unusual against ${history.length} previous line items from your own bills. Line count, pricing and labour rates all sit in your normal range.`
        : "Nothing unusual found. You have little billing history yet, so this is a structural check rather than a price comparison.",
      findings: [], computed,
    };
    const { data: saved } = await admin.from("bill_reviews").insert(row).select().single();
    return new Response(JSON.stringify({ ok: true, review: saved ?? row }), { headers: cors(origin) });
  }

  // ---- findings exist: the model judges and explains, over computed facts only ----
  let assessment = findings.some((f) => f.severity === "high") ? "review" : "review";
  let confidence = sourceCount >= 30 ? "high" : sourceCount >= 8 ? "medium" : "low";
  let summary = findings.map((f) => f.detail).join(" ");

  if (ANTHROPIC_API_KEY) {
    const prompt = `You are reviewing a commercial-vehicle repair invoice for an Indian fleet owner.

INVOICE
Vendor: ${wo.vendor || "unknown"}
Vehicle job: ${wo.title || "unspecified"}
Total: ${money(total)} across ${lines.length} lines
${lines.map((l) => `- [${l.line_type}] ${l.description} — qty ${l.qty ?? 1} — ${money(Number(l.amount))}`).join("\n")}

CHECKS THAT FIRED (computed from this fleet's own past bills — treat as fact)
${findings.map((f) => `- ${f.title}: ${f.detail}`).join("\n")}

Evidence base: ${sourceCount} comparable historical records.

Write a JSON object only, no prose around it:
{"assessment":"approve"|"review"|"reject","confidence":"low"|"medium"|"high","summary":"..."}

Rules:
- Base the summary ONLY on the checks above. Never introduce a number that is not there.
- "reject" only for clear double-billing. Otherwise "review".
- Summary: 2-3 sentences, plain English, addressed to the owner. Say what to ask the workshop.
- No greeting, no markdown.`;

    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: MODEL, max_tokens: 600,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      if (r.ok) {
        const j = await r.json();
        const text = (j.content?.[0]?.text || "").trim();
        const m = text.match(/\{[\s\S]*\}/);
        if (m) {
          const parsed = JSON.parse(m[0]);
          if (["approve", "review", "reject"].includes(parsed.assessment)) assessment = parsed.assessment;
          if (["low", "medium", "high"].includes(parsed.confidence)) confidence = parsed.confidence;
          if (typeof parsed.summary === "string" && parsed.summary.length > 10) summary = parsed.summary;
        }
      }
      // A model failure must never block the review — the deterministic findings
      // already stand on their own, and they are the part with the evidence.
    } catch { /* keep the computed summary */ }
  }

  const row = {
    org_id: wo.org_id, work_order_id: woId,
    assessment, confidence, source_count: sourceCount,
    summary, findings, computed, model: ANTHROPIC_API_KEY ? MODEL : null,
  };
  const { data: saved, error: saveErr } = await admin.from("bill_reviews").insert(row).select().single();
  if (saveErr) return err(origin, 500, "Could not save the review: " + saveErr.message);

  return new Response(JSON.stringify({ ok: true, review: saved }), { headers: cors(origin) });
});
