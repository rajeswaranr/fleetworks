-- ============================================================================
-- RBAC core: roles, permissions and scopes live in tables; everything asks them.
-- ============================================================================
--
-- Model (policy-as-data):
--   rbac_permissions       the catalogue: "resource:action" (vehicles:read, payroll:approve ...)
--   rbac_roles             built-in roles (org_id null) and per-organisation custom roles
--   rbac_role_permissions  which permissions a role holds, and at what data SCOPE:
--                            all      every row of the organisation
--                            assigned rows tied to a vehicle the user is assigned to
--                                     (write actions need 'update' access on the assignment)
--                            own      rows that belong to the user's own driver record
--   memberships.role_id    the role a user holds in an organisation
--
-- Every row-level-security policy and every server function authorises through
-- rbac_scope()/rbac_user_scope(); nothing decides by role NAME. Deny by default:
-- no role row => no permission.
--
-- Built-in roles: owner, manager, accountant, mechanic, supervisor, driver, viewer.
-- Custom roles are created per organisation by holders of roles:manage (owners) and can
-- never contain an owner_only permission, so they cannot be used to escalate.
-- Safe to re-run.

-- ── 1. catalogue ───────────────────────────────────────────────────────────
create table if not exists rbac_permissions (
  key         text primary key,                -- 'vehicles:read'
  resource    text not null,
  action      text not null,
  description text,
  owner_only  boolean not null default false,  -- never grantable to a custom role
  created_at  timestamptz not null default now()
);

create table if not exists rbac_roles (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid references organizations(id) on delete cascade,   -- null = built-in
  key         text not null,
  name        text not null,
  description text,
  base_role   text not null
              check (base_role in ('owner','manager','accountant','mechanic','supervisor','driver','viewer')),
  is_system   boolean not null default false,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- a custom role may only be based on a non-administrative role, otherwise the
  -- legacy is_org_admin() checks would treat it as an administrator
  constraint rbac_custom_base_not_admin
    check (org_id is null or base_role in ('accountant','mechanic','supervisor','driver','viewer'))
);
create unique index if not exists rbac_roles_system_key on rbac_roles(key) where org_id is null;
create unique index if not exists rbac_roles_org_key    on rbac_roles(org_id, key) where org_id is not null;

create table if not exists rbac_role_permissions (
  role_id    uuid not null references rbac_roles(id) on delete cascade,
  permission text not null references rbac_permissions(key) on delete cascade,
  scope      text not null default 'all' check (scope in ('all','assigned','own')),
  primary key (role_id, permission)
);
create index if not exists idx_rbac_rp_permission on rbac_role_permissions(permission);

alter table memberships add column if not exists role_id uuid references rbac_roles(id);
alter table memberships drop constraint if exists memberships_role_check;
alter table memberships add constraint memberships_role_check
  check (role in ('owner','manager','accountant','mechanic','viewer','supervisor','driver'));
create index if not exists idx_memberships_user_org on memberships(user_id, org_id);

-- ── 2. seed the permission catalogue ───────────────────────────────────────
do $$
declare
  res text[] := array[
    'vehicles','drivers','assignments','sites','projects','dispatch','trips','trip_requests','trip_expenses',
    'geofences','assets','devices','telemetry','driver_locations','attendance','driver_documents',
    'fuel','expenses','expense_categories','ledger','payroll','payroll_setup','invoices','purchasing','gst',
    'parties','fastag','insurance','fuel_intel','catalog',
    'work_orders','issues','inspections','reminders','parts','tyres','documents','service_requests',
    'safety','whatsapp','bill_review','coldchain','automation','team'
  ];
  acts text[] := array['read','create','update','delete'];
  r text; a text;
