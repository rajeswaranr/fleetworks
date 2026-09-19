# Telegraf & Free IoT Platform Integration for FleetWorks

Complete guide to integrating Telegraf (metrics agent) and free IoT platforms for vehicle telemetry collection without expensive proprietary dashcam/telematics services.

## 1. Architecture Overview

### Option A: Telegraf + InfluxDB (Recommended for cost & simplicity)
```
Vehicle GPS/CAN → Telegraf Agent → InfluxDB Cloud (free tier) → Supabase → Dashboard
```

### Option B: MQTT + Mosquitto (Self-hosted free)
```
Vehicle IoT Device → MQTT Broker (Mosquitto) → Edge Function → Supabase
```

### Option C: Hybrid (Best for production)
```
Multiple Vehicles → Telegraf → InfluxDB Cloud
                  ↓
            Supabase Edge Function → video_events table
                  ↓
            FleetWorks Dashboard
```

---

## 2. Telegraf Installation & Configuration

### 2.1 What is Telegraf?

Telegraf is an **open-source metrics agent** that:
- Collects metrics from multiple sources (GPS, OBD-II, sensors, APIs)
- Lightweight (~10MB, 5-10% CPU per vehicle)
- Runs on vehicle devices, gateways, or servers
- Sends to InfluxDB, AWS, Azure, or custom HTTP endpoints
- Free & MIT licensed

### 2.2 Installation

#### Linux/Raspberry Pi (Vehicle Gateway)
```bash
# Download latest Telegraf
wget https://dl.influxdata.com/telegraf/releases/telegraf-1.30.0_linux_arm64.tar.gz
tar -xzf telegraf-1.30.0_linux_arm64.tar.gz
sudo mv telegraf /opt/telegraf

# Create config directory
sudo mkdir -p /etc/telegraf
sudo cp telegraf.conf /etc/telegraf/telegraf.conf

# Start as service
sudo systemctl enable telegraf
sudo systemctl start telegraf
```

#### macOS
```bash
brew install telegraf
```

#### Windows (Fleet Management Server)
```bash
# Download from https://dl.influxdata.com/telegraf/releases/
# Or via Chocolatey:
choco install telegraf
```

#### Docker (Recommended for testing)
```dockerfile
FROM telegraf:1.30.0-alpine
COPY telegraf.conf /etc/telegraf/telegraf.conf
CMD ["telegraf", "--config=/etc/telegraf/telegraf.conf"]
```

---

## 3. Telegraf Configuration for Fleet Telemetry

### 3.1 GPS + CAN Bus / OBD-II Input

```toml
# /etc/telegraf/telegraf.conf

[agent]
  interval = "10s"
  round_interval = true
  hostname = "vehicle-001"

# ======= Inputs =======

# GPS via serial port (u-blox, Quectel)
[[inputs.mqtt_consumer]]
  servers = ["tcp://mosquitto.local:1883"]
  topics = ["gps/+/location", "obd/+/data"]
  data_format = "json"

# Or pull from GPS API endpoint
[[inputs.http]]
  urls = ["http://localhost:8086/api/gps"]
  data_format = "json"
  name_override = "gps_position"
  interval = "30s"

# CAN Bus via socketcan (Linux)
[[inputs.socketcan]]
  interfaces = ["vcan0"]

# OBD-II via serial or Bluetooth
[[inputs.http]]
  urls = ["http://localhost:3000/obd/data"]
  data_format = "json"
  name_override = "vehicle_obd"

# ======= Output to InfluxDB =======

[[outputs.influxdb_v2]]
  urls = ["https://us-west-2-1.aws.cloud2.influxdata.com"]
  token = "${INFLUXDB_TOKEN}"
  organization = "fleetworks"
  bucket = "vehicle_metrics"

# ======= Output to Supabase (Edge Function) =======

[[outputs.http]]
  url = "https://your-project.supabase.co/functions/v1/telemetry-ingest"
  data_format = "json"
  headers = {
    "Authorization" = "Bearer ${SUPABASE_ANON_KEY}",
    "Content-Type" = "application/json"
  }
  # Convert metrics to JSON
  json_transformation = """
    {
      "vehicle_id": "${tag.vehicle_id}",
      "timestamp": "${time}",
      "speed_kmh": ${field.speed},
      "latitude": ${field.lat},
      "longitude": ${field.lon},
      "rpm": ${field.rpm},
      "fuel_pct": ${field.fuel_level},
      "temperature": ${field.engine_temp}
    }
  """
```

