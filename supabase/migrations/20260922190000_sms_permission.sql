-- Sending SMS costs money and reaches real people, so it gets its own permission
-- instead of "any signed-in user". Owners and managers hold it; custom roles can be given it.
insert into rbac_permissions(key, resource, action, description, owner_only)
values ('sms:create', 'sms', 'create', 'Send SMS alerts to drivers and staff', false)
on conflict (key) do nothing;

insert into rbac_role_permissions(role_id, permission, scope)
select r.id, 'sms:create', 'all' from rbac_roles r
 where r.org_id is null and r.key in ('owner', 'manager')
on conflict (role_id, permission) do update set scope = excluded.scope;