begin
  foreach r in array res loop
    foreach a in array acts loop
      insert into rbac_permissions(key, resource, action, description)
      values (r || ':' || a, r, a, initcap(a) || ' ' || replace(r, '_', ' '))
      on conflict (key) do nothing;
    end loop;
  end loop;

  insert into rbac_permissions(key, resource, action, description) values
    ('expense_requests:read',    'expense_requests', 'read',    'See petty-expense requests'),
    ('expense_requests:create',  'expense_requests', 'create',  'Submit a petty-expense request'),
    ('expense_requests:update',  'expense_requests', 'update',  'Edit a petty-expense request'),
    ('expense_requests:delete',  'expense_requests', 'delete',  'Delete a petty-expense request'),
    ('expense_requests:approve', 'expense_requests', 'approve', 'Approve or reject petty-expense requests'),
    ('payroll_requests:read',    'payroll_requests', 'read',    'See salary payment requests'),
    ('payroll_requests:create',  'payroll_requests', 'create',  'Queue a salary payment request'),
    ('payroll_requests:update',  'payroll_requests', 'update',  'Edit a salary payment request'),
    ('payroll_requests:delete',  'payroll_requests', 'delete',  'Delete a salary payment request'),
    ('payroll_requests:approve', 'payroll_requests', 'approve', 'Approve a salary payment request'),
    ('payroll:approve',          'payroll',          'approve', 'Release salary payouts'),
    ('roles:read',               'roles',            'read',    'See roles and their permissions'),
    ('roles:manage',             'roles',            'manage',  'Create roles and change what they can do'),
    ('audit:read',               'audit',            'read',    'Read the audit trail'),
    ('reports:read',             'reports',          'read',    'Open reports and dashboards'),
    ('reports:export',           'reports',          'export',  'Download reports'),
    ('org:read',                 'org',              'read',    'See organisation settings'),
    ('org:update',               'org',              'update',  'Change organisation settings')
  on conflict (key) do nothing;

  -- What only an owner may ever hold: managing people, roles, the organisation,
  -- releasing money, and reading the audit trail.
  update rbac_permissions set owner_only = true
   where key in ('roles:manage','team:create','team:update','team:delete','org:update',
                 'payroll:approve','payroll_requests:approve','audit:read');
end $$;

-- ── 3. built-in roles ──────────────────────────────────────────────────────
insert into rbac_roles(org_id, key, name, description, base_role, is_system) values
  (null,'owner',     'Owner',      'Full control of the organisation, including people, roles and payments.', 'owner',      true),
  (null,'manager',   'Manager',    'Runs operations and finance day to day. Cannot manage people, roles or release payouts.', 'manager', true),
  (null,'accountant','Accounts',   'Finance records: expenses, khata, invoices, GST, payroll records. No operations or people.', 'accountant', true),
  (null,'mechanic',  'Mechanic',   'Maintenance: job cards, issues, inspections, service, spares and tyres.', 'mechanic', true),
  (null,'supervisor','Supervisor', 'Runs the vehicles and sites assigned to them.', 'supervisor', true),
  (null,'driver',    'Driver',     'Their own khata, attendance and documents, and the vehicle assigned to them.', 'driver', true),
  (null,'viewer',    'Viewer',     'Read-only view of fleet operations and maintenance. No finance or people.', 'viewer', true)
on conflict do nothing;

-- helper used only by this migration to grant "a,b,c" at a scope
create or replace function _rbac_grant(p_role text, p_scope text, p_perms text) returns void
language plpgsql as $$
declare k text; v_role uuid;
begin
  select id into v_role from rbac_roles where org_id is null and key = p_role;
  if v_role is null then raise exception 'unknown built-in role %', p_role; end if;
  foreach k in array string_to_array(replace(p_perms, E'\n', ''), ',') loop
    k := btrim(k);
    if k = '' then continue; end if;
    if not exists (select 1 from rbac_permissions where key = k) then raise exception 'unknown permission %', k; end if;
    insert into rbac_role_permissions(role_id, permission, scope) values (v_role, k, p_scope)
    on conflict (role_id, permission) do update set scope = excluded.scope;
  end loop;
end $$;

-- owner: everything, whole organisation
insert into rbac_role_permissions(role_id, permission, scope)
select r.id, p.key, 'all' from rbac_roles r cross join rbac_permissions p
 where r.org_id is null and r.key = 'owner'
on conflict (role_id, permission) do nothing;

-- manager: everything except what is owner-only and destructive money actions
insert into rbac_role_permissions(role_id, permission, scope)
select r.id, p.key, 'all' from rbac_roles r cross join rbac_permissions p
 where r.org_id is null and r.key = 'manager'
   and not p.owner_only
   and p.key not in ('payroll:delete','payroll_requests:delete','ledger:delete')
on conflict (role_id, permission) do nothing;

