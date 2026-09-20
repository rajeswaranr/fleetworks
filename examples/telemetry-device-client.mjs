/* Reference HTTPS client for a tracker gateway or vendor webhook worker.

   TELEMETRY_URL=https://PROJECT.supabase.co/functions/v1/telemetry-ingest \
   TELEMETRY_INGEST_KEY=replace-me DEVICE_IMEI=861100000000001 \
   node examples/telemetry-device-client.mjs

   A physical tracker may speak AIS-140/JT808 over TCP instead of HTTPS. In
   that case, run this mapping code in the vendor-cloud webhook or protocol
   gateway—not in the FleetWorks browser. */

const endpoint = process.env.TELEMETRY_URL;
const ingestKey = process.env.TELEMETRY_INGEST_KEY;
const imei = process.env.DEVICE_IMEI;

if (!endpoint || !ingestKey || !imei) {
  console.error("Set TELEMETRY_URL, TELEMETRY_INGEST_KEY and DEVICE_IMEI.");
  process.exitCode = 1;
} else {
  const now = new Date().toISOString();
  const payload = {
    imei,
    readings: [{
      recorded_at: now,
      latitude: 11.2189,
      longitude: 78.1677,
      speed_kmph: 56.4,
      heading: 248,
      ignition: true,
      odometer_km: 184220.7,
      engine_hours: 6250.2,
      engine_rpm: 1640,
      coolant_temp_c: 87.5,
      battery_voltage: 27.8,
      fuel_level_pct: 68.4,
      fuel_rate_lph: 16.1,
      tyre_pressure_min_psi: 102,
    }],
    events: [],
  };

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", "x-ingest-key": ingestKey },
    body: JSON.stringify(payload),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error("Telemetry rejected:", response.status, result);
    process.exitCode = 1;
  } else {
    console.log("Telemetry accepted:", result);
  }
}
