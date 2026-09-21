-- Loading / unloading places for the trip forms. Drivers cannot read the sites table
-- (it carries contract rates and client details), so this returns only the place
-- names, their role and the project, for organisations where the caller may log trips.
create or replace function trip_place_options()
returns table(site_id uuid, name text, location text, site_role text, project_name text)
language sql stable security definer set search_path = public as $$
  select s.id, s.name, s.location, ps.site_role, p.name
    from project_sites ps
    join sites s    on s.id = ps.site_id
    join projects p on p.id = ps.project_id
   where ps.site_role in ('loading', 'unloading', 'both')
     and s.status is distinct from 'closed'
     and has_perm(ps.org_id, 'trips:create')
   order by p.name, s.name
$$;
revoke execute on function trip_place_options() from public, anon;
grant execute on function trip_place_options() to authenticated;
