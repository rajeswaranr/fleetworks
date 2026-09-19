# FleetWorks Simulator & Telegraf Quick Start

Test your video telemetry system without real hardware or Samsara integration.

## 1. Video Event Simulators

### Option A: Python (Easiest)

```bash
# Install requirements
pip install requests

# Set environment
export SUPABASE_URL="https://your-project.supabase.co"
export SUPABASE_ANON_KEY="your-anon-key"
export VEHICLE_ID="550e8400-e29b-41d4-a716-446655440001"
export ORG_ID="550e8400-e29b-41d4-a716-446655440000"

# Run simulator
cd simulators/
python video-event-simulator.py harsh_brake

# Generate 5 collision events, 3 seconds apart
python video-event-simulator.py collision --count 5 --interval 3

# Use custom video URL (S3, YouTube, etc.)
python video-event-simulator.py speeding --video "https://example.com/video.mp4"

# Verbose mode (see responses)
python video-event-simulator.py lane_departure --verbose
```

### Option B: Node.js

```bash
# Install Node.js dependencies (if needed)
npm install

# Set environment
export SUPABASE_URL="https://your-project.supabase.co"
export SUPABASE_ANON_KEY="your-anon-key"
export VEHICLE_ID="550e8400-e29b-41d4-a716-446655440001"

# Run simulator
node simulators/video-event-simulator.js harsh_brake 5 3
# Format: event_type, count, interval_seconds
```

### Supported Event Types

```
✓ harsh_brake      - Sudden braking (critical)
✓ collision        - Impact detected (critical)
✓ lane_departure   - Drifted out of lane (warning)
✓ speeding         - Over speed limit (warning)
✓ harsh_turn       - Sharp turn (info)
✓ harsh_acceleration - Rapid acceleration (info)
```

---

## 2. Telegraf + MQTT Setup

### Quick Start with Docker

```bash
cd telegraf/

# Set environment variables
export SUPABASE_URL="https://your-project.supabase.co"
export SUPABASE_ANON_KEY="your-anon-key"
export MQTT_PASSWORD="your-secure-password"
export GRAFANA_PASSWORD="admin"  # Change this!

# Start everything
docker-compose up -d

# Verify services
docker-compose ps
docker logs fleetworks-telegraf
docker logs fleetworks-mosquitto

# Stop everything
docker-compose down
```

### What runs:
- **Mosquitto** (MQTT Broker) - Port 1883
- **Telegraf** - Collects vehicle data, sends to Supabase
- **Grafana** (Optional) - Dashboard - Port 3000

### Test MQTT

```bash
# Connect to Mosquitto (inside Docker)
docker exec -it fleetworks-mosquitto sh

# Subscribe to GPS data
mosquitto_sub -h localhost -t "vehicle/+/gps"

# Publish test data (from another terminal)
mosquitto_pub -h localhost -t "vehicle/001/gps" \
  -m '{"lat":13.0827,"lon":80.2707,"speed":62,"accuracy":5.2}'

# Publish OBD data
mosquitto_pub -h localhost -t "vehicle/001/obd" \
  -m '{"rpm":2100,"fuel":65,"temp":92}'
```

---

## 3. Simulating Vehicle Data via MQTT

### Send GPS Data

```bash
# Real-time GPS stream (every 5 seconds)
while true; do
  mosquitto_pub -h localhost -t "vehicle/001/gps" \
    -m "{\"lat\":$((RANDOM % 90)).$(RANDOM % 100),
         \"lon\":$((RANDOM % 180)).$(RANDOM % 100),
         \"speed\":$((RANDOM % 120)),
         \"accuracy\":$((RANDOM % 20))}"
  sleep 5
done
```

### Send OBD Data

```bash
# Engine metrics (every 10 seconds)
while true; do
  mosquitto_pub -h localhost -t "vehicle/001/obd" \
    -m "{\"rpm\":$((1000 + RANDOM % 3000)),
         \"fuel\":$((20 + RANDOM % 80)),
         \"temp\":$((80 + RANDOM % 30))}"
  sleep 10
done
```

### Send Event Data

```bash
# Harsh braking event
mosquitto_pub -h localhost -t "vehicle/001/events" \
  -m '{"event":"harsh_brake","severity":"critical","speed":62}'
```

---

## 4. Verify Data in Dashboard

