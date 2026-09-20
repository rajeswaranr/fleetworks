-- RFID Tire Tracking System with Real-time Pressure Monitoring
-- Includes AI-enabled analytics and predictive maintenance

CREATE TABLE IF NOT EXISTS tire_registry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),

  -- RFID Tag Information
  rfid_tag_id TEXT NOT NULL UNIQUE, -- 16-char RFID tag (e.g., E00070100123ABCD)
  rfid_chip_type TEXT, -- 'Gen2', 'Gen2+', 'Impinj Monza'

  -- Tire Specifications
  tire_size TEXT NOT NULL, -- e.g., "295/80R22.5"
  brand TEXT,
  model TEXT,
  batch_number TEXT,
  manufacture_date DATE,

  -- Physical Properties
  max_pressure_psi INTEGER, -- Max PSI for this tire
  recommended_pressure_psi INTEGER, -- Optimal PSI
  tire_weight_kg DECIMAL(10, 2),
  tread_depth_mm_new DECIMAL(5, 2), -- New tire tread depth

  -- Registration
  registration_date TIMESTAMPTZ DEFAULT now(),
  installed_date TIMESTAMPTZ,
  installation_vehicle_id UUID REFERENCES vehicles(id),
  installation_position TEXT, -- 'FL', 'FR', 'RL', 'RR', 'STEER', 'DRIVE', 'TRAILER'

  -- Lifecycle
  status TEXT DEFAULT 'registered', -- registered, installed, active, retired, damaged
  current_vehicle_id UUID REFERENCES vehicles(id),
  current_position TEXT,

  -- Analytics
  total_distance_km DECIMAL(12, 2) DEFAULT 0,
  current_tread_depth_mm DECIMAL(5, 2),
  tread_wear_pct DECIMAL(5, 2), -- 0-100% wear

  -- Maintenance
  last_rotation_date TIMESTAMPTZ,
  last_repair_date TIMESTAMPTZ,
  repair_count INTEGER DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tire_pressure_readings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  tire_id UUID NOT NULL REFERENCES tire_registry(id),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id),

  -- Reading Details
  reading_timestamp TIMESTAMPTZ NOT NULL,
  pressure_psi DECIMAL(5, 2) NOT NULL,
  pressure_bar DECIMAL(5, 2),
  temperature_celsius DECIMAL(5, 2),

  -- Status
  is_normal BOOLEAN DEFAULT true,
  deviation_from_recommended_pct DECIMAL(5, 2),
  alert_type TEXT, -- 'under_pressure', 'over_pressure', 'high_temp', 'low_temp', 'normal'
  alert_severity TEXT, -- 'info', 'warning', 'critical'

  -- GPS Context
  latitude DECIMAL(10, 8),
  longitude DECIMAL(11, 8),
  speed_kmh DECIMAL(5, 2),

  -- Device Info
  sensor_type TEXT, -- 'TPMS', 'OBD-II', 'Bluetooth', 'Cellular'
  signal_strength_dbm INTEGER,
  battery_level_pct INTEGER,

  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tire_anomalies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  tire_id UUID NOT NULL REFERENCES tire_registry(id),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id),

  -- Anomaly Details
  anomaly_type TEXT NOT NULL, -- 'pressure_drop', 'over_pressure', 'rapid_wear', 'temperature_spike', 'puncture_detected'
  detected_at TIMESTAMPTZ NOT NULL,
  pressure_reading_id UUID REFERENCES tire_pressure_readings(id),

  -- Severity & AI Score
  severity TEXT NOT NULL, -- 'info', 'warning', 'critical'
  ai_confidence_score DECIMAL(3, 1), -- 0-100%
  predicted_failure_risk_pct DECIMAL(3, 1), -- AI prediction: % chance of failure in next 7 days

  -- Context
  description TEXT,
  recommended_action TEXT,

  -- Resolution
  is_resolved BOOLEAN DEFAULT false,
  resolved_at TIMESTAMPTZ,
  resolution_notes TEXT,

  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tire_analytics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  tire_id UUID NOT NULL REFERENCES tire_registry(id),

  -- Daily aggregates
  aggregation_date DATE NOT NULL,

  -- Pressure Statistics
  avg_pressure_psi DECIMAL(5, 2),
  min_pressure_psi DECIMAL(5, 2),
  max_pressure_psi DECIMAL(5, 2),
  pressure_variance DECIMAL(5, 2),
  pressure_readings_count INTEGER,

  -- Temperature Statistics
  avg_temperature_celsius DECIMAL(5, 2),
  max_temperature_celsius DECIMAL(5, 2),
  high_temp_events INTEGER, -- Count of temp > 80°C

  -- Usage
  distance_km DECIMAL(10, 2),
  active_hours INTEGER,

  -- Wear
  estimated_tread_loss_mm DECIMAL(5, 3), -- Daily wear
  wear_rate_mm_per_1000km DECIMAL(5, 2),

  -- Alerts
  alert_count INTEGER,
  critical_alerts INTEGER,

  -- AI Predictions
  remaining_life_days INTEGER,
  estimated_replacement_date DATE,

  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tire_maintenance_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  tire_id UUID NOT NULL REFERENCES tire_registry(id),
  vehicle_id UUID REFERENCES vehicles(id),

  -- Maintenance Event
  event_type TEXT NOT NULL, -- 'rotation', 'repair', 'balance', 'alignment', 'replacement', 'inspection'
  event_date TIMESTAMPTZ NOT NULL,
  description TEXT,

  -- Repair Details (if repair)
  repair_type TEXT, -- 'puncture', 'sidewall', 'tread_separation', 'bead_break'
  repair_location TEXT,
  repair_cost DECIMAL(10, 2),

  -- Maintenance Details
  performed_by TEXT, -- Mechanic name or service center
  service_center_id UUID,
  parts_replaced TEXT,

  -- Next Service
  next_service_date DATE,
  next_service_type TEXT,

  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tire_ai_predictions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  tire_id UUID NOT NULL REFERENCES tire_registry(id),
  vehicle_id UUID REFERENCES vehicles(id),

  -- Prediction Metadata
  prediction_date TIMESTAMPTZ NOT NULL,
  prediction_window_days INTEGER, -- 7, 30, 90 days

  -- AI Model
  model_version TEXT, -- e.g., 'tire-v2.1'
  training_data_points INTEGER,

  -- Predictions
  failure_risk_pct DECIMAL(3, 1), -- 0-100% chance of failure
  recommended_replacement_date DATE,
  estimated_remaining_life_days INTEGER,
  estimated_remaining_distance_km DECIMAL(10, 2),

  -- Contributing Factors
  primary_risk_factor TEXT, -- 'rapid_wear', 'pressure_instability', 'temperature', 'age'
  risk_score DECIMAL(5, 2), -- 0-100

  -- Confidence
  model_confidence_pct DECIMAL(3, 1),

  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tire_fleet_analytics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),

  -- Summary Period
  summary_date DATE NOT NULL,

  -- Fleet Overview
  total_tires INTEGER,
  tires_monitored INTEGER,
  tires_active INTEGER,
  tires_retired INTEGER,

  -- Pressure Health
  tires_optimal_pressure INTEGER,
  tires_low_pressure INTEGER,
  tires_high_pressure INTEGER,

  -- Wear Status
  avg_tread_depth_mm DECIMAL(5, 2),
  avg_tread_wear_pct DECIMAL(5, 2),
  tires_below_2mm_depth INTEGER, -- Critical wear

  -- Alerts
  total_alerts INTEGER,
  critical_alerts INTEGER,

  -- Predictions
  tires_at_risk DECIMAL(3, 1), -- % of fleet at risk
  predicted_replacements_next_30days INTEGER,

  -- Cost Metrics
  total_maintenance_cost DECIMAL(12, 2),
  avg_tire_cost DECIMAL(10, 2),
  cost_per_km DECIMAL(8, 4),

  -- Efficiency
  avg_pressure_compliance_pct DECIMAL(5, 2), -- % time in optimal range

  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(org_id, summary_date)
);

