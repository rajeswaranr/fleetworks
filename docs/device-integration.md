# Connecting devices to FleetWorks

How GPS trackers, AI dashcams, MDVRs, 360° and cargo cameras, fuel-level and
temperature sensors reach FleetSafe, and why it is built this way.

## 1. What the industry uses

| Area | Standard / protocol | Where you meet it |
|---|---|---|
| GPS trackers (India) | **AIS-140** (ARAI), mandatory VLTD for public and goods-carrying commercial vehicles | Any AIS-140 certified tracker; the device also reports to the state backend |
| GPS trackers (general) | **Teltonika Codec 8 / 8E**, **Concox GT06**, Queclink @Track | Binary or ASCII over TCP/UDP |
| Dashcams, MDVRs (ADAS + DMS) | **JT/T 808** (position, alarms, commands) with **JT/T 1078** (live video, playback, file upload); alarm-attachment extensions for ADAS/DMS | Most AI dashcams and multi-channel recorders sold for trucks and buses |
| IP cameras | ONVIF, RTSP | Fixed or cargo cameras on a recorder |
| Engine / CAN | **SAE J1939**, **FMS** (Bus/Truck FMS), OBD-II | Fuel level, RPM, odometer, coolant; read by the tracker |
| Fuel level sensors | Capacitive LLS (Omnicomm LLS, Escort, Technoton) on RS-485/RS-232 | Wired to the tracker; reported as raw counts inside its messages |
| Reefer / temperature | 1-Wire probes, BLE beacons, reefer-unit telematics | Wired or paired to the tracker |
| Signal vocabulary | **COVESA VSS** (Vehicle Signal Specification) | FleetWorks' internal signal names |
| Fleet data exchange | rFMS (ACEA), ISO 15143-3 (AEMP 2.0) | OEM clouds, construction equipment |
| Browser video | HLS, WebRTC (WHEP) | Live view; JT/T 1078 and RTSP must be converted by a media gateway |

Two facts drive the design:

1. **Trackers and cameras speak TCP binary protocols; FleetWorks runs on HTTPS
   edge functions.** A protocol gateway sits between them, decodes the binary
   protocol, and forwards JSON. The established hosted gateway is **flespi**
   (700+ protocols, including Teltonika, GT06, JT/T 808 and AIS-140); the
   established open-source one is **Traccar** (200+). Devices and vendor clouds
   that can make HTTPS requests themselves skip the gateway.
2. **Sensors do not talk to the internet.** A fuel or temperature sensor is wired
   to the tracker, and its value arrives inside the tracker's message under a
   vendor-specific parameter name (`io.270`, `escort.lls.value.1`, `temp1`...).
   Capacitive fuel sensors report raw counts that only mean litres after a
   per-tank calibration table.

## 2. How FleetWorks takes data in

```
 device ──TCP binary──► flespi / Traccar ──HTTPS JSON──┐
 device / vendor cloud ─────────HTTPS JSON─────────────┼─► device-ingest ─► adapters ─► sensor mappings
 camera ──clip / snapshot (multipart or URL)──────────► device-media    │                 + tank calibration
                                                                        ▼
                         telemetry · device_events · ai_events · vehicle_twin · device_media
                                                                        │  database triggers
                                                                        ▼
                         geofence enter/exit · cold-chain checks · fleet_alerts ─► SMS dispatcher
```

* **One endpoint, several formats.** `device-ingest?format=fleetworks|flespi|traccar`.
  Each format has an adapter (`supabase/functions/_shared/devices/adapters.ts`)
  that turns it into one canonical message: device ident, time, canonical VSS
  signals, every original parameter, events, media links. Supporting another
  gateway is one more adapter.
* **Sensor mappings, not code.** `device_sensors` says "parameter X from this
  device is signal Y", with a scale/offset or a calibration table. That is how
  any fuel sensor, temperature probe, door switch or TPMS unit plugs in.
* **Camera channels.** `device_channels` lists each channel of a dashcam, MDVR,
  360° or cargo camera with its role and a live link (HLS/WebRTC) where the
  vendor or gateway provides one. `device-media` stores clips and snapshots in
  the private `device-media` bucket and links them to the incident.
* **Per-fleet keys.** `integration_keys` holds a hashed key per gateway or
  vendor. A key only reaches devices registered in its own fleet, and can be
  revoked on its own.
* **Ingest log.** Every POST is logged: accepted, partly accepted, rejected, or
  from a device that is not registered yet. That's the first place to look when
  a device isn't showing up.
* **Message bus = Postgres.** Triggers fan out to geofences, cold chain and
  alerts inside the same transaction as the reading; `fleet_alerts` is the
  outbox the SMS dispatcher drains every minute (pg_cron + pg_net). There is no
  broker to run. If volume ever needs it, Supabase Queues (pgmq) is the
  in-database upgrade.

## 3. Connecting each kind of device

Everything below is also on **FleetSafe → Device Hub → Connect**, with your
real endpoint and key filled in.

