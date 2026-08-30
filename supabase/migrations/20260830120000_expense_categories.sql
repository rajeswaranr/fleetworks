-- ============ FleetWorks — expense categories as data ============
-- Categories lived in a JavaScript constant plus whatever strings happened to
-- appear in past expenses. That meant a category typed on a phone never reached
-- the desktop, an operator could not remove types they never use, and the list
-- a fleet actually works with existed only as a side effect of its own history.
--
-- Now a real per-org table. The field stays FREE TEXT in the UI — this table is
-- the suggestion list and the memory, not a constraint. A fleet that types
-- "FASTag - HDFC" or a Tamil term still gets it saved, and it becomes a
-- suggestion everywhere from then on, which was the good part of the old design
-- and is worth keeping.
--
-- is_active rather than DELETE: expenses reference categories by name, so
-- removing a row must never orphan history. Hiding it drops it from the
-- suggestion list while every past expense keeps reading correctly.

create table if not exists expense_categories (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organizations(id) on delete cascade,
  name       text not null,
  -- Seeded rows are marked so a fleet can tell the shipped list from its own
  -- additions, and so re-seeding can skip an org that has already been set up.
  is_default boolean not null default false,
  is_active  boolean not null default true,
  sort_order int not null default 100,
  created_at timestamptz not null default now()
);

-- Case-insensitive uniqueness: "Fastag" and "FASTag" are the same category to a
-- human, and two rows would show as two suggestions.
create unique index if not exists idx_expcat_org_name
  on expense_categories(org_id, lower(name));
create index if not exists idx_expcat_active on expense_categories(org_id, is_active, sort_order);

alter table expense_categories enable row level security;
drop policy if exists expcat_member_all on expense_categories;
create policy expcat_member_all on expense_categories for all to authenticated
  using (is_org_member(org_id)) with check (is_org_member(org_id));
grant select, insert, update, delete on expense_categories to authenticated;

-- Seeds the shipped list for one org. Idempotent: on conflict does nothing, so
-- calling it repeatedly is safe and it will not resurrect a category the fleet
-- has deliberately deactivated.
create or replace function seed_expense_categories(p_org uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_added int := 0;
  v_names text[] := array[
    'Tyres','Tyre Puncture','Tyre Change','Battery','Brakes','Clutch',
    'Engine Oil & Filters','Suspension','Electrical','Body & Paint',
    'DEF','Greasing','Water Wash',
    'FASTag Recharge','Toll','RTO','Police',
    'Insurance','Permit & Road Tax','Fitness & PUC','Other'
  ];
begin
  -- Only a member may seed their own org; a definer function must check for
  -- itself, because RLS does not apply to it.
  if not exists (select 1 from memberships m where m.org_id = p_org and m.user_id = auth.uid()) then
    return 0;
  end if;

  insert into expense_categories (org_id, name, is_default, sort_order)
  select p_org, n, true, i * 10
    from unnest(v_names) with ordinality as t(n, i)
  on conflict (org_id, lower(name)) do nothing;

  get diagnostics v_added = row_count;
  return v_added;
end;
$$;

revoke all on function seed_expense_categories(uuid) from public;
revoke execute on function seed_expense_categories(uuid) from anon;
grant execute on function seed_expense_categories(uuid) to authenticated;

-- Backfill: every category any existing expense already used becomes a row, so
-- no fleet loses a type it had been using before this table existed.
insert into expense_categories (org_id, name, is_default, sort_order)
select distinct e.org_id, trim(e.category), false, 500
  from expenses e
 where e.category is not null and trim(e.category) <> ''
on conflict (org_id, lower(name)) do nothing;

-- Verify after running:
--   select org_id, count(*) from expense_categories group by 1;
--   select * from expense_categories where not is_default limit 10;
