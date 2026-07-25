-- ============ FleetWorks — Payment Approvals (owner-UPI flow) ============
-- Run once in Supabase SQL Editor. Idempotent. Independent of Cashfree —
-- works before/without schema-payroll.sql (approving logs into
-- salary_payments only if that table exists).
--
-- A payment_request is a queued salary payment awaiting the owner's
-- approval. The approval itself happens on the owner's phone: "Approve &
-- Pay" opens the owner's own UPI app pre-filled with the driver's UPI and
-- amount, and the owner authorises with their UPI PIN. FleetWorks never
-- touches the money — it orchestrates the queue and keeps the books.

create table if not exists payment_requests (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  driver_ext_id text not null,          -- matches drivers.ext_id / local driver id
  amount        numeric not null check (amount > 0),
  period        text,                    -- e.g. "2026-07"
  note          text,
  status        text not null default 'pending'
                check (status in ('pending','paid','rejected')),
  utr           text,                    -- UPI ref captured at approval time (optional)
  requested_by  uuid,                    -- auth.uid() of whoever queued it
  decided_at    timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists idx_payreq_org    on payment_requests(org_id);
create index if not exists idx_payreq_status on payment_requests(org_id, status);

alter table payment_requests enable row level security;
drop policy if exists org_members_all_payment_requests on payment_requests;
create policy org_members_all_payment_requests on payment_requests
  for all to authenticated
  using (is_org_member(org_id)) with check (is_org_member(org_id));
grant select, insert, update, delete on payment_requests to authenticated;

-- Verify after running:
--   select column_name from information_schema.columns where table_name = 'payment_requests' order by 1;
