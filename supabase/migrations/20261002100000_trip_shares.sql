-- Live Share: a customer-facing, read-only live-location link for one vehicle (Samsara-style).
-- The owner creates a time-limited token; anyone with the link sees only that vehicle's current
-- position + speed (served by the trip-share edge function via the service role — never direct DB
-- access). Tokens expire and can be revoked.

create table if not exists public.trip_shares (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  vehicle_id  uuid not null references vehicles(id) on delete cascade,
  token       text not null unique,
  label       text,
  created_by  uuid references auth.users(id),
  expires_at  timestamptz not null default (now() + interval '24 hours'),
  revoked_at  timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists idx_trip_shares_vehicle on trip_shares(vehicle_id, created_at desc);
create index if not exists idx_trip_shares_token on trip_shares(token);

alter table public.trip_shares enable row level security;

-- Owners/managers/supervisors see and manage their own org's shares; the public link is served
-- only through the edge function (service role), so anon gets no direct table access.
drop policy if exists trip_shares_select on public.trip_shares;
create policy trip_shares_select on public.trip_shares for select to authenticated
  using (org_id in (select org_id from memberships where user_id = auth.uid()));
drop policy if exists trip_shares_write on public.trip_shares;
create policy trip_shares_write on public.trip_shares for all to authenticated
  using (org_id in (select org_id from memberships where user_id = auth.uid()
                    and role in ('owner','manager','supervisor')))
  with check (org_id in (select org_id from memberships where user_id = auth.uid()
                    and role in ('owner','manager','supervisor')));
