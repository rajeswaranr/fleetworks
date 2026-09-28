// The one path every device message takes into FleetWorks, whatever sent it.
//
//   auth       ingest key → fleet (per-fleet keys) or the legacy global key
//   resolve    ident → registered device (never auto-created: a key must not be able
//              to invent devices), its sensor mappings and the vehicle's tank size
//   normalise  sensor mappings + fuel litres ⇄ percent, range checks
//   store      telemetry rows (wide), device events, media references
//   derive     rule-based AI events and the live vehicle twin
//   record     devices.last_seen_at and one ingest_log row per device
//
// Geofence enter/exit, cold-chain checks and alerts happen in database triggers on
// the rows written here (migration 20260928110000_fleetsafe_backend.sql), so they
// fire the same way for the driver app and the simulator.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  applySensors, deriveFuel, EVENT_TYPES, hasReading, SIG, toTelemetryRow, validate,
  type CanonicalMessage, type SensorMap,
} from "./adapters.ts";
import { detect, healthScores, toSignals, type AiEvent } from "./intelligence.ts";

export interface KeyInfo { orgId: string | null; keyId: string | null }

// Constant-time compare, so a wrong key cannot be discovered by timing the response.
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
export async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Per-fleet key (fwk_...) → its org; the legacy TELEMETRY_INGEST_KEY → any org. null = refused. */
export async function resolveKey(admin: SupabaseClient, key: string, legacyKey: string): Promise<KeyInfo | null> {
  if (!key) return null;
  if (key.startsWith("fwk_")) {
    const { data } = await admin.from("integration_keys").select("id, org_id, revoked_at").eq("key_hash", await sha256Hex(key)).maybeSingle();
    if (!data || data.revoked_at) return null;
    admin.from("integration_keys").update({ last_used_at: new Date().toISOString() }).eq("id", data.id).then(() => {});
    return { orgId: data.org_id, keyId: data.id };
  }
  return legacyKey && safeEqual(key, legacyKey) ? { orgId: null, keyId: null } : null;
}

export interface Device {
  id: string; org_id: string; vehicle_id: string | null; simulated: boolean; kind: string; imei: string;
}
export async function findDevice(admin: SupabaseClient, key: KeyInfo, ident: string): Promise<Device | null> {
  const cols = "id, org_id, vehicle_id, simulated, kind, imei";
  let q = admin.from("devices").select(cols).or(`imei.eq.${JSON.stringify(ident)},external_id.eq.${JSON.stringify(ident)}`);
  if (key.orgId) q = q.eq("org_id", key.orgId);
  const { data } = await q.limit(2);
  // the same IMEI registered in two fleets can only be written with that fleet's own key
  if (!data || data.length !== 1) return null;
  return data[0] as Device;
}

export interface IngestResult {
  ident: string; status: "ok" | "partial" | "unknown_device" | "rejected" | "error";
  readings: number; events: number; aiEvents: number; media: number; skipped: number; detail?: string;
  deviceId?: string; vehicleId?: string | null;
}

const OVERSPEED_KMPH = 70;
export const IDENT_RE = /^[A-Za-z0-9._:-]{1,64}$/;

