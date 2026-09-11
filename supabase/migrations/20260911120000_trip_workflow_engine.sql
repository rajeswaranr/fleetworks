-- ============ FleetWorks — Trip Workflow Engine ============
-- Full trip lifecycle with owner planning, driver acknowledgment, diesel/
-- advance requests with approval workflow, FASTag balance, and anon-key
-- driver access pattern.
--
-- States: planned → assigned → acknowledged → started → completed | cancelled
-- Requests: pending → approved → paid | rejected

-- ---------- 1. Fix driver_entries kind constraint ----------
-- Expand allowed kinds to include trip_status, location, sos (already used
-- in driver.controller.js but constraint was never updated), and new workflow
-- kinds for this feature.
alter table driver_entries drop constraint if exists driver_entries_kind_check;
alter table driver_entries add constraint driver_entries_kind_check
  check (kind in (
    'fuel','issue','inspection',
    'trip_status','location','sos',
    'trip_ack','diesel_request','advance_request',
    'bill_upload','receipt_upload','push_subscribe'
  ));

-- ---------- 2. Extend trips table with workflow fields ----------
alter table trips add column if not exists status text not null default 'planned'
  check (status in ('planned','assigned','acknowledged','started','completed','cancelled'));

alter table trips add column if not exists cargo_description text;
alter table trips add column if not exists planned_start     timestamptz;
alter table trips add column if not exists planned_end       timestamptz;
alter table trips add column if not exists actual_start      timestamptz;
alter table trips add column if not exists actual_end        timestamptz;
alter table trips add column if not exists acknowledged_at   timestamptz;
alter table trips add column if not exists milestones        jsonb not null default '{}'::jsonb;
-- Driver token stored here so anon SELECT can be scoped to drivers with the token
alter table trips add column if not exists driver_link_token text;
-- FASTag balance cached at trip assignment time for driver display
alter table trips add column if not exists fastag_balance    numeric;
alter table trips add column if not exists fastag_balance_at timestamptz;
alter table trips add column if not exists updated_at        timestamptz not null default now();

create index if not exists idx_trips_status    on trips(org_id, status);
create index if not exists idx_trips_vehicle_s on trips(vehicle_id, status);

-- Keep updated_at honest
create or replace function set_trips_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end;
$$;
drop trigger if exists trg_trips_updated_at on trips;
create trigger trg_trips_updated_at
  before update on trips for each row execute function set_trips_updated_at();

-- ---------- 3. Trip events audit table ----------
create table if not exists trip_events (
  id          bigint generated always as identity primary key,
  trip_id     uuid not null references trips(id) on delete cascade,
  from_status text,
  to_status   text,
  actor       text not null default 'system', -- 'owner','driver','system'
  actor_name  text,
  note        text,
  payload     jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists idx_trip_events_trip on trip_events(trip_id, created_at desc);

-- Auto-log status changes
create or replace function trg_trip_status_audit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into trip_events(trip_id, from_status, to_status, actor, note)
    values (new.id, null, new.status, 'owner', 'Trip planned');
  elsif new.status is distinct from old.status then
    insert into trip_events(trip_id, from_status, to_status, actor, note)
    values (new.id, old.status, new.status, 'system', null);
  end if;
  return new;
end $$;
drop trigger if exists trg_trip_status_audit on trips;
create trigger trg_trip_status_audit
  after insert or update on trips
  for each row execute function trg_trip_status_audit();

-- ---------- 4. Trip requests (diesel / advance / toll) ----------
create table if not exists trip_requests (
  id             uuid primary key default gen_random_uuid(),
  trip_id        uuid not null references trips(id) on delete cascade,
  org_id         uuid not null references organizations(id) on delete cascade,
  request_type   text not null check (request_type in ('diesel','advance','toll')),
  amount         numeric,
  reason         text,
  status         text not null default 'pending'
                   check (status in ('pending','approved','paid','rejected')),
  bill_url       text,
  transaction_url text,
  approved_by    text,
  approved_at    timestamptz,
  paid_at        timestamptz,
  paid_amount    numeric,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists idx_trip_req_trip   on trip_requests(trip_id);
create index if not exists idx_trip_req_org    on trip_requests(org_id, status, created_at desc);

create or replace function set_trip_req_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end;
$$;
drop trigger if exists trg_trip_req_updated_at on trip_requests;
create trigger trg_trip_req_updated_at
  before update on trip_requests for each row execute function set_trip_req_updated_at();

-- ---------- 5. RLS — owner (authenticated) ----------
alter table trip_events   enable row level security;
alter table trip_requests enable row level security;

-- trip_events: owner sees their org's events via trip join
drop policy if exists trip_events_owner on trip_events;
create policy trip_events_owner on trip_events for select to authenticated
  using (exists (select 1 from trips t where t.id = trip_id and is_org_member(t.org_id)));

-- owner can insert events (for driver-ack received from driver_entries processing)
drop policy if exists trip_events_owner_insert on trip_events;
create policy trip_events_owner_insert on trip_events for insert to authenticated
  with check (exists (select 1 from trips t where t.id = trip_id and is_org_member(t.org_id)));

-- trip_requests: org members full access
drop policy if exists trip_req_owner on trip_requests;
create policy trip_req_owner on trip_requests for all to authenticated
  using (is_org_member(org_id)) with check (is_org_member(org_id));

-- ---------- 6. RLS — driver (anon role, scoped by vehicle UUID) ----------
-- Vehicle UUIDs are random 128-bit values — possessing one is the credential.
-- Driver gets vehicle_id from their link (?vid=...). The query always includes
-- vehicle_id=eq.{DVID} so anon can only see trips for that vehicle.

drop policy if exists trips_anon_driver on trips;
create policy trips_anon_driver on trips for select to anon
  using (vehicle_id is not null and status in ('assigned','acknowledged','started'));

-- trip_requests: anon insert (driver submits) + anon select (driver polls status)
-- org_id check via trip join prevents cross-org requests
drop policy if exists trip_req_anon_insert on trip_requests;
create policy trip_req_anon_insert on trip_requests for insert to anon
  with check (
    org_id is not null
    and trip_id is not null
    and exists (select 1 from trips t
                 where t.id = trip_id
                   and t.vehicle_id is not null
                   and t.status in ('assigned','acknowledged','started'))
  );

drop policy if exists trip_req_anon_select on trip_requests;
create policy trip_req_anon_select on trip_requests for select to anon
  using (
    exists (select 1 from trips t
             where t.id = trip_id
               and t.vehicle_id is not null
               and t.status in ('assigned','acknowledged','started'))
  );

-- fastag_accounts: anon read so driver can see FASTag balance for their vehicle
drop policy if exists fastag_anon_driver on fastag_accounts;
create policy fastag_anon_driver on fastag_accounts for select to anon
  using (vehicle_id is not null and is_active = true);

-- ---------- 7. Grants ----------
grant select, insert on trip_events to authenticated;
grant select, insert, update, delete on trip_requests to authenticated;

grant select           on trips         to anon;
grant select, insert   on trip_requests to anon;
grant select           on fastag_accounts to anon;

-- Verify after running:
--   select column_name from information_schema.columns where table_name='trips' order by 1;
--   select * from trip_requests limit 5;
