-- Fuel Pilferage Detection Schema
-- Tracks fuel consumption anomalies and flags suspicious trips

CREATE TABLE IF NOT EXISTS fuel_trips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id),
  driver_id UUID REFERENCES drivers(id),

  -- Trip tracking
  trip_date DATE NOT NULL,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ,

  -- Distance and location
  distance_km DECIMAL(10, 2) NOT NULL,
  start_location TEXT,
  end_location TEXT,

  -- Fuel data
  fuel_filled_liters DECIMAL(10, 2),
  fuel_filled_amount DECIMAL(12, 2),
  fuel_filled_at TIMESTAMPTZ,
  fuel_card_used BOOLEAN DEFAULT false,
  fuel_card_provider TEXT, -- HPCL, BPCL, IOCL, JIOBP

  -- Consumption tracking
  expected_consumption_liters DECIMAL(10, 2), -- Based on vehicle avg efficiency
  actual_consumption_liters DECIMAL(10, 2),
  consumption_variance_pct DECIMAL(5, 2), -- +/- percentage

  -- Pilferage detection
  is_anomalous BOOLEAN DEFAULT false,
  anomaly_type TEXT, -- 'high_consumption', 'low_consumption', 'fuel_jump', 'no_refill'
  anomaly_severity TEXT DEFAULT 'warning', -- 'info', 'warning', 'critical'

  -- Additional context
  idle_time_minutes INTEGER,
  harsh_events_count INTEGER,
  avg_speed_kmh DECIMAL(5, 2),
  notes TEXT,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fuel_consumption_baseline (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id),

  -- Vehicle specs
  vehicle_type TEXT, -- 'truck', 'auto', 'bus', 'loader'
  make_model TEXT,
  manufacturing_year INTEGER,

  -- Fuel efficiency baseline (L/100km)
  avg_consumption_l_per_100km DECIMAL(5, 2),
  min_consumption_l_per_100km DECIMAL(5, 2),
  max_consumption_l_per_100km DECIMAL(5, 2),
  std_deviation DECIMAL(5, 2),

  -- Data points
  trips_measured INTEGER DEFAULT 0,
  last_calibrated_date DATE,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE(org_id, vehicle_id)
);

CREATE TABLE IF NOT EXISTS fuel_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  fuel_trip_id UUID NOT NULL REFERENCES fuel_trips(id),

  alert_type TEXT NOT NULL, -- 'high_consumption', 'fuel_jump', 'no_refill', 'abnormal_pattern'
  severity TEXT NOT NULL, -- 'info', 'warning', 'critical'
  confidence_score DECIMAL(3, 1), -- 0-100%
  estimated_loss_liters DECIMAL(10, 2),
  estimated_loss_amount DECIMAL(12, 2),

  description TEXT,
  recommended_action TEXT,

  is_reviewed BOOLEAN DEFAULT false,
  reviewed_by UUID REFERENCES auth.users(id),
  reviewed_at TIMESTAMPTZ,
  review_notes TEXT,

  is_false_positive BOOLEAN DEFAULT false,

  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes for performance
CREATE INDEX idx_fuel_trips_org_vehicle ON fuel_trips(org_id, vehicle_id);
CREATE INDEX idx_fuel_trips_date ON fuel_trips(trip_date DESC);
CREATE INDEX idx_fuel_trips_anomalous ON fuel_trips(is_anomalous) WHERE is_anomalous = true;
CREATE INDEX idx_fuel_alerts_severity ON fuel_alerts(severity) WHERE is_reviewed = false;

-- Hypertable for time-series fuel data
DO $ts$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') THEN
    PERFORM create_hypertable('fuel_trips', 'trip_date', if_not_exists => TRUE);
  END IF;
END $ts$;

-- Compression for old data (>30 days)
DO $ts$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') THEN
    EXECUTE $q$ALTER TABLE fuel_trips SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'org_id, vehicle_id',
  timescaledb.compress_orderby = 'trip_date DESC'
)$q$;
  END IF;
END $ts$;

DO $ts$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') THEN
    PERFORM add_compression_policy('fuel_trips', INTERVAL '30 days', if_not_exists => TRUE);
  END IF;
END $ts$;

-- Row-Level Security
ALTER TABLE fuel_trips ENABLE ROW LEVEL SECURITY;
ALTER TABLE fuel_consumption_baseline ENABLE ROW LEVEL SECURITY;
ALTER TABLE fuel_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY fuel_trips_org_isolation ON fuel_trips
  FOR ALL
  USING (is_org_admin(org_id));

CREATE POLICY fuel_baseline_org_isolation ON fuel_consumption_baseline
  FOR ALL
  USING (is_org_admin(org_id));

CREATE POLICY fuel_alerts_org_isolation ON fuel_alerts
  FOR ALL
  USING (is_org_admin(org_id));

-- Helper function: Calculate fuel consumption anomaly
CREATE OR REPLACE FUNCTION detect_fuel_anomaly(
  p_vehicle_id UUID,
  p_org_id UUID,
  p_distance_km DECIMAL,
  p_actual_consumption DECIMAL,
  p_consumption_variance DECIMAL
)
RETURNS TABLE (
  is_anomalous BOOLEAN,
  anomaly_type TEXT,
  severity TEXT,
  confidence_score DECIMAL
) AS $$
DECLARE
  v_baseline RECORD;
  v_threshold_high DECIMAL;
  v_threshold_low DECIMAL;
  v_variance_abs DECIMAL;
BEGIN
  -- Get vehicle baseline
  SELECT * INTO v_baseline FROM fuel_consumption_baseline
  WHERE vehicle_id = p_vehicle_id AND org_id = p_org_id;

  IF v_baseline IS NULL THEN
    RETURN QUERY SELECT false, 'no_baseline'::text, 'info'::text, 50.0::DECIMAL;
    RETURN;
  END IF;

  v_threshold_high := v_baseline.avg_consumption_l_per_100km * 1.25; -- 25% above average
  v_threshold_low := v_baseline.avg_consumption_l_per_100km * 0.75;   -- 25% below average
  v_variance_abs := ABS(p_consumption_variance);

  -- Detect anomalies
  IF p_actual_consumption > v_threshold_high THEN
    RETURN QUERY SELECT
      true,
      'high_consumption'::text,
      CASE
        WHEN p_consumption_variance > 50 THEN 'critical'::text
        WHEN p_consumption_variance > 30 THEN 'warning'::text
        ELSE 'info'::text
      END,
      LEAST(100, 50 + (p_consumption_variance - 25) * 2)::DECIMAL; -- Confidence 0-100
      RETURN;
  END IF;

  IF p_actual_consumption < v_threshold_low THEN
    RETURN QUERY SELECT
      true,
      'low_consumption'::text,
      'info'::text,
      60.0::DECIMAL;
      RETURN;
  END IF;

  -- No anomaly detected
  RETURN QUERY SELECT false, 'normal'::text, 'info'::text, 0.0::DECIMAL;
END;
$$ LANGUAGE plpgsql;
