-- ============================================================================
-- RBAC enforcement: every table is authorised through the role tables.
-- ============================================================================
--
-- rbac_table_registry says, for each table, which permission resource guards it and
-- which columns tie a row to an organisation, a vehicle or a driver. rbac_apply() reads
-- the registry and builds the row-level-security policies:
--
--   SELECT  rbac_scope(org, 'resource:read')    => all | assigned | own | (nothing = denied)
--   INSERT  rbac_scope(org, 'resource:create')
--   UPDATE  rbac_scope(org, 'resource:update')
--   DELETE  rbac_scope(org, 'resource:delete')
--
--   all       -> allowed
--   assigned  -> the row's vehicle is assigned to the user (write needs 'update' access)
--   own       -> the row belongs to the user's own driver record
--
-- Change what a role can do by editing rbac_role_permissions; the policies do not change.
-- A table that is not in the registry has no grants for the API and is unreachable.
-- Safe to re-run.

create table if not exists rbac_table_registry (
  table_name      text primary key,
  mode            text not null check (mode in ('generated','custom','platform','rbac')),
  resource        text,                    -- permission resource, for generated tables
  org_col         text not null default 'org_id',
  vehicle_col     text,                    -- column holding a vehicles.id ('id' on vehicles itself)
  driver_col      text,                    -- column holding a drivers.id ('id' on drivers itself)
  driver_ext_col  text,                    -- column holding a drivers.ext_id
  uid_col         text,                    -- column holding the auth user that owns the row
  assigned_sql    text,                    -- extra condition for the 'assigned' scope; {W} = is a write
  own_sql         text,                    -- extra condition for the 'own' scope
  scoped_write_sql text,                   -- extra condition ANDed on create/update when scope is not 'all'
  extra_read_sql  text,                    -- other principals allowed to read (e.g. the partner workshop)
  extra_update_sql text,                   -- other principals allowed to update
  actions         text[],                  -- default: read, create, update, delete
  notes           text
);

-- ── helpers for the site/project tables ───────────────────────────────────
-- sites, projects, project_sites and site_vehicle_assignments consult each other
-- in their scoped rules. Written inline that is a policy cycle (Postgres refuses
-- it as "infinite recursion"), so each lookup goes through a definer function
-- that reads the base table without re-entering the policies.
create or replace function rbac_site_supervised(p_site uuid) returns boolean
language sql stable security definer set search_path = public as $f$
  select exists (select 1 from sites s where s.id = p_site and s.supervisor_user_id = auth.uid());
$f$;
create or replace function rbac_project_supervised(p_project uuid) returns boolean
language sql stable security definer set search_path = public as $f$
  select exists (select 1 from project_sites ps join sites s on s.id = ps.site_id
                  where ps.project_id = p_project and s.supervisor_user_id = auth.uid());
$f$;
create or replace function rbac_site_vehicle_mine(p_site uuid) returns boolean
language sql stable security definer set search_path = public as $f$
  select exists (select 1 from site_vehicle_assignments a
                   join vehicles v on v.id = a.vehicle_id
                   join vehicle_assignments va on va.org_id = v.org_id and va.vehicle_ext_id = v.ext_id and va.user_id = auth.uid()
                  where a.site_id = p_site and a.removed_date is null);
$f$;