-- Indexes
CREATE INDEX idx_tire_registry_org ON tire_registry(org_id);
CREATE INDEX idx_tire_registry_rfid ON tire_registry(rfid_tag_id);
CREATE INDEX idx_tire_registry_vehicle ON tire_registry(current_vehicle_id);
CREATE INDEX idx_tire_pressure_org_tire ON tire_pressure_readings(org_id, tire_id, reading_timestamp DESC);
CREATE INDEX idx_tire_pressure_timestamp ON tire_pressure_readings(reading_timestamp DESC);
CREATE INDEX idx_tire_pressure_alert ON tire_pressure_readings(alert_type) WHERE alert_type IS NOT NULL;
CREATE INDEX idx_tire_anomalies_org_date ON tire_anomalies(org_id, detected_at DESC);
CREATE INDEX idx_tire_anomalies_severity ON tire_anomalies(severity) WHERE is_resolved = false;
CREATE INDEX idx_tire_analytics_org_date ON tire_analytics(org_id, aggregation_date DESC);
CREATE INDEX idx_tire_ai_predictions_org ON tire_ai_predictions(org_id, tire_id);

-- Hypertable for time-series pressure readings (TimescaleDB)
DO $ts$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') THEN
    PERFORM create_hypertable('tire_pressure_readings', 'reading_timestamp', if_not_exists => TRUE);
  END IF;
