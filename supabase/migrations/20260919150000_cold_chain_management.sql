-- Cold Chain Management System
-- Real-time temperature monitoring for refrigerated vehicles
-- Includes violation detection, compliance tracking, and analytics

CREATE TABLE IF NOT EXISTS cold_chain_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),

  -- Product Types & Thresholds
  product_type TEXT NOT NULL, -- 'milk', 'ice_cream', 'meat', 'fish', 'pharma', 'general'
  min_temperature_celsius DECIMAL(5, 2) NOT NULL,
  max_temperature_celsius DECIMAL(5, 2) NOT NULL,
  ideal_temperature_celsius DECIMAL(5, 2),

  -- Alert Settings
  warning_deviation_celsius DECIMAL(3, 1), -- Alert if deviation exceeds this
  critical_deviation_celsius DECIMAL(3, 1), -- Critical if deviation exceeds this
  alert_sms_enabled BOOLEAN DEFAULT true,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cold_chain_vehicles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id),

  -- Temperature Sensors
  sensor_id TEXT UNIQUE, -- IoT device ID
  sensor_type TEXT, -- 'thermo_king', 'carrier', 'lamborghini', 'bluetooth_sensor'
  compartments INTEGER DEFAULT 1, -- Number of temperature zones

  -- Configuration
  product_type TEXT REFERENCES cold_chain_config(product_type),
  min_temp DECIMAL(5, 2),
  max_temp DECIMAL(5, 2),

  -- Status
  is_active BOOLEAN DEFAULT true,
  last_reading_at TIMESTAMPTZ,
  current_temperature_celsius DECIMAL(5, 2),

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS temperature_readings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  vehicle_id UUID NOT NULL REFERENCES cold_chain_vehicles(id),

  -- Reading Data
  reading_timestamp TIMESTAMPTZ NOT NULL,
  temperature_celsius DECIMAL(5, 2) NOT NULL,
  humidity_pct DECIMAL(5, 2),
  compartment_id INTEGER DEFAULT 1,

  -- Status
  is_normal BOOLEAN DEFAULT true,
  temperature_status TEXT, -- 'optimal', 'warning', 'critical'
  deviation_from_min DECIMAL(5, 2),
  deviation_from_max DECIMAL(5, 2),

  -- Context
  latitude DECIMAL(10, 8),
  longitude DECIMAL(11, 8),
  trip_id UUID,

  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS temperature_violations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  vehicle_id UUID NOT NULL REFERENCES cold_chain_vehicles(id),

  -- Violation Details
  violation_type TEXT NOT NULL, -- 'too_cold', 'too_hot', 'high_humidity', 'door_open'
  detected_at TIMESTAMPTZ NOT NULL,
  temperature_celsius DECIMAL(5, 2),
  duration_minutes INTEGER,

  -- Severity
  severity TEXT NOT NULL, -- 'warning', 'critical', 'severe'
  impact_on_cargo TEXT, -- 'None', 'Marginal', 'Loss', 'Total Loss'

  -- Resolution
  is_resolved BOOLEAN DEFAULT false,
  resolved_at TIMESTAMPTZ,
  resolution_notes TEXT,

  -- Cost Impact
  estimated_loss_pct DECIMAL(5, 2),
  estimated_loss_amount DECIMAL(12, 2),

  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cold_chain_compliance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  vehicle_id UUID NOT NULL REFERENCES cold_chain_vehicles(id),

  -- Compliance Period
  compliance_date DATE NOT NULL,
  trip_date DATE,

  -- Metrics
  total_readings INTEGER,
  readings_in_range INTEGER,
  compliance_pct DECIMAL(5, 2), -- % time temp was within range
  violation_count INTEGER,
  critical_violations INTEGER,

  -- Certificate
  fssai_compliant BOOLEAN,
  cold_chain_intact BOOLEAN,
  temperature_log_available BOOLEAN,

  -- Status
  status TEXT, -- 'compliant', 'warning', 'non_compliant'
  notes TEXT,

  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cold_chain_analytics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  vehicle_id UUID NOT NULL REFERENCES cold_chain_vehicles(id),

  -- Summary Date
  summary_date DATE NOT NULL,

  -- Temperature Stats
  avg_temperature_celsius DECIMAL(5, 2),
  min_temperature_celsius DECIMAL(5, 2),
  max_temperature_celsius DECIMAL(5, 2),
  temperature_variance DECIMAL(5, 2),

  -- Compliance
  readings_compliant_pct DECIMAL(5, 2),
  violations_count INTEGER,
  violation_minutes INTEGER,

  -- Impact
  cargo_loss_value DECIMAL(12, 2),
  compliance_score DECIMAL(3, 1), -- 0-10

  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(org_id, vehicle_id, summary_date)
);