-- ── registry: tables guarded by permission resources ───────────────────────
insert into rbac_table_registry(table_name, mode, resource, vehicle_col, driver_col, driver_ext_col, uid_col, assigned_sql, scoped_write_sql, extra_read_sql, extra_update_sql, actions, org_col) values
 ('assets','generated','assets','towed_by_vehicle_id',null,null,null,null,null,null,null,null,'org_id'),
 ('automation_rules','generated','automation',null,null,null,null,null,null,null,null,null,'org_id'),
 ('automation_runs','generated','automation',null,null,null,null,null,null,null,null,null,'org_id'),
 ('bill_reviews','generated','bill_review',null,null,null,null,null,null,null,null,null,'org_id'),
 ('coaching_meetings','generated','safety',null,'driver_id',null,null,null,null,null,null,null,'org_id'),
 ('coaching_sessions','generated','safety','vehicle_id','driver_id',null,null,null,null,null,null,null,'org_id'),
 ('cold_chain_analytics','generated','coldchain','vehicle_id',null,null,null,null,null,null,null,null,'org_id'),
 ('cold_chain_compliance','generated','coldchain','vehicle_id',null,null,null,null,null,null,null,null,'org_id'),
 ('cold_chain_config','generated','coldchain',null,null,null,null,null,null,null,null,null,'org_id'),
 ('cold_chain_vehicles','generated','coldchain','vehicle_id',null,null,null,null,null,null,null,null,'org_id'),
 ('daily_dispatch','generated','dispatch','vehicle_id',null,null,null,
   '(supervisor_user_id = auth.uid() or exists (select 1 from sites s where s.id = daily_dispatch.site_id and s.supervisor_user_id = auth.uid()))',null,null,null,null,'org_id'),
 ('device_events','generated','devices',null,null,null,null,null,null,null,null,null,'org_id'),
 ('devices','generated','devices','vehicle_id',null,null,null,null,null,null,null,null,'org_id'),
 ('documents','generated','documents','vehicle_id','driver_id',null,null,null,null,null,null,null,'org_id'),
 ('driver_attendance','generated','attendance','vehicle_id','driver_id',null,null,null,
   $s$(source = 'driver')$s$,null,null,null,'org_id'),
 ('driver_documents','generated','driver_documents',null,'driver_id',null,null,null,
   $s$(submitted_by = 'driver')$s$,null,null,null,'org_id'),
 ('driver_ledger','generated','ledger',null,'driver_id',null,null,null,
   $s$(type in ('advance','expense'))$s$,null,null,null,'org_id'),
 ('driver_locations','generated','driver_locations','vehicle_id','driver_id',null,null,null,null,null,null,null,'org_id'),
 ('driver_payout_details','generated','payroll_setup',null,null,'driver_ext_id',null,null,null,null,null,null,'org_id'),
 ('drivers','generated','drivers','vehicle_id','id',null,null,null,null,null,null,null,'org_id'),
 ('eway_bills','generated','gst',null,null,null,null,null,null,null,null,null,'org_id'),
 ('expense_categories','generated','expense_categories',null,null,null,null,null,null,null,null,null,'org_id'),
 ('expense_change_requests','generated','expense_requests','vehicle_id',null,null,'requested_by',null,
   $s$(requested_by = auth.uid())$s$,null,null,null,'org_id'),
 ('expenses','generated','expenses','vehicle_id',null,null,null,null,null,null,null,null,'org_id'),
 ('fastag_accounts','generated','fastag','vehicle_id',null,null,null,null,null,null,null,null,'org_id'),
 ('fastag_balance_log','generated','fastag',null,null,null,null,null,null,null,null,null,'org_id'),
 ('fuel_alerts','generated','fuel_intel',null,null,null,null,null,null,null,null,null,'org_id'),
 ('fuel_consumption_baseline','generated','fuel_intel','vehicle_id',null,null,null,null,null,null,null,null,'org_id'),
 ('fuel_logs','generated','fuel','vehicle_id',null,null,null,null,null,null,null,null,'org_id'),
 ('fuel_trips','generated','fuel_intel','vehicle_id','driver_id',null,null,null,null,null,null,null,'org_id'),
 ('geofence_events','generated','geofences','vehicle_id','driver_id',null,null,null,null,null,null,null,'org_id'),
 ('geofences','generated','geofences',null,null,null,null,null,null,null,null,null,'org_id'),
 ('gst_audit_logs','generated','gst',null,null,null,null,null,null,null,null,null,'org_id'),
 ('gst_configuration','generated','gst',null,null,null,null,null,null,null,null,null,'org_id'),
 ('gst_invoices','generated','gst','vehicle_id','driver_id',null,null,null,null,null,null,null,'org_id'),
 ('gst_settlement_summary','generated','gst',null,null,null,null,null,null,null,null,null,'org_id'),
 ('inspections','generated','inspections','vehicle_id',null,null,null,null,null,null,null,null,'org_id'),
 ('insurance_claims','generated','insurance','vehicle_id','driver_id',null,null,null,null,null,null,null,'org_id'),
 ('insurance_policies','generated','insurance','vehicle_id','driver_id',null,null,null,null,null,null,null,'org_id'),
 ('issues','generated','issues','vehicle_id',null,null,null,null,null,null,null,null,'org_id'),
 ('items','generated','catalog',null,null,null,null,null,null,null,null,null,'org_id'),
 ('parties','generated','parties',null,null,null,null,null,null,null,null,null,'org_id'),
 ('parts','generated','parts',null,null,null,null,null,null,null,null,null,'org_id'),
 ('payment_requests','generated','payroll_requests',null,null,'driver_ext_id','requested_by',null,null,null,null,null,'org_id'),
 ('project_sites','generated','projects',null,null,null,null,
   'rbac_site_supervised(project_sites.site_id)',null,null,null,null,'org_id'),
 ('projects','generated','projects',null,null,null,null,
   'rbac_project_supervised(projects.id)',null,null,null,null,'org_id'),
 ('purchase_order_lines','generated','purchasing',null,null,null,null,null,null,null,null,null,'org_id'),
 ('purchase_orders','generated','purchasing','vehicle_id',null,null,null,null,null,null,null,null,'org_id'),
 ('reminders','generated','reminders','vehicle_id',null,null,null,null,null,null,null,null,'org_id'),
 ('safety_event_weights','generated','safety',null,null,null,null,null,null,'(org_id is null)',null,null,'org_id'),
 ('salary_payments','generated','payroll',null,null,'driver_ext_id',null,null,null,null,null,null,'org_id'),
 ('sales_invoice_lines','generated','invoices',null,null,null,null,null,null,null,null,null,'org_id'),
 ('sales_invoices','generated','invoices','vehicle_id',null,null,null,null,null,null,null,null,'org_id'),
 ('service_requests','generated','service_requests','vehicle_id',null,null,null,null,null,
   'is_workshop_user(workshop_id)','is_workshop_user(workshop_id)',null,'org_id'),
 ('site_staff_assignments','generated','assignments',null,null,null,null,
   'rbac_site_supervised(site_staff_assignments.site_id)',null,null,null,null,'org_id'),
 ('site_vehicle_assignments','generated','assignments','vehicle_id',null,null,null,
   'rbac_site_supervised(site_vehicle_assignments.site_id)',null,null,null,null,'org_id'),
 ('sites','generated','sites',null,null,null,null,
   '(supervisor_user_id = auth.uid() or rbac_site_vehicle_mine(sites.id))',null,null,null,null,'org_id'),
 ('telemetry','generated','telemetry',null,null,null,null,null,null,null,null,null,'org_id'),
 ('temperature_readings','generated','coldchain','vehicle_id',null,null,null,null,null,null,null,null,'org_id'),
 ('temperature_violations','generated','coldchain','vehicle_id',null,null,null,null,null,null,null,null,'org_id'),
 ('tire_ai_predictions','generated','tyres','vehicle_id',null,null,null,null,null,null,null,null,'org_id'),
 ('tire_analytics','generated','tyres',null,null,null,null,null,null,null,null,null,'org_id'),
 ('tire_anomalies','generated','tyres','vehicle_id',null,null,null,null,null,null,null,null,'org_id'),
 ('tire_fleet_analytics','generated','tyres',null,null,null,null,null,null,null,null,null,'org_id'),
 ('tire_maintenance_logs','generated','tyres','vehicle_id',null,null,null,null,null,null,null,null,'org_id'),
 ('tire_pressure_readings','generated','tyres','vehicle_id',null,null,null,null,null,null,null,null,'org_id'),
 ('tire_registry','generated','tyres','current_vehicle_id',null,null,null,null,null,null,null,null,'org_id'),
 ('trip_expenses','generated','trip_expenses','vehicle_id','driver_id',null,null,null,
   $s$(status = 'submitted')$s$,null,null,null,'org_id'),
 ('trip_requests','generated','trip_requests',null,null,null,null,
   '(exists (select 1 from trips t where t.id = trip_requests.trip_id and rbac_vehicle_ok(t.org_id, t.vehicle_id, {W})))',null,null,null,null,'org_id'),
 ('trips','generated','trips','vehicle_id','driver_id',null,null,null,null,null,null,null,'org_id'),
 ('tyre_fitments','generated','tyres','vehicle_id',null,null,null,null,null,null,null,null,'org_id'),
 ('tyre_readings','generated','tyres','vehicle_id',null,null,null,null,null,null,null,null,'org_id'),
 ('tyres','generated','tyres',null,null,null,null,null,null,null,null,null,'org_id'),
 ('vehicle_op_statuses','generated','dispatch','vehicle_id',null,null,null,null,null,null,null,null,'org_id'),
 ('vehicle_telemetry','generated','telemetry','vehicle_id',null,null,null,null,null,null,null,null,'org_id'),
 ('vehicles','generated','vehicles','id',null,null,null,null,null,null,null,null,'org_id'),
 ('whatsapp_contacts','generated','whatsapp',null,'driver_id',null,null,null,null,null,null,null,'org_id'),
 ('whatsapp_messages','generated','whatsapp',null,null,null,null,null,null,null,null,null,'org_id'),
 ('work_order_lines','generated','work_orders',null,null,null,null,
   '(exists (select 1 from work_orders w where w.id = work_order_lines.work_order_id and rbac_vehicle_ok(w.org_id, w.vehicle_id, {W})))',null,null,null,null,'org_id'),
 ('work_orders','generated','work_orders','vehicle_id',null,null,null,null,null,null,null,null,'org_id'),
 ('workshop_complaints','generated','service_requests',null,null,null,null,null,null,
   'is_workshop_user(workshop_id)',null,null,'org_id')
