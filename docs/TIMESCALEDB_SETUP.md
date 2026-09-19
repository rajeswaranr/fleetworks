# TimescaleDB Configuration for Video Telemetry

Complete guide to setting up and using TimescaleDB for high-volume vehicle telemetry and dashcam event storage.

## 1. Enable TimescaleDB on Supabase

### Option A: Create New Project with TimescaleDB

1. Go to Supabase Dashboard → Create Project
2. Select **PostgreSQL with TimescaleDB extension**
3. Select Region: **ap-south-1 (Mumbai)** for India latency
4. Project will auto-initialize with TimescaleDB

### Option B: Add TimescaleDB to Existing Project

```bash
# Connect to Supabase PostgreSQL
psql postgresql://postgres:[PASSWORD]@db.project-ref.supabase.co:5432/postgres

# Create extension
CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;

# Verify installation
SELECT extname FROM pg_extension WHERE extname = 'timescaledb';
# Output: timescaledb
```

## 2. Schema Setup

The migration file `20260913010000_video_telemetry_integration.sql` creates:

### video_events (Hypertable)
```sql
-- Primary time-series table for dashcam incidents
CREATE TABLE video_events (
  id UUID PRIMARY KEY,
  org_id UUID,
  vehicle_id UUID,
  timestamp TIMESTAMPTZ NOT NULL,  -- Required for hypertable
  event_type TEXT,                  -- harsh_brake, collision, lane_departure, etc
  severity TEXT,                     -- info, warning, critical
  speed_kmh NUMERIC,
  latitude NUMERIC,
  longitude NUMERIC,
  s3_url TEXT,
  confidence_pct INTEGER,
  harsh_score NUMERIC,
  status TEXT,
  ...
);

-- Convert to hypertable (automatic compression for time-series)
SELECT create_hypertable('video_events', 'timestamp', 
  if_not_exists => TRUE,
  migrate_data => TRUE);

-- Auto-compress data older than 30 days
ALTER TABLE video_events SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'org_id,vehicle_id',
  timescaledb.compress_orderby = 'timestamp DESC'
);

SELECT add_compression_policy('video_events', INTERVAL '30 days');
```

### video_clips (Continuous Recording)
```sql
-- For archival of continuous dashcam footage
CREATE TABLE video_clips (
  id UUID PRIMARY KEY,
  org_id UUID,
  vehicle_id UUID,
  timestamp TIMESTAMPTZ NOT NULL,
  s3_key TEXT,
  duration_sec INTEGER,
  camera_position TEXT,
  expires_at TIMESTAMPTZ
);

SELECT create_hypertable('video_clips', 'timestamp', if_not_exists => TRUE);
```

## 3. Indexes for Query Performance

### Critical Indexes
```sql
-- Query unreviewed events for a vehicle
CREATE INDEX video_events_vehicle_time 
  ON video_events (vehicle_id, timestamp DESC)
  WHERE status = 'new';

-- Organization-level queries
CREATE INDEX video_events_org_time 
  ON video_events (org_id, timestamp DESC);

-- Event type filtering (harsh braking, collisions, etc)
CREATE INDEX video_events_type 
  ON video_events (event_type, timestamp DESC);

-- Geospatial queries (events in area)
CREATE INDEX video_events_geo 
  ON video_events USING GIST (ll_to_earth(latitude, longitude));
```

## 4. Common TimescaleDB Queries

### Get Recent Events (Last 24 Hours)
```sql
SELECT 
  id, vehicle_id, timestamp, event_type, severity,
  speed_kmh, harsh_score, confidence_pct
FROM video_events
WHERE 
  org_id = 'org-uuid'
  AND timestamp > now() - INTERVAL '24 hours'
  AND status = 'new'
ORDER BY timestamp DESC
LIMIT 20;

-- Response time: ~50ms (with index)
-- Without timestamp filter: ~2000ms (full scan)
```

### Events by Hour (Time Binning)
```sql
SELECT 
  time_bucket('1 hour', timestamp) AS hour,
  COUNT(*) as event_count,
  AVG(harsh_score) as avg_severity,
  COUNT(CASE WHEN severity = 'critical' THEN 1 END) as critical_count
FROM video_events
WHERE 
  org_id = 'org-uuid'
  AND vehicle_id = 'vehicle-uuid'
  AND timestamp > now() - INTERVAL '7 days'
GROUP BY hour
ORDER BY hour DESC;

-- Aggregates across 1M events in <100ms
```

### Top Problem Vehicles (Last 7 Days)
```sql
SELECT 
  vehicle_id,
  COUNT(*) as total_events,
  COUNT(CASE WHEN severity = 'critical' THEN 1 END) as critical_events,
  AVG(harsh_score) as avg_harsh_score,
  AVG(confidence_pct) as avg_confidence
FROM video_events
WHERE 
  org_id = 'org-uuid'
  AND timestamp > now() - INTERVAL '7 days'
GROUP BY vehicle_id
ORDER BY critical_events DESC, total_events DESC
LIMIT 10;

-- Fleet-wide analysis in <200ms
```

