-- ============ FleetWorks — driver location from the phone ============
-- Live position without hardware. The driver already carries a GPS: the phone
-- running the team portal. With consent it reports coordinates while on duty,
-- which closes the biggest gap against telematics platforms at zero capex and
-- keeps the "no hardware to fit" promise on the landing page.
--
-- This is NOT a replacement for a fitted tracker. A phone can be left in the
-- cab, run out of battery, or lose signal, and the driver can revoke permission
-- at any time — so accuracy and staleness are stored alongside every point
-- rather than implied, and the UI must show when a position is old rather than
-- drawing a confident dot on a map.
--
-- CONSENT IS EXPLICIT AND WITHDRAWABLE. Tracking a person's location is
-- personal data under the DPDP Act 2023: it needs purpose-limited consent,
-- recorded, and revocable. share_location on the driver row is that switch, and
-- the insert policy refuses points when it is off — the check lives in the
-- database, not only in the app that is asking for the fix.

alter table drivers add column if not exists share_location boolean not null default false;
alter table drivers add column if not exists location_consent_at timestamptz;

create table if not exists driver_locations (
  id            bigserial primary key,
  org_id        uuid not null references organizations(id) on delete cascade,
  driver_id     uuid not null references drivers(id) on delete cascade,
  vehicle_id    uuid references vehicles(id) on delete set null,
  latitude      numeric not null,
  longitude     numeric not null,
  -- Metres of uncertainty as reported by the device. A 2,000 m fix from a cell
  -- tower and a 5 m GPS fix are not the same claim, and a map that draws them
  -- identically is lying.
  accuracy_m    numeric,
  speed_kmph    numeric,
  heading       numeric,
  battery_pct   int,
  source        text not null default 'phone'
                check (source in ('phone','device','manual')),
  recorded_at   timestamptz not null default now(),
  created_at    timestamptz not null default now()
);
create index if not exists idx_dloc_driver_time on driver_locations(driver_id, recorded_at desc);
create index if not exists idx_dloc_org_time on driver_locations(org_id, recorded_at desc);

alter table driver_locations enable row level security;

-- Owner sees the fleet; a driver sees only their own trail. Same rule as the
-- khata and attendance, and for the same reason.
drop policy if exists dloc_select on driver_locations;
create policy dloc_select on driver_locations for select to authenticated
  using (is_org_admin(org_id) or is_my_driver_row(driver_id));

-- A driver posts only their own points, and only while consent is on. The
-- database enforces the switch so revoking consent stops collection even if a
-- stale app build keeps trying.
drop policy if exists dloc_insert on driver_locations;
create policy dloc_insert on driver_locations for insert to authenticated
  with check (
    is_my_driver_row(driver_id)
    and exists (select 1 from drivers d where d.id = driver_id and d.share_location)
  );

-- Points are never edited. A corrected location is a new point; rewriting one
-- would make the trail unusable as a record of where a vehicle actually was.
drop policy if exists dloc_delete on driver_locations;
create policy dloc_delete on driver_locations for delete to authenticated
  using (is_org_admin(org_id));

grant select, insert, delete on driver_locations to authenticated;
grant usage, select on sequence driver_locations_id_seq to authenticated;

-- Location is high-frequency and low-value once stale, so it ages out faster
-- than telemetry. Reuses the per-org retention pattern already established.
alter table organizations
  add column if not exists location_retention_days int not null default 30;

comment on column organizations.location_retention_days is
  'Driver location points older than this are purged. 0 disables purging.';

create or replace function purge_driver_locations(p_batch int default 20000)
returns bigint
language plpgsql security definer set search_path = public as $$
declare v_n bigint := 0; v_uid uuid := auth.uid();
begin
  if v_uid is null then return 0; end if;
  with mine as (select org_id from memberships where user_id = v_uid),
  doomed as (
    select l.id from driver_locations l
      join organizations o on o.id = l.org_id
     where l.org_id in (select org_id from mine)
       and o.location_retention_days > 0
       and l.recorded_at < now() - (o.location_retention_days || ' days')::interval
     limit p_batch
  )
  delete from driver_locations l using doomed d where l.id = d.id;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function purge_driver_locations(int) from public;
revoke execute on function purge_driver_locations(int) from anon;
grant execute on function purge_driver_locations(int) to authenticated;

-- Verify after running:
--   select driver_id, count(*), max(recorded_at) from driver_locations group by 1;
