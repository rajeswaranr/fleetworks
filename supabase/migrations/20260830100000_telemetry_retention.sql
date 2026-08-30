-- ============ FleetWorks — telemetry retention ============
-- The telemetry table shipped with no way to age data out. At one reading per
-- 30 seconds per vehicle, twenty trucks write roughly 1.7 million rows a month
-- and the table grows without limit — the row count climbs, the index climbs
-- with it, and the dashboard's "latest reading per device" query slows down for
-- everyone. This closes that.
--
-- Deliberately NOT scheduled here. pg_cron is not enabled on this project, and
-- the fix for an unbounded table should not itself depend on an extension that
-- may not exist. purge_telemetry() is a plain function: call it from the
-- devices page, from a scheduled edge function, or by hand. Scheduling can be
-- added later without touching this logic.
--
-- Two horizons, because the data is not equally valuable. Raw readings are only
-- interesting while recent — nobody asks what a truck's RPM was on a Tuesday in
-- March. Events are the opposite: a forward-collision warning matters at a
-- claim or a driver review months later, so they are kept far longer and
-- unacknowledged ones are never touched at all.

alter table organizations
  add column if not exists telemetry_retention_days int not null default 90;
alter table organizations
  add column if not exists event_retention_days     int not null default 730;

comment on column organizations.telemetry_retention_days is
  'Raw telemetry readings older than this are purged. 0 disables purging for the org.';
comment on column organizations.event_retention_days is
  'Acknowledged device events older than this are purged. Unacknowledged events are never purged.';

-- Deleting a million rows in one statement locks the table and bloats WAL, so
-- the function works in bounded batches and reports what it removed. Callers
-- can run it repeatedly until it returns zero.
create or replace function purge_telemetry(p_batch int default 20000)
returns table (telemetry_deleted bigint, events_deleted bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tel bigint := 0;
  v_ev  bigint := 0;
begin
  with doomed as (
    select t.id
      from telemetry t
      join organizations o on o.id = t.org_id
     where o.telemetry_retention_days > 0
       and t.recorded_at < now() - (o.telemetry_retention_days || ' days')::interval
     limit p_batch
  )
  delete from telemetry t using doomed d where t.id = d.id;
  get diagnostics v_tel = row_count;

  -- Unacknowledged events survive regardless of age: an alert nobody has looked
  -- at is precisely the one that must not disappear quietly.
  with doomed as (
    select e.id
      from device_events e
      join organizations o on o.id = e.org_id
     where o.event_retention_days > 0
       and e.acknowledged_at is not null
       and e.occurred_at < now() - (o.event_retention_days || ' days')::interval
     limit p_batch
  )
  delete from device_events e using doomed d where e.id = d.id;
  get diagnostics v_ev = row_count;

  return query select v_tel, v_ev;
end;
$$;

-- security definer so the purge can cross orgs in one pass, but execution is
-- granted only to authenticated users — never anon.
revoke all on function purge_telemetry(int) from public;
grant execute on function purge_telemetry(int) to authenticated;

-- Supporting index: the purge scans by time within an org, which is the same
-- shape as the dashboard query but ascending.
create index if not exists idx_telemetry_purge on telemetry(org_id, recorded_at);
create index if not exists idx_events_purge on device_events(org_id, occurred_at) where acknowledged_at is not null;

-- Verify after running:
--   select * from purge_telemetry(1000);
--   select telemetry_retention_days, event_retention_days from organizations limit 5;
