-- Recreates the vehicle telemetry tables/views on plain Postgres.
-- 20260919020000 is recorded as applied but its tables do not exist (TimescaleDB is not
-- available on this project). Same schema, without Timescale-only features.

-- Vehicle Telemetry Table for Telegraf/IoT Integration
-- Stores real-time GPS, OBD-II, and sensor data from vehicles
-- Complements video_events with contextual telemetry

-- Enable TimescaleDB extension if not already enabled
-- TimescaleDB is not available on this Supabase project; plain Postgres tables are used.

-- Main telemetry table (hypertable for time-series data)
CREATE TABLE IF NOT EXISTS vehicle_telemetry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  vehicle_id UUID NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL, -- Required for TimescaleDB hypertable

  -- GPS data
  latitude NUMERIC(10, 6),
  longitude NUMERIC(10, 6),
  accuracy_m NUMERIC(5, 2), -- GPS accuracy in meters
  altitude_m NUMERIC(6, 2), -- Altitude in meters

  -- Speed and acceleration
  speed_kmh NUMERIC(5, 1),
  acceleration_ms2 NUMERIC(4, 2),

  -- Engine data (OBD-II)
  rpm NUMERIC(5, 0),
  temperature_c NUMERIC(4, 1), -- Engine temperature
  throttle_pct NUMERIC(3, 1),

  -- Fuel data
  fuel_pct NUMERIC(3, 1), -- Fuel level percentage
  fuel_consumption_lh NUMERIC(4, 2), -- Liters per hour
  fuel_used_l NUMERIC(6, 2), -- Total fuel used in trip

  -- Battery/power
  battery_v NUMERIC(4, 2), -- Battery voltage

  -- Emissions (if available)
  co2_ppm NUMERIC(6, 1),
  nox_ppm NUMERIC(6, 1),

  -- Geofence/zone
  zone_id UUID, -- If vehicle is in a geofence zone
  location_name TEXT,

  -- Data source
  source TEXT, -- 'telegraf', 'mqtt', 'samsara', 'custom'
  device_id TEXT, -- GPS/OBD device identifier

  -- Quality metrics
  signal_strength INT, -- -1 to -120 dBm (cellular signal)
  data_quality NUMERIC(3, 1), -- Confidence percentage

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Convert to TimescaleDB hypertable (automatic time-based partitioning)
DO $ts$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') THEN
    PERFORM create_hypertable('vehicle_telemetry', 'timestamp',
  if_not_exists => TRUE,
  migrate_data => TRUE);
  END IF;
END $ts$;

-- Enable compression for data older than 30 days
DO $ts$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') THEN
    EXECUTE $q$ALTER TABLE vehicle_telemetry SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'org_id,vehicle_id',
  timescaledb.compress_orderby = 'timestamp DESC'
)$q$;
  END IF;
END $ts$;

-- Add compression policy
DO $ts$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') THEN
    PERFORM add_compression_policy('vehicle_telemetry', INTERVAL '30 days', if_not_exists => TRUE);
  END IF;
END $ts$;

-- Add retention policy (keep 90 days of raw data, compress after 30 days)
DO $ts$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') THEN
    PERFORM add_retention_policy('vehicle_telemetry', INTERVAL '90 days', if_not_exists => TRUE);
  END IF;
END $ts$;

-- ======= INDEXES FOR QUERY PERFORMANCE =======

-- Recent telemetry for a vehicle
CREATE INDEX IF NOT EXISTS telemetry_vehicle_time
  ON vehicle_telemetry (vehicle_id, timestamp DESC);

-- Organization-level queries
CREATE INDEX IF NOT EXISTS telemetry_org_time
  ON vehicle_telemetry (org_id, timestamp DESC);

-- GPS location queries
CREATE INDEX IF NOT EXISTS telemetry_geo_idx
  ON vehicle_telemetry (latitude, longitude)
  WHERE latitude IS NOT NULL AND longitude IS NOT NULL;

-- Speed/RPM filtering (detect harsh driving)
CREATE INDEX IF NOT EXISTS telemetry_speed_idx
  ON vehicle_telemetry (vehicle_id, speed_kmh DESC)
  WHERE speed_kmh > 80;

-- Fuel level tracking
CREATE INDEX IF NOT EXISTS telemetry_fuel_idx
  ON vehicle_telemetry (vehicle_id, timestamp DESC)
  WHERE fuel_pct IS NOT NULL;

-- Data source filtering
CREATE INDEX IF NOT EXISTS telemetry_source_idx
  ON vehicle_telemetry (source, timestamp DESC);

