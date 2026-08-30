-- ============ FleetWorks — driver attendance ============
-- Not office attendance. A truck driver's day is present, on a trip, resting
-- between loads, on leave, or absent — and for the daily- and trip-basis
-- drivers this fleet already supports, attendance IS the wage calculation:
-- days present times the daily rate. Without it, a daily-wage driver's pay is
-- typed from memory at the end of the month.
--
-- One row per driver per day, enforced. Two records for the same date is not a
-- correction, it is an argument, and the unique constraint makes an update the
-- only way to change a day.
--
-- `source` matters more than it looks. A day marked by the owner, self-marked
-- by the driver in the portal, replied over WhatsApp, or INFERRED from a trip
-- the driver logged are four different levels of evidence, and a payroll
-- dispute turns on which one it was.

create table if not exists driver_attendance (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations(id) on delete cascade,
  driver_id       uuid not null references drivers(id) on delete cascade,
  attendance_date date not null,
  status          text not null default 'present'
                  check (status in ('present','on_trip','rest','leave','absent','half_day')),
  -- Which truck they were on. Useful for a fleet where drivers move between
  -- vehicles, and it is how attendance reconciles against the trip log.
  vehicle_id      uuid references vehicles(id) on delete set null,
  hours           numeric,
  note            text,
  source          text not null default 'owner'
                  check (source in ('owner','supervisor','driver','whatsapp','auto_trip')),
  marked_by       uuid references auth.users(id),
  marked_at       timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  unique (org_id, driver_id, attendance_date)
);
create index if not exists idx_att_driver_date on driver_attendance(driver_id, attendance_date desc);
create index if not exists idx_att_org_date on driver_attendance(org_id, attendance_date desc);

alter table driver_attendance enable row level security;

-- Owners see and manage the whole fleet's attendance. A driver sees only their
-- own, and may mark only their own day — the same shape as the khata rule, and
-- for the same reason: one person's record is nobody else's business.
drop policy if exists att_select on driver_attendance;
create policy att_select on driver_attendance for select to authenticated
  using (is_org_admin(org_id) or is_my_driver_row(driver_id));

drop policy if exists att_insert on driver_attendance;
create policy att_insert on driver_attendance for insert to authenticated
  with check (is_org_admin(org_id) or is_my_driver_row(driver_id));

-- Correcting a day stays with the owner. A driver who could rewrite yesterday
-- could rewrite a month of it before payday.
drop policy if exists att_update on driver_attendance;
create policy att_update on driver_attendance for update to authenticated
  using (is_org_admin(org_id)) with check (is_org_admin(org_id));

drop policy if exists att_delete on driver_attendance;
create policy att_delete on driver_attendance for delete to authenticated
  using (is_org_admin(org_id));

grant select, insert, update, delete on driver_attendance to authenticated;

-- Days worked in a period, which is what a daily- or trip-basis wage is
-- actually multiplied by. Half days count as half; rest, leave and absent
-- count as nothing. Returned as a table so payroll can show the breakdown
-- rather than just the total — an owner querying a wage wants to see which
-- days, not a number.
create or replace function driver_days_worked(p_driver uuid, p_from date, p_to date)
returns table (days_worked numeric, present int, half int, on_trip int, rest int, leave_days int, absent int)
language sql stable security definer set search_path = public as $$
  select
    coalesce(sum(case a.status
      when 'present'  then 1
      when 'on_trip'  then 1
      when 'half_day' then 0.5
      else 0 end), 0)::numeric                        as days_worked,
    count(*) filter (where a.status = 'present')::int  as present,
    count(*) filter (where a.status = 'half_day')::int as half,
    count(*) filter (where a.status = 'on_trip')::int  as on_trip,
    count(*) filter (where a.status = 'rest')::int     as rest,
    count(*) filter (where a.status = 'leave')::int    as leave_days,
    count(*) filter (where a.status = 'absent')::int   as absent
  from driver_attendance a
  join drivers d on d.id = a.driver_id
  where a.driver_id = p_driver
    and a.attendance_date between p_from and p_to
    -- Definer function: it must check for itself that the caller is entitled to
    -- this driver's record, because RLS does not apply inside it.
    and (is_org_admin(a.org_id) or is_my_driver_row(a.driver_id));
$$;

revoke all on function driver_days_worked(uuid, date, date) from public;
revoke execute on function driver_days_worked(uuid, date, date) from anon;
grant execute on function driver_days_worked(uuid, date, date) to authenticated;

-- Verify after running:
--   select * from driver_days_worked('<driver-uuid>', '2026-08-01', '2026-08-31');
