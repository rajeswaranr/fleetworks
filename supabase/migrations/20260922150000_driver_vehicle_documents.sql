-- Drivers can open the documents (and files) of the vehicles they are assigned:
-- RC, insurance, permit and the like. Read-only, assigned vehicles only; the
-- storage rule (rbac_vdoc_ok) and the documents table policy both follow this grant.
insert into rbac_role_permissions(role_id, permission, scope)
select r.id, 'documents:read', 'assigned' from rbac_roles r where r.org_id is null and r.key = 'driver'
on conflict (role_id, permission) do update set scope = excluded.scope;