### 3.2 Sample Metrics from Vehicle

```toml
# Example vehicle publishing GPS + OBD data

[[inputs.mqtt_consumer]]
  servers = ["tcp://mosquitto.local:1883"]
  topics = ["vehicle/001/gps", "vehicle/001/obd"]
  data_format = "json"

# Message format expected:
# Topic: vehicle/001/gps
# Payload: {"lat": 13.0827, "lon": 80.2707, "accuracy": 5.2, "altitude": 45}

# Topic: vehicle/001/obd
# Payload: {"speed": 62, "rpm": 2100, "fuel": 65, "temp": 92}
```

---

## 4. InfluxDB Cloud (Free Tier)

### 4.1 Create Free InfluxDB Account

1. Sign up at https://cloud2.influxdata.com (AWS region: ap-south-1 for India)
2. Create organization: "FleetWorks"
3. Create bucket: "vehicle_metrics"
4. Generate API token: Settings → API Tokens → Generate
5. Save token (needed in Telegraf config)

### 4.2 Free Tier Limits
- **Storage:** 30 days
- **Data points:** 10 million per month (~3k/day across 100 vehicles)
- **Retention:** Auto-delete after 30 days
- **Cost:** $0

### 4.3 Query Recent Metrics

```bash
# Via InfluxDB CLI or UI
influx query '
  from(bucket: "vehicle_metrics")
    |> range(start: -24h)
    |> filter(fn: (r) => r.vehicle_id == "vehicle-001")
    |> filter(fn: (r) => r._measurement == "gps_position")
'

# Result:
# _time              | speed_kmh | latitude | longitude
# 2026-09-19T10:30Z  | 62        | 13.0827  | 80.2707
# 2026-09-19T10:40Z  | 58        | 13.0835  | 80.2712
```

---

## 5. MQTT + Mosquitto (Self-Hosted Alternative)

### 5.1 Why MQTT?

- **Lightweight:** 2-5% overhead vs proprietary protocols
- **Free:** Mosquitto is open-source (MIT license)
- **Reliable:** QoS levels (at-most-once, at-least-once, exactly-once)
- **Real-time:** Publish-subscribe pattern
- **Standard:** Works with all IoT devices (vehicles, sensors, gateways)

### 5.2 Mosquitto Installation

#### Linux (Gateway / Server)
```bash
# Ubuntu/Debian
sudo apt-get install mosquitto mosquitto-clients

# Start broker
sudo systemctl start mosquitto
sudo systemctl enable mosquitto

# Test connection
mosquitto_sub -h localhost -t test
mosquitto_pub -h localhost -t test -m "hello"
```

#### Docker
```bash
docker run -d \
  --name mosquitto \
  -p 1883:1883 \
  -p 9001:9001 \
  eclipse-mosquitto:latest
```

### 5.3 MQTT Topics & Message Format

```
Topics (publish from vehicles):
  vehicle/001/gps       → {"lat": 13.0827, "lon": 80.2707, "speed": 62, "accuracy": 5.2}
  vehicle/001/obd       → {"rpm": 2100, "fuel": 65, "temp": 92}
  vehicle/001/events    → {"event": "harsh_brake", "severity": "warning"}

Subscribe in Supabase Edge Function:
  gps/+/location        → All vehicles' location data
  obd/+/data            → All vehicles' OBD data
  events/+/incident     → All incident events
```

### 5.4 Telegraf → Mosquitto → Supabase

