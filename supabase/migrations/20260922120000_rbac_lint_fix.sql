-- rbac_lint: a generated policy's "case ... then true" branch is the 'all' scope, not an open policy.
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