export async function ingestDevice(
  admin: SupabaseClient, key: KeyInfo, endpoint: string, format: string, ident: string, messages: CanonicalMessage[],
): Promise<IngestResult> {
  const res: IngestResult = { ident, status: "ok", readings: 0, events: 0, aiEvents: 0, media: 0, skipped: 0 };
  const log = async () => {
    await admin.from("ingest_log").insert({
      org_id: key.orgId ?? (res.deviceId ? (await admin.from("devices").select("org_id").eq("id", res.deviceId).maybeSingle()).data?.org_id : null),
      key_id: key.keyId, endpoint, format, ident, status: res.status, detail: res.detail?.slice(0, 500) ?? null,
      readings: res.readings, events: res.events, media: res.media,
    });
  };
  try {
    if (!ident) { res.status = "rejected"; res.detail = "Message has no device ident (IMEI / serial)."; await log(); return res; }
    // idents go into a PostgREST filter, so only the characters device IDs actually use
    if (!IDENT_RE.test(ident)) { res.status = "rejected"; res.detail = "Device ident may only use letters, digits and . _ : - (max 64)."; await log(); return res; }
    const device = await findDevice(admin, key, ident);
    if (!device) {
      res.status = "unknown_device";
      res.detail = `No device registered with IMEI or ID ${ident}${key.orgId ? " in this fleet" : ""}. Add it under Devices & Telemetry.`;
      await log(); return res;
    }
    res.deviceId = device.id; res.vehicleId = device.vehicle_id;

    const [{ data: sensorRows }, { data: veh }] = await Promise.all([
      admin.from("device_sensors").select("source_key, signal_path, transform, scale, offset, calibration").eq("device_id", device.id).eq("enabled", true),
      device.vehicle_id ? admin.from("vehicles").select("tank_capacity").eq("id", device.vehicle_id).maybeSingle() : Promise.resolve({ data: null }),
    ]);
    const tank = Number((veh as { tank_capacity?: number } | null)?.tank_capacity) || null;
    const maps = (sensorRows || []) as SensorMap[];

    // normalise and validate
    const msgs: CanonicalMessage[] = [];
    const problems: string[] = [];
    for (const m of messages) {
      const n = applySensors(m, maps);
      n.signals = deriveFuel(n.signals, tank);
      const bad = validate(n);
      if (bad) { res.skipped++; problems.push(bad); continue; }
      msgs.push(n);
    }
    msgs.sort((a, b) => a.ts.localeCompare(b.ts));

    // ── readings ──
    const readings = msgs.filter(hasReading);
    const { data: previous } = await admin.from("telemetry")
      .select("recorded_at,fuel_level_pct,ignition,speed_kmph,latitude,longitude,tyre_pressure_min_psi,coolant_temp_c,battery_voltage")
      .eq("device_id", device.id).order("recorded_at", { ascending: false }).limit(1).maybeSingle();
    const derived: { type: string; severity: string; msg: CanonicalMessage; extra: Record<string, unknown> }[] = [];
    let latest: string | null = null;
    if (readings.length) {
      const rows = readings.map((m) => {
        if (!latest || m.ts > latest) latest = m.ts;
        return { ...toTelemetryRow(m), device_id: device.id, org_id: device.org_id, raw: m.params, simulated: device.simulated };
      });
      const { error, count } = await admin.from("telemetry").insert(rows, { count: "exact" });
      if (error) throw new Error("telemetry insert: " + error.message);
      res.readings = count ?? rows.length;

      // simple device-side events every tracker implies
      let prior = previous as Record<string, unknown> | null;
      for (let i = 0; i < readings.length; i++) {
        const row = rows[i] as Record<string, unknown>;
        const speed = Number(row.speed_kmph) || 0;
        if (speed > OVERSPEED_KMPH) derived.push({ type: "overspeed", severity: "warning", msg: readings[i], extra: { speed_kmph: speed, limit_kmph: OVERSPEED_KMPH } });
        const f = row.fuel_level_pct as number | undefined, pf = prior?.fuel_level_pct as number | undefined;
        if (f != null && pf != null && row.ignition === false && pf - f >= 8) derived.push({ type: "fuel_drop", severity: "critical", msg: readings[i], extra: { fuel_drop_pct: +(pf - f).toFixed(1) } });
        prior = row;
      }

      // rule-based AI events + the live twin; a failure here must not lose the readings
      try {
        const since = new Date(Date.now() - 15 * 60000).toISOString();
        const { data: lastEvents } = await admin.from("ai_events").select("event_type, occurred_at").eq("device_id", device.id).gte("occurred_at", since);
        const recent: Record<string, number> = {};
        for (const e of lastEvents || []) recent[e.event_type] = Math.max(recent[e.event_type] || 0, Date.parse(e.occurred_at));
        const ai: AiEvent[] = [];
        let p = previous as Record<string, unknown> | null;
        for (const row of rows) { ai.push(...detect(p, row, recent)); p = row; }
        if (ai.length) {
          await admin.from("ai_events").insert(ai.map((e) => ({
            org_id: device.org_id, device_id: device.id, vehicle_id: device.vehicle_id, occurred_at: e.occurred_at,
            event_type: e.event_type, signal_path: e.signal_path, severity: e.severity, confidence: e.confidence,
            summary: e.summary, evidence: e.evidence, simulated: device.simulated,
          })));
        }
        res.aiEvents = ai.length;

        const { data: twin } = await admin.from("vehicle_twin").select("state").eq("device_id", device.id).maybeSingle();
        const state: Record<string, { v: unknown; ts: string }> = { ...((twin?.state as Record<string, { v: unknown; ts: string }>) || {}) };
        for (const m of readings) {
          Object.assign(state, toSignals(toTelemetryRow(m)));
          for (const [path, v] of Object.entries(m.signals)) state[path] = { v, ts: m.ts };   // litres, driver ID, door...
        }
        for (const e of ai) state[e.signal_path] = { v: Math.max(Number(state[e.signal_path]?.v || 0), e.confidence), ts: e.occurred_at };
        await admin.from("vehicle_twin").upsert({
          device_id: device.id, org_id: device.org_id, vehicle_id: device.vehicle_id, state,
          health: healthScores(state, ai), last_reading_at: latest, simulated: device.simulated, updated_at: new Date().toISOString(),
        });
      } catch (e) { console.error("intelligence step failed:", (e as Error).message); }
    }

    // ── events + media ──
    const evRows: Record<string, unknown>[] = [];
    const evMedia: { idx: number; media: CanonicalMessage["events"][number]["media"] }[] = [];
    const push = (type: string, severity: string, m: CanonicalMessage, ts: string, raw: Record<string, unknown>, media: CanonicalMessage["events"][number]["media"]) => {
      if (!(EVENT_TYPES as readonly string[]).includes(type)) { res.skipped++; return; }
      const clip = media.find((x) => x.kind !== "snapshot");
      evRows.push({
        device_id: device.id, org_id: device.org_id, occurred_at: ts, event_type: type, severity,
        latitude: m.signals[SIG.lat] ?? null, longitude: m.signals[SIG.lng] ?? null, speed_kmph: m.signals[SIG.speed] ?? null,
        video_url: clip ? clip.url : null, raw, simulated: device.simulated,
      });
      if (media.length) evMedia.push({ idx: evRows.length - 1, media });
    };
    for (const m of msgs) for (const e of m.events) push(e.type, e.severity, m, e.ts, { ...e.params, raw_type: e.raw_type }, e.media);
    for (const d of derived) push(d.type, d.severity, d.msg, d.msg.ts, { ...d.extra, derived: true }, []);
    let eventIds: string[] = [];
    if (evRows.length) {
      const { data, error } = await admin.from("device_events").insert(evRows).select("id");
      if (error) throw new Error("event insert: " + error.message);
      eventIds = (data || []).map((r: { id: string }) => r.id);
      res.events = eventIds.length;
    }
    const mediaRows: Record<string, unknown>[] = [];
    for (const { idx, media } of evMedia) for (const x of media) mediaRows.push(mediaRow(device, x, eventIds[idx] ?? null, String(evRows[idx].occurred_at)));
    for (const m of msgs) for (const x of m.media) mediaRows.push(mediaRow(device, x, null, m.ts));
    if (mediaRows.length) {
      const { error } = await admin.from("device_media").insert(mediaRows);
      if (!error) res.media = mediaRows.length;
    }

    await admin.from("devices").update({ last_seen_at: latest || new Date().toISOString() }).eq("id", device.id);
    if (res.skipped) { res.status = res.readings || res.events ? "partial" : "rejected"; res.detail = [...new Set(problems)].join("; ") || `${res.skipped} item(s) skipped (unknown event type or bad value).`; }
    await log();
    return res;
  } catch (e) {
    res.status = "error"; res.detail = (e as Error).message;
    await log().catch(() => {});
    return res;
  }
}

function mediaRow(device: Device, x: { channel?: number | string; kind?: string; url: string; mime?: string }, eventId: string | null, ts: string) {
  const ch = Number(x.channel);
  return {
    org_id: device.org_id, device_id: device.id, vehicle_id: device.vehicle_id, event_id: eventId,
    channel_no: Number.isFinite(ch) ? ch : null, role: Number.isFinite(ch) ? null : (x.channel ?? null),
    kind: x.kind === "snapshot" ? "snapshot" : "clip", source_url: x.url, mime: x.mime ?? null,
    captured_at: ts, simulated: device.simulated,
  };
}

/** Groups messages by device ident, preserving order. */
export function byIdent(messages: CanonicalMessage[]): Map<string, CanonicalMessage[]> {
  const m = new Map<string, CanonicalMessage[]>();
  for (const msg of messages) { const k = msg.ident || ""; if (!m.has(k)) m.set(k, []); m.get(k)!.push(msg); }
  return m;
}
