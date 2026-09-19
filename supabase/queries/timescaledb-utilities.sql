-- TimescaleDB Utility Queries for Video Telemetry
-- Run these in Supabase SQL Editor for monitoring and optimization

-- ======= SETUP & VERIFICATION =======

-- 1. Verify TimescaleDB is installed
SELECT extname, extversion FROM pg_extension WHERE extname = 'timescaledb';

-- 2. Create hypertables if not exists (idempotent)
SELECT create_hypertable('video_events', 'timestamp', if_not_exists => TRUE);
SELECT create_hypertable('video_clips', 'timestamp', if_not_exists => TRUE);

-- 3. Enable compression on video_events
ALTER TABLE video_events SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'org_id,vehicle_id',
  timescaledb.compress_orderby = 'timestamp DESC'
) ON CONFLICT DO NOTHING;

-- 4. Add compression policy (30 days)
SELECT add_compression_policy('video_events', INTERVAL '30 days', if_not_exists => TRUE);

-- 5. Add retention policy (90 days)
SELECT add_retention_policy('video_events', INTERVAL '90 days', if_not_exists => TRUE);

-- ======= MONITORING & ANALYSIS =======

-- 6. Storage usage by table
SELECT
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as total_size,
  pg_size_pretty(pg_relation_size(schemaname||'.'||tablename)) as table_size,
  pg_size_pretty(pg_indexes_size(schemaname||'.'||tablename)) as indexes_size
FROM pg_tables
WHERE schemaname = 'public' AND tablename IN ('video_events', 'video_clips')
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;

-- 7. Compression status
SELECT
  chunk_name,
  pg_size_pretty(table_bytes) as table_size,
  pg_size_pretty(index_bytes) as index_size,
  is_compressed
FROM chunks_view
WHERE hypertable_name = 'video_events'
ORDER BY table_bytes DESC
LIMIT 20;

-- 8. Total database size
SELECT pg_size_pretty(pg_database_size('postgres')) as total_db_size;

-- ======= OPERATIONAL QUERIES =======

-- 9. Recent unreviewed events (last 24 hours)
SELECT
  id, vehicle_id, timestamp, event_type, severity,
  speed_kmh, harsh_score, confidence_pct, duration_sec
FROM video_events
WHERE status = 'new' AND timestamp > now() - INTERVAL '24 hours'
ORDER BY timestamp DESC
LIMIT 20;

-- 10. Critical events requiring immediate attention
SELECT
  id, vehicle_id, timestamp, event_type,
  speed_kmh, latitude, longitude, harsh_score,
  duration_sec, s3_url
FROM video_events
WHERE severity = 'critical' AND timestamp > now() - INTERVAL '7 days'
ORDER BY timestamp DESC;

-- 11. Events by vehicle (last 48 hours)
SELECT
  v.registration,
  COUNT(*) as event_count,
  COUNT(CASE WHEN severity = 'critical' THEN 1 END) as critical_count,
  ROUND(AVG(harsh_score), 1) as avg_harsh_score,
  ROUND(AVG(speed_kmh), 1) as avg_speed
FROM video_events ve
JOIN vehicles v ON ve.vehicle_id = v.id
WHERE ve.timestamp > now() - INTERVAL '48 hours'
GROUP BY v.registration
ORDER BY event_count DESC;

-- 12. Event type breakdown (last 7 days)
SELECT
  event_type,
  COUNT(*) as count,
  COUNT(CASE WHEN severity = 'critical' THEN 1 END) as critical_count,
  ROUND(100.0 * COUNT(*) / (
    SELECT COUNT(*) FROM video_events
    WHERE timestamp > now() - INTERVAL '7 days'
  ), 2) as pct
FROM video_events
WHERE timestamp > now() - INTERVAL '7 days'
GROUP BY event_type
ORDER BY count DESC;

-- 13. Events per hour (last 24 hours) - for trending
SELECT
  time_bucket('1 hour', timestamp) as hour,
  COUNT(*) as event_count,
  COUNT(CASE WHEN severity = 'critical' THEN 1 END) as critical_events,
  ROUND(AVG(harsh_score), 1) as avg_severity,
  ROUND(AVG(confidence_pct), 1) as avg_confidence
FROM video_events
WHERE timestamp > now() - INTERVAL '24 hours'
GROUP BY hour
ORDER BY hour DESC;

-- 14. Driver performance scorecard (last 30 days)
SELECT
  d.id,
  d.name,
  COUNT(ve.id) as total_events,
  COUNT(CASE WHEN ve.severity = 'critical' THEN 1 END) as critical_events,
  ROUND(AVG(ve.harsh_score), 1) as avg_harsh_score,
  ROUND(AVG(ve.confidence_pct), 1) as avg_ai_confidence,
  COUNT(DISTINCT ve.vehicle_id) as vehicles_driven
FROM drivers d
LEFT JOIN vehicles v ON d.id = v.driver_id
LEFT JOIN video_events ve ON v.id = ve.vehicle_id
  AND ve.timestamp > now() - INTERVAL '30 days'
GROUP BY d.id, d.name
HAVING COUNT(ve.id) > 0
ORDER BY critical_events DESC, total_events DESC;

