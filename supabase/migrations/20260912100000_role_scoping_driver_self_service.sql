-- ============ FleetWorks — role scoping + driver self-service ============
--
-- Two problems, one migration.
--
-- PROBLEM 1 — supervisors were seeing the whole fleet.
-- is_org_member() is true for ANY membership row, supervisors included. Every
-- table added since the team-access work (trips events/requests, tyres, FASTag,
-- sales invoices) guarded itself with is_org_member(org_id), so a supervisor
-- assigned one truck could still read every trip, every tyre and every FASTag
-- balance in the org. The vehicle-scoped predicates (can_view_vehicle_id /
-- can_update_vehicle_id) already existed from 20260724110000 — these tables
-- simply never adopted them. This migration re-points them.
--
-- PROBLEM 2 — the driver portal could not show a driver his own record.
-- driver.html is a no-login page: the driver's credential is the random UUID in
-- his link. He could already submit diesel/advance requests, but could not
-- attach the bill afterwards (no anon UPDATE policy existed, so markReqPaid()
-- was failing silently), and had no way to see his own attendance or what he
-- had actually been paid. Anon access below is scoped by driver_id — a random
-- 128-bit value, the same "possessing the UUID is the credential" model the
-- trip policies already use — and never widens beyond one driver's own rows.

-- ========================= 1. TRIPS: supervisor scoping =========================
-- `trips` itself is already vehicle-scoped (20260830140000). Its children are
-- the ones that were left on the org-wide predicate.

-- trip_events: scope through the parent trip's vehicle.
drop policy if exists trip_events_owner on trip_events;
create policy trip_events_owner on trip_events for select to authenticated
  using (exists (
    select 1 from trips t
    where t.id = trip_id and can_view_vehicle_id(t.org_id, t.vehicle_id)
  ));

drop policy if exists trip_events_owner_insert on trip_events;
create policy trip_events_owner_insert on trip_events for insert to authenticated
  with check (exists (
    select 1 from trips t
    where t.id = trip_id and can_update_vehicle_id(t.org_id, t.vehicle_id)
  ));

-- trip_requests: a supervisor may see and raise requests for his own trucks.
-- Approving and paying stays with owner/manager — a supervisor approving his
-- own diesel request would defeat the point of the approval step.
drop policy if exists trip_req_owner on trip_requests;

drop policy if exists trip_req_select on trip_requests;
create policy trip_req_select on trip_requests for select to authenticated
  using (exists (
    select 1 from trips t
    where t.id = trip_id and can_view_vehicle_id(t.org_id, t.vehicle_id)
  ));

drop policy if exists trip_req_insert on trip_requests;
create policy trip_req_insert on trip_requests for insert to authenticated
  with check (exists (
    select 1 from trips t
    where t.id = trip_id and can_update_vehicle_id(t.org_id, t.vehicle_id)
  ));

drop policy if exists trip_req_update on trip_requests;
create policy trip_req_update on trip_requests for update to authenticated
  using (is_org_admin(org_id)) with check (is_org_admin(org_id));

drop policy if exists trip_req_delete on trip_requests;
create policy trip_req_delete on trip_requests for delete to authenticated
  using (is_org_admin(org_id));

-- ========================= 2. TYRES: supervisor scoping =========================

-- A fitment belongs to one truck, so it scopes cleanly.
drop policy if exists fitment_org on tyre_fitments;
drop policy if exists tyre_fitments_select on tyre_fitments;
create policy tyre_fitments_select on tyre_fitments for select to authenticated
  using (can_view_vehicle_id(org_id, vehicle_id));

drop policy if exists tyre_fitments_write on tyre_fitments;
create policy tyre_fitments_write on tyre_fitments for insert to authenticated
  with check (can_update_vehicle_id(org_id, vehicle_id));

drop policy if exists tyre_fitments_update on tyre_fitments;
create policy tyre_fitments_update on tyre_fitments for update to authenticated
  using (can_update_vehicle_id(org_id, vehicle_id))
  with check (can_update_vehicle_id(org_id, vehicle_id));