```toml
# Telegraf config: read MQTT, relay to Supabase

[[inputs.mqtt_consumer]]
  servers = ["tcp://mosquitto.local:1883"]
  topics = ["vehicle/+/gps", "vehicle/+/obd"]
  data_format = "json"

[[outputs.http]]
  url = "https://your-project.supabase.co/functions/v1/telemetry-ingest"
  data_format = "json"
  headers = {
    "Authorization" = "Bearer ${SUPABASE_ANON_KEY}"
  }
```

---

## 6. Edge Function: Telemetry Ingestion

```typescript
// supabase/functions/telemetry-ingest/index.ts

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL"),
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
);

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const body = await req.json();
    const { vehicle_id, timestamp, speed_kmh, latitude, longitude, rpm, fuel_pct, temperature } = body;

    // Validate required fields
    if (!vehicle_id || !timestamp) {
      return new Response(JSON.stringify({ error: "Missing fields" }), { status: 400 });
    }

    // Insert into vehicle_telemetry table
    const { data, error } = await supabase
      .from("vehicle_telemetry")
      .insert({
        vehicle_id,
        org_id: body.org_id, // Add org from auth context if needed
        timestamp: new Date(timestamp).toISOString(),
        speed_kmh,
        latitude,
        longitude,
        rpm,
        fuel_pct,
        temperature,
        source: "telegraf", // Mark as Telegraf-sourced
      });

    if (error) throw error;

    // Detect anomalies (harsh braking, overspeed, etc)
    if (speed_kmh > 80) {
      // Create video event if speeding
      await supabase.from("video_events").insert({
        vehicle_id,
        org_id: body.org_id,
        timestamp: new Date(timestamp).toISOString(),
        event_type: "speeding",
        severity: speed_kmh > 100 ? "critical" : "warning",
        speed_kmh,
        latitude,
        longitude,
        status: "new",
      });
    }

    return new Response(
      JSON.stringify({ ok: true, message: "Telemetry recorded" }),
      { status: 200 }
    );
  } catch (error) {
    console.error(error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500 }
    );
  }
});
```

### Deploy to Supabase
```bash
supabase functions deploy telemetry-ingest
supabase functions secrets set SUPABASE_URL="https://your-project.supabase.co"
supabase functions secrets set SUPABASE_SERVICE_ROLE_KEY="your-key-here"
```

---

## 7. Vehicle GPS + OBD-II Devices (Budget Options)

### 7.1 GPS Trackers (~$20-50)
| Device | Price | Features | Protocol |
|--------|-------|----------|----------|
| Quectel BG95-M1 | $25 | GPS+LTE, low power | MQTT/HTTP |
| u-blox ZOE-M8B | $35 | Accurate GPS (2m) | UART/I2C |
| SIM7600 | $40 | GPS+4G+BDS, larger data | HTTP POST |
| AirLink ES465 | $60 | Industrial, IP67 | MQTT/Modbus |

### 7.2 OBD-II Bluetooth Adapters (~$15-30)
| Device | Price | App | Features |
|--------|-------|-----|----------|
| Vgate iCar Pro BLE | $20 | iOS/Android | All PID codes, WiFi option |
| ELM327 USB | $15 | PC/Linux | Cheapest, wired only |
| Konnwei KW901 | $25 | iOS/Android | Wifi & Bluetooth |
| Carista | $35 | iOS/Android | Premium UI, video overlay |

### 7.3 Wiring Diagram: ESP32 + GPS + OBD-II

```
Vehicle
  ├─ OBD-II Port → ELM327 → ESP32 (UART) → MQTT Broker
  ├─ 12V Power → USB Converter → ESP32
  └─ Optional: GPS Module (u-blox) → ESP32 (I2C)

Flow:
  ESP32 reads OBD-II every 10s
  → Sends to Mosquitto MQTT broker
  → Telegraf subscribes to topics
  → InfluxDB or Supabase stores metrics
```

### 7.4 ESP32 Firmware Example

