-- ============ FleetWorks — Payroll: driver bank/UPI payouts via Cashfree ============
-- Run in Supabase SQL Editor AFTER db/schema-team-access.sql. Idempotent.
--
-- Deliberately does NOT store raw bank account numbers or full UPI IDs.
-- The owner's browser sends them once to the payroll-add-beneficiary edge
-- function, which forwards them straight to Cashfree and gets back a
-- beneficiary_id — that id (plus a masked display string) is all this
-- database ever holds. All writes to both tables below happen through
-- service-role edge functions, never directly from the client, so the
-- payout ledger can't be forged or edited after the fact.
--
-- ext_id note: driver_payout_details/salary_payments key on the driver's
-- blob-stable ext_id, not drivers.id — sync_fleet_from_blob() deletes and
-- re-inserts every driver row on each save (same reason vehicle_assignments
-- in schema-team-access.sql keys on vehicle ext_id, not vehicles.id).

create or replace function is_org_admin(p_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false)
    or exists (select 1 from memberships m where m.org_id = p_org and m.user_id = auth.uid() and m.role in ('owner','manager'));
$$;

-- ========================= 1. PAYOUT DETAILS (masked) =========================

create table if not exists driver_payout_details (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references organizations(id) on delete cascade,
  driver_ext_id       text not null,
  method              text not null check (method in ('bank','upi')),
  account_holder_name text,
  bank_ifsc           text,
  bank_account_last4  text,
  upi_id_masked       text,
  cf_beneficiary_id   text not null,
  beneficiary_status  text not null default 'pending',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (org_id, driver_ext_id)
);
create index if not exists idx_payout_details_org on driver_payout_details(org_id);

alter table driver_payout_details enable row level security;
drop policy if exists payout_details_admin_select on driver_payout_details;
create policy payout_details_admin_select on driver_payout_details for select to authenticated
  using (is_org_admin(org_id));
drop policy if exists payout_details_admin_delete on driver_payout_details;
create policy payout_details_admin_delete on driver_payout_details for delete to authenticated
  using (is_org_admin(org_id));
-- No insert/update policy for `authenticated` — rows are only ever written
-- by payroll-add-beneficiary (service role), which never receives the org's
-- write privileges through RLS at all, by design.
grant select, delete on driver_payout_details to authenticated;

-- ========================= 2. PAYMENT LEDGER =========================

create table if not exists salary_payments (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(id) on delete cascade,
  driver_ext_id  text not null,
  period         text,                 -- e.g. "2026-07"
  amount         numeric not null check (amount > 0),
  method         text,
  status         text not null default 'pending' check (status in ('pending','processing','success','failed','reversed')),
  transfer_ref   text not null,        -- our transfer_id sent to Cashfree
  cf_transfer_id text,                 -- Cashfree's own reference
  utr            text,
  failure_reason text,
  notes          text,
  initiated_by   uuid references auth.users(id),
  initiated_at   timestamptz not null default now(),
  completed_at   timestamptz,
  unique (org_id, transfer_ref)
);
create index if not exists idx_salary_payments_org    on salary_payments(org_id);
create index if not exists idx_salary_payments_driver on salary_payments(org_id, driver_ext_id);

alter table salary_payments enable row level security;
drop policy if exists salary_payments_admin_select on salary_payments;
create policy salary_payments_admin_select on salary_payments for select to authenticated
  using (is_org_admin(org_id));
-- Read-only ledger from the client's perspective — insert happens in
-- payroll-transfer, status updates happen in payroll-webhook, both service role.
grant select on salary_payments to authenticated;

-- Verify after running:
--   select * from driver_payout_details limit 5;
--   select * from salary_payments order by initiated_at desc limit 5;