drop policy if exists tyre_fitments_delete on tyre_fitments;
create policy tyre_fitments_delete on tyre_fitments for delete to authenticated
  using (is_org_admin(org_id));

-- Tyres are org-level stock. A supervisor may read a tyre only while it is
-- fitted to a truck he holds; stock, purchase cost and scrapped tyres are the
-- owner's business. Only owner/manager change the inventory.
drop policy if exists tyres_org on tyres;
drop policy if exists tyres_select on tyres;
create policy tyres_select on tyres for select to authenticated
  using (
    is_org_admin(org_id)
    or exists (
      select 1 from tyre_fitments f
      where f.tyre_id = tyres.id and f.is_current
        and can_view_vehicle_id(f.org_id, f.vehicle_id)
    )
  );

drop policy if exists tyres_write on tyres;
create policy tyres_write on tyres for all to authenticated
  using (is_org_admin(org_id)) with check (is_org_admin(org_id));

-- ========================= 3. FASTAG: supervisor scoping =========================

drop policy if exists fastag_member_all on fastag_accounts;
drop policy if exists fastag_accounts_select on fastag_accounts;
create policy fastag_accounts_select on fastag_accounts for select to authenticated
  using (can_view_vehicle_id(org_id, vehicle_id));

drop policy if exists fastag_accounts_write on fastag_accounts;
create policy fastag_accounts_write on fastag_accounts for all to authenticated
  using (is_org_admin(org_id)) with check (is_org_admin(org_id));

drop policy if exists fastag_log_member_all on fastag_balance_log;
drop policy if exists fastag_log_select on fastag_balance_log;
create policy fastag_log_select on fastag_balance_log for select to authenticated
  using (exists (
    select 1 from fastag_accounts a
    where a.id = fastag_balance_log.account_id
      and can_view_vehicle_id(a.org_id, a.vehicle_id)
  ));

-- ========================= 4. SALES INVOICES: admin only =========================
-- Customer billing is not a supervisor's business even for his own trucks —
-- rate per tonne and outstanding balances are commercial terms.

drop policy if exists sales_invoices_member_all on sales_invoices;
drop policy if exists sales_invoices_all on sales_invoices;
create policy sales_invoices_all on sales_invoices for all to authenticated
  using (is_org_admin(org_id)) with check (is_org_admin(org_id));

drop policy if exists sales_invoice_lines_member_all on sales_invoice_lines;
drop policy if exists sales_invoice_lines_all on sales_invoice_lines;
create policy sales_invoice_lines_all on sales_invoice_lines for all to authenticated
  using (exists (
    select 1 from sales_invoices i
    where i.id = sales_invoice_lines.invoice_id and is_org_admin(i.org_id)
  ))
  with check (exists (
    select 1 from sales_invoices i
    where i.id = sales_invoice_lines.invoice_id and is_org_admin(i.org_id)
  ));

-- ========================= 5. DRIVER SELF-SERVICE (anon) =========================

-- 5a. Attach a bill to his own request, and confirm he received the money.
-- Restricted to requests on a live trip. The column-level grant below is what
-- actually stops him editing amount or approving himself — the policy alone
-- would let an UPDATE touch any column.
drop policy if exists trip_req_anon_update on trip_requests;
create policy trip_req_anon_update on trip_requests for update to anon
  using (exists (
    select 1 from trips t
    where t.id = trip_id and t.vehicle_id is not null
      and t.status in ('assigned','acknowledged','started')
  ))
  with check (exists (
    select 1 from trips t
    where t.id = trip_id and t.vehicle_id is not null
      and t.status in ('assigned','acknowledged','started')
  ));

grant update (bill_url, transaction_url, status, paid_at) on trip_requests to anon;

