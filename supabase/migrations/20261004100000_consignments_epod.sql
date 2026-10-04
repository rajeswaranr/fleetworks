-- FleetOps: consignments / freight + trip billing, and ePOD (electronic proof of delivery).
--
-- A consignment is one load the fleet carries for a customer (LR / bilty number, from → to,
-- freight rate, advance). The driver confirms delivery by photographing the proof with the
-- phone camera; those photos are ePODs. Trip billing is freight minus advance = balance due,
-- with a status the owner moves created → dispatched → delivered → billed.

create table if not exists public.consignments (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  vehicle_id    uuid references vehicles(id) on delete set null,
  driver_id     uuid references drivers(id) on delete set null,
  trip_id       uuid,                              -- optional link to a trips row
  lr_no         text,                              -- LR / bilty / consignment number
  customer      text,
  from_loc      text,
  to_loc        text,
  goods         text,
  weight_kg     numeric,
  freight_amount numeric not null default 0,       -- rupees
  advance_amount numeric not null default 0,       -- rupees paid up front
  status        text not null default 'created'
                  check (status in ('created','dispatched','delivered','billed','cancelled')),
  delivered_at  timestamptz,
  note          text,
  created_by    uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_consignments_org on consignments(org_id, created_at desc);
create index if not exists idx_consignments_vehicle on consignments(vehicle_id, created_at desc);

create table if not exists public.epods (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(id) on delete cascade,
  consignment_id uuid references consignments(id) on delete set null,
  vehicle_id     uuid references vehicles(id) on delete set null,
  driver_id      uuid references drivers(id) on delete set null,
  lr_no          text,                             -- for loose uploads not yet linked to a consignment
  storage_path   text not null,                    -- object in the device-media bucket
  latitude       numeric,
  longitude      numeric,
  note           text,
  captured_at    timestamptz not null default now(),
  created_at     timestamptz not null default now()
);
create index if not exists idx_epods_consignment on epods(consignment_id);
create index if not exists idx_epods_org on epods(org_id, created_at desc);

alter table public.consignments enable row level security;
alter table public.epods enable row level security;

-- Owners / managers / supervisors of the org manage consignments and read ePODs.
drop policy if exists consignments_rw on public.consignments;
create policy consignments_rw on public.consignments for all to authenticated
  using (org_id in (select org_id from memberships where user_id = auth.uid()))
  with check (org_id in (select org_id from memberships where user_id = auth.uid()));
drop policy if exists epods_select on public.epods;
create policy epods_select on public.epods for select to authenticated
  using (org_id in (select org_id from memberships where user_id = auth.uid()));
-- ePOD writes go through the epod-upload edge function (service role), so no anon/author insert policy here.