END $ts$;
DO $ts$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') THEN
    EXECUTE $q$ALTER TABLE tire_pressure_readings SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'org_id, tire_id',
  timescaledb.compress_orderby = 'reading_timestamp DESC'
)$q$;
  END IF;
END $ts$;
DO $ts$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') THEN
    PERFORM add_compression_policy('tire_pressure_readings', INTERVAL '30 days', if_not_exists => TRUE);
  END IF;
END $ts$;

-- Row-Level Security
ALTER TABLE tire_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE tire_pressure_readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE tire_anomalies ENABLE ROW LEVEL SECURITY;
ALTER TABLE tire_analytics ENABLE ROW LEVEL SECURITY;
ALTER TABLE tire_maintenance_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE tire_ai_predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE tire_fleet_analytics ENABLE ROW LEVEL SECURITY;

CREATE POLICY tire_registry_org_isolation ON tire_registry
  FOR ALL USING (is_org_admin(org_id));

CREATE POLICY tire_pressure_org_isolation ON tire_pressure_readings
  FOR ALL USING (is_org_admin(org_id));

CREATE POLICY tire_anomalies_org_isolation ON tire_anomalies
  FOR ALL USING (is_org_admin(org_id));

CREATE POLICY tire_analytics_org_isolation ON tire_analytics
  FOR ALL USING (is_org_admin(org_id));

CREATE POLICY tire_maintenance_org_isolation ON tire_maintenance_logs
  FOR ALL USING (is_org_admin(org_id));

CREATE POLICY tire_ai_org_isolation ON tire_ai_predictions
  FOR ALL USING (is_org_admin(org_id));

CREATE POLICY tire_fleet_org_isolation ON tire_fleet_analytics
  FOR ALL USING (is_org_admin(org_id));

-- AI Helper Functions

-- 1. Detect Pressure Anomaly
CREATE OR REPLACE FUNCTION detect_tire_pressure_anomaly(
  p_current_pressure DECIMAL,
  p_recommended_pressure DECIMAL,
  p_historical_avg DECIMAL,
  p_max_pressure DECIMAL
)
RETURNS TABLE (
  alert_type TEXT,
  severity TEXT,
  deviation_pct DECIMAL
) AS $$
DECLARE
  v_deviation_pct DECIMAL;
  v_alert_type TEXT;
  v_severity TEXT;
