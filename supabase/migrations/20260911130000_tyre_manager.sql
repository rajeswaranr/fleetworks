-- ============ FleetWorks — Tyre Manager ============
-- Individual tyre inventory + axle fitment tracking.
-- tyre_readings (already exists) stores periodic tread/pressure snapshots;
-- this migration adds the identity layer: WHICH tyre (serial, brand, size)
-- is fitted WHERE, and its full retread history.

-- ---------- 1. Tyre inventory ----------
create table if not exists tyres (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations(id) on delete cascade,
  serial_no       text,                       -- manufacturer serial or owner tag
  brand           text,                       -- MRF, Apollo, CEAT, Bridgestone…
  size            text,                       -- "10.00R20", "295/80R22.5", "7.50R16"
  tyre_type       text not null default 'radial'
                    check (tyre_type in ('radial','bias')),
  new_tread_mm    numeric not null default 14, -- tread depth when brand-new
  purchase_cost   numeric,
  purchase_date   date,
  purchase_odo    numeric,                    -- fleet odometer at purchase
  status          text not null default 'stock'
                    check (status in ('fitted','stock','retread_pending','scrapped')),
  retread_count   int not null default 0,
  last_retread_date date,
  last_retread_odo  numeric,
  last_retread_cost numeric,
  total_km        numeric,                    -- lifetime km (updated on removal)
  scrapped_date   date,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_tyres_org    on tyres(org_id, status);
create index if not exists idx_tyres_serial on tyres(org_id, serial_no);

alter table tyres enable row level security;
drop policy if exists tyres_org on tyres;
create policy tyres_org on tyres for all to authenticated
  using (is_org_member(org_id)) with check (is_org_member(org_id));
grant select, insert, update, delete on tyres to authenticated;

-- ---------- 2. Tyre fitments — axle position history ----------
create table if not exists tyre_fitments (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id) on delete cascade,
  tyre_id      uuid not null references tyres(id) on delete cascade,
  vehicle_id   uuid not null references vehicles(id) on delete cascade,
  position     text not null,         -- matches AXLE_LAYOUTS keys
  axle_no      int,                   -- 1=front, 2=rear1, 3=rear2, 4=trailer...
  fitted_date  date not null default current_date,
  fitted_odo   numeric,               -- odometer at time of fitting
  fitted_tread numeric,               -- tread depth at fitting (mm)
  removed_date date,
  removed_odo  numeric,
  removed_tread numeric,
  is_current   boolean not null default true,
  created_at   timestamptz not null default now()
);
create index if not exists idx_fitment_vehicle  on tyre_fitments(vehicle_id, is_current);
create index if not exists idx_fitment_tyre     on tyre_fitments(tyre_id);
create index if not exists idx_fitment_org      on tyre_fitments(org_id);

alter table tyre_fitments enable row level security;
drop policy if exists fitment_org on tyre_fitments;
create policy fitment_org on tyre_fitments for all to authenticated
  using (is_org_member(org_id)) with check (is_org_member(org_id));
grant select, insert, update, delete on tyre_fitments to authenticated;

-- ---------- 3. Link tyre_readings to individual tyre (optional backfill) ----------
alter table tyre_readings add column if not exists tyre_id uuid references tyres(id) on delete set null;
alter table tyre_readings add column if not exists tread_depth_new_mm numeric; -- tread of THIS tyre when new

-- Index for wear-rate queries (need consecutive readings by odo)
create index if not exists idx_tr_vehicle_pos_odo
  on tyre_readings(vehicle_id, position, odometer);

-- ---------- 4. Keep tyres.updated_at current ----------
create or replace function set_tyres_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end;
$$;
drop trigger if exists trg_tyres_updated_at on tyres;
create trigger trg_tyres_updated_at
  before update on tyres for each row execute function set_tyres_updated_at();

-- ---------- 5. Computed view: latest reading + wear rate per vehicle+position ----------
create or replace view v_tyre_manager as
with ranked as (
  select *,
    row_number() over (partition by vehicle_id, position order by reading_date desc, created_at desc) as rn_latest,
    row_number() over (partition by vehicle_id, position order by reading_date asc,  created_at asc)  as rn_oldest
  from tyre_readings
  where odometer is not null and tread_depth_mm is not null
),
latest as (select * from ranked where rn_latest = 1),
oldest as (select * from ranked where rn_oldest = 1),
pairs as (
  select
    l.vehicle_id, l.position, l.tread_depth_mm as tread_latest, l.pressure_psi,
    l.odometer as odo_latest, l.reading_date, l.tyre_id,
    o.tread_depth_mm as tread_first, o.odometer as odo_first,
    l.org_id
  from latest l join oldest o using (vehicle_id, position)
)
select
  vehicle_id, position, tread_latest, pressure_psi, reading_date, tyre_id,
  odo_latest, org_id,
  case when odo_latest > odo_first and tread_first > tread_latest
       then round(cast((tread_first - tread_latest) / (odo_latest - odo_first) * 1000 as numeric), 4)
       else null
  end as wear_rate_mm_per_1000km   -- null if only one reading
from pairs;

grant select on v_tyre_manager to authenticated;

-- Verify:
--   select * from tyres limit 5;
--   select * from tyre_fitments where is_current = true limit 10;
--   select vehicle_id, position, tread_latest, wear_rate_mm_per_1000km from v_tyre_manager;
