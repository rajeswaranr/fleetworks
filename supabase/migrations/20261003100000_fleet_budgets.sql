-- FleetFin budgets: a monthly spend budget per category, compared against actuals
-- (fuel_logs for diesel, expenses for the rest). One row per org + month + category.
create table if not exists public.fleet_budgets (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  month       text not null,                 -- 'YYYY-MM'
  category    text not null,                 -- 'Diesel' or an expense category
  amount      numeric not null default 0,    -- rupees, matching expenses.amount / fuel_logs.amount
  created_by  uuid references auth.users(id),
  updated_at  timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  unique (org_id, month, category)
);
create index if not exists idx_fleet_budgets_org_month on fleet_budgets(org_id, month);

alter table public.fleet_budgets enable row level security;
drop policy if exists fleet_budgets_select on public.fleet_budgets;
create policy fleet_budgets_select on public.fleet_budgets for select to authenticated
  using (org_id in (select org_id from memberships where user_id = auth.uid()));
drop policy if exists fleet_budgets_write on public.fleet_budgets;
create policy fleet_budgets_write on public.fleet_budgets for all to authenticated
  using (org_id in (select org_id from memberships where user_id = auth.uid()
                    and role in ('owner','manager','supervisor')))
  with check (org_id in (select org_id from memberships where user_id = auth.uid()
                    and role in ('owner','manager','supervisor')));
