# Connecting a vehicle device to FleetWorks

FleetWorks does not connect a browser directly to a tracker. A tracker or its
vendor cloud sends data to the FleetWorks HTTPS ingest endpoint. The server
authenticates the sender, finds the registered IMEI and linked vehicle, stores
the raw packet, normalizes fields, derives alerts, and exposes the result to the
owner and driver UIs through authenticated database reads.

```text
GPS / dashcam / fuel sensor
            |
       AIS-140, JT808, or vendor protocol
            |
  device vendor cloud or protocol gateway
            |
       HTTPS JSON + secret key
            v
  telemetry-ingest Edge Function
      | validate and normalize
      | store telemetry history
      | derive overspeed / parked fuel-drop alerts
      v
  devices + telemetry + device_events
      |                         |
  owner dashboard          driver portal
```

## 1. Obtain the device connection details

From the hardware/vendor, obtain:

- IMEI or serial number
- protocol: HTTPS webhook, AIS-140, JT808, FMS or proprietary
- vendor webhook configuration page or TCP gateway documentation
- telemetry field definitions and units
- dashcam clip/stream callback documentation, if applicable

If the hardware only supports a vendor IP address and TCP port, a protocol
gateway must decode those frames and post the normalized JSON shown below.

## 2. Apply the database migration

Apply `supabase/migrations/20260828100000_devices_telemetry.sql`. It creates:

- `devices`: physical device inventory and vehicle association
- `telemetry`: normalized time-series readings plus the original `raw` packet
- `device_events`: actionable ADAS, DMS, fuel and safety events

## 3. Register and link the device

Create the device as an authenticated fleet owner. Use the database UUID of the
vehicle—not its registration number—in `vehicle_id`.

```sql
insert into devices (
  org_id, vehicle_id, imei, vendor, model, protocol, capabilities,
  status, installed_at, simulated
) values (
  'ORG_UUID', 'VEHICLE_UUID', '861100000000001',
  'Your vendor', 'Tracker model', 'ais140',
  array['gps','fuel_level','adas','dms'],
  'active', now(), false
);
```

The ingest endpoint deliberately refuses unknown IMEIs. This prevents a sender
with a leaked vendor key from inventing devices or choosing an organisation.

## 4. Deploy and secure the ingest endpoint

```bash
npx supabase functions deploy telemetry-ingest --no-verify-jwt
npx supabase secrets set TELEMETRY_INGEST_KEY="a-long-random-secret"
```

Configure the vendor webhook URL as:

```text
https://PROJECT.supabase.co/functions/v1/telemetry-ingest
```

Configure this header in the vendor gateway:

```text
x-ingest-key: a-long-random-secret
```

Never put the service-role key or ingest key in `fleet.html`, `driver.html`, a
mobile client, or firmware that untrusted users can read. Prefer a separate
ingest key per vendor in production and rotate it periodically.

## 5. Send normalized data

### Teltonika FMC125

The included FMC125 adapter supports the capabilities documented in datasheet
v2.1: GNSS, accelerometer scenarios, external voltage, CAN/OBD engine values,
analog or RS232/RS485 LLS fuel level, impulse fuel-flow readings, and compatible
Bluetooth LE temperature sensors. A Teltonika Codec 8/8E gateway must first map
numeric AVL I/O element IDs to the descriptive `io` properties used by the
adapter; the IDs depend on the selected FMC125 firmware/configuration and
should be taken from Teltonika's Codec/AVL parameter documentation.

Generate and send an FMC125 batch with:

```bash
TELEMETRY_URL="https://PROJECT.supabase.co/functions/v1/telemetry-ingest" \
TELEMETRY_INGEST_KEY="your-secret" \
DEVICE_IMEI="861100000000125" \
node examples/fmc125-telemetry-simulator.mjs
```

The FMC125 is a tracker, not a dashcam. Video requires a separate camera and a
vehicle/time correlation in `device_events`; the adapter does not claim native
video capability.

### Teltonika FMC650

The FMC650 adapter adds dual-band L1+L5 GNSS metadata, two J1939 CAN channels,
J1708, K-line/tachograph state, tachograph download readiness, TPMS values,
cold-chain temperature, dual RS232 device modes, external antenna state, and
the 550 mAh backup-battery level. Values without dedicated telemetry columns
are retained under `raw.fmc650`.

```bash
TELEMETRY_URL="https://PROJECT.supabase.co/functions/v1/telemetry-ingest" \
TELEMETRY_INGEST_KEY="your-secret" \
DEVICE_IMEI="861100000000650" \
node examples/fmc650-telemetry-simulator.mjs
```

```json
{
  "imei": "861100000000001",
  "readings": [{
    "recorded_at": "2026-09-20T10:30:00Z",
    "latitude": 11.2189,
    "longitude": 78.1677,
    "speed_kmph": 56.4,
    "heading": 248,
    "ignition": true,
    "odometer_km": 184220.7,
    "engine_rpm": 1640,
    "coolant_temp_c": 87.5,
    "battery_voltage": 27.8,
    "fuel_level_pct": 68.4,
    "fuel_rate_lph": 16.1
  }],
  "events": [{
    "occurred_at": "2026-09-20T10:30:00Z",
    "event_type": "harsh_brake",
    "severity": "warning",
    "speed_kmph": 56.4,
    "video_url": "https://vendor.example/signed-clip-url"
  }]
}
```

Run the included reference sender:

```bash
TELEMETRY_URL="https://PROJECT.supabase.co/functions/v1/telemetry-ingest" \
TELEMETRY_INGEST_KEY="your-secret" \
DEVICE_IMEI="861100000000001" \
node examples/telemetry-device-client.mjs
```

The endpoint accepts up to 500 readings and 200 vendor events per request. It
validates coordinates, speed, fuel percentage and timestamps. It also creates:

- an `overspeed` warning above 70 km/h
- a critical `fuel_drop` event when fuel falls by at least 8 percentage points
  while the ignition is off

## 6. Show data in the UI

The owner uses `fleet.html#devices` for fleet-wide device status, readings and
alerts. The driver uses the Live Vehicle tab and should only receive data for
the vehicle linked to that driver's token/account. Production UI reads must use
authenticated endpoints and RLS; never trust a vehicle ID supplied only by the
browser.

## 7. Production checklist

- Use HTTPS only and rotate vendor keys.
- Add one credential per vendor/device rather than sharing one fleet-wide key.
- Add request IDs or vendor sequence numbers for idempotency.
- Reject stale timestamps and rate-limit by device.
- Monitor last-seen time and alert when a device goes offline.
- Store dashcam video in object storage; keep only signed URLs and metadata in
  `device_events`.
- Run telemetry retention regularly; raw readings and safety events have
  different retention requirements.
- Verify fuel calibration against the physical tank before enabling theft
  alerts for operations.
