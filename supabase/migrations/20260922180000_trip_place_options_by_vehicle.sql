-- Loading / unloading suggestions follow the project the vehicle is deployed to
-- (site_vehicle_assignments). A BPCL tanker sees the BPCL places, an IOCL tanker
-- the IOCL ones. A vehicle with no deployment still sees every place it may use.
drop function if exists trip_place_options();
create or replace function trip_place_options(p_vehicle uuid default null)
returns table(site_id uuid, name text, location text, site_role text, project_name text)
language sql stable security definer set search_path = public as $$
  with mine as (
    select coalesce(a.project_id, ps.project_id) as project_id
      from site_vehicle_assignments a
      left join project_sites ps on ps.site_id = a.site_id and a.project_id is null
     where p_vehicle is not null and a.vehicle_id = p_vehicle and a.removed_date is null
       and rbac_vehicle_ok(a.org_id, a.vehicle_id, false)
  )
  select s.id, s.name, s.location, ps.site_role, p.name
    from project_sites ps
    join sites s    on s.id = ps.site_id
    join projects p on p.id = ps.project_id
   where ps.site_role in ('loading', 'unloading', 'both')
     and s.status is distinct from 'closed'
     and has_perm(ps.org_id, 'trips:create')
     and (not exists (select 1 from mine where project_id is not null) or ps.project_id in (select project_id from mine))
   order by p.name, s.name
$$;
revoke execute on function trip_place_options(uuid) from public, anon;
grant execute on function trip_place_options(uuid) to authenticated;
