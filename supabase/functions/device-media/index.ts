// FleetWorks — camera media ingest (Supabase Edge Function, Deno).
//
// Clips and snapshots from any camera: dashcam, MDVR channel, 360° (AVM) composite,
// cargo camera, fuel-tank camera. Files go to the private device-media bucket; members
// see them through signed URLs, subject to RLS on the path (org / vehicle).
//
//   POST /functions/v1/device-media        header x-ingest-key: fwk_...
//
//   multipart/form-data   file=<clip or image>, ident, channel (number or role),
//                         kind=clip|snapshot, captured_at, event_type?, event_id?, severity?
//   application/json      { ident, url: "https://...", channel, kind, captured_at, event_type?, event_id? }
//                         — the function fetches the file (JT/T 1078 / vendor clouds
//                         usually hand over a download URL rather than the bytes)
//
// Giving event_type creates the incident as well (e.g. a dashcam that uploads its
// forward-collision clip in one call); event_id attaches the file to an incident
// already sent to device-ingest.
//
// Deploy:
//   npx supabase functions deploy device-media --no-verify-jwt

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { eventType, severityFor } from "../_shared/devices/adapters.ts";
import { findDevice, IDENT_RE, resolveKey } from "../_shared/devices/pipeline.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LEGACY_KEY = Deno.env.get("TELEMETRY_INGEST_KEY") || "";
const MAX_BYTES = 100 * 1024 * 1024;    // matches the bucket limit
const FETCH_TIMEOUT_MS = 25000;
const EXT: Record<string, string> = {
  "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm", "video/x-matroska": "mkv",
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp",
};
const ROLES = new Set(["front_road", "cabin_dms", "left", "right", "rear", "cargo", "surround_avm", "tank", "other"]);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, x-ingest-key",
  "Content-Type": "application/json",
};
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: CORS });

