# FleetWorks live video (LiveKit) & MQTT device ingest

The FleetWorks Transitional Platform uses **managed** services only — no servers to run,
no self-hosted infrastructure. Live video is **LiveKit Cloud**; device data can arrive over
**MQTT** through any managed broker. Both sit behind portable seams, so a later move to
self-hosted LiveKit or a different broker is a config change, not an app rewrite.

---

## 1. Live video — LiveKit Cloud

**What it does:** the driver's phone running Safe Drive publishes the cabin camera as a true
live WebRTC stream; the fleet owner/supervisor watches it from **AI Vision → "Watch driver
phone live"**. Recording (2-minute event clips) is unchanged and still lands in Incident Triage.

**The seam:** the browser only ever calls `window.MediaService`
([js/core/media-service.js](../js/core/media-service.js)) —
`publish(vehicleId, stream)`, `view(vehicleId, videoEl)`, `available()`. LiveKit lives only
behind it and in one edge function. Swap providers by changing those two files.

### Set-up (once)

1. Create a **LiveKit Cloud** project at https://cloud.livekit.io — note the **project URL**
   (`wss://<name>.livekit.cloud`), **API key** and **API secret**.
2. Add them as Supabase edge-function secrets (Dashboard → Project → Edge Functions → Secrets,
   or CLI):

   ```bash
   npx supabase secrets set \
     LIVEKIT_URL=wss://<name>.livekit.cloud \
     LIVEKIT_API_KEY=<api-key> \
     LIVEKIT_API_SECRET=<api-secret>
   ```

3. Deploy the token minter:

   ```bash
   npx supabase functions deploy livekit-token --no-verify-jwt
   ```

Until the secrets exist, `livekit-token` returns **503** and the app quietly falls back to the
simulated cameras — nothing breaks.

### How auth works

`livekit-token` ([supabase/functions/livekit-token](../supabase/functions/livekit-token/index.ts))
verifies the caller's Supabase JWT and org membership, then mints a short-lived LiveKit token
scoped to one room per vehicle (`veh_<vehicleId>`):

- **driver** (any member on the vehicle) → `canPublish`, cannot subscribe;
- **viewer** (owner / manager / supervisor only) → `canSubscribe`, hidden, cannot publish.

The LiveKit API secret never leaves the server. The **no-login WhatsApp driver page cannot go
live** — its token is not verified server-side, so it must never publish footage. Live view
needs the team driver login.

---

## 2. Device ingest over MQTT

**What it does:** any managed MQTT broker can feed telemetry and events into FleetWorks. MQTT is
treated as a **transport**, not a payload format: the broker's own rule/data-integration engine
forwards each message over HTTPS to `device-ingest?format=mqtt`, which normalizes it through the
same canonical pipeline as flespi/Traccar/native. **Postgres stays the message bus** — FleetWorks
runs no broker.

```
vehicle → MQTT broker (HiveMQ / EMQX / flespi / AWS IoT Core)
        → broker rule forwards HTTPS
        → POST /functions/v1/device-ingest?format=mqtt   (header x-ingest-key: fwk_...)
        → adapters.fromMqtt → device_events / telemetry (Postgres)
```

### Topic & payload contract

Publish one of these; the adapter takes identity and kind from explicit fields first, else the topic:

```
topic:  fleetworks/v1/<ident>/telemetry     payload: { "latitude": 11.1, "longitude": 79.4, "speed_kmph": 52, "fuel_level_pct": 44 }
topic:  fleetworks/v1/<ident>/event         payload: { "event_type": "harsh_brake", "severity": "warning" }
```

or the device envelope (topic optional):

```json
{ "vehicleId": "VH-10027", "deviceId": "TPMS-001", "type": "tpms",
  "timestamp": "2026-09-30T08:10:00Z",
  "payload": { "position": "front_left", "pressure_kpa": 812, "temperature_c": 46 } }
```

- `<ident>` matches the device by IMEI/serial as registered in Devices & Telemetry.
- Known keys (`latitude`, `speed_kmph`, `fuel_level_pct`, …) map to canonical signals; anything
  else stays in `params` for per-device sensor mappings (`device_sensors`) to pick up.
- `type` containing `event`/`alarm`/`alert`, or a payload with `event_type`, routes to events.
- A broker that wraps the message as `{ "topic": "...", "payload": { ... } }` is unwrapped
  automatically; batches go as a JSON array or under `messages`.

### Broker set-up (example)

1. In **Devices & Telemetry → Integrations**, create an ingest key (`fwk_...`).
2. In your broker's rule/data-integration, forward matching topics to
   `https://<project>.supabase.co/functions/v1/device-ingest?format=mqtt` with header
   `x-ingest-key: fwk_...` (or `?key=fwk_...` if the broker cannot set headers).
3. No FleetWorks deploy needed for the broker; redeploy `device-ingest` only when the adapter
   changes:

   ```bash
   npx supabase functions deploy device-ingest --no-verify-jwt
   ```

---

## Why this is portable (Transitional Platform)

| Concern | Managed today | Later, if needed |
|---|---|---|
| Live video | LiveKit Cloud | self-hosted LiveKit (same API/SDK) |
| Device transport | managed MQTT broker | AWS IoT Core / Kafka / another broker — new adapter only |
| Data | Supabase Postgres | Cloud SQL / Aurora (ordinary Postgres) |
| Media | Supabase Storage / LiveKit egress | S3 / GCS |

The interfaces (`MediaService`, the device message contract, the event model) are the durable
part; the managed services behind them are disposable.
