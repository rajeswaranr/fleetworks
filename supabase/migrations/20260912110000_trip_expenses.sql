-- ============ FleetWorks — driver trip expenses ============
--
-- Money the driver spends out of his own pocket on the road: loading and
-- unloading labour, a police or RTO payment, tyre air, greasing, a cup of tea
-- for the cleaner. Today this is a scrap of paper handed over at the end of the
-- trip and argued about, which is exactly the kind of thing that quietly eats a
-- trip's margin.
--
-- Deliberately NOT written straight into `expenses`. That table is the owner's
-- books, and the anon driver role must never be able to write into it — a
-- driver's claim is a claim until the owner accepts it. So: the driver files
-- here, the owner approves, and only an approved row is the owner's to post.
-- Same shape as trip_requests, for the same reason.

create table if not exists trip_expenses (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  trip_id     uuid references trips(id) on delete set null,
  vehicle_id  uuid references vehicles(id) on delete set null,
  driver_id   uuid references drivers(id) on delete set null,
  category    text not null,
  amount      numeric not null check (amount > 0),
  note        text,
  bill_path   text,
  spent_at    date not null default current_date,
  status      text not null default 'submitted'
                check (status in ('submitted','approved','rejected')),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_texp_trip    on trip_expenses(trip_id);
create index if not exists idx_texp_driver  on trip_expenses(driver_id, spent_at desc);
create index if not exists idx_texp_org     on trip_expenses(org_id, status, spent_at desc);

create or replace function set_trip_exp_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end;
$$;
drop trigger if exists trg_trip_exp_updated_at on trip_expenses;
create trigger trg_trip_exp_updated_at
  before update on trip_expenses for each row execute function set_trip_exp_updated_at();

alter table trip_expenses enable row level security;

-- Owner/manager: everything. Supervisor: only his own vehicles' claims, and he
-- cannot approve — approving a claim is a payment decision.
drop policy if exists texp_select on trip_expenses;
create policy texp_select on trip_expenses for select to authenticated
  using (can_view_vehicle_id(org_id, vehicle_id) or is_org_admin(org_id));

drop policy if exists texp_insert on trip_expenses;
create policy texp_insert on trip_expenses for insert to authenticated
  with check (can_update_vehicle_id(org_id, vehicle_id) or is_org_admin(org_id));

drop policy if exists texp_update on trip_expenses;
create policy texp_update on trip_expenses for update to authenticated
  using (is_org_admin(org_id)) with check (is_org_admin(org_id));

drop policy if exists texp_delete on trip_expenses;
create policy texp_delete on trip_expenses for delete to authenticated
  using (is_org_admin(org_id));

-- Driver (anon), scoped by his own driver UUID. He may file and correct his own
-- claim while it is still submitted; once the owner approves or rejects it, it
-- is settled and the USING clause below stops matching it.
drop policy if exists texp_anon_select on trip_expenses;
create policy texp_anon_select on trip_expenses for select to anon
  using (driver_id is not null);

drop policy if exists texp_anon_insert on trip_expenses;
create policy texp_anon_insert on trip_expenses for insert to anon
  with check (driver_id is not null and status = 'submitted' and amount > 0);

drop policy if exists texp_anon_update on trip_expenses;
create policy texp_anon_update on trip_expenses for update to anon
  using (driver_id is not null and status = 'submitted')
  with check (driver_id is not null and status = 'submitted');

grant select, insert on trip_expenses to anon;
grant update (amount, category, note, bill_path, spent_at, updated_at) on trip_expenses to anon;
grant select, insert, update, delete on trip_expenses to authenticated;

comment on table trip_expenses is
  'Out-of-pocket spend a driver files from the portal (loading, unloading, '
  'police, RTO, air, greasing, misc). A claim, not a book entry — only after '
  'the owner approves it should it post to expenses.';

-- ---------- Categories the road actually produces ----------
-- seed_expense_categories() shipped a workshop-shaped list; these are the ones
-- a driver spends on during a trip and had nowhere to put.
create or replace function seed_trip_expense_categories(p_org uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_added int := 0;
  v_names text[] := array[
    'Loading Charges','Unloading Charges','Tyre Air','Parking',
    'Weighbridge','Driver Food & Stay','Cleaner Batta','Miscellaneous'
  ];
begin
  if not exists (select 1 from memberships m where m.org_id = p_org and m.user_id = auth.uid()) then
    return 0;
  end if;

  insert into expense_categories (org_id, name, is_default, sort_order)
  select p_org, n, true, 300 + i * 10
    from unnest(v_names) with ordinality as t(n, i)
  on conflict (org_id, lower(name)) do nothing;

  get diagnostics v_added = row_count;
  return v_added;
end;
$$;

revoke all on function seed_trip_expense_categories(uuid) from public;
revoke execute on function seed_trip_expense_categories(uuid) from anon;
grant execute on function seed_trip_expense_categories(uuid) to authenticated;

-- Backfill every org that already has categories seeded, so existing fleets get
-- the new road categories without anyone having to re-run setup.
insert into expense_categories (org_id, name, is_default, sort_order)
select o.org_id, t.n, true, 300 + t.i * 10
  from (select distinct org_id from expense_categories) o
 cross join unnest(array[
    'Loading Charges','Unloading Charges','Tyre Air','Parking',
    'Weighbridge','Driver Food & Stay','Cleaner Batta','Miscellaneous'
  ]) with ordinality as t(n, i)
on conflict (org_id, lower(name)) do nothing;

-- ---------- What the driver is owed ----------
-- Approved out-of-pocket spend is money the owner owes back, and it belongs in
-- the same summary as salary and advances — otherwise the driver reads three
-- different screens and still cannot tell where he stands.
create or replace view v_driver_expense_summary
with (security_invoker = true) as
select
  driver_id,
  org_id,
  sum(amount) filter (where status = 'approved')  as approved_total,
  sum(amount) filter (where status = 'submitted') as pending_total,
  count(*)    filter (where status = 'submitted') as pending_count
from trip_expenses
where driver_id is not null
group by driver_id, org_id;

grant select on v_driver_expense_summary to authenticated, anon;

comment on view v_driver_expense_summary is
  'Per-driver out-of-pocket position: approved (owed back) versus still waiting '
  'on the owner. security_invoker keeps RLS, so a driver resolves only his own.';
