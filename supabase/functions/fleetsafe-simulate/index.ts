// FleetWorks — FleetSafe simulator for a signed-in fleet (Supabase Edge Function, Deno).
//
// POST { action: "seed" | "clear" }   (the caller's JWT; owner or manager only)
//
//   seed   gives the fleet's own vehicles (up to 6) simulated MDVRs with camera
//          channels and fuel/reefer sensor mappings, a depot, a customer site and a
//          restricted zone, three trailers/equipment, and one realistic day of
//          readings plus 7 days of camera alarms (supabase/functions/_shared/sim).
//          Readings go through the LIVE ingest pipeline, so the rules, geofences,
//          cold chain and alerts are the real backend's own output, not scripted.
//   clear  removes exactly what seed created (every row it writes is simulated = true).
//
// Simulated data never sends SMS (fs_delivery_for) and is labelled as a test on
// every page. Seeding again replaces the previous simulated day.
//
// Deploy:  npx supabase functions deploy fleetsafe-simulate --no-verify-jwt

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import "../_shared/sim/fleetsafe-sim.js";
import { fromFleetworks } from "../_shared/devices/adapters.ts";
import { ingestDevice } from "../_shared/devices/pipeline.ts";

// deno-lint-ignore no-explicit-any
const Sim = (globalThis as any).FleetSafeSim;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ALLOW = ["https://fleetworks.in", "https://www.fleetworks.in", "http://localhost:8642", "http://127.0.0.1:8642"];
const cors = (o: string | null) => ({
  "Access-Control-Allow-Origin": o && ALLOW.includes(o) ? o : ALLOW[0],
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, authorization, apikey",
  "Content-Type": "application/json",
});

async function clear(admin: SupabaseClient, org: string) {
  const { data: devs } = await admin.from("devices").select("id").eq("org_id", org).eq("simulated", true);
  const ids = (devs || []).map((d) => d.id);
  const out: Record<string, number> = {};
  const del = async (label: string, q: PromiseLike<{ count: number | null }>) => { out[label] = (await q).count ?? 0; };
  if (ids.length) {
    const [{ data: ev }, { data: ai }] = await Promise.all([
      admin.from("device_events").select("id").in("device_id", ids),
      admin.from("ai_events").select("id").in("device_id", ids),
    ]);
    const evIds = [...(ev || []), ...(ai || [])].map((r) => r.id);
    if (evIds.length) await del("analyses", admin.from("incident_analyses").delete({ count: "exact" }).eq("org_id", org).in("event_id", evIds));
  }
  await del("coaching", admin.from("coaching_sessions").delete({ count: "exact" }).eq("org_id", org).eq("simulated", true));
  await del("media", admin.from("device_media").delete({ count: "exact" }).eq("org_id", org).eq("simulated", true));
  await del("alerts", admin.from("fleet_alerts").delete({ count: "exact" }).eq("org_id", org).eq("simulated", true));
  // devices cascade to telemetry, camera events, AI events, twin, channels and sensor mappings
  if (ids.length) await del("devices", admin.from("devices").delete({ count: "exact" }).in("id", ids));
  await del("geofences", admin.from("geofences").delete({ count: "exact" }).eq("org_id", org).eq("simulated", true));
  await del("assets", admin.from("assets").delete({ count: "exact" }).eq("org_id", org).eq("simulated", true));
  const { data: cc } = await admin.from("cold_chain_vehicles").select("vehicle_id").eq("org_id", org).eq("simulated", true);
  if (cc?.length) await admin.from("cold_chain_compliance").delete().eq("org_id", org).in("vehicle_id", cc.map((c) => c.vehicle_id)).like("notes", "Computed nightly%");
  await del("reefers", admin.from("cold_chain_vehicles").delete({ count: "exact" }).eq("org_id", org).eq("simulated", true));
  await del("positions", admin.from("driver_locations").delete({ count: "exact" }).eq("org_id", org).eq("simulated", true));
  await del("log", admin.from("ingest_log").delete({ count: "exact" }).eq("org_id", org).eq("endpoint", "simulator"));
  return out;
}

