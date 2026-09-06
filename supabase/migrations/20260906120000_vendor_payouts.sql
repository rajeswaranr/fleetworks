-- ============ FleetWorks — Vendor (workshop/garage) payout tables ============
-- Garage partners register their bank account or UPI ID once; FleetWorks admin
-- triggers the fortnightly payout via the vendor-payout edge function.
--
-- Raw account numbers are NEVER stored here. The vendor-add-beneficiary edge
-- function forwards them once to Cashfree and stores only:
--   • the Cashfree beneficiary_id
--   • a masked display string (last-4 / masked UPI)
--   • the GSTIN (public identifier — safe to store)
--
-- Garage identity: auth.users.id — every garage logs in with their own
-- Supabase auth account (garage.html partner login).

-- ========================= 1. PAYOUT DETAILS (masked) =========================

create table if not exists vendor_payout_details (
  id                  uuid primary key default gen_random_uuid(),
  garage_user_id      uuid not null references auth.users(id) on delete cascade,
  method              text not null check (method in ('bank','upi')),
  account_holder_name text,
  bank_ifsc           text,
  bank_account_last4  text,
  upi_id_masked       text,
  cf_beneficiary_id   text not null,
  beneficiary_status  text not null default 'pending',
  gstin               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (garage_user_id)
);

alter table vendor_payout_details enable row level security;

-- Garage owner sees only their own row; no insert/update from client — written
-- only by the vendor-add-beneficiary edge function (service role).
drop policy if exists vendor_pd_own_select on vendor_payout_details;
create policy vendor_pd_own_select on vendor_payout_details for select to authenticated
  using (auth.uid() = garage_user_id
      or coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false));

drop policy if exists vendor_pd_own_delete on vendor_payout_details;
create policy vendor_pd_own_delete on vendor_payout_details for delete to authenticated
  using (auth.uid() = garage_user_id);

grant select, delete on vendor_payout_details to authenticated;

-- ========================= 2. VENDOR PAYMENT LEDGER =========================

create table if not exists vendor_payments (
  id              uuid primary key default gen_random_uuid(),
  garage_user_id  uuid not null references auth.users(id),
  period          text,              -- fortnightly cycle start, e.g. "2026-09-01"
  gross_amount    numeric not null check (gross_amount > 0),
  platform_fee    numeric not null default 0,
  amount          numeric not null check (amount > 0),   -- gross - fee = what lands in bank
  method          text,
  status          text not null default 'pending'
                  check (status in ('pending','processing','success','failed','reversed')),
  transfer_ref    text not null,
  cf_transfer_id  text,
  utr             text,
  failure_reason  text,
  notes           text,
  initiated_by    uuid references auth.users(id),
  initiated_at    timestamptz not null default now(),
  completed_at    timestamptz,
  unique (transfer_ref)
);

create index if not exists idx_vendor_payments_garage on vendor_payments(garage_user_id);
create index if not exists idx_vendor_payments_status on vendor_payments(status);

alter table vendor_payments enable row level security;

-- Garage sees their own rows; admin sees all. Insert/update only via service role.
drop policy if exists vendor_payments_own_select on vendor_payments;
create policy vendor_payments_own_select on vendor_payments for select to authenticated
  using (auth.uid() = garage_user_id
      or coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false));

grant select on vendor_payments to authenticated;

-- Verify after running:
--   select * from vendor_payout_details limit 5;
--   select * from vendor_payments order by initiated_at desc limit 5;
