-- ============ FleetWorks — driver trip logging, and the RLS gap it exposed ============
--
-- SECURITY FIX FIRST.
-- The team-access migration vehicle-scoped seven tables — tyre_readings,
-- fuel_logs, expenses, issues, work_orders, reminders, inspections — via
-- can_view_vehicle_id / can_update_vehicle_id. `trips` and `driver_ledger` were
-- not among them and kept a plain is_org_member policy, which is fine while
-- only the owner touches them and wrong the moment a driver can log in: any
-- team member could read every vehicle's trips and the entire fleet's advance
-- ledger, and write to both. Giving drivers a login without closing this would
-- have handed every driver the whole khata.
--
-- trips is now scoped by vehicle, like the other seven.
--
-- driver_ledger cannot be — it has no vehicle_id, it has driver_id. A driver
-- should see their OWN khata and nobody else's, which is a different rule, so
-- it gets its own: owners and admins see the fleet's, a driver sees only rows
-- whose driver row is linked to their user.

-- ---------- start/end odometer on a trip ----------
-- The driver knows the two readings; km is arithmetic. Storing both means a
-- disputed distance can be checked against what was actually entered, and an
-- impossible entry (end below start) is visible rather than hidden inside a
-- single number.
alter table trips add column if not exists odo_start numeric;
alter table trips add column if not exists odo_end   numeric;
alter table trips add column if not exists driver_id uuid references drivers(id) on delete set null;
alter table trips add column if not exists notes     text;

-- Guard the obvious data error at the database, not just in the form.
alter table trips drop constraint if exists trips_odo_sane;
alter table trips add constraint trips_odo_sane
  check (odo_start is null or odo_end is null or odo_end >= odo_start);

-- ---------- trips: vehicle-scoped like the rest ----------
drop policy if exists org_members_all_trips on trips;
drop policy if exists trips_select on trips;
drop policy if exists trips_insert on trips;
drop policy if exists trips_update on trips;
drop policy if exists trips_delete on trips;

create policy trips_select on trips for select to authenticated
  using (can_view_vehicle_id(org_id, vehicle_id));
create policy trips_insert on trips for insert to authenticated
  with check (can_update_vehicle_id(org_id, vehicle_id));
create policy trips_update on trips for update to authenticated
  using (can_update_vehicle_id(org_id, vehicle_id))
  with check (can_update_vehicle_id(org_id, vehicle_id));
-- Deletion stays with the owner: a driver correcting a mistake should raise it,
-- not quietly remove the record of a trip that was run.
create policy trips_delete on trips for delete to authenticated
  using (is_org_admin(org_id));

-- ---------- driver_ledger: own khata only ----------
-- Links a signed-in team user to their driver row. Without this a driver has no
-- identity in the drivers table, only in auth — and the khata is keyed on the
-- former.
alter table drivers add column if not exists user_id uuid references auth.users(id) on delete set null;
create index if not exists idx_drivers_user on drivers(user_id);

create or replace function is_my_driver_row(p_driver uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from drivers d where d.id = p_driver and d.user_id = auth.uid());
$$;

drop policy if exists org_members_all_driver_ledger on driver_ledger;
drop policy if exists ledger_select on driver_ledger;
drop policy if exists ledger_insert on driver_ledger;
drop policy if exists ledger_write on driver_ledger;

create policy ledger_select on driver_ledger for select to authenticated
  using (is_org_admin(org_id) or is_my_driver_row(driver_id));
-- A driver may record an advance they received or an expense they paid; they
-- may not settle their own account, which is the owner's call.
create policy ledger_insert on driver_ledger for insert to authenticated
  with check (
    is_org_admin(org_id)
    or (is_my_driver_row(driver_id) and type in ('advance','expense'))
  );
create policy ledger_update on driver_ledger for update to authenticated
  using (is_org_admin(org_id)) with check (is_org_admin(org_id));
create policy ledger_delete on driver_ledger for delete to authenticated
  using (is_org_admin(org_id));

grant select, insert, update, delete on trips to authenticated;
grant select, insert, update, delete on driver_ledger to authenticated;

-- Verify after running:
--   select polname, pg_get_expr(polqual, polrelid) from pg_policy
--    where polrelid in ('trips'::regclass, 'driver_ledger'::regclass);
