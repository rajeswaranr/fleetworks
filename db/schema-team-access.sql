-- ============ FleetWorks — Team Access: Supervisors & Drivers ============
-- Run in Supabase SQL Editor AFTER db/schema-normalized.sql. Idempotent.
--
-- Adds two roles beyond owner/manager/viewer:
--   supervisor — sees only vehicles assigned to them (read by default)
--   driver     — sees + can log fuel/expense/issue/inspection/tyre data
--                for vehicles assigned to them
--
-- The actual read/write boundary is vehicle_assignments.access
-- ('view' | 'update'), not the role label — role is just what the UI
-- shows ("Supervisor" / "Driver" badge). This lets an owner grant a
-- supervisor update rights on one vehicle without inventing a new role.
--
-- IMPORTANT: this restricts the NORMALIZED tables (vehicles, fuel_logs,
-- expenses, issues, ...), which are kept live by the schema-normalized.sql
-- dual-write trigger. The owner's raw fleets.data blob stays owner-only
-- (unchanged, unreadable by team members) — team members sign in through
-- team.html, which reads/writes these normalized tables directly via
-- PostgREST, so Postgres itself — not client JS — enforces the scoping.

-- ========================= 1. ROLES =========================

alter table memberships drop constraint if exists memberships_role_check;
alter table memberships add constraint memberships_role_check
  check (role in ('owner','manager','viewer','supervisor','driver'));