select _rbac_grant('accountant', 'all', $g$
  vehicles:read, drivers:read, sites:read, projects:read, trips:read, work_orders:read, parts:read, attendance:read,
  fuel:read, fuel:create, fuel:update,
  expenses:read, expenses:create, expenses:update,
  expense_categories:read, expense_categories:create, expense_categories:update,
  expense_requests:read, expense_requests:update, expense_requests:approve,
  trip_expenses:read, trip_expenses:create, trip_expenses:update,
  ledger:read, ledger:create, ledger:update,
  payroll:read, payroll:create, payroll:update, payroll_setup:read,
  payroll_requests:read, payroll_requests:create,
  invoices:read, invoices:create, invoices:update,
  purchasing:read, purchasing:create, purchasing:update,
  gst:read, gst:create, gst:update,
  parties:read, parties:create, parties:update,
  fastag:read, fastag:update, insurance:read, fuel_intel:read,
  catalog:read, catalog:create, catalog:update,
  reports:read, reports:export, org:read, roles:read
$g$);

select _rbac_grant('mechanic', 'all', $g$
  vehicles:read, devices:read, telemetry:read,
  work_orders:read, work_orders:create, work_orders:update,
  issues:read, issues:create, issues:update,
  inspections:read, inspections:create, inspections:update,
  reminders:read, reminders:create, reminders:update,
  parts:read, parts:create, parts:update,
  tyres:read, tyres:create, tyres:update,
  documents:read, service_requests:read, service_requests:create, service_requests:update,
  expense_requests:create, catalog:read, org:read, roles:read
$g$);

-- supervisor: only vehicles/sites assigned to them
select _rbac_grant('supervisor', 'assigned', $g$
  vehicles:read, drivers:read, assignments:read, sites:read, projects:read,
  dispatch:read, dispatch:create, dispatch:update,
  trips:read, trips:create, trips:update, trip_requests:read, trip_requests:update,
  trip_expenses:read, trip_expenses:create,
  fuel:read, fuel:create, expenses:read,
  expense_requests:read, expense_requests:create,
  work_orders:read, issues:read, issues:create, issues:update,
  inspections:read, inspections:create, reminders:read,
  tyres:read, tyres:create, documents:read,
  attendance:read, attendance:create, attendance:update,
  devices:read, telemetry:read, geofences:read, safety:read, service_requests:read, service_requests:create
$g$);
select _rbac_grant('supervisor', 'all', 'parts:read, expense_categories:read, catalog:read, org:read');

-- driver: their own records, and the vehicle they are assigned to
select _rbac_grant('driver', 'own', $g$
  drivers:read, ledger:read, ledger:create,
  attendance:read, attendance:create,
  driver_documents:read, driver_documents:create, driver_documents:update,
  payroll:read, driver_locations:read, driver_locations:create,
  trip_expenses:read, trip_expenses:create, trip_expenses:update
$g$);
select _rbac_grant('driver', 'assigned', $g$
  vehicles:read, fuel:read, fuel:create,
  trips:read, trips:create, trips:update, trip_requests:read, trip_requests:create, trip_requests:update,
  issues:read, issues:create, inspections:read, inspections:create,
  work_orders:read, reminders:read, expense_requests:read, expense_requests:create
$g$);
select _rbac_grant('driver', 'all', 'expense_categories:read, org:read');

select _rbac_grant('viewer', 'all', $g$
  vehicles:read, sites:read, projects:read, assignments:read, dispatch:read, trips:read,
  geofences:read, assets:read, devices:read, telemetry:read, fuel:read,
  work_orders:read, issues:read, inspections:read, reminders:read, parts:read, tyres:read, documents:read,
  safety:read, reports:read, org:read
$g$);

drop function _rbac_grant(text, text, text);

-- point every existing membership at its built-in role
update memberships m set role_id = r.id
  from rbac_roles r
 where r.org_id is null and r.key = m.role and m.role_id is null;

-- ── 4. the functions everything calls ──────────────────────────────────────
create or replace function is_platform_admin() returns boolean
language sql stable as $$ select coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false) $$;

-- The user's scope for a permission in an organisation: 'all' | 'assigned' | 'own' | null.
create or replace function rbac_scope(p_org uuid, p_perm text) returns text
language sql stable security definer set search_path = public as $$
  select rp.scope
    from memberships m
    join rbac_role_permissions rp on rp.role_id = m.role_id
   where m.user_id = auth.uid() and m.org_id = p_org and rp.permission = p_perm
   limit 1
$$;

-- Same, for an explicit user. For server functions only (service role): they verify the JWT
-- themselves and then ask the database what that user may do.
create or replace function rbac_user_scope(p_user uuid, p_org uuid, p_perm text) returns text
language sql stable security definer set search_path = public as $$
  select rp.scope
    from memberships m
    join rbac_role_permissions rp on rp.role_id = m.role_id
   where m.user_id = p_user and m.org_id = p_org and rp.permission = p_perm
   limit 1
$$;