on conflict (table_name) do update set
  mode = excluded.mode, resource = excluded.resource, vehicle_col = excluded.vehicle_col, driver_col = excluded.driver_col,
  driver_ext_col = excluded.driver_ext_col, uid_col = excluded.uid_col, assigned_sql = excluded.assigned_sql,
  scoped_write_sql = excluded.scoped_write_sql, extra_read_sql = excluded.extra_read_sql,
  extra_update_sql = excluded.extra_update_sql, actions = excluded.actions, org_col = excluded.org_col;

-- the organisation row itself: readable by its members, changeable by whoever holds org:update
insert into rbac_table_registry(table_name, mode, resource, org_col, actions, notes) values
 ('organizations','generated','org','id', array['read','update'],'organisations are created by the owner-signup function, never through the API')
on conflict (table_name) do update set mode = excluded.mode, resource = excluded.resource, org_col = excluded.org_col, actions = excluded.actions;

-- RBAC and audit tables (policies written in the core migration)
insert into rbac_table_registry(table_name, mode, notes) values
 ('rbac_permissions','rbac','read-only catalogue'), ('rbac_roles','rbac','roles:manage'), ('rbac_role_permissions','rbac','roles:manage'),
 ('memberships','rbac','team:*'), ('vehicle_assignments','rbac','assignments:*'), ('audit_log','rbac','audit:read, insert-only via trigger'),
 ('rbac_table_registry','rbac','service role only')