-- 15. Most problematic vehicles (90-day history)
SELECT
  v.registration,
  COUNT(*) as total_events,
  COUNT(CASE WHEN severity = 'critical' THEN 1 END) as critical_events,
  COUNT(CASE WHEN severity = 'warning' THEN 1 END) as warning_events,
  ROUND(AVG(harsh_score), 1) as avg_harsh_score,
  ROUND(100.0 * COUNT(CASE WHEN status = 'new' THEN 1 END) / COUNT(*), 1) as pct_unreviewed
FROM video_events ve
JOIN vehicles v ON ve.vehicle_id = v.id
WHERE ve.timestamp > now() - INTERVAL '90 days'
GROUP BY v.registration
ORDER BY critical_events DESC, total_events DESC
LIMIT 20;

-- 16. Video coverage (do we have clips for events?)
SELECT
  COUNT(*) as total_events,
  COUNT(CASE WHEN s3_url IS NOT NULL THEN 1 END) as events_with_video,
  ROUND(100.0 * COUNT(CASE WHEN s3_url IS NOT NULL THEN 1 END) / COUNT(*), 1) as video_coverage_pct,
  ROUND(100.0 * COUNT(CASE WHEN s3_url IS NULL THEN 1 END) / COUNT(*), 1) as missing_video_pct
FROM video_events
WHERE timestamp > now() - INTERVAL '7 days';

-- ======= MAINTENANCE =======

-- 17. Manually compress chunks older than 30 days
SELECT compress_chunk(chunk)
FROM show_chunks('video_events',
  from => now() - INTERVAL '60 days',
  to => now() - INTERVAL '30 days'
) AS chunk
WHERE NOT is_compressed(chunk);

-- 18. List all chunks and their status
SELECT
  chunk_name,
  range_start,
  range_end,
  table_bytes,
  index_bytes,
  is_compressed
FROM chunks_view
WHERE hypertable_name = 'video_events'
ORDER BY range_start DESC
LIMIT 50;

-- 19. Count events per chunk (data distribution)
SELECT
  chunk_name,
  COUNT(*) as row_count,
  MIN(timestamp) as earliest,
  MAX(timestamp) as latest
FROM video_events
GROUP BY chunk_name
ORDER BY MIN(timestamp) DESC;

-- 20. Delete old data manually (if retention policy not working)
DELETE FROM video_events
WHERE timestamp < now() - INTERVAL '90 days'
  AND status IN ('cleared', 'reviewed')
  AND severity != 'critical';

-- ======= PERFORMANCE TUNING =======

-- 21. Query plan for video event lookup
EXPLAIN ANALYZE
SELECT * FROM video_events
WHERE vehicle_id = '550e8400-e29b-41d4-a716-446655440000'
  AND timestamp > now() - INTERVAL '7 days'
ORDER BY timestamp DESC;

-- 22. Slow queries (requires pg_stat_statements)
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

SELECT
  query,
  calls,
  total_time,
  mean_time,
  max_time,
  stddev_time
FROM pg_stat_statements
WHERE query LIKE '%video_events%' OR query LIKE '%video_clips%'
ORDER BY mean_time DESC
LIMIT 10;

-- 23. Index usage statistics
SELECT
  schemaname,
  tablename,
  indexname,
  idx_scan,
  idx_tup_read,
  idx_tup_fetch
FROM pg_stat_user_indexes
WHERE tablename IN ('video_events', 'video_clips')
ORDER BY idx_scan DESC;

-- ======= ANALYTICS =======

-- 24. Events by location (geospatial)
SELECT
  ROUND(latitude, 2) as lat_bucket,
  ROUND(longitude, 2) as lng_bucket,
  COUNT(*) as event_count,
  COUNT(CASE WHEN severity = 'critical' THEN 1 END) as critical_count
FROM video_events
WHERE timestamp > now() - INTERVAL '30 days'
  AND latitude IS NOT NULL
  AND longitude IS NOT NULL
GROUP BY lat_bucket, lng_bucket
ORDER BY event_count DESC
LIMIT 20;

-- 25. Severity distribution over time
SELECT
  time_bucket('1 day', timestamp) as day,
  severity,
  COUNT(*) as count
FROM video_events
WHERE timestamp > now() - INTERVAL '30 days'
GROUP BY day, severity
ORDER BY day DESC, severity;

-- ======= CLEANUP & OPTIMIZATION =======

-- 26. Find and delete duplicate events (if any)
WITH ranked_events AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY vehicle_id, timestamp, event_type
      ORDER BY id
    ) as rn
  FROM video_events
)
DELETE FROM video_events
WHERE id IN (SELECT id FROM ranked_events WHERE rn > 1);

-- 27. Vacuum analyze (optimize table for queries)
VACUUM ANALYZE video_events;
VACUUM ANALYZE video_clips;

-- 28. Check for bloat in tables
SELECT
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size,
  ROUND(100 * pg_relation_size(schemaname||'.'||tablename)::numeric /
    pg_total_relation_size(schemaname||'.'||tablename), 2) as table_pct
FROM pg_tables
WHERE schemaname = 'public' AND tablename IN ('video_events', 'video_clips');

-- 29. Export data to CSV (last 30 days)
-- Run in psql or save to file:
-- psql -d postgres -c "\COPY (SELECT * FROM video_events WHERE timestamp > now() - INTERVAL '30 days') TO STDOUT WITH CSV HEADER" > events_export.csv

-- 30. Hypertable info
SELECT
  hypertable_name,
  owner,
  num_chunks,
  num_compressed_chunks
FROM timescaledb_information.hypertables
WHERE hypertable_name IN ('video_events', 'video_clips');