### Check FleetSafe Dashboard

1. Go to FleetWorks dashboard
2. Click **FleetSafe** → **Video Events**
3. Should show:
   - Simulated video events (harsh brake, collision, etc.)
   - Telemetry overlay (speed, GPS, fuel, RPM)
   - Real-time events from Telegraf/MQTT

### Query Database

```sql
-- Check video events (last 1 hour)
SELECT id, event_type, severity, speed_kmh, 
       timestamp, camera_position, status
FROM video_events
WHERE timestamp > now() - INTERVAL '1 hour'
ORDER BY timestamp DESC;

-- Check vehicle telemetry (last hour)
SELECT vehicle_id, timestamp, speed_kmh, 
       latitude, longitude, rpm, fuel_pct
FROM vehicle_telemetry
WHERE timestamp > now() - INTERVAL '1 hour'
ORDER BY timestamp DESC;

-- Check alerts sent
SELECT vehicle_id, severity, message, sent_at
FROM video_alerts_sent
WHERE sent_at > now() - INTERVAL '1 hour'
ORDER BY sent_at DESC;
```

---

## 5. Gradual Load Testing

### Simulate Fleet of 10 Vehicles

```bash
# Generate 10 harsh braking events (one per vehicle)
for i in {1..10}; do
  export VEHICLE_ID="550e8400-e29b-41d4-a716-44665544000$i"
  python simulators/video-event-simulator.py harsh_brake &
done
wait

# Generate continuous events for 1 hour
python simulators/video-event-simulator.py \
  speeding --count 60 --interval 60  # One event per minute
```

### Simulate 100 Vehicles with Telegraf

```bash
# Each vehicle publishes to MQTT every 10 seconds
for vehicle_id in {1..100}; do
  (while true; do
    mosquitto_pub -h localhost -t "vehicle/$vehicle_id/gps" \
      -m "{\"lat\":13.08,\"lon\":80.27,\"speed\":$((RANDOM % 120))}"
    sleep 10
  done) &
done
```

---

## 6. Samsara Integration (Alternative)

If you have Samsara API access:

```bash
# Set Samsara API token
export SAMSARA_API_TOKEN="token_xxxxxxxxxxxx"

# Enable Samsara polling in telegraf.conf
# Uncomment the [[inputs.http]] section for Samsara API

# Restart Telegraf
docker-compose restart telegraf
```

---

## 7. Troubleshooting

### Telegraf not sending to Supabase

```bash
# Check logs
docker logs fleetworks-telegraf

# Test connection to Supabase
curl -X POST \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
  "$SUPABASE_URL/functions/v1/telemetry-ingest" \
  -d '{"vehicle_id":"test","speed_kmh":62}'
```

### MQTT not working

```bash
# Check Mosquitto is running
docker ps | grep mosquitto

# Check logs
docker logs fleetworks-mosquitto

# Test publish
mosquitto_pub -h localhost -t "test" -m "hello"
mosquitto_sub -h localhost -t "test"
```

### Video events not appearing in dashboard

```bash
# Check Edge Function logs
SELECT * FROM edge_function_logs 
WHERE function_name = 'dashcam-webhook' 
ORDER BY created_at DESC LIMIT 10;

# Verify RLS policies
SELECT * FROM pg_policies 
WHERE tablename = 'video_events';

# Check vehicle exists
SELECT * FROM vehicles 
WHERE id = '550e8400-e29b-41d4-a716-446655440001';
```

---

## 8. Next Steps

1. ✅ Run Python simulator to generate test events
2. ✅ Watch events appear in FleetSafe dashboard
3. ✅ Start Telegraf + MQTT for continuous data
4. ✅ Deploy GPS/OBD devices to real vehicles
5. ✅ Configure Samsara webhook (if using Samsara)
6. ✅ Set up alerts (email, SMS, push notifications)

---

## Reference

- **Simulator Scripts**: `simulators/video-event-simulator.{js,py}`
- **Telegraf Config**: `telegraf/telegraf.conf`
- **Docker Compose**: `telegraf/docker-compose.yml`
- **Telegraf Docs**: https://docs.influxdata.com/telegraf/
- **MQTT Topics**: `vehicle/{id}/gps|obd|events`
- **Dashboard**: FleetWorks → FleetSafe → Video Events