-- ======= ROW LEVEL SECURITY (RLS) =======

ALTER TABLE vehicle_telemetry ENABLE ROW LEVEL SECURITY;

-- Users can only see telemetry for their organization's vehicles
CREATE POLICY telemetry_org_isolation
  ON vehicle_telemetry
  FOR SELECT
  USING (org_id = auth.uid()::UUID);

-- Only authenticated users can view (service role can insert)
CREATE POLICY telemetry_service_insert
  ON vehicle_telemetry
  FOR INSERT
  WITH CHECK (true);

-- ======= TRIGGERS =======

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_telemetry_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER telemetry_updated_at_trigger
  BEFORE UPDATE ON vehicle_telemetry
  FOR EACH ROW
  EXECUTE FUNCTION update_telemetry_updated_at();

-- ======= CONTINUOUS AGGREGATES (Pre-computed data for dashboards) =======

-- Hourly aggregates for faster dashboard queries
CREATE OR REPLACE VIEW vehicle_telemetry_hourly
AS
SELECT
  date_trunc('hour', timestamp) as hour,
  org_id,
  vehicle_id,
  AVG(speed_kmh) as avg_speed,
  MAX(speed_kmh) as max_speed,
  MIN(latitude) as min_lat,
  MAX(latitude) as max_lat,
  MIN(longitude) as min_lon,
  MAX(longitude) as max_lon,
  AVG(rpm) as avg_rpm,
  AVG(fuel_pct) as avg_fuel,
  AVG(temperature_c) as avg_temp,
  COUNT(*) as record_count
FROM vehicle_telemetry
GROUP BY hour, org_id, vehicle_id;

-- Auto-refresh policy for continuous aggregate
DO $ts$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') THEN
    PERFORM add_continuous_aggregate_policy('vehicle_telemetry_hourly',
  start_offset => INTERVAL '2 hours',
  end_offset => INTERVAL '5 min',
  schedule_interval => INTERVAL '5 min',
  if_not_exists => TRUE);
  END IF;
END $ts$;

-- Daily aggregates for monthly reports
CREATE OR REPLACE VIEW vehicle_telemetry_daily
AS
SELECT
  date_trunc('day', timestamp) as day,
  org_id,
  vehicle_id,
  AVG(speed_kmh) as avg_speed,
  MAX(speed_kmh) as max_speed,
  SUM(fuel_used_l) as total_fuel,
  AVG(rpm) as avg_rpm,
  COUNT(*) as record_count
FROM vehicle_telemetry
GROUP BY day, org_id, vehicle_id;

DO $ts$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') THEN
    PERFORM add_continuous_aggregate_policy('vehicle_telemetry_daily',
  start_offset => INTERVAL '7 days',
  end_offset => INTERVAL '1 day',
  schedule_interval => INTERVAL '1 day',
  if_not_exists => TRUE);
  END IF;
END $ts$;

-- ======= VIEWS FOR COMMON QUERIES =======

-- Latest telemetry for each vehicle (real-time dashboard)
CREATE OR REPLACE VIEW vehicle_telemetry_latest AS
SELECT
  DISTINCT ON (vehicle_id)
  id, vehicle_id, timestamp,
  latitude, longitude, accuracy_m, altitude_m,
  speed_kmh, rpm, temperature_c, fuel_pct,
  battery_v, source, zone_id, location_name
FROM vehicle_telemetry
ORDER BY vehicle_id, timestamp DESC;

-- Vehicles with low fuel (below 20%)
CREATE OR REPLACE VIEW vehicles_low_fuel AS
SELECT
  DISTINCT ON (vehicle_id)
  vehicle_id, fuel_pct, timestamp, location_name
FROM vehicle_telemetry
WHERE fuel_pct < 20
  AND timestamp > now() - INTERVAL '1 hour'
ORDER BY vehicle_id, timestamp DESC;

-- Speeding alerts (over 80 km/h in residential zones, etc)
CREATE OR REPLACE VIEW telemetry_speeding_alerts AS
SELECT
  id, vehicle_id, timestamp, speed_kmh,
  latitude, longitude, zone_id, location_name
FROM vehicle_telemetry
WHERE speed_kmh > 80
  AND timestamp > now() - INTERVAL '24 hours'
ORDER BY timestamp DESC;

-- ======= HELPER FUNCTIONS =======