-- ========================= 2. VEHICLE ASSIGNMENTS =========================
-- Keyed by vehicle_ext_id (the blob's stable client-side id, e.g. "v1"),
-- NOT vehicles.id — sync_fleet_from_blob() deletes and re-inserts every
-- vehicle row on each save, so a uuid FK would silently orphan on the
-- owner's next sync. ext_id survives every re-sync.

create table if not exists vehicle_assignments (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(id) on delete cascade,
  user_id        uuid not null references auth.users(id) on delete cascade,
  vehicle_ext_id text not null,
  access         text not null default 'view' check (access in ('view','update')),
  created_at     timestamptz not null default now(),
  unique (org_id, user_id, vehicle_ext_id)
);
create index if not exists idx_va_user on vehicle_assignments(user_id);
create index if not exists idx_va_org_vehext on vehicle_assignments(org_id, vehicle_ext_id);

alter table vehicle_assignments enable row level security;
drop policy if exists va_admin_all on vehicle_assignments;
create policy va_admin_all on vehicle_assignments for all to authenticated
  using (is_org_member(org_id) and exists (
    select 1 from memberships m where m.org_id = org_id and m.user_id = auth.uid() and m.role in ('owner','manager')
  ))
  with check (is_org_member(org_id) and exists (
    select 1 from memberships m where m.org_id = org_id and m.user_id = auth.uid() and m.role in ('owner','manager')
  ));
drop policy if exists va_self_read on vehicle_assignments;
create policy va_self_read on vehicle_assignments for select to authenticated
  using (user_id = auth.uid());
grant select, insert, update, delete on vehicle_assignments to authenticated;

-- ========================= 3. PREDICATE FUNCTIONS =========================

-- Full org-wide access: owner/manager membership, or a FleetWorks admin.
create or replace function is_org_admin(p_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false)
    or exists (select 1 from memberships m where m.org_id = p_org and m.user_id = auth.uid() and m.role in ('owner','manager'));
$$;

-- Vehicle-scoped access, addressed by the blob-stable ext_id.
create or replace function can_view_vehicle(p_org uuid, p_vehicle_ext_id text)
returns boolean language sql stable security definer set search_path = public as $$
  select is_org_admin(p_org)
    or exists (select 1 from vehicle_assignments va where va.org_id = p_org and va.user_id = auth.uid() and va.vehicle_ext_id = p_vehicle_ext_id);
$$;
create or replace function can_update_vehicle(p_org uuid, p_vehicle_ext_id text)
returns boolean language sql stable security definer set search_path = public as $$
  select is_org_admin(p_org)
    or exists (select 1 from vehicle_assignments va where va.org_id = p_org and va.user_id = auth.uid() and va.vehicle_ext_id = p_vehicle_ext_id and va.access = 'update');
$$;

-- Convenience overloads for child tables that store vehicle_id (uuid), not
-- ext_id — resolve through vehicles once so callers never join manually.
create or replace function can_view_vehicle_id(p_org uuid, p_vehicle_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select is_org_admin(p_org)
    or exists (
      select 1 from vehicles v
      where v.id = p_vehicle_id and v.org_id = p_org
        and can_view_vehicle(p_org, v.ext_id)
    );
$$;
create or replace function can_update_vehicle_id(p_org uuid, p_vehicle_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select is_org_admin(p_org)
    or exists (
      select 1 from vehicles v
      where v.id = p_vehicle_id and v.org_id = p_org
        and can_update_vehicle(p_org, v.ext_id)
    );
$$;

-- ========================= 4. ROLE-AWARE RLS =========================
-- Replaces the blanket "org_members_all_<table>" policies from
-- schema-normalized.sql for tables where per-vehicle scoping applies.
-- parts (org-wide inventory, not vehicle-specific) is left as-is on
-- purpose — supervisors/drivers get no special restriction there.

drop policy if exists org_members_all_vehicles on vehicles;
create policy vehicles_select on vehicles for select to authenticated
  using (can_view_vehicle(org_id, ext_id));
create policy vehicles_admin_write on vehicles for insert to authenticated
  with check (is_org_admin(org_id));
create policy vehicles_admin_update on vehicles for update to authenticated
  using (is_org_admin(org_id)) with check (is_org_admin(org_id));
create policy vehicles_admin_delete on vehicles for delete to authenticated
  using (is_org_admin(org_id));

drop policy if exists org_members_all_drivers on drivers;
create policy drivers_select on drivers for select to authenticated
  using (is_org_admin(org_id) or vehicle_id is null or can_view_vehicle_id(org_id, vehicle_id));
create policy drivers_admin_write on drivers for all to authenticated
  using (is_org_admin(org_id)) with check (is_org_admin(org_id));

drop policy if exists org_members_all_documents on documents;
create policy documents_select on documents for select to authenticated
  using (is_org_admin(org_id) or (entity_type = 'vehicle' and can_view_vehicle_id(org_id, vehicle_id)));
create policy documents_write on documents for insert to authenticated
  with check (is_org_admin(org_id) or (entity_type = 'vehicle' and can_update_vehicle_id(org_id, vehicle_id)));
create policy documents_update on documents for update to authenticated
  using (is_org_admin(org_id) or (entity_type = 'vehicle' and can_update_vehicle_id(org_id, vehicle_id)))
  with check (is_org_admin(org_id) or (entity_type = 'vehicle' and can_update_vehicle_id(org_id, vehicle_id)));
create policy documents_delete on documents for delete to authenticated
  using (is_org_admin(org_id));

-- Shared pattern for the remaining vehicle_id-scoped operational tables:
-- SELECT = can_view, INSERT/UPDATE = can_update, DELETE = admin-only.
do $$
declare t text;
begin
  foreach t in array array['tyre_readings','fuel_logs','expenses','issues','work_orders','reminders','inspections']
  loop
    execute format('drop policy if exists org_members_all_%1$s on %1$s;', t);
    execute format('create policy %1$s_select on %1$s for select to authenticated using (can_view_vehicle_id(org_id, vehicle_id));', t);
    execute format('create policy %1$s_insert on %1$s for insert to authenticated with check (can_update_vehicle_id(org_id, vehicle_id));', t);
    execute format('create policy %1$s_update on %1$s for update to authenticated using (can_update_vehicle_id(org_id, vehicle_id)) with check (can_update_vehicle_id(org_id, vehicle_id));', t);
    execute format('create policy %1$s_delete on %1$s for delete to authenticated using (is_org_admin(org_id));', t);
  end loop;
end $$;

-- Owner/manager can manage OTHER members' rows directly (revoke access,
-- change a role label) without another edge function — membership creation
-- for a brand-new team member still goes through team-invite (it needs the
-- service-role key to create the auth.users row itself).
-- NOTE: this must go through is_org_admin() (security definer, bypasses RLS
-- internally), never a raw `select ... from memberships` here — a policy ON
-- memberships that itself queries memberships triggers RLS recursively on
-- every read of this table (Postgres re-evaluates this same policy for the
-- subquery's own scan), which Postgres rejects and PostgREST surfaces as a
-- flat 500 on every single memberships request, however innocuous.
drop policy if exists membership_admin_manage on memberships;
create policy membership_admin_manage on memberships for all to authenticated
  using (is_org_admin(org_id))
  with check (is_org_admin(org_id));
grant insert, update, delete on memberships to authenticated;

-- ========================= 5. TEAM ROSTER VIEW (for the owner) =========================
-- One row per team member with their org, role and assigned-vehicle count —
-- what the Team & Access tab lists. auth.users is admin-only to query
-- directly, so surface just the email through a security-definer function.

create or replace function team_roster(p_org uuid)
returns table (
  membership_id uuid, user_id uuid, email text, role text,
  assigned_vehicles text[], created_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select m.id, m.user_id, u.email, m.role,
    coalesce(array_agg(distinct va.vehicle_ext_id) filter (where va.vehicle_ext_id is not null), '{}'),
    m.created_at
  from memberships m
  join auth.users u on u.id = m.user_id
  left join vehicle_assignments va on va.org_id = m.org_id and va.user_id = m.user_id
  where m.org_id = p_org and is_org_admin(p_org)
  group by m.id, u.email
  order by m.created_at;
$$;
revoke all on function team_roster(uuid) from public;
grant execute on function team_roster(uuid) to authenticated;

-- Verify after running:
--   select * from team_roster((select org_id from memberships where user_id = auth.uid() limit 1));