```cpp
// Arduino sketch for ESP32 + OBD-II + WiFi + MQTT

#include <WiFi.h>
#include <PubSubClient.h>
#include "ELMduino.h"

#define RX_PIN 16
#define TX_PIN 17
#define BAUD_RATE 38400

const char* ssid = "FleetWorks-WiFi";
const char* password = "your-password";
const char* mqtt_server = "mosquitto.local";
const int mqtt_port = 1883;

ELMduino myELM;
WiFiClient espClient;
PubSubClient client(espClient);

void setup() {
  Serial.begin(115200);
  Serial2.begin(BAUD_RATE, SERIAL_8N1, RX_PIN, TX_PIN);
  
  // Connect to WiFi
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("WiFi connected!");
  
  // Connect to MQTT
  client.setServer(mqtt_server, mqtt_port);
  reconnect();
  
  // Initialize OBD-II
  if (myELM.begin(Serial2)) {
    Serial.println("ELM327 connected!");
  } else {
    Serial.println("ELM327 connection failed!");
  }
}

void loop() {
  if (!client.connected()) {
    reconnect();
  }
  client.loop();
  
  // Read OBD-II data every 10 seconds
  if (myELM.queryPID(0x0D, speed)) { // Speed
    client.publish("vehicle/001/obd", 
      "{\"speed\":" + String(speed) + "}");
  }
  
  if (myELM.queryPID(0x0C, rpm)) { // RPM
    client.publish("vehicle/001/obd", 
      "{\"rpm\":" + String(rpm) + "}");
  }
  
  if (myELM.queryPID(0x2F, fuel)) { // Fuel level
    client.publish("vehicle/001/obd", 
      "{\"fuel\":" + String(fuel) + "}");
  }
  
  delay(10000);
}

void reconnect() {
  while (!client.connected()) {
    if (client.connect("ESP32-Vehicle-001")) {
      Serial.println("MQTT connected");
    } else {
      delay(5000);
    }
  }
}
```

---

## 8. Dashboard Query: Real-Time Telemetry

### Get Last 24 Hours of Vehicle Data

```sql
SELECT 
  id, vehicle_id, timestamp, 
  speed_kmh, latitude, longitude, 
  rpm, fuel_pct, temperature,
  source
FROM vehicle_telemetry
WHERE vehicle_id = 'vehicle-001'
  AND timestamp > now() - INTERVAL '24 hours'
ORDER BY timestamp DESC;
```

### Detect Anomalies

```sql
-- Identify harsh acceleration (speed increase > 20 km/h in 10s)
WITH speed_changes AS (
  SELECT 
    vehicle_id, timestamp, speed_kmh,
    LAG(speed_kmh) OVER (
      PARTITION BY vehicle_id 
      ORDER BY timestamp
    ) as prev_speed,
    EXTRACT(EPOCH FROM (
      timestamp - LAG(timestamp) OVER (
        PARTITION BY vehicle_id 
        ORDER BY timestamp
      )
    )) as time_delta_sec
  FROM vehicle_telemetry
  WHERE timestamp > now() - INTERVAL '24 hours'
)
SELECT 
  vehicle_id, timestamp, 
  speed_kmh, prev_speed,
  (speed_kmh - prev_speed) as acceleration_kmh_s
FROM speed_changes
WHERE (speed_kmh - prev_speed) > 20 
  AND time_delta_sec < 30;
```

---

## 9. Cost Breakdown (100 Vehicles, 30 Days)

| Component | Cost | Notes |
|-----------|------|-------|
| Telegraf | $0 | Open-source |
| InfluxDB Cloud | $0 | Free tier (10M points/month) |
| Mosquitto | $0 | Open-source |
| Supabase (PostgreSQL) | $25 | 2GB storage included |
| GPS/OBD Hardware | $30/vehicle | One-time for 100 vehicles = $3000 |
| **Total Monthly** | **$25** | Just Supabase |
| **Total Hardware** | **$3000** | One-time setup |

