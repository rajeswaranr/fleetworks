// FleetWorks — generic device ingest (Supabase Edge Function, Deno).
//
// One HTTPS endpoint for every tracker, camera and sensor, whatever wire format it
// arrives in:
//
//   POST /functions/v1/device-ingest?format=fleetworks   FleetWorks JSON (devices / vendor clouds)
//   POST /functions/v1/device-ingest?format=flespi       flespi HTTP stream (Teltonika, GT06, JT/T 808,
//                                                        AIS-140 and 700+ protocols via flespi)
//   POST /functions/v1/device-ingest?format=traccar      Traccar position / event forwarding
//   POST /functions/v1/device-ingest?format=mqtt         MQTT broker rule/webhook forward
//                                                        (HiveMQ, EMQX, flespi, AWS IoT Core...)
//
//   header  x-ingest-key: fwk_...   (a fleet's own key, from Devices & Telemetry → Integrations)
//           Gateways that cannot set headers may pass ?key=... instead.
//
// See docs/device-integration.md for the payloads and how to point each gateway here.
//
// Deploy:
//   npx supabase functions deploy device-ingest --no-verify-jwt

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { adapt, FORMATS, type Format } from "../_shared/devices/adapters.ts";
import { byIdent, ingestDevice, resolveKey, type IngestResult } from "../_shared/devices/pipeline.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LEGACY_KEY = Deno.env.get("TELEMETRY_INGEST_KEY") || "";
const MAX_BYTES = 2 * 1024 * 1024;     // 2 MB of JSON per POST; media goes to device-media
const MAX_MESSAGES = 1000;

const CORS = {
  "Access-Control-Allow-Origin": "*",            // machine-to-machine: the key is the auth, not the origin
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, x-ingest-key",
  "Content-Type": "application/json",
};
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: CORS });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return reply(405, { error: "POST only" });

  const url = new URL(req.url);
  const format = (url.searchParams.get("format") || "fleetworks").toLowerCase() as Format;
  if (!FORMATS.includes(format)) return reply(400, { error: `Unknown format. Use one of: ${FORMATS.join(", ")}.` });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const key = await resolveKey(admin, req.headers.get("x-ingest-key") || url.searchParams.get("key") || "", LEGACY_KEY);
  if (!key) return reply(401, { error: "Missing or wrong ingest key." });

  const len = Number(req.headers.get("content-length") || 0);
  if (len > MAX_BYTES) return reply(413, { error: "Payload over 2 MB. Send media to device-media, and batch readings smaller." });
  let body: unknown;
  try { body = JSON.parse(await req.text()); } catch { return reply(400, { error: "Body is not valid JSON." }); }

  let messages;
  try { messages = adapt(format, body); } catch (e) { return reply(422, { error: `Could not read this ${format} payload: ${(e as Error).message}` }); }
  if (!messages.length) return reply(422, { error: "No messages found in the payload." });
  if (messages.length > MAX_MESSAGES) return reply(413, { error: `Over ${MAX_MESSAGES} messages in one POST.` });

  const results: IngestResult[] = [];
  for (const [ident, msgs] of byIdent(messages)) {
    results.push(await ingestDevice(admin, key, "device-ingest", format, ident, msgs));
  }
  const ok = results.every((r) => r.status === "ok" || r.status === "partial");
  // Gateways retry on non-2xx. An unknown device will never succeed on retry, so it is
  // reported in the body with 200 and in the ingest log, rather than as an error that
  // would make the gateway resend the same batch forever.
  const status = results.some((r) => r.status === "error") ? 500 : 200;
  return reply(status, {
    ok, format,
    devices: results.map(({ ident, status, readings, events, aiEvents, media, skipped, detail, vehicleId }) =>
      ({ ident, status, readings, events, aiEvents, media, skipped, detail, vehicleId })),
  });
});
