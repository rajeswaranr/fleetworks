-- ======= VIDEO EVENTS & STREAMING SCHEMA =======

-- Video events table: Stores dashcam incidents, alerts, and clip metadata
CREATE TABLE IF NOT EXISTS video_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  timestamp TIMESTAMPTZ NOT NULL,
  event_type TEXT NOT NULL, -- 'harsh_brake', 'collision', 'lane_departure', 'harsh_turn', 'speeding', 'harsh_acceleration'
  severity TEXT DEFAULT 'info', -- 'info', 'warning', 'critical'

  -- Video metadata
  s3_bucket TEXT,
  s3_key TEXT, -- s3://bucket/videos/org_id/vehicle_id/timestamp.mp4
  s3_url TEXT, -- Full signed URL for playback
  duration_sec INTEGER,
  file_size_mb NUMERIC,
  video_format TEXT DEFAULT 'mp4', -- mp4, webm, hls

  -- Telemetry at time of event
  latitude NUMERIC,
  longitude NUMERIC,
  speed_kmh NUMERIC,
  rpm INTEGER,
  fuel_pct NUMERIC,

  -- Dashcam AI analysis
  confidence_pct INTEGER, -- AI confidence (Samsara: 0-100)
  ai_detection TEXT, -- JSON array of detected objects/behaviors
  harsh_score NUMERIC, -- Magnitude of harsh braking (0-100)

  -- Review status
  status TEXT DEFAULT 'new', -- 'new', 'reviewed', 'cleared', 'flagged'
  reviewed_by UUID REFERENCES auth.users(id),
  reviewed_at TIMESTAMPTZ,
  notes TEXT,

  -- Streaming metadata
  stream_url TEXT, -- RTMP stream URL (if live)
  stream_status TEXT, -- 'idle', 'recording', 'streaming', 'uploaded'

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Hypertable for time-series queries
SELECT create_hypertable('video_events', 'timestamp',
  if_not_exists => TRUE,
  migrate_data => TRUE);

-- Compress old data (>30 days)
ALTER TABLE video_events SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'org_id,vehicle_id',
  timescaledb.compress_orderby = 'timestamp DESC'
);

SELECT add_compression_policy('video_events', INTERVAL '30 days',
  if_not_exists => TRUE);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS video_events_vehicle_time
  ON video_events (vehicle_id, timestamp DESC)
  WHERE status = 'new';

CREATE INDEX IF NOT EXISTS video_events_org_time
  ON video_events (org_id, timestamp DESC);

CREATE INDEX IF NOT EXISTS video_events_type
  ON video_events (event_type, timestamp DESC);

-- Video clips for continuous recording (optional, for longer archives)
CREATE TABLE IF NOT EXISTS video_clips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  timestamp TIMESTAMPTZ NOT NULL,

  -- Clip metadata
  s3_key TEXT NOT NULL,
  duration_sec INTEGER,
  file_size_mb NUMERIC,

  -- Recording info
  camera_position TEXT, -- 'forward', 'cabin', 'rear', 'driver_facing'
  resolution TEXT, -- '1920x1080', '2560x1440'
  fps INTEGER DEFAULT 30,
  bitrate_mbps NUMERIC,

  -- Retention
  retention_days INTEGER DEFAULT 30,
  expires_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT now()
);

SELECT create_hypertable('video_clips', 'timestamp',
  if_not_exists => TRUE,
  migrate_data => TRUE);

CREATE INDEX IF NOT EXISTS video_clips_vehicle_time
  ON video_clips (vehicle_id, timestamp DESC);

-- View: Link video events with telemetry
CREATE OR REPLACE VIEW video_events_with_telemetry AS
SELECT
  ve.id,
  ve.org_id,
  ve.vehicle_id,
  v.registration,
  ve.timestamp,
  ve.event_type,
  ve.severity,
  ve.s3_url,
  ve.duration_sec,

  -- Telemetry at event time
  ve.latitude,
  ve.longitude,
  ve.speed_kmh,
  ve.rpm,
  ve.fuel_pct,

  -- Vehicle context
  d.name AS driver_name,
  d.mobile AS driver_mobile,
  ve.confidence_pct,
  ve.harsh_score,

  -- Status
  ve.status,
  ve.reviewed_by,
  ve.reviewed_at,
  ve.notes,

  ve.created_at