on conflict (table_name) do nothing;

-- Tables that are not organisation data and keep hand-written policies. Each is either
-- platform staff only, a public form, or part of the partner-workshop marketplace.
insert into rbac_table_registry(table_name, mode, notes) values
 ('admin_password_resets','platform','FleetWorks staff only'),
 ('leads','platform','public form insert; staff read/update'),
 ('vendor_applications','platform','public form insert; staff, plus the applicant''s own row'),
 ('vendor_leads','platform','FleetWorks staff only'),
 ('scraper_configs','platform','FleetWorks staff only'),
 ('scraper_runs','platform','FleetWorks staff only'),
 ('staff_members','platform','FleetWorks staff only'),
 ('service_advisors','platform','FleetWorks staff only'),
 ('vendor_payments','platform','staff plus the payee'),
 ('vendor_payout_details','platform','staff plus the payee'),
 ('whatsapp_templates','platform','global message templates, read-only to signed-in users'),
 ('insurance_quotes','platform','public form insert; staff read'),
 ('fleets','custom','the owner''s own settings blob (owner_id = auth.uid())'),
 ('driver_entries','custom','no-login driver link: insert only, owner reads'),
 ('workshops','custom','partner workshop marketplace'), ('mechanics','custom','partner workshop marketplace'),
 ('payout_cycles','custom','partner workshop marketplace'), ('payout_lines','custom','partner workshop marketplace'),
 ('request_assignments','custom','service workflow'), ('estimates','custom','service workflow'),
 ('estimate_items','custom','service workflow'), ('assessments','custom','service workflow'),
 ('attachments','custom','service workflow'), ('work_logs','custom','service workflow'),
 ('work_reports','custom','service workflow'), ('status_events','custom','service workflow'),
 ('invoices','custom','service workflow'), ('payments','custom','service workflow'),
 ('feedback','custom','service workflow'), ('trip_events','custom','trip audit trail')
