// FleetWorks — Automation Rule Engine (Supabase Edge Function, Deno).
//
// Evaluates all enabled automation_rules for an org (or all orgs when called
// by the system scheduler). For each rule it checks the trigger condition
// against the normalized Postgres tables and writes actions (reminders, work
// orders, issues) when the condition is met.
//
// Auth:
//   • Owner/manager JWT  → runs rules for their org only (UI "Run Now" button)
//   • x-automation-key header matching AUTOMATION_SECRET env var → all orgs
//     (used by pg_cron daily schedule)
//
// Deploy:
//   supabase functions deploy automation-run --no-verify-jwt
//   supabase secrets set AUTOMATION_SECRET=<random-secret>

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const AUTOMATION_SECRET = Deno.env.get("AUTOMATION_SECRET") || "";

const ALLOW_ORIGINS = [
  "https://fleetworks.in", "https://www.fleetworks.in",
  "http://localhost:8642", "http://127.0.0.1:8642",
];
function cors(origin: string | null) {
  const o = origin && ALLOW_ORIGINS.includes(origin) ? origin : ALLOW_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": o,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, authorization, apikey, x-automation-key",
    "Content-Type": "application/json",
  };
}
const errResp = (origin: string | null, status: number, message: string) =>
  new Response(JSON.stringify({ error: message }), { status, headers: cors(origin) });

const today = () => new Date().toISOString().slice(0, 10);

// ===================== TRIGGER EVALUATORS =====================

async function runDocumentExpiry(
  admin: ReturnType<typeof createClient>,
  rule: Record<string, any>,
  orgId: string,
): Promise<number> {
  const daysBefore: number = rule.trigger_config?.days_before ?? 30;
  const docs: string[] = rule.trigger_config?.documents ?? ["insurance", "puc", "fitness", "permit", "roadtax"];
  const titleTpl: string = rule.action_config?.title_template || "{vehicle} — {doc} expires in {days} day(s)";

  const docFields: Record<string, string> = {
    insurance: "insurance_till",
    puc: "puc_till",
    fitness: "fitness_till",
    permit: "permit_till",
    roadtax: "roadtax_till",
  };
  const docLabels: Record<string, string> = {
    insurance: "Insurance",
    puc: "PUC",
    fitness: "Fitness Certificate",
    permit: "National Permit",
    roadtax: "Road Tax",
  };

  const { data: vehicles } = await admin
    .from("vehicles")
    .select("id, name, insurance_till, puc_till, fitness_till, permit_till, roadtax_till")
    .eq("org_id", orgId);

  if (!vehicles?.length) return 0;

  let actions = 0;
  const now = new Date();

  for (const v of vehicles) {
    for (const doc of docs) {
      const field = docFields[doc];
      if (!field || !v[field]) continue;

      const expiry = new Date(v[field]);
      const daysLeft = Math.round((expiry.getTime() - now.getTime()) / 86400000);

      if (daysLeft < 0 || daysLeft > daysBefore) continue;

      // Dedup: skip if an automation reminder for this vehicle+doc already exists
      // with a due_date matching the expiry date
      const { data: existing } = await admin
        .from("reminders")
        .select("id")
        .eq("org_id", orgId)
        .eq("vehicle_id", v.id)
        .eq("source", "automation")
        .eq("due_date", v[field])
        .ilike("task", `%${docLabels[doc]}%`)
        .limit(1);

      if (existing?.length) continue;

      const task = titleTpl
        .replace("{vehicle}", v.name || "Vehicle")
        .replace("{doc}", docLabels[doc] || doc)
        .replace("{days}", String(daysLeft));

      await admin.from("reminders").insert({
        org_id: orgId,
        vehicle_id: v.id,
        task,
        due_date: v[field],
        source: "automation",
        rule_id: rule.id,
      });
      actions++;
    }
  }
  return actions;
}