### Geospatial: Events Within Radius
```sql
SELECT 
  id, vehicle_id, timestamp, event_type, speed_kmh,
  earth_distance(
    ll_to_earth(latitude, longitude),
    ll_to_earth(13.0827, 80.2707)  -- Chennai coord
  ) / 1000 as distance_km
FROM video_events
WHERE 
  org_id = 'org-uuid'
  AND timestamp > now() - INTERVAL '7 days'
  AND earth_distance(
    ll_to_earth(latitude, longitude),
    ll_to_earth(13.0827, 80.2707)
  ) < 5000  -- 5km radius
ORDER BY timestamp DESC;

-- Geofence queries in <150ms
```

### Event Type Trends (Last 30 Days)
```sql
SELECT 
  event_type,
  severity,
  COUNT(*) as count,
  ROUND(100.0 * COUNT(*) / (SELECT COUNT(*) FROM video_events 
    WHERE org_id = 'org-uuid' 
    AND timestamp > now() - INTERVAL '30 days'), 2) as pct
FROM video_events
WHERE 
  org_id = 'org-uuid'
  AND timestamp > now() - INTERVAL '30 days'
GROUP BY event_type, severity
ORDER BY count DESC;

-- Trend analysis for dashboard charts
```

### Driver Performance Scorecard (30 Days)
```sql
SELECT 
  d.id,
  d.name,
  COUNT(ve.id) as total_events,
  COUNT(CASE WHEN ve.severity = 'critical' THEN 1 END) as critical_events,
  ROUND(AVG(ve.harsh_score), 1) as avg_harsh_score,
  ROUND(AVG(ve.confidence_pct), 1) as avg_ai_confidence,
  COUNT(CASE WHEN ve.status = 'reviewed' THEN 1 END) as reviewed_events
FROM drivers d
LEFT JOIN video_events ve ON d.id = (
  SELECT driver_id FROM vehicles WHERE id = ve.vehicle_id
)
WHERE 
  d.org_id = 'org-uuid'
  AND ve.timestamp > now() - INTERVAL '30 days'
GROUP BY d.id, d.name
ORDER BY critical_events DESC, total_events DESC;
```

## 5. Performance Tuning

### Check Compression Status
```sql
SELECT 
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size,
  (
    SELECT count(*) FROM pg_class WHERE relname = tablename AND relkind = 'c'
  ) > 0 as is_compressed
FROM pg_tables
WHERE tablename LIKE 'video_%';
```

### Monitor Query Performance
```sql
-- Find slow queries
SELECT 
  query,
  calls,
  total_time,
  mean_time,
  max_time
FROM pg_stat_statements
WHERE query LIKE '%video_events%'
ORDER BY mean_time DESC
LIMIT 10;

-- Run with: CREATE EXTENSION pg_stat_statements;
```

### Continuous Aggregate (Pre-aggregated Data)
```sql
-- Pre-compute hourly event counts for faster dashboards
CREATE MATERIALIZED VIEW video_events_hourly WITH (timescaledb.continuous) AS
SELECT 
  time_bucket('1 hour', timestamp) as hour,
  org_id,
  vehicle_id,
  event_type,
  COUNT(*) as event_count,
  AVG(harsh_score) as avg_harsh_score
FROM video_events
GROUP BY hour, org_id, vehicle_id, event_type;

-- Refresh policy: Auto-update every 5 minutes
SELECT add_continuous_aggregate_policy('video_events_hourly',
  start_offset => INTERVAL '2 hours',
  end_offset => INTERVAL '5 min',
  schedule_interval => INTERVAL '5 min');
```

## 6. Data Retention & Lifecycle

### Automatic Data Retention
```sql
-- Keep only 90 days of raw data (compressed after 30 days)
SELECT add_retention_policy('video_events', INTERVAL '90 days');

-- Older data moves to S3 Glacier via archive job
-- (configured in backup strategy)
```

### Manual Cleanup
```sql
-- Delete old events older than 90 days
DELETE FROM video_events
WHERE timestamp < now() - INTERVAL '90 days'
AND status IN ('cleared', 'reviewed');

-- Or just video_clips (continuous recording takes more space)
DELETE FROM video_clips
WHERE expires_at < now();
```

## 7. Integration with Edge Functions

### Supabase Edge Function Example
```typescript
// supabase/functions/dashcam-webhook/index.ts

// Insert video event (TimescaleDB auto-sorts by timestamp)
const { data, error } = await supabase
  .from('video_events')
  .insert({
    org_id: vehicle.org_id,
    vehicle_id: event.vehicle_id,
    timestamp: new Date(event.timestamp).toISOString(),  // ISO format
    event_type: event.event_type,
    severity: event.severity,
    speed_kmh: event.speed_kmh,
    latitude: event.latitude,
    longitude: event.longitude,
    s3_url: videoUrl,
    confidence_pct: event.confidence_pct,
    harsh_score: event.harsh_score,
    status: 'new',
  });

// TimescaleDB automatically:
// - Partitions by time (1-day chunks by default)
// - Indexes by timestamp
// - Compresses after 30 days
// - Cleans up after 90 days
```