BEGIN
  v_deviation_pct := ABS((p_current_pressure - p_recommended_pressure) / p_recommended_pressure * 100);

  -- Pressure checks
  IF p_current_pressure < (p_recommended_pressure * 0.85) THEN
    v_alert_type := 'under_pressure';
    IF v_deviation_pct > 20 THEN
      v_severity := 'critical';
    ELSE
      v_severity := 'warning';
    END IF;
  ELSIF p_current_pressure > (p_max_pressure * 0.95) THEN
    v_alert_type := 'over_pressure';
    v_severity := 'warning';
  ELSIF ABS(p_current_pressure - p_historical_avg) > (p_historical_avg * 0.15) THEN
    v_alert_type := 'pressure_variance';
    v_severity := 'info';
  ELSE
    v_alert_type := 'normal';
    v_severity := 'info';
  END IF;

  RETURN QUERY SELECT v_alert_type::text, v_severity::text, v_deviation_pct;
END;
$$ LANGUAGE plpgsql;

-- 2. Calculate Tire Wear Rate
CREATE OR REPLACE FUNCTION calculate_wear_rate(
  p_tire_id UUID,
  p_days INTEGER DEFAULT 30
)
RETURNS TABLE (
  wear_rate_mm_per_day DECIMAL,
  wear_rate_mm_per_1000km DECIMAL,
  estimated_life_days INTEGER
) AS $$
DECLARE
  v_initial_tread DECIMAL;
  v_current_tread DECIMAL;
  v_distance_km DECIMAL;
  v_wear_mm DECIMAL;
  v_wear_per_day DECIMAL;
  v_wear_per_1000km DECIMAL;
  v_life_days INTEGER;
BEGIN
  -- Get tire tread depth progression
  SELECT tread_depth_mm_new INTO v_initial_tread
  FROM tire_registry WHERE id = p_tire_id;

  SELECT current_tread_depth_mm INTO v_current_tread
  FROM tire_registry WHERE id = p_tire_id;

  SELECT total_distance_km INTO v_distance_km
  FROM tire_registry WHERE id = p_tire_id;

  v_wear_mm := v_initial_tread - v_current_tread;
  v_wear_per_day := v_wear_mm / p_days;
  v_wear_per_1000km := CASE WHEN v_distance_km > 0 THEN (v_wear_mm / v_distance_km) * 1000 ELSE 0 END;

  -- Minimum legal tread depth: 1.6mm (India)
  v_life_days := CASE WHEN v_wear_per_day > 0 THEN (v_current_tread - 1.6) / v_wear_per_day::INTEGER ELSE 999 END;

  RETURN QUERY SELECT v_wear_per_day, v_wear_per_1000km, v_life_days;
END;
$$ LANGUAGE plpgsql;

-- 3. Calculate Failure Risk Score (AI)
CREATE OR REPLACE FUNCTION calculate_tire_risk_score(
  p_pressure_deviation_pct DECIMAL,
  p_temperature_celsius DECIMAL,
  p_tread_wear_pct DECIMAL,
  p_age_days INTEGER,
  p_mileage_km DECIMAL
)
RETURNS DECIMAL AS $$
DECLARE
  v_risk_score DECIMAL := 0;
BEGIN
  -- Pressure factor (30% weight)
  v_risk_score := v_risk_score + (LEAST(ABS(p_pressure_deviation_pct) / 50, 1.0) * 30);

  -- Temperature factor (25% weight) - high temp accelerates aging
  IF p_temperature_celsius > 75 THEN
    v_risk_score := v_risk_score + (((p_temperature_celsius - 75) / 25) * 25);
  END IF;

  -- Wear factor (30% weight)
  v_risk_score := v_risk_score + (LEAST(p_tread_wear_pct / 100, 1.0) * 30);

  -- Age factor (15% weight) - tires degrade over time
  IF p_age_days > 1825 THEN -- 5 years
    v_risk_score := v_risk_score + 15;
  ELSIF p_age_days > 1095 THEN -- 3 years
    v_risk_score := v_risk_score + (((p_age_days - 1095) / 730) * 15);
  END IF;

  RETURN LEAST(v_risk_score, 100.0);
END;
$$ LANGUAGE plpgsql;