on conflict (table_name) do nothing;

-- ── the generator ──────────────────────────────────────────────────────────
create or replace function rbac_apply(p_table text) returns void language plpgsql as $$
declare
  r rbac_table_registry;
  pol record;
  act text; cmd text; perm text; w boolean;
  org text; parts text[]; asg text; own text; expr text; restrict_sql text;
begin
  select * into r from rbac_table_registry where table_name = p_table and mode = 'generated';
  if not found then raise exception 'table % is not registered as generated', p_table; end if;

  -- Replace every policy except ones for the anonymous role (those belong to the
  -- driver-link migration and are written by hand).
  for pol in select policyname from pg_policies
              where schemaname = 'public' and tablename = p_table and not ('anon' = any(roles)) loop
    execute format('drop policy %I on %I', pol.policyname, p_table);
  end loop;
  execute format('alter table %I enable row level security', p_table);

  org := quote_ident(r.org_col);
  foreach act in array coalesce(r.actions, array['read','create','update','delete']) loop
    w := (act <> 'read');
    perm := r.resource || ':' || act;

    parts := array[]::text[];
    if r.vehicle_col is not null then
      parts := parts || format('rbac_vehicle_ok(%s, %s, %L)', org, quote_ident(r.vehicle_col), w);
    end if;
    if r.assigned_sql is not null then
      parts := parts || replace(r.assigned_sql, '{W}', w::text);
    end if;
    asg := case when cardinality(parts) = 0 then 'false' else array_to_string(parts, ' or ') end;

    parts := array[]::text[];
    if r.driver_col is not null then parts := parts || format('is_my_driver_row(%s)', quote_ident(r.driver_col)); end if;
    if r.driver_ext_col is not null then parts := parts || format('is_my_driver_ext(%s, %s)', org, quote_ident(r.driver_ext_col)); end if;
    if r.uid_col is not null then parts := parts || format('%s = auth.uid()', quote_ident(r.uid_col)); end if;
    if r.own_sql is not null then parts := parts || r.own_sql; end if;
    own := case when cardinality(parts) = 0 then 'false' else array_to_string(parts, ' or ') end;

    restrict_sql := case when act in ('create','update') and r.scoped_write_sql is not null
                         then ' and ' || r.scoped_write_sql else '' end;

    expr := format('case rbac_scope(%s, %L) when ''all'' then true when ''assigned'' then ((%s)%s) when ''own'' then ((%s)%s) else false end',
                   org, perm, asg, restrict_sql, own, restrict_sql);
    if act = 'read' and r.extra_read_sql is not null then expr := format('(%s) or (%s)', expr, r.extra_read_sql); end if;
    if act = 'update' and r.extra_update_sql is not null then expr := format('(%s) or (%s)', expr, r.extra_update_sql); end if;

    cmd := case act when 'read' then 'select' when 'create' then 'insert' when 'update' then 'update' else 'delete' end;
    if cmd = 'insert' then
      execute format('create policy %I on %I for insert to authenticated with check (%s)', 'rbac_' || act, p_table, expr);
    elsif cmd = 'update' then
      execute format('create policy %I on %I for update to authenticated using (%s) with check (%s)', 'rbac_' || act, p_table, expr, expr);
    else
      execute format('create policy %I on %I for %s to authenticated using (%s)', 'rbac_' || act, p_table, cmd, expr);
    end if;
  end loop;