FROM video_events ve
LEFT JOIN vehicles v ON ve.vehicle_id = v.id
LEFT JOIN drivers d ON v.driver_id = d.id
WHERE ve.org_id = auth.uid()::UUID; -- RLS

-- View: Recent unreviewed events
CREATE OR REPLACE VIEW recent_video_alerts AS
SELECT
  id,
  vehicle_id,
  timestamp,
  event_type,
  severity,
  s3_url,
  speed_kmh,
  harsh_score,
  confidence_pct
FROM video_events
WHERE status = 'new'
  AND org_id = auth.uid()::UUID
  AND timestamp > now() - INTERVAL '7 days'
ORDER BY timestamp DESC;

-- RLS Policy: Organizations see only their own events
ALTER TABLE video_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_read_own_video_events" ON video_events
  FOR SELECT USING (org_id = auth.uid()::UUID);

CREATE POLICY "org_insert_video_events" ON video_events
  FOR INSERT WITH CHECK (org_id = auth.uid()::UUID);

CREATE POLICY "org_update_video_events" ON video_events
  FOR UPDATE USING (org_id = auth.uid()::UUID)
  WITH CHECK (org_id = auth.uid()::UUID);

-- RLS Policy: Clips
ALTER TABLE video_clips ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_read_own_clips" ON video_clips
  FOR SELECT USING (org_id = auth.uid()::UUID);

-- Function: Auto-update video_events.updated_at
CREATE OR REPLACE FUNCTION update_video_events_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER video_events_updated_at_trigger
  BEFORE UPDATE ON video_events
  FOR EACH ROW
  EXECUTE FUNCTION update_video_events_updated_at();

-- Function: Generate S3 signed URL (expires in 7 days)
CREATE OR REPLACE FUNCTION get_video_signed_url(p_s3_key TEXT)
RETURNS TEXT AS $$
DECLARE
  v_url TEXT;
BEGIN
  -- This would call AWS SDK to generate signed URL
  -- For now, return placeholder - implement in Edge Function
  v_url := 'https://fleetworks-videos.s3.amazonaws.com/' || p_s3_key || '?AWSAccessKeyId=...&Signature=...&Expires=' || extract(epoch FROM now() + INTERVAL '7 days');
  RETURN v_url;
END;
$$ LANGUAGE plpgsql;

-- Alerts table: Track notifications sent to users
CREATE TABLE IF NOT EXISTS video_alerts_sent (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_event_id UUID NOT NULL REFERENCES video_events(id) ON DELETE CASCADE,
  recipient_user_id UUID NOT NULL REFERENCES auth.users(id),
  channel TEXT, -- 'push', 'email', 'sms', 'in_app'
  sent_at TIMESTAMPTZ DEFAULT now(),
  delivered_at TIMESTAMPTZ,
  status TEXT DEFAULT 'sent' -- 'sent', 'delivered', 'failed'
);

CREATE INDEX IF NOT EXISTS video_alerts_sent_event
  ON video_alerts_sent (video_event_id);

-- Grant permissions to authenticated users
GRANT SELECT ON video_events TO authenticated;
GRANT SELECT ON video_clips TO authenticated;
GRANT SELECT ON video_events_with_telemetry TO authenticated;
GRANT SELECT ON recent_video_alerts TO authenticated;

-- Grant to service role for Edge Functions
GRANT ALL ON video_events TO service_role;
GRANT ALL ON video_clips TO service_role;
GRANT ALL ON video_alerts_sent TO service_role;

COMMENT ON TABLE video_events IS 'Dashcam events: collisions, harsh braking, lane departure. Hypertable for efficient time-series queries.';
COMMENT ON TABLE video_clips IS 'Continuous video recording clips from dashcams. Optional storage for full archive.';
COMMENT ON COLUMN video_events.s3_url IS 'Pre-signed S3 URL valid for 7 days. Regenerate as needed.';
COMMENT ON COLUMN video_events.ai_detection IS 'JSON array of AI-detected objects: [{type: "person", confidence: 0.95}, {type: "vehicle", confidence: 0.87}]';
