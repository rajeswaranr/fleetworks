// FleetWorks — Safe Drive clip review & retention (Supabase Edge Function, Deno).
//
// Two callers:
//   1. pg_cron (header x-cron-key): the nightly sweep. Deletes clips still 'pending'
//      after 3 days — the stored file AND the device_media row — so unreviewed footage
//      never lingers.
//   2. Owner / supervisor (their JWT): review one clip now.
//        { mediaId, action: "archive" }  keep it (stops the 3-day deletion)
//        { mediaId, action: "delete"  }  remove the file and the row immediately
//      Membership in the clip's org is verified first.
//
// Deleting the storage file needs the storage API (a SQL delete would orphan it), which
// is why retention lives here rather than in the fs_retention() SQL job.
//
// Secrets: FLEETSAFE_CRON_KEY (same as the dispatcher).
// Deploy:  npx supabase functions deploy device-media-retention --no-verify-jwt

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_KEY = Deno.env.get("FLEETSAFE_CRON_KEY") || "";
const RETAIN_DAYS = 3;
const BATCH = 200;
const ALLOW = ["https://fleetworks.in", "https://www.fleetworks.in", "http://localhost:8642", "http://127.0.0.1:8642"];
const cors = (o: string | null) => ({
  "Access-Control-Allow-Origin": o && ALLOW.includes(o) ? o : ALLOW[0],
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, authorization, apikey, x-cron-key",
  "Content-Type": "application/json",
});
function safeEqual(a: string, b: string) { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; }

// remove a batch of clips: their files first, then the rows (skip rows whose file remove failed)
async function purge(admin: SupabaseClient, rows: { id: string; storage_path: string | null }[]) {
  const paths = rows.map((r) => r.storage_path).filter((p): p is string => !!p);
  let removed = 0;
  if (paths.length) { const { error } = await admin.storage.from("device-media").remove(paths); if (!error) removed = paths.length; }
  const ids = rows.map((r) => r.id);
  if (ids.length) await admin.from("device_media").delete().in("id", ids);
  return { rows: ids.length, files: removed };
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  const reply = (s: number, b: unknown) => new Response(JSON.stringify(b), { status: s, headers: cors(origin) });
  if (req.method !== "POST") return reply(405, { error: "POST only" });
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

  // ── cron sweep ──
  const cron = req.headers.get("x-cron-key") || "";
  if (cron) {
    if (!CRON_KEY || !safeEqual(cron, CRON_KEY)) return reply(401, { error: "Not allowed." });
    const before = new Date(Date.now() - RETAIN_DAYS * 864e5).toISOString();
    const { data: due } = await admin.from("device_media").select("id, storage_path")
      .eq("kind", "clip").eq("review_status", "pending").lt("captured_at", before).limit(BATCH);
    if (!due?.length) return reply(200, { ok: true, deleted: 0 });
    const r = await purge(admin, due);
    return reply(200, { ok: true, deleted: r.rows, files: r.files });
  }

  // ── owner/supervisor review of one clip ──
  const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return reply(401, { error: "Sign in first." });
  let body: { mediaId?: string; action?: string };
  try { body = await req.json(); } catch { return reply(400, { error: "bad_json" }); }
  const mediaId = String(body.mediaId || ""), action = String(body.action || "");
  if (!/^[0-9a-f-]{36}$/i.test(mediaId)) return reply(400, { error: "mediaId is required." });
  if (action !== "archive" && action !== "delete") return reply(400, { error: "action must be archive or delete." });

  const { data: caller } = await admin.auth.getUser(jwt);
  if (!caller?.user) return reply(401, { error: "Session expired — sign in again." });
  const { data: media } = await admin.from("device_media").select("id, org_id, storage_path").eq("id", mediaId).maybeSingle();
  if (!media) return reply(404, { error: "Clip not found." });
  const { data: mem } = await admin.from("memberships").select("org_id, role").eq("user_id", caller.user.id).eq("org_id", media.org_id).maybeSingle();
  if (!mem || !["owner", "manager", "supervisor"].includes(String(mem.role))) return reply(403, { error: "Only the owner or a supervisor can review clips." });

  if (action === "archive") {
    await admin.from("device_media").update({ review_status: "archived", reviewed_at: new Date().toISOString(), reviewed_by: caller.user.id }).eq("id", mediaId);
    return reply(200, { ok: true, review_status: "archived" });
  }
  await purge(admin, [media]);
  return reply(200, { ok: true, deleted: true });
});