create or replace function has_perm(p_org uuid, p_perm text) returns boolean
language sql stable security definer set search_path = public as $$ select rbac_scope(p_org, p_perm) is not null $$;

-- Does the caller hold the permission across the whole organisation?
create or replace function has_perm_all(p_org uuid, p_perm text) returns boolean
language sql stable security definer set search_path = public as $$ select rbac_scope(p_org, p_perm) = 'all' $$;

create or replace function rbac_vehicle_ok(p_org uuid, p_vehicle uuid, p_write boolean default false) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from vehicles v
      join vehicle_assignments va
        on va.org_id = v.org_id and va.vehicle_ext_id = v.ext_id and va.user_id = auth.uid()
     where v.id = p_vehicle and v.org_id = p_org and (not p_write or va.access = 'update'))
$$;

create or replace function is_my_driver_ext(p_org uuid, p_driver_ext text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from drivers d where d.org_id = p_org and d.ext_id = p_driver_ext and d.user_id = auth.uid())
$$;

-- What the current user may do in an organisation (for the UI: hide what would be refused).
create or replace function my_permissions(p_org uuid) returns table(permission text, scope text)
language sql stable security definer set search_path = public as $$
  select rp.permission, rp.scope
    from memberships m join rbac_role_permissions rp on rp.role_id = m.role_id
   where m.user_id = auth.uid() and m.org_id = p_org
$$;

create or replace function my_role(p_org uuid) returns table(role_id uuid, role_key text, role_name text, base_role text)
language sql stable security definer set search_path = public as $$
  select r.id, r.key, r.name, r.base_role
    from memberships m join rbac_roles r on r.id = m.role_id
   where m.user_id = auth.uid() and m.org_id = p_org
$$;

-- Legacy helpers keep working (older policies still call them) but now derive from the
-- role tables. They no longer grant anything to FleetWorks platform staff: platform
-- admins run the platform (leads, vendor applications), not customer data.
create or replace function is_org_admin(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from memberships m join rbac_roles r on r.id = m.role_id
     where m.org_id = p_org and m.user_id = auth.uid() and r.base_role in ('owner','manager'))
$$;
create or replace function is_org_member(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships m where m.org_id = p_org and m.user_id = auth.uid())
$$;
create or replace function is_owner(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from memberships m join rbac_roles r on r.id = m.role_id
     where m.org_id = p_org and m.user_id = auth.uid() and r.base_role = 'owner')
$$;

-- ── 5. guards: nobody can talk themselves into more access ─────────────────
create or replace function rbac_roles_guard() returns trigger language plpgsql as $$
begin
  -- Built-in roles change only through migrations (no API user, no service call).
  if tg_op in ('UPDATE','DELETE') and old.is_system and (auth.uid() is not null or current_setting('request.jwt.claim.role', true) is not null) then
    raise exception 'built-in roles cannot be changed';
  end if;
  if tg_op = 'INSERT' and new.is_system and auth.uid() is not null then
    raise exception 'built-in roles cannot be created';
  end if;
  if tg_op = 'DELETE' then
    if exists (select 1 from memberships where role_id = old.id) then
      raise exception 'role "%" is still assigned to members; reassign them first', old.name;
    end if;
    return old;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists trg_rbac_roles_guard on rbac_roles;
create trigger trg_rbac_roles_guard before insert or update or delete on rbac_roles
  for each row execute function rbac_roles_guard();

create or replace function rbac_role_permissions_guard() returns trigger language plpgsql as $$
declare v_role rbac_roles; v_owner_only boolean;
begin
  select * into v_role from rbac_roles where id = coalesce(new.role_id, old.role_id);
  if v_role.is_system and auth.uid() is not null then
    raise exception 'built-in role permissions cannot be changed';
  end if;
  if tg_op <> 'DELETE' then
    select owner_only into v_owner_only from rbac_permissions where key = new.permission;
    if v_owner_only and not v_role.is_system then
      raise exception 'permission % can only be held by the built-in owner role', new.permission;
    end if;
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists trg_rbac_rp_guard on rbac_role_permissions;
create trigger trg_rbac_rp_guard before insert or update or delete on rbac_role_permissions
  for each row execute function rbac_role_permissions_guard();

