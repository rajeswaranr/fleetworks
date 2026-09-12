-- ============ FleetWorks — retire the blanket org-member policies ============
--
-- THIS IS THE MIGRATION THAT ACTUALLY CLOSES THE SUPERVISOR LEAK.
--
-- 20260724110000 built the whole vehicle-scoping model — can_view_vehicle_id /
-- can_update_vehicle_id, per-table scoped policies, the lot — and it has been
-- inert ever since. Every one of those tables ALSO still carries its original
-- `org_members_all_<table>` policy from schema-normalized.sql: PERMISSIVE, ALL
-- commands, `is_org_member(org_id)`.
--
-- Postgres ORs permissive policies. One blanket grant beside ten careful ones
-- means the ten never decide anything. And is_org_member() is true for ANY
-- membership row — supervisor and driver included — so an invited supervisor
-- could read and write every vehicle's trips, fuel, expenses, issues,
-- inspections, work orders, tyre readings, documents, reminders and devices
-- across the entire org.
--
-- Re-running db/schema-normalized.sql after the team-access migration is what
-- restored them. That file is historical now (see the DB-migrations note) and
-- must not be run against this database again — doing so re-opens all of this.
--
-- Owners and managers are unaffected: can_view_vehicle_id() and
-- can_update_vehicle_id() both short-circuit on is_org_admin(), which covers
-- owner, manager, and the FleetWorks admin JWT role.

-- ========== 1. Tables whose scoped replacements are already complete ==========
-- These eight already have scoped SELECT/INSERT/UPDATE and admin DELETE
-- underneath. Removing the blanket policy is the entire fix.

drop policy if exists org_members_all_trips         on trips;
drop policy if exists org_members_all_fuel_logs     on fuel_logs;
drop policy if exists org_members_all_issues        on issues;
drop policy if exists org_members_all_inspections   on inspections;
drop policy if exists org_members_all_reminders     on reminders;
drop policy if exists org_members_all_documents     on documents;
drop policy if exists org_members_all_work_orders   on work_orders;
drop policy if exists org_members_all_tyre_readings on tyre_readings;

-- ========== 2. expenses — supervisor may add and edit his own vehicles' ==========
-- Only scoped SELECT existed, so dropping the blanket would have made the table
-- read-only for supervisors. They log diesel, labour and site spend against the
-- trucks they run, so they get INSERT and UPDATE on exactly those.

drop policy if exists expenses_insert on expenses;
create policy expenses_insert on expenses for insert to authenticated
  with check (can_update_vehicle_id(org_id, vehicle_id));

drop policy if exists expenses_update on expenses;
create policy expenses_update on expenses for update to authenticated
  using (can_update_vehicle_id(org_id, vehicle_id))
  with check (can_update_vehicle_id(org_id, vehicle_id));

drop policy if exists org_members_all_expenses on expenses;

-- ========== 3. drivers — edit the man on his truck, not the roster ==========
-- A supervisor may correct the driver record attached to a vehicle he holds:
-- phone number, licence expiry, which of his trucks the man is on today.
--
-- INSERT and DELETE stay with owner/manager (drivers_admin_write already covers
-- them). This is not timidity about identity data — it is that a brand-new
-- driver row has no vehicle yet, so can_update_vehicle_id() has nothing to
-- resolve and a scoped INSERT policy could never pass. Creating people is an
-- org-level act; assigning them to a truck is the vehicle-level one.

drop policy if exists drivers_update on drivers;
create policy drivers_update on drivers for update to authenticated
  using (can_update_vehicle_id(org_id, vehicle_id))
  with check (can_update_vehicle_id(org_id, vehicle_id));

drop policy if exists org_members_all_drivers on drivers;

-- ========== 4. devices — had no scoped policy at all ==========
-- The AIS-140 box bolted to a truck. A supervisor commissioning or swapping a
-- device on his own vehicle is routine; a device row with vehicle_id null is
-- unassigned stock and stays owner/manager business, which is why the SELECT
-- policy spells that case out instead of letting it fall through.

drop policy if exists devices_select on devices;
create policy devices_select on devices for select to authenticated
  using (
    case when vehicle_id is null then is_org_admin(org_id)
         else can_view_vehicle_id(org_id, vehicle_id) end
  );

drop policy if exists devices_insert on devices;
create policy devices_insert on devices for insert to authenticated
  with check (
    case when vehicle_id is null then is_org_admin(org_id)
         else can_update_vehicle_id(org_id, vehicle_id) end
  );

drop policy if exists devices_update on devices;
create policy devices_update on devices for update to authenticated
  using (
    case when vehicle_id is null then is_org_admin(org_id)
         else can_update_vehicle_id(org_id, vehicle_id) end
  )
  with check (
    case when vehicle_id is null then is_org_admin(org_id)
         else can_update_vehicle_id(org_id, vehicle_id) end
  );

drop policy if exists devices_delete on devices;
create policy devices_delete on devices for delete to authenticated
  using (is_org_admin(org_id));

drop policy if exists devices_member_all on devices;

-- ========== 5. Approvals move to the supervisor ==========
-- 20260912100000 kept approving a diesel or advance request with owner/manager,
-- on the reasoning that approving your own request defeats the approval. That
-- was the wrong call for how these fleets actually run: the supervisor is the
-- person on site who knows whether the driver really needs the money, and
-- waiting on the owner is what makes drivers phone him at midnight.
--
-- A supervisor does not raise these — the driver does, over the anon role — so
-- approving is not self-approval. It stays scoped to his own vehicles.

drop policy if exists trip_req_update on trip_requests;
create policy trip_req_update on trip_requests for update to authenticated
  using (exists (
    select 1 from trips t
    where t.id = trip_id
      and (can_update_vehicle_id(t.org_id, t.vehicle_id) or is_org_admin(t.org_id))
  ))
  with check (exists (
    select 1 from trips t
    where t.id = trip_id
      and (can_update_vehicle_id(t.org_id, t.vehicle_id) or is_org_admin(t.org_id))
  ));

drop policy if exists texp_update on trip_expenses;
create policy texp_update on trip_expenses for update to authenticated
  using (can_update_vehicle_id(org_id, vehicle_id) or is_org_admin(org_id))
  with check (can_update_vehicle_id(org_id, vehicle_id) or is_org_admin(org_id));

-- ========== 6. Verify ==========
-- Expect zero rows. Any row here is a table where a blanket grant still
-- overrides its scoped policies.
--
--   select tablename, policyname from pg_policies
--    where schemaname = 'public'
--      and qual like '%is_org_member%'
--      and roles::text like '%authenticated%'
--      and exists (select 1 from information_schema.columns c
--                   where c.table_schema = 'public'
--                     and c.table_name = pg_policies.tablename
--                     and c.column_name = 'vehicle_id');
--
-- service_requests is deliberately NOT in this migration. Its blanket policy
-- (sr_owner) sits alongside partner-facing policies for workshops outside the
-- org, so narrowing it is a different problem with a different blast radius.
-- Left open on purpose, to be looked at on its own.