## 8. Cost Optimization

### Storage Breakdown (per 100 vehicles, 10 events/day)
| Size | Time | Cost |
|------|------|------|
| 10GB | 30 days | $2-3 |
| 30GB | 90 days | $6-9 |
| 100GB | 1 year | $20-30 |

**Key savings:**
- Compression: 80-90% reduction in aged data
- TimescaleDB: 40% cheaper than standard PostgreSQL for time-series
- Auto-tiering: Move to S3 Glacier after 90 days (~$0.01/GB/month)

### Monitor Storage Usage
```sql
-- Current size
SELECT pg_size_pretty(pg_database_size('postgres'));

-- Per table
SELECT 
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename))
FROM pg_tables
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
```

## 9. Backup & Recovery

### Enable Continuous Backups (Supabase)
Settings → Database → Backups
- Frequency: Daily
- Retention: 7 days
- Can restore to any point in time

### Backup Video Events
```sql
-- Export last 7 days to CSV for archive
COPY (
  SELECT * FROM video_events
  WHERE org_id = 'org-uuid'
  AND timestamp > now() - INTERVAL '7 days'
) TO STDOUT WITH CSV HEADER;

-- Or to S3 directly
SELECT aws_s3_query_to_s3('SELECT * FROM video_events WHERE org_id = $1',
  $$s3://backup-bucket/video-events-$(date +%Y%m%d).csv$$,
  options => 'format csv header true'
);
```

## 10. Real-Time Subscriptions (Supabase Realtime)

### PostgreSQL Notify/Listen
```sql
-- Edge Function: Notify on new critical event
CREATE FUNCTION notify_critical_event()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.severity = 'critical' THEN
    PERFORM pg_notify('video_events:critical', 
      json_build_object(
        'vehicle_id', NEW.vehicle_id,
        'event_type', NEW.event_type,
        'timestamp', NEW.timestamp
      )::text
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER video_events_critical_notify
  AFTER INSERT ON video_events
  FOR EACH ROW
  EXECUTE FUNCTION notify_critical_event();
```

### React Subscription
```jsx
// js/modules/fleet-ops/controllers/video-events.controller.js

supabase
  .channel('video-events-live')
  .on('postgres_changes', {
    event: 'INSERT',
    schema: 'public',
    table: 'video_events',
    filter: 'severity=eq.critical'  // Only critical events
  }, (payload) => {
    console.log('Critical event!', payload.new);
    notifyManager(payload.new);
  })
  .subscribe();
```

## 11. Troubleshooting

### High Query Latency
```sql
-- Check if indexes are used
EXPLAIN ANALYZE
SELECT * FROM video_events
WHERE vehicle_id = 'xyz' 
AND timestamp > now() - INTERVAL '24 hours';

-- If Seq Scan: rebuild index
REINDEX INDEX video_events_vehicle_time;
```

### Compression Not Working
```sql
-- Check compression policy
SELECT * FROM timescaledb_information.compression_settings
WHERE hypertable_name = 'video_events';

-- Check if chunks are compressed
SELECT 
  chunk_name,
  table_bytes,
  index_bytes,
  is_compressed
FROM chunks_view
WHERE hypertable_name = 'video_events'
ORDER BY table_bytes DESC;
```

### Out of Disk Space
```sql
-- Find largest tables
SELECT 
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size
FROM pg_tables
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC
LIMIT 10;

-- Delete old compressed chunks
DELETE FROM video_clips 
WHERE timestamp < now() - INTERVAL '60 days';
```

## 12. Production Checklist

- [ ] TimescaleDB extension installed
- [ ] Hypertables created for video_events and video_clips
- [ ] Compression policy enabled (30 days)
- [ ] Retention policy enabled (90 days)
- [ ] Indexes created for common queries
- [ ] Continuous aggregates for dashboards
- [ ] Backup strategy configured
- [ ] Real-time subscriptions tested
- [ ] Query performance monitored
- [ ] Storage alerts set up (>80% capacity)

## 13. Scaling Beyond 1000 Vehicles

### When to upgrade:
- **500 vehicles:** Add read replicas for analytics
- **2000 vehicles:** Shard by org_id or region
- **5000+ vehicles:** Dedicated TimescaleDB cloud cluster

### Setup Read Replica
```sql
-- Create replica for analytics queries only
-- (keeps main DB for writes)
psql postgresql://postgres@read-replica.supabase.co/postgres

-- All SELECTs route to replica, INSERTs stay on primary
```

---

**Need help?** Check TimescaleDB docs: https://docs.timescaledb.com/