-- Get average speed for a vehicle over time range
CREATE OR REPLACE FUNCTION get_vehicle_avg_speed(
  p_vehicle_id UUID,
  p_hours INT DEFAULT 24
)
RETURNS TABLE (vehicle_id UUID, avg_speed NUMERIC, max_speed NUMERIC, record_count INT) AS $$
BEGIN
  RETURN QUERY
  SELECT
    vehicle_id,
    AVG(speed_kmh)::NUMERIC,
    MAX(speed_kmh)::NUMERIC,
    COUNT(*)::INT
  FROM vehicle_telemetry
  WHERE vehicle_id = p_vehicle_id
    AND timestamp > now() - INTERVAL '1 hour' * p_hours
  GROUP BY vehicle_id;
END;
$$ LANGUAGE plpgsql;

-- Calculate fuel consumption rate (liters per hour)
CREATE OR REPLACE FUNCTION calculate_fuel_consumption(
  p_vehicle_id UUID,
  p_start_time TIMESTAMPTZ,
  p_end_time TIMESTAMPTZ
)
RETURNS TABLE (
  vehicle_id UUID,
  fuel_consumed NUMERIC,
  hours_elapsed NUMERIC,
  liters_per_hour NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  WITH fuel_range AS (
    SELECT
      fuel_pct,
      timestamp,
      LAG(fuel_pct) OVER (ORDER BY timestamp) as prev_fuel_pct,
      LAG(timestamp) OVER (ORDER BY timestamp) as prev_timestamp
    FROM vehicle_telemetry
    WHERE vehicle_id = p_vehicle_id
      AND timestamp BETWEEN p_start_time AND p_end_time
    ORDER BY timestamp
  )
  SELECT
    p_vehicle_id,
    ABS(SUM(prev_fuel_pct - fuel_pct))::NUMERIC as fuel_consumed,
    EXTRACT(EPOCH FROM (p_end_time - p_start_time)) / 3600::NUMERIC as hours_elapsed,
    (ABS(SUM(prev_fuel_pct - fuel_pct)) / (EXTRACT(EPOCH FROM (p_end_time - p_start_time)) / 3600))::NUMERIC as liters_per_hour
  FROM fuel_range
  WHERE prev_fuel_pct IS NOT NULL;
END;
$$ LANGUAGE plpgsql;

-- ======= GRANTS =======

-- Allow authenticated users to read their org's telemetry
GRANT SELECT ON vehicle_telemetry TO authenticated;
GRANT SELECT ON vehicle_telemetry_latest TO authenticated;
GRANT SELECT ON vehicles_low_fuel TO authenticated;
GRANT SELECT ON telemetry_speeding_alerts TO authenticated;

-- Allow service role (Edge Functions) to insert and update
GRANT INSERT, UPDATE ON vehicle_telemetry TO service_role;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- Allow views access
GRANT SELECT ON vehicle_telemetry_hourly TO authenticated;
GRANT SELECT ON vehicle_telemetry_daily TO authenticated;

-- ======= EXAMPLE QUERIES FOR TESTING =======

-- Insert sample telemetry data
-- INSERT INTO vehicle_telemetry (
--   org_id, vehicle_id, timestamp,
--   latitude, longitude, accuracy_m, altitude_m,
--   speed_kmh, rpm, temperature_c, fuel_pct,
--   battery_v, source, device_id
-- ) VALUES (
--   '550e8400-e29b-41d4-a716-446655440000',
--   '550e8400-e29b-41d4-a716-446655440001',
--   now(),
--   13.0827, 80.2707, 5.2, 45.0,
--   62, 2100, 92.5, 65.0,
--   12.5, 'telegraf', 'device-001'
-- );

-- Get latest telemetry
-- SELECT * FROM vehicle_telemetry_latest WHERE vehicle_id = '550e8400-e29b-41d4-a716-446655440001';

-- Get hourly summary
-- SELECT * FROM vehicle_telemetry_hourly WHERE vehicle_id = '550e8400-e29b-41d4-a716-446655440001';

-- Detect harsh acceleration (speed increase > 20 km/h in 10 seconds)
-- WITH speed_changes AS (
--   SELECT
--     vehicle_id, timestamp, speed_kmh,
--     LAG(speed_kmh) OVER (PARTITION BY vehicle_id ORDER BY timestamp) as prev_speed,
--     EXTRACT(EPOCH FROM (timestamp - LAG(timestamp) OVER (PARTITION BY vehicle_id ORDER BY timestamp))) as time_delta_sec
--   FROM vehicle_telemetry
--   WHERE timestamp > now() - INTERVAL '24 hours'
-- )
-- SELECT vehicle_id, timestamp, speed_kmh, prev_speed, (speed_kmh - prev_speed) as acceleration
-- FROM speed_changes
-- WHERE (speed_kmh - prev_speed) > 20 AND time_delta_sec < 30;