-- Indexes
CREATE INDEX idx_cold_chain_org ON cold_chain_vehicles(org_id);
CREATE INDEX idx_temp_readings_vehicle ON temperature_readings(vehicle_id, reading_timestamp DESC);
CREATE INDEX idx_temp_readings_status ON temperature_readings(temperature_status) WHERE temperature_status != 'optimal';
CREATE INDEX idx_violations_vehicle ON temperature_violations(vehicle_id, detected_at DESC);
CREATE INDEX idx_violations_severity ON temperature_violations(severity) WHERE is_resolved = false;
CREATE INDEX idx_compliance_vehicle ON cold_chain_compliance(vehicle_id, compliance_date DESC);
CREATE INDEX idx_analytics_vehicle ON cold_chain_analytics(vehicle_id, summary_date DESC);

-- Hypertable for time-series temperature readings (TimescaleDB)
SELECT create_hypertable('temperature_readings', 'reading_timestamp', if_not_exists => TRUE);
ALTER TABLE temperature_readings SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'org_id, vehicle_id',
  timescaledb.compress_orderby = 'reading_timestamp DESC'
);
SELECT add_compression_policy('temperature_readings', INTERVAL '30 days', if_not_exists => TRUE);

-- Row-Level Security
ALTER TABLE cold_chain_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE cold_chain_vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE temperature_readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE temperature_violations ENABLE ROW LEVEL SECURITY;
ALTER TABLE cold_chain_compliance ENABLE ROW LEVEL SECURITY;
ALTER TABLE cold_chain_analytics ENABLE ROW LEVEL SECURITY;

CREATE POLICY cold_chain_org_isolation ON cold_chain_vehicles
  FOR ALL USING (org_id = current_user_org_id());

CREATE POLICY temp_readings_org_isolation ON temperature_readings
  FOR ALL USING (org_id = current_user_org_id());

CREATE POLICY violations_org_isolation ON temperature_violations
  FOR ALL USING (org_id = current_user_org_id());

CREATE POLICY compliance_org_isolation ON cold_chain_compliance
  FOR ALL USING (org_id = current_user_org_id());

CREATE POLICY analytics_org_isolation ON cold_chain_analytics
  FOR ALL USING (org_id = current_user_org_id());

-- AI Helper Functions

-- 1. Detect Temperature Violation
CREATE OR REPLACE FUNCTION detect_temperature_violation(
  p_current_temp DECIMAL,
  p_min_temp DECIMAL,
  p_max_temp DECIMAL,
  p_ideal_temp DECIMAL
)
RETURNS TABLE (
  violation_type TEXT,
  severity TEXT,
  deviation DECIMAL,
  impact TEXT
) AS $$
DECLARE
  v_violation_type TEXT;
  v_severity TEXT;
  v_deviation DECIMAL;
  v_impact TEXT;
BEGIN
  IF p_current_temp < p_min_temp THEN
    v_violation_type := 'too_cold';
    v_deviation := p_min_temp - p_current_temp;
  ELSIF p_current_temp > p_max_temp THEN
    v_violation_type := 'too_hot';
    v_deviation := p_current_temp - p_max_temp;
  ELSE
    v_violation_type := 'normal';
    v_deviation := 0;
  END IF;

  -- Severity scoring
  IF ABS(v_deviation) > 5 THEN
    v_severity := 'critical';
    v_impact := 'Total Loss';
  ELSIF ABS(v_deviation) > 3 THEN
    v_severity := 'warning';
    v_impact := 'Loss';
  ELSE
    v_severity := 'info';
    v_impact := 'Marginal';
  END IF;

  RETURN QUERY SELECT v_violation_type::text, v_severity::text, v_deviation, v_impact::text;
END;
$$ LANGUAGE plpgsql;

-- 2. Calculate Cold Chain Compliance Score
CREATE OR REPLACE FUNCTION calculate_compliance_score(
  p_readings_in_range INTEGER,
  p_total_readings INTEGER,
  p_violation_count INTEGER
)
RETURNS DECIMAL AS $$
DECLARE
  v_compliance_pct DECIMAL;
  v_score DECIMAL := 10.0;
BEGIN
  IF p_total_readings = 0 THEN
    RETURN 0;
  END IF;

  v_compliance_pct := (p_readings_in_range::DECIMAL / p_total_readings::DECIMAL) * 100;

  -- Base score from compliance %
  v_score := (v_compliance_pct / 100) * 10;

  -- Deduct for violations
  v_score := v_score - (p_violation_count * 0.5);

  RETURN GREATEST(v_score, 0);
END;
$$ LANGUAGE plpgsql;

-- 3. Estimate Cargo Loss
CREATE OR REPLACE FUNCTION estimate_cargo_loss(
  p_violation_severity TEXT,
  p_duration_minutes INTEGER,
  p_cargo_value DECIMAL
)
RETURNS DECIMAL AS $$
DECLARE
  v_loss_pct DECIMAL;
BEGIN
  -- Calculate loss based on severity and duration
  IF p_violation_severity = 'critical' THEN
    v_loss_pct := 100.0; -- Total loss
  ELSIF p_violation_severity = 'warning' THEN
    v_loss_pct := (p_duration_minutes::DECIMAL / 60) * 10; -- ~10% per hour
  ELSE
    v_loss_pct := (p_duration_minutes::DECIMAL / 120) * 1; -- ~1% per 2 hours
  END IF;

  RETURN (v_loss_pct / 100) * p_cargo_value;
END;
$$ LANGUAGE plpgsql;
