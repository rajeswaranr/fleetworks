-- Link existing driver logins to their driver business record where the match
-- is unambiguous. New invitations perform an explicit link in team-invite.

create unique index if not exists idx_drivers_one_login
  on drivers(user_id) where user_id is not null;

-- First choice: the name entered during invitation exactly matches one driver
-- in the same organization.
with matches as (
  select m.user_id, min(d.id) as driver_id
  from memberships m
  join auth.users u on u.id = m.user_id
  join drivers d on d.org_id = m.org_id and d.user_id is null
    and lower(trim(d.name)) = lower(trim(coalesce(u.raw_user_meta_data->>'full_name', '')))
  where m.role = 'driver'
  group by m.user_id
  having count(*) = 1
)
update drivers d set user_id = matches.user_id
from matches where d.id = matches.driver_id;

-- Fallback: the login's assigned vehicles resolve to exactly one unlinked
-- driver record in the organization.
with matches as (
  select m.user_id, min(d.id) as driver_id
  from memberships m
  join vehicle_assignments va on va.org_id = m.org_id and va.user_id = m.user_id
  join vehicles v on v.org_id = va.org_id and v.ext_id = va.vehicle_ext_id
  join drivers d on d.org_id = m.org_id and d.vehicle_id = v.id and d.user_id is null
  where m.role = 'driver'
    and not exists (select 1 from drivers linked where linked.user_id = m.user_id)
  group by m.user_id
  having count(distinct d.id) = 1
)
update drivers d set user_id = matches.user_id
from matches where d.id = matches.driver_id;