end $$;

-- apply to every generated table
do $$ declare t text; begin
  for t in select table_name from rbac_table_registry where mode = 'generated' order by 1 loop
    perform rbac_apply(t);
  end loop;
end $$;

-- ── platform tables: staff only, or the applicant's own application ────────
-- leads / vendor_applications were readable (and, for applications, editable) by ANY signed-in
-- user, including a customer's driver: they are FleetWorks-internal.
drop policy if exists auth_read_leads on leads;
drop policy if exists leads_staff_read on leads;
create policy leads_staff_read on leads for select to authenticated using (is_platform_admin());

-- 20260722100000 adds this column but the live table never received it (the database drifted from
-- the migration files), which broke the partner portal's own-application lookup.
alter table vendor_applications add column if not exists owner_id uuid references auth.users(id);
create index if not exists idx_vendor_applications_owner on vendor_applications(owner_id);

drop policy if exists auth_read_vendor_applications on vendor_applications;
drop policy if exists vendor_apps_own_insert on vendor_applications;
drop policy if exists auth_update_vendor_applications on vendor_applications;
drop policy if exists vendor_apps_staff_all on vendor_applications;
drop policy if exists vendor_apps_own_read on vendor_applications;
drop policy if exists vendor_apps_claim on vendor_applications;
create policy vendor_apps_staff_all on vendor_applications for all to authenticated
  using (is_platform_admin()) with check (is_platform_admin());
create policy vendor_apps_own_read on vendor_applications for select to authenticated
  using (owner_id = auth.uid()
         or (owner_id is null and lower(email) = lower(auth.jwt() ->> 'email')));
create policy vendor_apps_own_insert on vendor_applications for insert to authenticated
  with check (owner_id = auth.uid() or owner_id is null);
-- an applicant can attach an ownerless application to themselves, matched on their verified email
create policy vendor_apps_claim on vendor_applications for update to authenticated
  using (owner_id is null and lower(email) = lower(auth.jwt() ->> 'email'))
  with check (owner_id = auth.uid());

-- ── telemetry views ran with the owner's rights and were granted to the anonymous role ──
do $$ declare v text; begin
  foreach v in array array['vehicle_telemetry_latest','vehicle_telemetry_hourly','vehicle_telemetry_daily',
                           'vehicles_low_fuel','telemetry_speeding_alerts','fleet_vehicle_stats',
                           'v_drivers','v_expense_details','v_expenses','v_fuel_logs','v_issues','v_vehicles'] loop
    if to_regclass('public.' || v) is not null then
      execute format('alter view %I set (security_invoker = true)', v);
    end if;
  end loop;
end $$;

-- ── privileges: deny by default ────────────────────────────────────────────
-- Supabase grants every new table to the anonymous and signed-in roles. Row-level security was
-- then the ONLY barrier, and 114 tables were reachable by anyone holding the public key. Now
-- nothing is granted unless a table is registered here, and future tables start with no access.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon;
do $$ begin
  begin
    execute 'alter default privileges for role supabase_admin in schema public revoke all on tables from anon, authenticated';
    execute 'alter default privileges for role supabase_admin in schema public revoke execute on functions from public, anon';
  exception when insufficient_privilege then null; end;
end $$;

-- signed-in users: table access is decided by the policies above
do $$ declare t text; begin
  for t in select table_name from rbac_table_registry
            where mode in ('generated','custom','platform') and to_regclass('public.' || table_name) is not null loop
    execute format('grant select, insert, update, delete on %I to authenticated', t);
  end loop;
end $$;
grant select on rbac_permissions, rbac_roles, rbac_role_permissions to authenticated;
grant insert, update, delete on rbac_roles, rbac_role_permissions to authenticated;
grant select, insert, update, delete on memberships, vehicle_assignments to authenticated;
grant select on audit_log to authenticated;