create or replace function memberships_guard() returns trigger language plpgsql as $$
declare v_role rbac_roles; v_remaining int;
begin
  if tg_op in ('INSERT','UPDATE') then
    if new.role_id is null then
      select id into new.role_id from rbac_roles where org_id is null and key = new.role;
    end if;
    select * into v_role from rbac_roles where id = new.role_id;
    if v_role.id is null then raise exception 'unknown role'; end if;
    if v_role.org_id is not null and v_role.org_id <> new.org_id then
      raise exception 'that role belongs to another organisation';
    end if;
    new.role := v_role.base_role;               -- legacy column mirrors the role's base
  end if;

  -- no self-service role changes through the API
  if tg_op = 'UPDATE' and auth.uid() is not null and old.user_id = auth.uid()
     and (new.role_id is distinct from old.role_id or new.user_id is distinct from old.user_id or new.org_id is distinct from old.org_id) then
    raise exception 'you cannot change your own role';
  end if;

  -- an organisation always keeps at least one owner
  -- (skipped when the row is going away as a cascade from deleting the user or the organisation)
  if tg_op in ('UPDATE','DELETE') and old.role = 'owner' and pg_trigger_depth() <= 1
     and (tg_op = 'DELETE' or new.role <> 'owner') then
    select count(*) into v_remaining from memberships where org_id = old.org_id and role = 'owner' and id <> old.id;
    if v_remaining = 0 then raise exception 'an organisation must keep at least one owner'; end if;
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists trg_memberships_guard on memberships;
create trigger trg_memberships_guard before insert or update or delete on memberships
  for each row execute function memberships_guard();

-- ── 6. RLS on the RBAC tables themselves ───────────────────────────────────
alter table rbac_permissions      enable row level security;
alter table rbac_roles            enable row level security;
alter table rbac_role_permissions enable row level security;

drop policy if exists rbac_perm_select on rbac_permissions;
create policy rbac_perm_select on rbac_permissions for select to authenticated using (true);

drop policy if exists rbac_roles_select on rbac_roles;
create policy rbac_roles_select on rbac_roles for select to authenticated
  using (org_id is null or has_perm(org_id, 'roles:read') or exists (select 1 from memberships m where m.role_id = rbac_roles.id and m.user_id = auth.uid()));
drop policy if exists rbac_roles_insert on rbac_roles;
create policy rbac_roles_insert on rbac_roles for insert to authenticated
  with check (org_id is not null and not is_system and has_perm(org_id, 'roles:manage'));
drop policy if exists rbac_roles_update on rbac_roles;
create policy rbac_roles_update on rbac_roles for update to authenticated
  using (org_id is not null and not is_system and has_perm(org_id, 'roles:manage'))
  with check (org_id is not null and not is_system and has_perm(org_id, 'roles:manage'));
drop policy if exists rbac_roles_delete on rbac_roles;
create policy rbac_roles_delete on rbac_roles for delete to authenticated
  using (org_id is not null and not is_system and has_perm(org_id, 'roles:manage'));

drop policy if exists rbac_rp_select on rbac_role_permissions;
create policy rbac_rp_select on rbac_role_permissions for select to authenticated
  using (exists (select 1 from rbac_roles r where r.id = role_id
                  and (r.org_id is null or has_perm(r.org_id, 'roles:read')
                       or exists (select 1 from memberships m where m.role_id = r.id and m.user_id = auth.uid()))));
drop policy if exists rbac_rp_write on rbac_role_permissions;
create policy rbac_rp_write on rbac_role_permissions for all to authenticated
  using (exists (select 1 from rbac_roles r where r.id = role_id and r.org_id is not null and not r.is_system and has_perm(r.org_id, 'roles:manage')))
  with check (exists (select 1 from rbac_roles r where r.id = role_id and r.org_id is not null and not r.is_system and has_perm(r.org_id, 'roles:manage')));

-- ── 7. memberships and vehicle assignments: were open to every member ──────
-- va_admin_all let ANY member insert/update/delete vehicle assignments, so a driver could
-- grant themselves access to any vehicle. memberships were readable by every member.
drop policy if exists va_admin_all on vehicle_assignments;
drop policy if exists va_select on vehicle_assignments;
drop policy if exists va_write on vehicle_assignments;
create policy va_select on vehicle_assignments for select to authenticated
  using (user_id = auth.uid() or has_perm_all(org_id, 'assignments:read'));
create policy va_write on vehicle_assignments for all to authenticated
  using (has_perm_all(org_id, 'assignments:update'))
  with check (has_perm_all(org_id, 'assignments:update'));

drop policy if exists memberships_select_member on memberships;
drop policy if exists memberships_select on memberships;
drop policy if exists memberships_admin_write on memberships;
do $$ declare pol record; begin
  for pol in select policyname from pg_policies where schemaname = 'public' and tablename = 'memberships' loop
    execute format('drop policy if exists %I on memberships', pol.policyname);
  end loop;