async function runOdometerService(
  admin: ReturnType<typeof createClient>,
  rule: Record<string, any>,
  orgId: string,
): Promise<number> {
  const intervalKm: number = rule.trigger_config?.interval_km ?? 10000;
  const titleTpl: string = rule.action_config?.title_template || "{vehicle} — service due (last service {ago} km ago)";

  const { data: vehicles } = await admin
    .from("vehicles")
    .select("id, name")
    .eq("org_id", orgId);

  if (!vehicles?.length) return 0;

  let actions = 0;

  for (const v of vehicles) {
    // Latest odometer from fuel_logs
    const { data: latestFuel } = await admin
      .from("fuel_logs")
      .select("odometer")
      .eq("vehicle_id", v.id)
      .not("odometer", "is", null)
      .order("log_date", { ascending: false })
      .limit(1);
    const currentOdo: number = latestFuel?.[0]?.odometer ?? 0;
    if (!currentOdo) continue;

    // Odometer at last completed service work order
    const { data: lastService } = await admin
      .from("work_orders")
      .select("created_at")
      .eq("vehicle_id", v.id)
      .in("status", ["Completed"])
      .order("created_at", { ascending: false })
      .limit(1);
    const lastServiceDate = lastService?.[0]?.created_at ?? "2000-01-01";

    // Fuel log odometer at or before last service date
    const { data: serviceOdoRow } = await admin
      .from("fuel_logs")
      .select("odometer")
      .eq("vehicle_id", v.id)
      .not("odometer", "is", null)
      .lte("log_date", lastServiceDate.slice(0, 10))
      .order("log_date", { ascending: false })
      .limit(1);
    const serviceOdo: number = serviceOdoRow?.[0]?.odometer ?? 0;

    const kmSinceService = currentOdo - serviceOdo;
    if (kmSinceService < intervalKm) continue;

    // Dedup: open work order already exists for this vehicle
    const { data: existingWO } = await admin
      .from("work_orders")
      .select("id")
      .eq("vehicle_id", v.id)
      .not("status", "in", '("Completed","Cancelled")')
      .ilike("title", "%service%")
      .limit(1);
    if (existingWO?.length) continue;

    const title = titleTpl
      .replace("{vehicle}", v.name || "Vehicle")
      .replace("{ago}", String(Math.round(kmSinceService)));

    await admin.from("work_orders").insert({
      org_id: orgId,
      vehicle_id: v.id,
      title,
      status: "Open",
    });
    actions++;
  }
  return actions;
}

async function runExpenseStale(
  admin: ReturnType<typeof createClient>,
  rule: Record<string, any>,
  orgId: string,
): Promise<number> {
  const days: number = rule.trigger_config?.days ?? 3;
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();

  const { data: pending } = await admin
    .from("expense_change_requests")
    .select("id")
    .eq("org_id", orgId)
    .eq("status", "pending")
    .lt("created_at", cutoff);

  if (!pending?.length) return 0;

  // Dedup: reminder already exists today for stale expenses
  const { data: existing } = await admin
    .from("reminders")
    .select("id")
    .eq("org_id", orgId)
    .eq("source", "automation")
    .eq("due_date", today())
    .ilike("task", "%expense%approval%")
    .limit(1);
  if (existing?.length) return 0;

  await admin.from("reminders").insert({
    org_id: orgId,
    task: `${pending.length} expense request(s) awaiting your approval for ${days}+ days`,
    due_date: today(),
    source: "automation",
    rule_id: rule.id,
  });
  return 1;
}

async function runHighIssueOpen(
  admin: ReturnType<typeof createClient>,
  rule: Record<string, any>,
  orgId: string,
): Promise<number> {
  const days: number = rule.trigger_config?.days ?? 7;
  const severities: string[] = rule.trigger_config?.severities ?? ["High", "Critical"];
  const cutoff = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

  const { data: issues } = await admin
    .from("issues")
    .select("id, vehicle_id, title, severity")
    .eq("org_id", orgId)
    .eq("status", "Open")
    .in("severity", severities)
    .lte("reported_at", cutoff);

  if (!issues?.length) return 0;

  let actions = 0;
  for (const iss of issues) {
    // Dedup: work order already exists for this issue
    const { data: existingWO } = await admin
      .from("work_orders")
      .select("id")
      .eq("issue_id", iss.id)
      .not("status", "in", '("Completed","Cancelled")')
      .limit(1);
    if (existingWO?.length) continue;

    await admin.from("work_orders").insert({
      org_id: orgId,
      vehicle_id: iss.vehicle_id,
      issue_id: iss.id,
      title: `ESCALATED: ${iss.title || "Issue"} (${iss.severity}, open ${days}+ days)`,
      status: "Open",
    });
    actions++;
  }
  return actions;
}

