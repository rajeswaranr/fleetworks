/* Send a datasheet-supported Teltonika FMC650 sample batch to FleetWorks.

   TELEMETRY_URL=https://PROJECT.supabase.co/functions/v1/telemetry-ingest \
   TELEMETRY_INGEST_KEY=replace-me DEVICE_IMEI=861100000000650 \
   node examples/fmc650-telemetry-simulator.mjs
*/
import "../js/modules/iot-telemetry/adapters/fmc650.adapter.js";

const endpoint = process.env.TELEMETRY_URL;
const ingestKey = process.env.TELEMETRY_INGEST_KEY;
const imei = process.env.DEVICE_IMEI || "861100000000650";
if (!endpoint || !ingestKey) {
  console.error("Set TELEMETRY_URL and TELEMETRY_INGEST_KEY. DEVICE_IMEI is optional.");
  process.exit(1);
}
const batch = globalThis.FWFmc650.sampleBatch(7);
batch.imei = imei;
const response = await fetch(endpoint, {
  method: "POST",
  headers: { "content-type": "application/json", "x-ingest-key": ingestKey },
  body: JSON.stringify(batch),
});
const result = await response.json().catch(() => ({}));
console.log(JSON.stringify({ status: response.status, sent: { readings: batch.readings.length, events: batch.events.length }, result }, null, 2));
if (!response.ok) process.exitCode = 1;
