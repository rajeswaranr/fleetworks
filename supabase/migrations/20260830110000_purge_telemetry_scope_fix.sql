-- ============ FleetWorks — fix purge_telemetry privilege and scope ============
-- Two defects in 20260830100000, both mine, found by probing the deployed
-- endpoint rather than by reading the migration back.
--
-- 1. ANON COULD CALL IT. `revoke all ... from public` does not remove the
--    explicit EXECUTE grant Supabase's default privileges hand to the `anon`
--    role at creation time — PUBLIC and anon are different grantees. The
--    function is SECURITY DEFINER, so an anonymous caller would have run it as
--    the owner, bypassing RLS entirely. Verified against the live endpoint: it
--    returned 200 to a request carrying only the publishable key.
--
-- 2. IT CROSSED ORGS BY DESIGN. The original comment called that intentional
--    "so the purge can cross orgs in one pass", which is wrong for anything a
--    tenant can invoke: one fleet's owner could age out another fleet's data.
--    A definer function must scope itself, because RLS is not doing it.
--
-- Now: anon is revoked explicitly, and the function purges only orgs the caller
-- actually belongs to, derived from auth.uid() inside the function rather than
-- taken as a parameter a caller could forge.

revoke execute on function purge_telemetry(int) from anon;

create or replace function purge_telemetry(p_batch int default 20000)
returns table (telemetry_deleted bigint, events_deleted bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tel bigint := 0;
  v_ev  bigint := 0;
  v_uid uuid := auth.uid();
begin
  -- No session, no purge. Belt and braces alongside the revoke above: if a
  -- future default-privileges change re-grants anon, this still refuses.
  if v_uid is null then
    return query select 0::bigint, 0::bigint;
    return;
  end if;

  with mine as (
    select org_id from memberships where user_id = v_uid
  ),
  doomed as (
    select t.id
      from telemetry t
      join organizations o on o.id = t.org_id
     where t.org_id in (select org_id from mine)
       and o.telemetry_retention_days > 0
       and t.recorded_at < now() - (o.telemetry_retention_days || ' days')::interval
     limit p_batch
  )
  delete from telemetry t using doomed d where t.id = d.id;
  get diagnostics v_tel = row_count;

  -- Unacknowledged events survive regardless of age: an alert nobody has looked
  -- at is precisely the one that must not disappear quietly.
  with mine as (
    select org_id from memberships where user_id = v_uid
  ),
  doomed as (
    select e.id
      from device_events e
      join organizations o on o.id = e.org_id
     where e.org_id in (select org_id from mine)
       and o.event_retention_days > 0
       and e.acknowledged_at is not null
       and e.occurred_at < now() - (o.event_retention_days || ' days')::interval
     limit p_batch
  )
  delete from device_events e using doomed d where e.id = d.id;
  get diagnostics v_ev = row_count;

  return query select v_tel, v_ev;
end;
$$;

revoke all on function purge_telemetry(int) from public;
revoke execute on function purge_telemetry(int) from anon;
grant execute on function purge_telemetry(int) to authenticated;

-- Verify after running — the first must be refused, the second must work:
--   curl -X POST .../rpc/purge_telemetry -H "apikey: <anon>"          -> 401/403
--   curl -X POST .../rpc/purge_telemetry -H "Authorization: Bearer .." -> counts
