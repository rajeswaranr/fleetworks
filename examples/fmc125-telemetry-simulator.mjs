/* Send datasheet-supported Teltonika FMC125 sample data to FleetWorks.

   TELEMETRY_URL=https://PROJECT.supabase.co/functions/v1/telemetry-ingest \
   TELEMETRY_INGEST_KEY=replace-me DEVICE_IMEI=861100000000125 \
   node examples/fmc125-telemetry-simulator.mjs
*/

import "../js/modules/iot-telemetry/adapters/fmc125.adapter.js";

const endpoint = process.env.TELEMETRY_URL;
const ingestKey = process.env.TELEMETRY_INGEST_KEY;
const imei = process.env.DEVICE_IMEI || "861100000000125";
if (!endpoint || !ingestKey) {
  console.error("Set TELEMETRY_URL and TELEMETRY_INGEST_KEY. DEVICE_IMEI is optional.");
  process.exit(1);
}

const batch = globalThis.FWFmc125.sampleBatch(6);
batch.imei = imei;
const response = await fetch(endpoint, {
  method: "POST",
  headers: { "content-type": "application/json", "x-ingest-key": ingestKey },
  body: JSON.stringify(batch),
});
const result = await response.json().catch(() => ({}));
console.log(JSON.stringify({ status: response.status, sent: { readings: batch.readings.length, events: batch.events.length }, result }, null, 2));
if (!response.ok) process.exitCode = 1;
