// FleetWorks — telemetry ingest (Supabase Edge Function, Deno).
//
// The original FleetWorks-JSON endpoint, kept so existing integrations and the
// simulator keep working. It now runs the same pipeline as device-ingest
// (supabase/functions/_shared/devices/pipeline.ts), so both behave identically; new
// integrations should use device-ingest, which also takes flespi and Traccar formats.
//
// Auth: x-ingest-key — a fleet's own key (fwk_...) or the legacy TELEMETRY_INGEST_KEY.
//
// Deploy:
//   npx supabase functions deploy telemetry-ingest --no-verify-jwt

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { fromFleetworks } from "../_shared/devices/adapters.ts";
import { ingestDevice, resolveKey } from "../_shared/devices/pipeline.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LEGACY_KEY = Deno.env.get("TELEMETRY_INGEST_KEY") || "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, x-ingest-key",
  "Content-Type": "application/json",
};
const err = (status: number, message: string) => new Response(JSON.stringify({ error: message }), { status, headers: CORS });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return err(405, "POST only");

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const key = await resolveKey(admin, req.headers.get("x-ingest-key") || "", LEGACY_KEY);
  if (!key) return err(401, "Bad ingest key.");

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return err(400, "bad_json"); }
  const imei = String(body.imei || "").trim();
  if (!imei) return err(400, "imei is required — it identifies the device.");
  if ((Array.isArray(body.readings) ? body.readings.length : 0) > 500) return err(413, "At most 500 readings per POST.");

  const r = await ingestDevice(admin, key, "telemetry-ingest", "fleetworks", imei, fromFleetworks(body));
  if (r.status === "unknown_device") return err(404, `No device registered with IMEI ${imei}. Add it first.`);
  if (r.status === "rejected") return err(422, r.detail || "Rejected.");
  if (r.status === "error") return err(500, r.detail || "Ingest failed.");
  return new Response(JSON.stringify({
    ok: true, imei, readings: r.readings, events: r.events, aiEvents: r.aiEvents, media: r.media,
    skippedEvents: r.skipped, vehicleId: r.vehicleId ?? null, detail: r.detail,
  }), { headers: CORS });
});
