-- ============ FleetWorks — Expense Change Approvals ============
-- Run once in Supabase SQL Editor, AFTER schema-team-access.sql. Idempotent.
--
-- Business rule: a supervisor, manager, or driver (anyone but the owner)
-- can no longer write to `expenses` directly. Every new expense or edit
-- they submit lands in expense_change_requests as 'pending' instead; only
-- the OWNER can approve (which applies it to the real expenses row) or
-- reject it (which discards it, expenses stays untouched). The owner's own
-- edits are unaffected — they still write straight to expenses, since they
-- ARE the approver.
--
-- This tightens expenses_insert/expenses_update from schema-team-access.sql
-- (currently: any team member with 'update' access on the vehicle can write
-- directly) down to owner-only. expenses_select and expenses_delete are
-- untouched (delete was already owner/manager-only).

-- ========================= 1. is_owner() predicate =========================
-- Stricter than is_org_admin() (which also passes managers) — approval
-- itself is reserved for the owner role specifically.
create or replace function is_owner(p_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false)
    or exists (select 1 from memberships m where m.org_id = p_org and m.user_id = auth.uid() and m.role = 'owner');
$$;

-- ========================= 2. Lock down direct expense writes =========================
drop policy if exists expenses_insert on expenses;
drop policy if exists expenses_update on expenses;
create policy expenses_insert on expenses for insert to authenticated with check (is_owner(org_id));
create policy expenses_update on expenses for update to authenticated using (is_owner(org_id)) with check (is_owner(org_id));

-- ========================= 3. The pending-request queue =========================
create table if not exists expense_change_requests (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id) on delete cascade,
  expense_id   uuid references expenses(id) on delete cascade, -- null = a brand-new expense being proposed
  vehicle_id   uuid not null references vehicles(id) on delete cascade,
  action       text not null check (action in ('create','update')),
  patch        jsonb not null, -- proposed fields only: expense_date, category, amount, title, vendor, gstin, bill_no, items
  status       text not null default 'pending' check (status in ('pending','approved','rejected')),
  requested_by uuid not null references auth.users(id),
  decided_by   uuid references auth.users(id),
  decided_at   timestamptz,
  note         text,
  created_at   timestamptz not null default now()
);
create index if not exists idx_ecr_org    on expense_change_requests(org_id);
create index if not exists idx_ecr_status on expense_change_requests(org_id, status);

alter table expense_change_requests enable row level security;

-- Anyone with write access to the vehicle can submit a request for it, but
-- only as themselves (can't file a request that impersonates another user).
drop policy if exists ecr_insert on expense_change_requests;
create policy ecr_insert on expense_change_requests for insert to authenticated
  with check (can_update_vehicle_id(org_id, vehicle_id) and requested_by = auth.uid());

-- Owner/manager see every request in the org (to review); a requester can
-- see their own regardless of role, so they know if it was approved/rejected.
drop policy if exists ecr_select on expense_change_requests;
create policy ecr_select on expense_change_requests for select to authenticated
  using (is_org_admin(org_id) or requested_by = auth.uid());

-- Only the OWNER can decide (approve/reject) — not even a manager.
drop policy if exists ecr_decide on expense_change_requests;
create policy ecr_decide on expense_change_requests for update to authenticated
  using (is_owner(org_id)) with check (is_owner(org_id));

grant select, insert, update on expense_change_requests to authenticated;

-- Verify after running:
--   select column_name from information_schema.columns where table_name = 'expense_change_requests' order by 1;