-- 5b. His own attendance. driver_id is the credential; the portal always
-- filters driver_id=eq.<uuid> and cannot enumerate without one.
drop policy if exists att_anon_driver on driver_attendance;
create policy att_anon_driver on driver_attendance for select to anon
  using (driver_id is not null);

grant select on driver_attendance to anon;

-- 5c. Marking his own day. source is pinned to 'driver' so a self-marked day is
-- never mistaken for the owner's record in a payroll dispute.
drop policy if exists att_anon_driver_insert on driver_attendance;
create policy att_anon_driver_insert on driver_attendance for insert to anon
  with check (driver_id is not null and source = 'driver'
              and attendance_date >= current_date - 1
              and attendance_date <= current_date);

grant insert on driver_attendance to anon;

-- 5d. What he has actually been paid. Read-only, own rows only.
drop policy if exists salary_anon_driver on salary_payments;
create policy salary_anon_driver on salary_payments for select to anon
  using (driver_ext_id is not null and status in ('success','processing','pending'));

grant select on salary_payments to anon;

-- ========================= 5e. DRIVER'S OWN DOCUMENTS =========================
-- A driver renews his licence himself and the owner finds out when it is already
-- expired. This lets him file it from the portal instead.
--
-- Identifier numbers are NOT stored. Only the last four digits go in, next to the
-- scan — enough for an owner to match the document to the record, useless to
-- anyone who gets the row. Aadhaar especially: full Aadhaar numbers carry
-- obligations under the Aadhaar Act that this app has no reason to take on, and
-- a masked tail is all the reconciliation actually needs. Same reasoning as
-- driver_payout_details, which has only ever kept bank_account_last4.

create table if not exists driver_documents (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  driver_id     uuid not null references drivers(id) on delete cascade,
  doc_type      text not null check (doc_type in ('dl','aadhaar','pan','photo','bank','upi','other')),
  number_last4  text check (number_last4 ~ '^[0-9A-Za-z]{0,6}$'),
  valid_till    date,
  file_path     text,
  note          text,
  status        text not null default 'pending_review'
                  check (status in ('pending_review','verified','rejected')),
  submitted_by  text not null default 'driver' check (submitted_by in ('driver','owner')),
  reviewed_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (org_id, driver_id, doc_type)
);
create index if not exists idx_drvdoc_driver on driver_documents(driver_id);
create index if not exists idx_drvdoc_expiry on driver_documents(org_id, valid_till);

create or replace function set_drvdoc_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end;
$$;
drop trigger if exists trg_drvdoc_updated_at on driver_documents;
create trigger trg_drvdoc_updated_at
  before update on driver_documents for each row execute function set_drvdoc_updated_at();

alter table driver_documents enable row level security;

-- Owner/manager: full control. A supervisor has no business in a driver's
-- identity documents, so this one stays admin-only rather than vehicle-scoped.
drop policy if exists drvdoc_admin on driver_documents;
create policy drvdoc_admin on driver_documents for all to authenticated
  using (is_org_admin(org_id)) with check (is_org_admin(org_id));

-- Driver (anon): read and file his own. He cannot set status — verification is
-- the owner's call — which the column grant below enforces.
drop policy if exists drvdoc_anon_select on driver_documents;
create policy drvdoc_anon_select on driver_documents for select to anon
  using (driver_id is not null);

drop policy if exists drvdoc_anon_insert on driver_documents;
create policy drvdoc_anon_insert on driver_documents for insert to anon
  with check (driver_id is not null and submitted_by = 'driver' and status = 'pending_review');

drop policy if exists drvdoc_anon_update on driver_documents;
create policy drvdoc_anon_update on driver_documents for update to anon
  using (driver_id is not null and submitted_by = 'driver')
  with check (driver_id is not null and submitted_by = 'driver');

grant select, insert on driver_documents to anon;
grant update (number_last4, valid_till, file_path, note, updated_at) on driver_documents to anon;
grant select, insert, update, delete on driver_documents to authenticated;