**Comparison to Samsara/Geotab:**
- Samsara: $15-25/vehicle/month = $1500-2500/month (100 vehicles)
- GeTab: $20-30/vehicle/month = $2000-3000/month (100 vehicles)
- **FleetWorks (Telegraf):** $25/month total + $3000 hardware (break-even in 1-2 months)

---

## 10. Deployment Checklist

- [ ] Telegraf installed on vehicle gateways or servers
- [ ] InfluxDB Cloud bucket created (or Mosquitto broker running)
- [ ] Telegraf config deployed with API tokens
- [ ] Edge Function deployed (telemetry-ingest)
- [ ] vehicle_telemetry table created in Supabase
- [ ] GPS/OBD devices installed in 10 test vehicles
- [ ] MQTT topics/Telegraf outputs verified with sample data
- [ ] Dashboard queries tested (recent events, anomalies)
- [ ] Alerts configured (harsh braking, speeding, low fuel)
- [ ] Real-time subscription to vehicle_telemetry working
- [ ] Monitoring dashboard showing live vehicle data
- [ ] Data retention policy set (30-90 days)
- [ ] Backups to S3 configured

---

## 11. Integration with Existing Video Events

Combine Telegraf telemetry with dashcam events:

```sql
-- Video event with enriched telemetry
SELECT 
  ve.id, ve.vehicle_id, ve.timestamp, ve.event_type, ve.severity,
  vt.speed_kmh, vt.latitude, vt.longitude, vt.rpm, vt.fuel_pct,
  ve.harsh_score, ve.confidence_pct, ve.s3_url
FROM video_events ve
LEFT JOIN vehicle_telemetry vt ON 
  ve.vehicle_id = vt.vehicle_id 
  AND vt.timestamp >= ve.timestamp - INTERVAL '5 seconds'
  AND vt.timestamp <= ve.timestamp + INTERVAL '5 seconds'
WHERE ve.timestamp > now() - INTERVAL '24 hours'
  AND ve.severity = 'critical'
ORDER BY ve.timestamp DESC;

-- Result: Each video event with contextual telemetry (speed, location, RPM)
-- = Complete incident reconstruction for insurance/training
```

---

## 12. Troubleshooting

### Telegraf Not Sending Data
```bash
# Check config syntax
telegraf --config=/etc/telegraf/telegraf.conf --dry-run

# Enable debug logging
telegraf --config=/etc/telegraf/telegraf.conf --debug

# Test HTTP output
curl -X POST http://localhost:8086/api/v2/write \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d 'measurement,tag1=value speed_kmh=62'
```

### MQTT Connection Issues
```bash
# Check Mosquitto broker
sudo systemctl status mosquitto

# Test publish/subscribe
mosquitto_sub -h localhost -t "vehicle/001/gps" -v
mosquitto_pub -h localhost -t "vehicle/001/gps" -m '{"speed": 62}'

# Check firewall
sudo ufw allow 1883/tcp
```

### Data Not in Supabase
```sql
-- Check Edge Function logs
SELECT * FROM edge_function_logs WHERE function_name = 'telemetry-ingest' ORDER BY created_at DESC LIMIT 20;

-- Verify table exists
SELECT tablename FROM pg_tables WHERE schemaname = 'public';

-- Check RLS policies
SELECT * FROM pg_policies WHERE tablename = 'vehicle_telemetry';
```

---

## 13. Next Steps

1. **Pilot (10 vehicles):** Install Telegraf + GPS/OBD on 10 vehicles, collect 7 days data
2. **Validate:** Ensure data accuracy vs manual verification (speed, fuel, location)
3. **Dashboard:** Build Grafana dashboard for real-time monitoring (optional)
4. **Scale:** Rollout to 100 vehicles once cost/reliability proven
5. **Integration:** Combine with video events for complete incident context

---

**References:**
- Telegraf Docs: https://docs.influxdata.com/telegraf/
- InfluxDB Cloud: https://cloud2.influxdata.com
- MQTT Spec: https://mqtt.org/
- Mosquitto: https://mosquitto.org/
- OBD-II PID Reference: https://en.wikipedia.org/wiki/OBD-II_PIDs