// The server fetches a URL a key holder gives it, so internal and private addresses are
// refused: the key must not become a way to probe the network the function runs in.
function publicHost(u: string): boolean {
  let h: string;
  try { h = new URL(u).hostname.toLowerCase().replace(/^\[|\]$/g, ""); } catch { return false; }
  if (!h.includes(".") || h === "localhost" || /\.(local|internal|localhost|lan)$/.test(h)) return false;
  if (h.endsWith(".supabase.co") || h.endsWith(".supabase.in")) return false;
  const v4 = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return !(a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224);
  }
  if (h.includes(":")) return !(h === "::1" || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80"));
  return true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return reply(405, { error: "POST only" });
  const url = new URL(req.url);
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const key = await resolveKey(admin, req.headers.get("x-ingest-key") || url.searchParams.get("key") || "", LEGACY_KEY);
  if (!key) return reply(401, { error: "Missing or wrong ingest key." });

  // ── read the request ──
  const f: Record<string, string> = {};
  let bytes: Uint8Array | null = null, mime = "";
  const ctype = req.headers.get("content-type") || "";
  try {
    if (ctype.startsWith("multipart/form-data")) {
      if (Number(req.headers.get("content-length") || 0) > MAX_BYTES + 65536) return reply(413, { error: "File over 100 MB." });
      const form = await req.formData();
      for (const [k, v] of form.entries()) if (typeof v === "string") f[k] = v;
      const file = form.get("file");
      if (!(file instanceof File)) return reply(400, { error: "Send the clip or image as the 'file' field." });
      mime = (file.type || "").toLowerCase();
      bytes = new Uint8Array(await file.arrayBuffer());
    } else {
      const j = await req.json();
      for (const [k, v] of Object.entries(j || {})) if (v !== null && v !== undefined) f[k] = String(v);
      if (!/^https:\/\//i.test(f.url || "")) return reply(400, { error: "Give the file as multipart 'file', or an https 'url' to fetch it from." });
      if (!publicHost(f.url)) return reply(400, { error: "The url must be a public internet address." });
    }
  } catch { return reply(400, { error: "Could not read the request body." }); }

  const ident = (f.ident || f.imei || "").trim();
  if (!IDENT_RE.test(ident)) return reply(400, { error: "ident (IMEI / serial) is required: letters, digits and . _ : - only." });
  const device = await findDevice(admin, key, ident);
  const log = (status: string, detail: string | null, media = 0) => admin.from("ingest_log").insert({
    org_id: key.orgId ?? device?.org_id ?? null, key_id: key.keyId, endpoint: "device-media", format: bytes ? "multipart" : "url",
    ident, status, detail, media,
  });
  if (!device) { await log("unknown_device", `No device registered with ID ${ident}.`); return reply(404, { error: `No device registered with IMEI or ID ${ident}.` }); }

  // ── fetch by URL when no bytes were sent ──
  if (!bytes) {
    try {
      const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
      // follow redirects by hand so every hop is checked, not just the first URL
      let target = f.url, r: Response | null = null;
      for (let hop = 0; hop < 4; hop++) {
        if (!publicHost(target)) throw new Error("redirected to a non-public address");
        r = await fetch(target, { signal: ctl.signal, redirect: "manual" });
        const loc = r.headers.get("location");
        if (r.status >= 300 && r.status < 400 && loc) { target = new URL(loc, target).toString(); continue; }
        break;
      }
      clearTimeout(timer);
      if (!r) throw new Error("no response");
      if (!r.ok) throw new Error(`the camera's URL answered ${r.status}`);
      if (Number(r.headers.get("content-length") || 0) > MAX_BYTES) throw new Error("file over 100 MB");
      mime = (r.headers.get("content-type") || "").split(";")[0].toLowerCase();
      bytes = new Uint8Array(await r.arrayBuffer());
    } catch (e) {
      // keep the reference even when the copy fails, so the clip is not lost from the record
      await admin.from("device_media").insert({
        org_id: device.org_id, device_id: device.id, vehicle_id: device.vehicle_id, kind: f.kind === "snapshot" ? "snapshot" : "clip",
        source_url: f.url, captured_at: f.captured_at || new Date().toISOString(), simulated: device.simulated,
      });
      await log("partial", `Stored the link only; could not copy the file: ${(e as Error).message}`, 1);
      return reply(202, { ok: true, stored: "link_only", detail: (e as Error).message });
    }
  }
  if (!bytes || !bytes.length) return reply(400, { error: "The file is empty." });
  if (bytes.length > MAX_BYTES) return reply(413, { error: "File over 100 MB." });
  if (!EXT[mime]) mime = f.kind === "snapshot" ? "image/jpeg" : "video/mp4";   // many cameras send octet-stream
  const kind = f.kind === "snapshot" || mime.startsWith("image/") ? "snapshot" : "clip";

  // ── channel → role ──
  const chNo = Number(f.channel);
  let role: string | null = ROLES.has(String(f.channel)) ? String(f.channel) : null;
  if (Number.isFinite(chNo) && !role) {
    const { data: ch } = await admin.from("device_channels").select("role").eq("device_id", device.id).eq("channel_no", chNo).maybeSingle();
    role = ch?.role ?? null;
  }

  // ── incident: attach to one, or create it ──
  const captured = f.captured_at && !Number.isNaN(Date.parse(f.captured_at)) ? new Date(f.captured_at).toISOString() : new Date().toISOString();
  let eventId: string | null = null;
  if (f.event_id) {
    const { data: ev } = await admin.from("device_events").select("id").eq("id", f.event_id).eq("device_id", device.id).maybeSingle();
    eventId = ev?.id ?? null;
  } else if (f.event_type) {
    const t = eventType(f.event_type);
    if (t) {
      const { data: ev } = await admin.from("device_events").insert({
        device_id: device.id, org_id: device.org_id, occurred_at: captured, event_type: t, severity: severityFor(t, f.severity),
        speed_kmph: Number.isFinite(Number(f.speed_kmph)) ? Number(f.speed_kmph) : null,
        latitude: Number.isFinite(Number(f.latitude)) ? Number(f.latitude) : null,
        longitude: Number.isFinite(Number(f.longitude)) ? Number(f.longitude) : null,
        raw: { ...f, raw_type: f.event_type, channel_role: role }, simulated: device.simulated,
      }).select("id").single();
      eventId = ev?.id ?? null;
    }
  }

  // ── store ──
  const d = new Date(captured);
  const path = `${device.org_id}/${device.vehicle_id || device.id}/${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCDate()).padStart(2, "0")}/${crypto.randomUUID()}.${EXT[mime]}`;
  const { error: upErr } = await admin.storage.from("device-media").upload(path, bytes, { contentType: mime, upsert: false });
  if (upErr) { await log("error", "Storage upload failed: " + upErr.message); return reply(500, { error: "Could not store the file: " + upErr.message }); }
  const { data: row, error: rowErr } = await admin.from("device_media").insert({
    org_id: device.org_id, device_id: device.id, vehicle_id: device.vehicle_id, event_id: eventId,
    channel_no: Number.isFinite(chNo) ? chNo : null, role, kind, storage_path: path, source_url: f.url || null,
    mime, bytes: bytes.length, captured_at: captured, simulated: device.simulated,
  }).select("id").single();
  if (rowErr) { await log("error", rowErr.message); return reply(500, { error: rowErr.message }); }
  if (eventId && kind === "clip") await admin.from("device_events").update({ video_url: "storage:device-media/" + path }).eq("id", eventId).is("video_url", null);
  await admin.from("devices").update({ last_seen_at: new Date().toISOString() }).eq("id", device.id);
  await log("ok", null, 1);
  return reply(200, { ok: true, media_id: row.id, event_id: eventId, kind, role, bytes: bytes.length });
});
