-- ============ FleetWorks — one-time demo-data purge ============
-- Run once in Supabase SQL Editor. Removes demo-fleet rows that the OLD
-- dual-write bridge projected into the normalized tables before the
-- DB-direct migration (back then every blob push wiped + re-projected, so
-- stale demo rows didn't matter; now that sync_fleet_from_blob() no longer
-- touches these tables, those old projected demo rows linger and show up in
-- signed-in accounts).
--
-- Demo rows are precisely identifiable: demo vehicles always use the fixed
-- ext_ids v1–v5 (real vehicles get a random 13-char uid), demo drivers use
-- 5 fixed DL numbers, demo parts use 6 fixed part numbers. Real data is
-- untouched. Idempotent — safe to re-run.
--
-- Deleting the demo vehicles cascades to their fuel_logs, expenses, issues,
-- work_orders, reminders, inspections, tyre_readings and documents (all FK
-- on delete cascade). Drivers are FK "on delete set null", so they're
-- deleted explicitly by DL number.

delete from drivers where dl_no in (
  'TN01 20180012345',  -- Suresh Kumar
  'UP32 20150098765',  -- Manoj Yadav
  'TN22 20190045678',  -- Ravi Shankar
  'KA05 20170034567',  -- Peter D''Souza
  'TN45 20200056789'   -- Abdul Rahman
);

delete from vehicles where ext_id in ('v1','v2','v3','v4','v5');

delete from parts where part_number in (
  'CAS-15W40-210L','TML-AF-1613X','BL-HCV-450','FF-BS6-220','WN-M22-100','ALT-12V90-BL'
);

-- Also purge any demo blob still sitting in fleets.data (vehicles keyed v1):
update fleets set data = data - 'vehicles' - 'drivers' - 'expenses' - 'fuelLogs'
  - 'inspections' - 'issues' - 'reminders' - 'parts' - 'workOrders'
  - 'documents' - 'tyreReadings' - 'trips' - 'driverLedger'
where data -> 'vehicles' @> '[{"id":"v1"}]'::jsonb;

-- Verify after running (expect 0 rows from each):
--   select name from vehicles where ext_id in ('v1','v2','v3','v4','v5');
--   select name from drivers where dl_no like 'TN01 2018%';
