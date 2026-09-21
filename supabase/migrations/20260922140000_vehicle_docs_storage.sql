-- Vehicle document files (RC, insurance, permit, PUC ... scans and photos).
-- Private bucket; objects live at  <org_id>/<vehicle_id>/<file>.
-- Who may read or write follows the RBAC tables, not the folder owner:
--   read   documents:read   — 'all' scope, or 'assigned' scope on that vehicle
--   write  documents:create / update / delete with the 'all' scope
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('vehicle-docs', 'vehicle-docs', false, 10485760, array['application/pdf','image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create or replace function rbac_vdoc_ok(p_path text, p_perm text) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when p_path !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.+' then false
    else case rbac_scope(split_part(p_path, '/', 1)::uuid, p_perm)
           when 'all' then true
           when 'assigned' then p_perm = 'documents:read' and rbac_vehicle_ok(split_part(p_path, '/', 1)::uuid, split_part(p_path, '/', 2)::uuid, false)
           else false end
  end
$$;
revoke execute on function rbac_vdoc_ok(text, text) from public, anon;
grant execute on function rbac_vdoc_ok(text, text) to authenticated;

drop policy if exists vdocs_read on storage.objects;
create policy vdocs_read on storage.objects for select to authenticated
  using (bucket_id = 'vehicle-docs' and rbac_vdoc_ok(name, 'documents:read'));
drop policy if exists vdocs_insert on storage.objects;
create policy vdocs_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'vehicle-docs' and rbac_vdoc_ok(name, 'documents:create'));
drop policy if exists vdocs_update on storage.objects;
create policy vdocs_update on storage.objects for update to authenticated
  using (bucket_id = 'vehicle-docs' and rbac_vdoc_ok(name, 'documents:update'))
  with check (bucket_id = 'vehicle-docs' and rbac_vdoc_ok(name, 'documents:update'));
drop policy if exists vdocs_delete on storage.objects;
create policy vdocs_delete on storage.objects for delete to authenticated
  using (bucket_id = 'vehicle-docs' and rbac_vdoc_ok(name, 'documents:delete'));