end $$;
create policy memberships_select on memberships for select to authenticated
  using (user_id = auth.uid() or has_perm_all(org_id, 'team:read'));
create policy memberships_insert on memberships for insert to authenticated
  with check (has_perm_all(org_id, 'team:create'));
create policy memberships_update on memberships for update to authenticated
  using (has_perm_all(org_id, 'team:update')) with check (has_perm_all(org_id, 'team:update'));
create policy memberships_delete on memberships for delete to authenticated
  using (has_perm_all(org_id, 'team:delete'));

-- ── 8. two functions that anyone could call ────────────────────────────────
-- sync_fleet_from_blob(p_owner, p_data) is SECURITY DEFINER with no caller check and was
-- executable by the anonymous role: anyone holding the public key could overwrite any
-- owner's organisation settings. It is only ever invoked by the fleets trigger.
revoke execute on function sync_fleet_from_blob(uuid, jsonb) from public, anon, authenticated;
revoke execute on function team_roster(uuid) from public, anon;

-- ── 9. audit trail ─────────────────────────────────────────────────────────
create table if not exists audit_log (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  org_id     uuid,
  actor      uuid,
  actor_role text,
  action     text not null,          -- INSERT | UPDATE | DELETE
  table_name text not null,
  row_id     text,
  old_data   jsonb,
  new_data   jsonb
);
create index if not exists idx_audit_org_at on audit_log(org_id, at desc);
create index if not exists idx_audit_table  on audit_log(table_name, at desc);
alter table audit_log enable row level security;
drop policy if exists audit_read on audit_log;
create policy audit_read on audit_log for select to authenticated using (org_id is not null and has_perm_all(org_id, 'audit:read'));
-- insert-only: rows are written by the trigger below; nobody edits or deletes the trail
revoke all on audit_log from anon, authenticated;
grant select on audit_log to authenticated;

create or replace function fw_audit() returns trigger language plpgsql security definer set search_path = public as $$
declare
  o jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  n jsonb := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  src jsonb := coalesce(n, o);
  v_org uuid; v_role text;
  secret text[] := array['bank_account','bank_ifsc','upi_id','token','link_token','api_key','password','secret'];
  k text;
begin
  v_org := nullif(src ->> 'org_id', '')::uuid;
  if v_org is null and tg_table_name = 'rbac_role_permissions' then
    select r.org_id into v_org from rbac_roles r where r.id = (src ->> 'role_id')::uuid;
  end if;
  if v_org is null and tg_table_name = 'organizations' then v_org := (src ->> 'id')::uuid; end if;
  foreach k in array secret loop
    if o ? k then o := o || jsonb_build_object(k, '[redacted]'); end if;
    if n ? k then n := n || jsonb_build_object(k, '[redacted]'); end if;
  end loop;
  select r.key into v_role from memberships m join rbac_roles r on r.id = m.role_id
   where m.user_id = auth.uid() and m.org_id = v_org limit 1;
  insert into audit_log(org_id, actor, actor_role, action, table_name, row_id, old_data, new_data)
  values (v_org, auth.uid(), v_role, tg_op, tg_table_name, src ->> 'id', o, n);
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  -- Who can do what, and money that moves: every change is recorded.
  foreach t in array array['memberships','rbac_roles','rbac_role_permissions','vehicle_assignments',
                           'salary_payments','payment_requests','driver_payout_details','drivers'] loop
    execute format('drop trigger if exists trg_audit_%1$s on %1$I', t);
    execute format('create trigger trg_audit_%1$s after insert or update or delete on %1$I for each row execute function fw_audit()', t);
  end loop;
  -- High-volume tables: only changes and removals.
  foreach t in array array['driver_ledger','expenses','vehicles'] loop
    execute format('drop trigger if exists trg_audit_%1$s on %1$I', t);
    execute format('create trigger trg_audit_%1$s after update or delete on %1$I for each row execute function fw_audit()', t);
  end loop;
end $$;

grant select on rbac_permissions, rbac_roles, rbac_role_permissions to authenticated;
grant insert, update, delete on rbac_roles, rbac_role_permissions to authenticated;
grant execute on function my_permissions(uuid), my_role(uuid), has_perm(uuid, text), has_perm_all(uuid, text) to authenticated;
revoke execute on function rbac_user_scope(uuid, uuid, text) from public, anon, authenticated;
