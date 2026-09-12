-- ============ FleetWorks — FleetInsure ============
--
-- A fleet carries four different covers and they are usually held by four
-- different people in four different drawers:
--
--   vehicle    — the motor policy. Comprehensive or third-party, per truck.
--   driver     — personal accident / group cover for the men, per driver.
--   cargo      — goods in transit. Per consignment or an open annual policy.
--   liability  — public liability, the one nobody thinks about until a truck
--                hits something that is not another truck.
--
-- ---------- On not duplicating the motor policy expiry ----------
-- vehicles.insurance_till already drives the Compliance Radar, and the radar is
-- what actually stops a truck being seized at a check post. This table does NOT
-- replace that date. It holds the detail the radar never had — insurer, policy
-- number, IDV, premium, NCB — and expiry is mirrored back to the radar by the
-- trigger below so there is exactly one date a driver can be stopped for, not
-- two that disagree.

create table if not exists insurance_policies (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  policy_type   text not null check (policy_type in ('vehicle','driver','cargo','liability')),

  -- Exactly one subject, enforced below. A cargo or liability policy covers the
  -- business rather than a numbered asset, so both stay null for those.
  vehicle_id    uuid references vehicles(id) on delete cascade,
  driver_id     uuid references drivers(id) on delete cascade,

  insurer       text,
  policy_no     text,
  cover_type    text,  -- comprehensive / third-party / group PA / open GIT / CGL
  sum_insured   numeric check (sum_insured is null or sum_insured >= 0),
  premium       numeric check (premium is null or premium >= 0),
  -- Motor-specific, null for the other three.
  idv           numeric,
  ncb_percent   numeric check (ncb_percent is null or ncb_percent between 0 and 100),
  deductible    numeric,

  start_date    date,
  expiry_date   date,
  status        text not null default 'active'
                  check (status in ('active','expired','lapsed','cancelled')),
  -- The scan lives in the same private bucket as everything else a fleet
  -- photographs; only the path is stored.
  document_path text,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- A vehicle policy needs a vehicle; a driver policy needs a driver; cargo and
  -- liability cover the business and must name neither. Without this a
  -- mis-typed row silently becomes an org-wide policy nobody can find.
  constraint insurance_subject_matches_type check (
    (policy_type = 'vehicle'   and vehicle_id is not null and driver_id is null)
    or (policy_type = 'driver' and driver_id is not null and vehicle_id is null)
    or (policy_type in ('cargo','liability') and vehicle_id is null and driver_id is null)
  )
);
create index if not exists idx_inspol_org     on insurance_policies(org_id, policy_type, expiry_date);
create index if not exists idx_inspol_vehicle on insurance_policies(vehicle_id);
create index if not exists idx_inspol_driver  on insurance_policies(driver_id);

create or replace function set_inspol_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end;
$$;
drop trigger if exists trg_inspol_updated_at on insurance_policies;
create trigger trg_inspol_updated_at
  before update on insurance_policies for each row execute function set_inspol_updated_at();

-- Keep the Compliance Radar honest. A motor policy renewed in FleetInsure has
-- to move the date the radar reads, or an owner sees "renewed" on one screen
-- and "expired" on another and stops trusting both.
create or replace function sync_vehicle_insurance_expiry()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.policy_type = 'vehicle' and new.vehicle_id is not null
     and new.expiry_date is not null and new.status = 'active' then
    update vehicles v
       set insurance_till = new.expiry_date
     where v.id = new.vehicle_id
       -- Only move it forward. A back-dated historical policy being entered
       -- must not drag a live expiry backwards.
       and (v.insurance_till is null or v.insurance_till < new.expiry_date);
  end if;
  return new;
end;
$$;
drop trigger if exists trg_sync_vehicle_insurance on insurance_policies;
create trigger trg_sync_vehicle_insurance
  after insert or update of expiry_date, status on insurance_policies
  for each row execute function sync_vehicle_insurance_expiry();

alter table insurance_policies enable row level security;

-- Premiums and sums insured are commercial terms, so this is owner/manager
-- only rather than vehicle-scoped. A supervisor has no reason to see what the
-- fleet pays to insure a truck.
drop policy if exists inspol_all on insurance_policies;
create policy inspol_all on insurance_policies for all to authenticated
  using (is_org_admin(org_id)) with check (is_org_admin(org_id));

grant select, insert, update, delete on insurance_policies to authenticated;

comment on table insurance_policies is
  'Vehicle, driver, cargo and public-liability cover. Motor expiry is mirrored '
  'into vehicles.compliance by trigger so the Compliance Radar stays the single '
  'date a truck can be stopped for — this table adds the detail, not a rival date.';

-- ---------- Claims ----------
-- A policy without its claims history is half a record: claims are what decides
-- next year's premium and whether a renewal is offered at all.

create table if not exists insurance_claims (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id) on delete cascade,
  policy_id    uuid references insurance_policies(id) on delete set null,
  vehicle_id   uuid references vehicles(id) on delete set null,
  driver_id    uuid references drivers(id) on delete set null,
  claim_no     text,
  incident_date date,
  reported_date date,
  description  text,
  claimed_amount  numeric check (claimed_amount is null or claimed_amount >= 0),
  approved_amount numeric check (approved_amount is null or approved_amount >= 0),
  status       text not null default 'intimated'
                 check (status in ('intimated','surveyor_assigned','documents_pending',
                                   'approved','settled','rejected','withdrawn')),
  surveyor     text,
  settled_date date,
  document_path text,
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists idx_insclaim_org    on insurance_claims(org_id, status, incident_date desc);
create index if not exists idx_insclaim_policy on insurance_claims(policy_id);

drop trigger if exists trg_insclaim_updated_at on insurance_claims;
create trigger trg_insclaim_updated_at
  before update on insurance_claims for each row execute function set_inspol_updated_at();

alter table insurance_claims enable row level security;

drop policy if exists insclaim_all on insurance_claims;
create policy insclaim_all on insurance_claims for all to authenticated
  using (is_org_admin(org_id)) with check (is_org_admin(org_id));

grant select, insert, update, delete on insurance_claims to authenticated;

-- ---------- What is expiring, across all four covers ----------
-- One list, because an owner asks "what lapses this month" and does not care
-- which of the four drawers the paper came from.

create or replace view v_insurance_radar
with (security_invoker = true) as
select
  p.id, p.org_id, p.policy_type, p.insurer, p.policy_no, p.cover_type,
  p.sum_insured, p.premium, p.expiry_date, p.status,
  p.vehicle_id, p.driver_id,
  coalesce(v.name, d.name, initcap(p.policy_type) || ' policy') as subject,
  (p.expiry_date - current_date) as days_left,
  case
    when p.status <> 'active'                     then 'inactive'
    when p.expiry_date is null                    then 'no_expiry_set'
    when p.expiry_date < current_date             then 'expired'
    when p.expiry_date <= current_date + 30       then 'expiring'
    else 'ok'
  end as radar_state
from insurance_policies p
left join vehicles v on v.id = p.vehicle_id
left join drivers  d on d.id = p.driver_id;

grant select on v_insurance_radar to authenticated;

comment on view v_insurance_radar is
  'All four covers in one expiry list. An owner asks what lapses this month, '
  'not which drawer the paper came from.';