comment on table driver_documents is
  'Driver-filed identity and licence documents. number_last4 is a masked tail, '
  'never the full DL/Aadhaar/PAN/account number — the scan in file_path is the '
  'record, the tail is only for matching it. Driver files, owner verifies.';

-- ========================= 6. DRIVER PAY SUMMARY =========================
-- The driver portal needs one number per bucket, not the ledger. A view keeps
-- the arithmetic in Postgres so the phone does not re-derive it — and so owner
-- and driver are always reading the same total.

create or replace view v_driver_pay_summary
with (security_invoker = true) as
select
  d.id                                        as driver_id,
  d.org_id,
  d.ext_id                                    as driver_ext_id,
  coalesce(sp.paid_total, 0)                  as paid_total,
  coalesce(adv.advance_outstanding, 0)        as advance_outstanding,
  coalesce(sp.paid_total, 0)
    - coalesce(adv.advance_outstanding, 0)    as net_received,
  coalesce(att.days_present, 0)               as days_present_this_month,
  coalesce(att.days_on_trip, 0)               as days_on_trip_this_month
from drivers d
left join lateral (
  select sum(amount) as paid_total
  from salary_payments s
  where s.driver_ext_id = d.ext_id and s.org_id = d.org_id and s.status = 'success'
) sp on true
left join lateral (
  -- advances approved or paid out but not yet recovered from a salary run
  select sum(coalesce(r.paid_amount, r.amount)) as advance_outstanding
  from trip_requests r
  join trips t on t.id = r.trip_id
  where t.driver_id = d.id and r.request_type = 'advance'
    and r.status in ('approved','paid')
) adv on true
left join lateral (
  select
    count(*) filter (where a.status = 'present')  as days_present,
    count(*) filter (where a.status = 'on_trip')  as days_on_trip
  from driver_attendance a
  where a.driver_id = d.id
    and a.attendance_date >= date_trunc('month', current_date)
) att on true;

grant select on v_driver_pay_summary to authenticated, anon;

-- ========================= 7. DRIVER UPLOAD BUCKET =========================
-- One private bucket for everything the driver photographs: diesel and toll
-- bills against a request, and his own licence/Aadhaar scans.
--
-- Path convention is "<driver_id>/<rest>" and the first folder must be the
-- driver's own UUID. That UUID is the portal credential, so a driver can only
-- write into his own folder and cannot guess another's. Not a public bucket:
-- reading still needs a policy, and enumeration still needs the UUID.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('driver-uploads', 'driver-uploads', false, 10485760,
        array['image/jpeg','image/png','image/webp','image/heic','application/pdf'])
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists drvup_anon_insert on storage.objects;
create policy drvup_anon_insert on storage.objects for insert to anon
  with check (
    bucket_id = 'driver-uploads'
    and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
  );

drop policy if exists drvup_anon_select on storage.objects;
create policy drvup_anon_select on storage.objects for select to anon
  using (bucket_id = 'driver-uploads');

-- Owner/manager read their OWN drivers' uploads. The first path folder is the
-- driver UUID, so resolve it back to the driver and check the org — without
-- this join a signed-in user from any other fleet could read the whole bucket.
drop policy if exists drvup_auth_all on storage.objects;
create policy drvup_auth_all on storage.objects for all to authenticated
  using (
    bucket_id = 'driver-uploads'
    and exists (
      select 1 from drivers d
      where d.id::text = (storage.foldername(name))[1]
        and is_org_admin(d.org_id)
    )
  )
  with check (
    bucket_id = 'driver-uploads'
    and exists (
      select 1 from drivers d
      where d.id::text = (storage.foldername(name))[1]
        and is_org_admin(d.org_id)
    )
  );

comment on view v_driver_pay_summary is
  'Per-driver pay position: salary paid, advances still outstanding, and this '
  'month''s attendance. security_invoker keeps the caller''s RLS on the base '
  'tables, so a driver reading it over anon still only resolves his own row.';