async function runFuelEfficiency(
  admin: ReturnType<typeof createClient>,
  rule: Record<string, any>,
  orgId: string,
): Promise<number> {
  const dropPct: number = rule.trigger_config?.drop_percent ?? 20;
  const lookbackDays: number = rule.trigger_config?.lookback_days ?? 30;
  const cutoff = new Date(Date.now() - lookbackDays * 86400000).toISOString().slice(0, 10);

  const { data: vehicles } = await admin
    .from("vehicles")
    .select("id, name")
    .eq("org_id", orgId);
  if (!vehicles?.length) return 0;

  let actions = 0;

  for (const v of vehicles) {
    const { data: recentLogs } = await admin
      .from("fuel_logs")
      .select("litres, amount, odometer, log_date")
      .eq("vehicle_id", v.id)
      .gte("log_date", cutoff)
      .not("litres", "is", null)
      .not("odometer", "is", null)
      .order("log_date", { ascending: true });

    const { data: olderLogs } = await admin
      .from("fuel_logs")
      .select("litres, amount, odometer, log_date")
      .eq("vehicle_id", v.id)
      .lt("log_date", cutoff)
      .not("litres", "is", null)
      .not("odometer", "is", null)
      .order("log_date", { ascending: false })
      .limit(20);

    if (!recentLogs?.length || !olderLogs?.length) continue;

    const avgEfficiency = (logs: any[]) => {
      const pairs: number[] = [];
      for (let i = 1; i < logs.length; i++) {
        const km = (logs[i].odometer || 0) - (logs[i - 1].odometer || 0);
        const l = logs[i].litres || 0;
        if (km > 0 && l > 0) pairs.push(km / l);
      }
      return pairs.length ? pairs.reduce((a, b) => a + b, 0) / pairs.length : 0;
    };

    const recentEff = avgEfficiency(recentLogs);
    const historicEff = avgEfficiency(olderLogs.reverse());

    if (!recentEff || !historicEff) continue;
    const actualDrop = ((historicEff - recentEff) / historicEff) * 100;
    if (actualDrop < dropPct) continue;

    // Dedup: issue already exists in last 7 days
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    const { data: existing } = await admin
      .from("issues")
      .select("id")
      .eq("vehicle_id", v.id)
      .eq("source", "automation")
      .gte("reported_at", sevenDaysAgo)
      .ilike("title", "%fuel efficiency%")
      .limit(1);
    if (existing?.length) continue;

    await admin.from("issues").insert({
      org_id: orgId,
      vehicle_id: v.id,
      title: `Fuel efficiency dropped ${Math.round(actualDrop)}% on ${v.name} (last ${lookbackDays} days)`,
      severity: "Medium",
      status: "Open",
      reported_at: today(),
      source: "automation",
    });
    actions++;
  }
  return actions;
}

// ===================== MAIN HANDLER =====================

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST") return errResp(origin, 405, "POST only");

  const autoKey = req.headers.get("x-automation-key");
  const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let orgId: string | null = null;

  if (autoKey && AUTOMATION_SECRET && autoKey === AUTOMATION_SECRET) {
    // System scheduler call — run all orgs
    orgId = null;
  } else if (jwt) {
    const { data: callerRes } = await admin.auth.getUser(jwt);
    if (!callerRes?.user) return errResp(origin, 401, "Sign in first.");
    const { data: mem } = await admin
      .from("memberships")
      .select("org_id, role")
      .eq("user_id", callerRes.user.id)
      .limit(1)
      .single();
    if (!mem || !["owner", "manager"].includes(mem.role)) {
      return errResp(origin, 403, "Owner or manager access required.");
    }
    orgId = mem.org_id;
  } else {
    return errResp(origin, 401, "Auth required.");
  }

  let rulesQuery = admin.from("automation_rules").select("*").eq("enabled", true);
  if (orgId) rulesQuery = rulesQuery.eq("org_id", orgId);
  const { data: rules, error: rulesErr } = await rulesQuery;
  if (rulesErr) return errResp(origin, 500, rulesErr.message);

  const summary: { ruleId: string; name: string; actions: number; status: string }[] = [];

  for (const rule of rules ?? []) {
    let actions = 0;
    let status = "ok";
    try {
      if (rule.trigger_type === "document_expiry") {
        actions = await runDocumentExpiry(admin, rule, rule.org_id);
      } else if (rule.trigger_type === "odometer_service") {
        actions = await runOdometerService(admin, rule, rule.org_id);
      } else if (rule.trigger_type === "expense_stale") {
        actions = await runExpenseStale(admin, rule, rule.org_id);
      } else if (rule.trigger_type === "high_issue_open") {
        actions = await runHighIssueOpen(admin, rule, rule.org_id);
      } else if (rule.trigger_type === "fuel_efficiency") {
        actions = await runFuelEfficiency(admin, rule, rule.org_id);
      }
    } catch (e) {
      status = "error";
      console.error(`Rule ${rule.id} (${rule.name}) failed:`, e);
    }

    await admin.from("automation_rules").update({
      last_run_at: new Date().toISOString(),
      last_run_status: status,
      run_count: (rule.run_count || 0) + 1,
    }).eq("id", rule.id);

    await admin.from("automation_runs").insert({
      rule_id: rule.id,
      org_id: rule.org_id,
      rule_name: rule.name,
      actions_taken: actions,
      status,
    });

    summary.push({ ruleId: rule.id, name: rule.name, actions, status });
  }

  return new Response(
    JSON.stringify({ ok: true, rules_evaluated: summary.length, summary }),
    { headers: cors(origin) },
  );
});