### GPS tracker (Teltonika, Concox, AIS-140, …)
1. Register the device (IMEI) in Device Hub and pick its vehicle.
2. In flespi, create a channel for the tracker's protocol and point the tracker
   at it (the tracker's own configurator sets server host and port).
3. Create a flespi **http stream** to
   `https://<project>.supabase.co/functions/v1/device-ingest?format=flespi&key=fwk_…`
   and subscribe it to the channel.

With Traccar instead, set in `traccar.xml`:

```xml
<entry key='forward.enable'>true</entry>
<entry key='forward.type'>json</entry>
<entry key='forward.url'>https://<project>.supabase.co/functions/v1/device-ingest?format=traccar</entry>
<entry key='forward.header'>x-ingest-key: fwk_…</entry>
<entry key='event.forward.enable'>true</entry>
<entry key='event.forward.url'>https://<project>.supabase.co/functions/v1/device-ingest?format=traccar</entry>
<entry key='event.forward.header'>x-ingest-key: fwk_…</entry>
```

Traccar reports speed in knots, odometer in metres and engine hours in
milliseconds; the adapter converts them.

### AI dashcam / MDVR (JT/T 808 + 1078)
* **Alarms** (forward collision, lane departure, headway, drowsiness, phone,
  smoking, distraction, camera blocked…) arrive through the gateway like tracker
  data. The adapter maps vendor names (FCW, LDW, HMW, "fatigueDriving",
  "phone call"...) to FleetWorks event types.
* **Clips and snapshots**: the camera, its cloud or the gateway uploads to
  `device-media`, either as a multipart file or as an https URL FleetWorks
  fetches. Passing `event_type` creates the incident in the same call; passing
  `event_id` attaches the file to an incident already sent.
* **Live view**: JT/T 1078 is not playable in a browser. Enter the HLS or
  WebRTC link the vendor cloud or media gateway gives you per channel in
  Device Hub.

### 360° camera (AVM) and cargo camera
Register it as its own device (`avm_360`, `cargo_camera`), or as channels of the
MDVR it records into, with the channel role **360° composite** or **Cargo**.
Clips arrive through `device-media` with `channel` set; Incident Triage shows
every channel's file for an incident side by side.

### Fuel level sensor
1. The sensor is wired to the tracker (RS-485 / RS-232). Register it as a
   `fuel_sensor` attached to that tracker, or map it on the tracker itself.
2. Once the tracker reports, Device Hub lists the parameter names it sent.
   Pick the fuel sensor's (for example `escort.lls.value.1` or `io.270`).
3. Map it to **Fuel in the tank, litres** with a **calibration table**: the
   raw-count → litres pairs from the tank's calibration sheet (fill the tank in
   steps and note the sensor reading at each step).
4. With the vehicle's tank capacity saved, FleetWorks also derives the fuel
   percentage, and the theft/leak rules and Fuel Sensor page work from it.

### Temperature probe / reefer
Map the probe's parameter to **Cargo temperature** (with scale/offset if the
tracker reports tenths of a degree), and add the vehicle under cold chain with
its allowed range. Breaches raise an incident, and a compliance record is
written every night.

### Direct JSON (vendor clouds, scripts, devices with HTTPS)

```bash
curl -X POST 'https://<project>.supabase.co/functions/v1/device-ingest?format=fleetworks' \
  -H 'x-ingest-key: fwk_…' -H 'content-type: application/json' \
  -d '{"imei":"862095050000001",
       "readings":[{"recorded_at":"2026-09-28T10:00:00Z","latitude":11.66,"longitude":78.15,
                    "speed_kmph":48,"ignition":true,"fuel_level_pct":62,"cargo_temp_c":4.1,
                    "escort_lls_1":1830}],
       "events":[{"event_type":"FCW","occurred_at":"2026-09-28T10:00:05Z","speed_kmph":64,
                  "media":[{"channel":1,"url":"https://vendor.example/clip.mp4"}]}]}'
```

Reading keys: `latitude, longitude, heading, speed_kmph, ignition, engine_rpm,
coolant_temp_c, engine_hours, fuel_level_pct, fuel_litres, fuel_rate_lph,
odometer_km, battery_voltage, tyre_pressure_min_psi, ambient_temp_c,
cargo_temp_c, cargo_door_open, driver_id`. Any other key is kept and can be
mapped in Device Hub.

## 4. What happens after a message arrives

| Trigger | Result |
|---|---|
| Reading with a position | Geofence enter/exit on the edge (not every reading); a restricted zone raises a critical alert |
| Reading with cargo temperature | Cold-chain check against the vehicle's range; one breach per 30 min |
| Any reading | Rule-based AI events (fuel theft/leak, tyre loss, overheating, low battery), vehicle twin |
| Warning or critical incident | `fleet_alerts` inbox; SMS if the fleet turned it on (never for test data) |
| Every 5 min | Tracker offline / back online alerts |
| Nightly | Cold-chain compliance per reefer; pruning of old readings |

## 5. Setting up the platform side (once)

```bash
npx supabase db push
npx supabase functions deploy device-ingest --no-verify-jwt
npx supabase functions deploy device-media --no-verify-jwt
npx supabase functions deploy telemetry-ingest --no-verify-jwt
npx supabase functions deploy fleetsafe-dispatch --no-verify-jwt
npx supabase secrets set FLEETSAFE_CRON_KEY=<long random string>
```

Then, in the SQL editor, the two Vault secrets the dispatch job reads:

```sql
select vault.create_secret('https://<project>.supabase.co', 'project_url');
select vault.create_secret('<same value as FLEETSAFE_CRON_KEY>', 'fleetsafe_cron_key');
```

For SMS, register a DLT template with two variables (`##var1##` what
happened, `##var2##` detail) in MSG91, and set `MSG91_TPL_SAFETY`. Until then
alerts stay in the in-app inbox.