async function seed(admin: SupabaseClient, org: string) {
  const [{ data: vehicles }, { data: drivers }] = await Promise.all([
    admin.from("vehicles").select("id, name, type, tank_capacity").eq("org_id", org).order("name").limit(6),
    admin.from("drivers").select("id, name, vehicle_id").eq("org_id", org),
  ]);
  if (!vehicles?.length) throw new Error("Add at least one vehicle first; the simulator fits devices to your own vehicles.");
  await clear(admin, org);
  const plan = Sim.plan({ vehicles, drivers: drivers || [] });

  // devices, channels, sensor mappings
  const devId: Record<string, string> = {};
  for (const d of plan.devices) {
    const { data, error } = await admin.from("devices").insert({
      org_id: org, vehicle_id: d.vehicle_id, imei: d.imei, kind: d.kind, protocol: d.protocol, integration: d.integration,
      vendor: d.vendor, model: d.model, capabilities: ["gps", "adas", "dms", "fuel_level"], status: "active", simulated: true,
      notes: `Simulated · ${d.route}`, installed_at: new Date(Date.now() - 30 * 864e5).toISOString(),
    }).select("id").single();
    if (error) throw new Error("device: " + error.message);
    devId[d.ref] = data.id;
  }
  await admin.from("device_channels").insert(plan.channels.map((c: Record<string, unknown>) => ({
    org_id: org, device_id: devId[c.device_ref as string], vehicle_id: plan.devices.find((d: { ref: string }) => d.ref === c.device_ref).vehicle_id,
    channel_no: c.channel_no, role: c.role, label: c.label,
  })));
  await admin.from("device_sensors").insert(plan.sensors.map((s: Record<string, unknown>) => ({
    org_id: org, device_id: devId[s.device_ref as string], source_key: s.source_key, signal_path: s.signal_path, transform: s.transform,
    scale: s.scale ?? null, offset: s.offset ?? null, calibration: s.calibration ?? null, label: s.label,
  })));
  // places, reefer, equipment: before the readings, so the triggers see them
  if (plan.geofences.length) await admin.from("geofences").insert(plan.geofences.map((g: Record<string, unknown>) => ({
    org_id: org, name: g.name, purpose: g.purpose, centre_lat: g.centre_lat, centre_lng: g.centre_lng, radius_m: g.radius_m, alert_on: g.alert_on, is_active: true, simulated: true,
  })));
  if (plan.coldChain.length) await admin.from("cold_chain_vehicles").insert(plan.coldChain.map((c: Record<string, unknown>) => ({ org_id: org, ...c, is_active: true, simulated: true })));
  if (plan.assets.length) await admin.from("assets").insert(plan.assets.map((a: Record<string, unknown>) => ({ org_id: org, ...a, simulated: true })));

  // readings through the real pipeline
  const results = [];
  for (const d of plan.devices) {
    results.push(await ingestDevice(admin, { orgId: org, keyId: null }, "simulator", "fleetworks", d.imei,
      fromFleetworks({ imei: d.imei, readings: plan.readings[d.ref] })));
  }
  // camera alarms, with the scenario the triage page draws the freeze frame from
  const evRows = plan.devices.flatMap((d: { ref: string }) => plan.events[d.ref].map((e: Record<string, unknown>) => ({ ...e, device_id: devId[d.ref], org_id: org, simulated: true })));
  const { data: evs, error: evErr } = await admin.from("device_events").insert(evRows).select("id, occurred_at, severity, event_type, device_id");
  if (evErr) throw new Error("events: " + evErr.message);
  // older, non-critical alarms were already reviewed, as on a fleet that uses FleetSafe daily
  const old = (evs || []).filter((e) => Date.parse(e.occurred_at) < Date.now() - 2 * 864e5 && (e.severity !== "critical" || Date.parse(e.occurred_at) < Date.now() - 4 * 864e5));
  for (const e of old) await admin.from("device_events").update({ acknowledged_at: new Date(Date.parse(e.occurred_at) + 3 * 3600e3).toISOString() }).eq("id", e.id);
  if (old.length) await admin.from("fleet_alerts").update({ read_at: new Date().toISOString() }).eq("org_id", org).eq("source", "device_events").in("source_id", old.map((e) => e.id));
  // coaching for the most recent drowsiness, where the vehicle has a driver
  const fatigue = (evs || []).filter((e) => e.event_type === "fatigue").sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))[0];
  if (fatigue) {
    const vid = plan.devices.find((d: { ref: string }) => devId[d.ref] === fatigue.device_id)?.vehicle_id;
    const drv = (drivers || []).find((x) => x.vehicle_id === vid);
    if (drv) await admin.from("coaching_sessions").insert({ org_id: org, driver_id: drv.id, event_id: fatigue.id, vehicle_id: vid, event_type: "fatigue", severity: "critical", status: "assigned", assigned_at: new Date().toISOString(), simulated: true });
  }
  // latest positions for Fleet View and the Operation Centre
  await admin.from("driver_locations").insert(plan.lastPositions.map((l: Record<string, unknown>) => ({ org_id: org, ...l, source: "device", simulated: true })));

  const { count: alerts } = await admin.from("fleet_alerts").select("id", { count: "exact", head: true }).eq("org_id", org).eq("simulated", true);
  const { count: ai } = await admin.from("ai_events").select("id", { count: "exact", head: true }).eq("org_id", org).eq("simulated", true);
  return {
    vehicles: vehicles.length, devices: plan.devices.length, readings: results.reduce((s, r) => s + r.readings, 0),
    camera_events: evs?.length ?? 0, ai_detections: ai ?? 0, alerts: alerts ?? 0, geofences: plan.geofences.length, assets: plan.assets.length,
    problems: results.filter((r) => r.status !== "ok").map((r) => `${r.ident}: ${r.status} ${r.detail || ""}`),
  };
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: cors(origin) });
  if (req.method !== "POST") return reply(405, { error: "POST only" });
  const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return reply(401, { error: "Sign in first." });
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: caller } = await admin.auth.getUser(jwt);
  if (!caller?.user) return reply(401, { error: "Session expired — sign in again." });
  const { data: mem } = await admin.from("memberships").select("org_id").eq("user_id", caller.user.id).in("role", ["owner", "manager"]).limit(1).maybeSingle();
  if (!mem) return reply(403, { error: "Only the fleet owner or a manager can load or remove simulated data." });

  let body: { action?: string } = {};
  try { body = await req.json(); } catch { /* default below */ }
  try {
    if (body.action === "clear") return reply(200, { ok: true, removed: await clear(admin, mem.org_id) });
    if (body.action === "seed") return reply(200, { ok: true, seeded: await seed(admin, mem.org_id) });
    return reply(400, { error: "action must be seed or clear" });
  } catch (e) {
    return reply(500, { error: (e as Error).message });
  }
});
