-- ============ FleetWorks — Admin Dashboard (staff/BDM assignment) ============
-- Run once in Supabase SQL Editor, AFTER schema-roles.sql. Idempotent.
--
-- Adds:
--   1. staff_members — a lightweight directory of FleetWorks staff/BDMs,
--      separate from Supabase Auth itself. admin.html manages this table
--      directly (add/deactivate a BDM) — no Supabase Admin API needed.
--      Readable/writable only by accounts already flagged
--      app_metadata.role = 'admin' (see schema-roles.sql).
--   2. assigned_to on leads + vendor_applications, so each can be handed to
--      a specific BDM and the console can show a per-BDM breakdown.
--   3. admin_update_leads — leads previously had read-only admin access
--      (admin_read_leads in schema-roles.sql); assigning a BDM needs update
--      too. vendor_applications already had admin_update_vendor_applications,
--      which covers the new assigned_to column with no policy change needed.
--
-- Transporter/vehicle counts for the dashboard are NOT computed here — the
-- admin console reads them straight from the organizations/vehicles tables
-- it already has full read access to (is_org_member() returns true for any
-- admin-flagged account, org-by-org, exactly like every other table below).

create table if not exists staff_members (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  email      text,
  role       text not null default 'bdm' check (role in ('bdm','admin')),
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
alter table staff_members enable row level security;
drop policy if exists "admin_all_staff_members" on staff_members;
create policy "admin_all_staff_members" on staff_members
  for all to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
grant select, insert, update, delete on staff_members to authenticated;

alter table leads add column if not exists assigned_to uuid references staff_members(id);
alter table vendor_applications add column if not exists assigned_to uuid references staff_members(id);

drop policy if exists "admin_update_leads" on leads;
create policy "admin_update_leads" on leads
  for update to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
grant update on leads to authenticated;

-- Verify after running:
--   select column_name from information_schema.columns where table_name = 'staff_members' order by 1;
--   select assigned_to from leads limit 1;
--   select assigned_to from vendor_applications limit 1;