-- signed-in read access to the reporting views (they run with the caller's own rights)
do $$ declare v text; begin
  for v in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind = 'v'
              and coalesce((select 'security_invoker=true' = any(c.reloptions)), false) loop
    execute format('grant select on %I to authenticated', v);
  end loop;
end $$;

-- the anonymous role keeps exactly what the public website and the no-login driver link need
grant insert on leads, insurance_quotes, vendor_applications, driver_entries to anon;
grant select, insert, update on driver_attendance, driver_documents, trip_expenses, trip_requests to anon;
grant select on trips, geofences, coaching_meetings, salary_payments to anon;
grant select, update on coaching_sessions to anon;
grant select on v_driver_pay_summary, v_driver_expense_summary, v_workshop_directory to anon;

-- ── functions: callable only by whoever needs them ─────────────────────────
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
revoke execute on function rbac_user_scope(uuid, uuid, text) from authenticated;
revoke execute on function sync_fleet_from_blob(uuid, jsonb) from authenticated;
revoke execute on function rbac_apply(text) from authenticated;
grant execute on function check_application_status(text) to anon;
-- helpers the anonymous driver-link policies call
grant execute on function is_my_driver_row(uuid), rbac_scope(uuid, text) to anon;

-- ── lint: proves the rules hold; the test-suite and CI call it ─────────────
create or replace function rbac_lint() returns table(problem text, detail text)
language sql stable security definer set search_path = public as $$
  -- a public table nobody registered
  select 'unregistered table', c.relname::text
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and c.relname not in (select table_name from rbac_table_registry)
  union all
  -- row-level security off
  select 'row-level security disabled', c.relname::text
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
  union all
  -- a generated table carrying a policy that is not from the generator (anonymous link policies excepted)
  select 'hand-written policy on generated table', p.tablename || '.' || p.policyname
    from pg_policies p join rbac_table_registry g on g.table_name = p.tablename and g.mode = 'generated'
   where p.schemaname = 'public' and p.policyname not like 'rbac\_%' and not ('anon' = any(p.roles))
  union all
  -- writes open to any organisation member, or to everyone
  select 'write policy open to any member or to everyone', p.tablename || '.' || p.policyname
    from pg_policies p
   where p.schemaname = 'public' and p.cmd in ('ALL','INSERT','UPDATE','DELETE')
     and regexp_replace(coalesce(p.qual,'') || ' ' || coalesce(p.with_check,''), '(then true|, true\))', '', 'gi') ~* '(is_org_member\(|(^|[^a-z_])true([^a-z_]|$))'
     and not ('anon' = any(p.roles) and p.tablename in ('leads','insurance_quotes','vendor_applications'))
     and p.policyname <> 'rbac_roles_select'
     and not (p.roles::text ~ 'authenticated' and p.tablename = 'insurance_quotes')
  union all
  -- the anonymous role can touch a table outside the public-form / driver-link allowlist
  select 'anonymous access outside the allowlist', c.relname::text
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r','v')
     and has_table_privilege('anon', c.oid, 'select,insert,update,delete')
     and c.relname not in ('leads','insurance_quotes','vendor_applications','driver_entries','driver_attendance','driver_documents',
                           'trip_expenses','trip_requests','trips','geofences','coaching_meetings','coaching_sessions','salary_payments',
                           'v_driver_pay_summary','v_driver_expense_summary','v_workshop_directory')
  union all
  -- a definer view that ignores the caller's rights but is readable
  select 'view bypasses row-level security', c.relname::text
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'v'
     and not coalesce((select 'security_invoker=true' = any(c.reloptions)), false)
     and (has_table_privilege('anon', c.oid, 'select') or has_table_privilege('authenticated', c.oid, 'select'))
  union all
  -- a role holding a permission that does not exist, or an owner-only permission on a custom role
  select 'owner-only permission on a custom role', r.key || ' -> ' || rp.permission
    from rbac_role_permissions rp join rbac_roles r on r.id = rp.role_id join rbac_permissions p on p.key = rp.permission
   where r.org_id is not null and p.owner_only
$$;
revoke execute on function rbac_lint() from public, anon;
grant execute on function rbac_lint() to authenticated;

revoke all on rbac_table_registry from anon, authenticated;
alter table rbac_table_registry enable row level security;
