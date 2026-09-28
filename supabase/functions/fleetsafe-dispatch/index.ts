// FleetWorks — FleetSafe alert dispatcher (Supabase Edge Function, Deno).
//
// Drains the fleet_alerts outbox: rows with delivery = 'pending' were raised by the
// database triggers (incident, geofence, cold chain, tracker offline) for fleets that
// turned SMS on. Called every minute by pg_cron, and only when something is waiting.
//
// Each alert is claimed (attempts + 1, still pending) before sending, so two overlapping
// runs cannot double-send; after three failed attempts it is marked failed and stays in
// the in-app inbox.
//
// SMS goes through MSG91's Flow API with a DLT-approved template:
//   MSG91_TPL_SAFETY  template with two variables: ##var1## = what happened (title),
//                     ##var2## = detail. Until it is set, alerts are marked 'skipped'
//                     and remain in the in-app inbox.
//
// Secrets: MSG91_AUTH_KEY, MSG91_TPL_SAFETY, FLEETSAFE_CRON_KEY (same value as the
//          vault secret fleetsafe_cron_key used by the cron job).
// Deploy:  npx supabase functions deploy fleetsafe-dispatch --no-verify-jwt

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { safeEqual } from "../_shared/devices/pipeline.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_KEY = Deno.env.get("FLEETSAFE_CRON_KEY") || "";
const AUTH_KEY = Deno.env.get("MSG91_AUTH_KEY") || "";
const TPL = Deno.env.get("MSG91_TPL_SAFETY") || "";
const BATCH = 40, MAX_ATTEMPTS = 3, MAX_PHONES = 5;

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const mobile = (raw: string) => {
  const d = String(raw).replace(/\D/g, "");
  return d.length === 10 ? "91" + d : d.length === 12 && d.startsWith("91") ? d : null;
};
// DLT templates cap variable length; keep each short and plain
const clip = (s: string | null, n: number) => (s || "").replace(/\s+/g, " ").trim().slice(0, n);

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "POST only" });
  if (!CRON_KEY || !safeEqual(req.headers.get("x-cron-key") || "", CRON_KEY)) return json(401, { error: "Not allowed." });
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

  const { data: pending } = await admin.from("fleet_alerts")
    .select("id, org_id, title, body, severity, attempts").eq("delivery", "pending")
    .order("created_at", { ascending: true }).limit(BATCH);
  if (!pending?.length) return json(200, { ok: true, sent: 0 });

  const orgs = [...new Set(pending.map((a) => a.org_id))];
  const { data: settings } = await admin.from("fleetsafe_settings").select("org_id, alert_phones, notify_sms").in("org_id", orgs);
  const byOrg = new Map((settings || []).map((s) => [s.org_id, s]));
  let sent = 0, failed = 0, skipped = 0;

  for (const a of pending) {
    // claim: only the run that bumps attempts from the value it read gets to send
    const { data: claimed } = await admin.from("fleet_alerts").update({ attempts: a.attempts + 1 })
      .eq("id", a.id).eq("attempts", a.attempts).eq("delivery", "pending").select("id");
    if (!claimed?.length) continue;

    const s = byOrg.get(a.org_id);
    const phones = [...new Set((s?.alert_phones || []).map(mobile).filter(Boolean))].slice(0, MAX_PHONES) as string[];
    const finish = (delivery: string, detail: string | null) => admin.from("fleet_alerts")
      .update({ delivery, delivery_detail: detail, delivered_at: delivery === "sent" ? new Date().toISOString() : null }).eq("id", a.id);

    if (!s?.notify_sms || !phones.length) { await finish("skipped", "SMS is off or no phone numbers are set."); skipped++; continue; }
    if (!AUTH_KEY || !TPL) { await finish("skipped", "SMS template not configured (MSG91_TPL_SAFETY)."); skipped++; continue; }

    try {
      const r = await fetch("https://api.msg91.com/api/v5/flow/", {
        method: "POST",
        headers: { "Content-Type": "application/json", authkey: AUTH_KEY },
        body: JSON.stringify({
          template_id: TPL, short_url: "0", realTimeResponse: "1",
          recipients: phones.map((m) => ({ mobiles: m, var1: clip(a.title, 60), var2: clip(a.body || a.severity, 80) })),
        }),
      });
      const out = await r.json().catch(() => ({}));
      if (!r.ok || out?.type === "error") throw new Error(out?.message || `MSG91 answered ${r.status}`);
      await finish("sent", `SMS to ${phones.length} number(s)`); sent++;
    } catch (e) {
      const last = a.attempts + 1 >= MAX_ATTEMPTS;
      await admin.from("fleet_alerts").update({ delivery: last ? "failed" : "pending", delivery_detail: clip((e as Error).message, 300) }).eq("id", a.id);
      failed++;
    }
  }
  return json(200, { ok: true, sent, failed, skipped });
});
