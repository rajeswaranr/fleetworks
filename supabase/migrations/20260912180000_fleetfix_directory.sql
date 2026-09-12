-- ============ FleetWorks — FleetFix: the workshop directory ============
--
-- FleetFix is the aggregator half of the product: find an outside garage, book
-- it, and track the job to invoice. FleetOps already owns work a fleet manages
-- itself — job cards, service reminders, its own workshop — so the distinction
-- this module draws is "someone else's bay".
--
-- ---------- The chicken and egg ----------
-- workshops_read let an owner see a workshop only if they already owned it, or
-- already had a service_request with it. So the directory could never be
-- browsed: you could only see the garages you had already booked, which is
-- precisely the information you do not need. Discovery was impossible by
-- construction.
--
-- An active workshop has opted into the platform and is advertising for work.
-- Its name, city, phone, trades and rating are listing data — that is the point
-- of being listed. So any signed-in member may read active rows.

drop policy if exists workshops_directory on workshops;
create policy workshops_directory on workshops for select to authenticated
  using (active = true);

-- ---------- But not every column ----------
-- RLS is row-level, so the policy above exposes the whole row including gstin
-- and owner_user. A fleet looking for a mechanic has no business with the
-- workshop's tax registration or the uuid of its proprietor's login. The
-- directory view carries listing columns only, and security_invoker keeps the
-- policy above in force rather than bypassing it.

create or replace view v_workshop_directory
with (security_invoker = true) as
select
  w.id, w.name, w.city, w.address, w.lat, w.lng, w.phone,
  w.services, w.rating, w.active,
  -- Jobs already completed through the platform. A rating with no volume behind
  -- it is a number somebody typed; this is the one an owner should weigh.
  (select count(*) from service_requests r
    where r.workshop_id = w.id and r.stage in ('closed','paid','reported')) as jobs_done
from workshops w
where w.active = true;

grant select on v_workshop_directory to authenticated;

comment on view v_workshop_directory is
  'Bookable partner workshops. Listing columns only — gstin and owner_user stay '
  'out, since a fleet looking for a mechanic has no business with either.';

-- ---------- Distance ----------
-- Nearest-first is the only ordering that matters when a truck is stopped. Same
-- haversine as the geofence check, kept as its own function so the directory and
-- any future dispatch logic agree on what "12 km away" means.

create or replace function workshop_distance_km(
  p_workshop uuid, p_lat numeric, p_lng numeric
) returns numeric
language sql stable set search_path = public as $$
  select round((6371 * 2 * asin(sqrt(
           power(sin(radians(p_lat - w.lat) / 2), 2)
           + cos(radians(w.lat)) * cos(radians(p_lat))
           * power(sin(radians(p_lng - w.lng) / 2), 2)
         )))::numeric, 1)
    from workshops w
   where w.id = p_workshop and w.lat is not null and w.lng is not null;
$$;

-- ---------- Promoting a lead into a partner ----------
-- vendor_leads holds businesses scraped from maps for the sales pipeline. They
-- have NOT agreed to anything, and their phone numbers and emails came from a
-- listing, not from them. Showing them to fleet owners as bookable partners
-- would have owners ringing garages that never signed up.
--
-- So promotion is explicit, admin-only, and one row at a time. A lead becomes a
-- workshop when somebody has actually onboarded it.

create or replace function promote_lead_to_workshop(p_lead uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_lead record;
begin
  if not coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false) then
    raise exception 'only FleetWorks admins can onboard a workshop';
  end if;

  select * into v_lead from vendor_leads where id = p_lead;
  if not found then raise exception 'lead not found'; end if;
  if not coalesce(v_lead.verified, false) then
    raise exception 'lead % has not been verified — verify it before onboarding', p_lead;
  end if;

  insert into workshops (name, city, address, lat, lng, phone, services, rating, active)
  values (v_lead.business_name, v_lead.city, v_lead.address,
          v_lead.latitude, v_lead.longitude, v_lead.phone,
          array[coalesce(v_lead.service_category, 'mechanic')],
          v_lead.rating, true)
  returning id into v_id;

  update vendor_leads set status = 'converted' where id = p_lead;
  return v_id;
end;
$$;

revoke execute on function promote_lead_to_workshop(uuid) from public, anon;
grant execute on function promote_lead_to_workshop(uuid) to authenticated;

comment on function promote_lead_to_workshop(uuid) is
  'Admin-only, one lead at a time, and only once verified. Scraped leads have '
  'not agreed to anything — listing them as bookable partners would have fleet '
  'owners ringing garages that never signed up.';
