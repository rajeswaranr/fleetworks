-- ============ FleetWorks — assets and geofences (FleetSafe) ============
--
-- Fleet View shows "entities", not vehicles. A fleet's yard holds trailers,
-- tippers, gensets, compressors and tankers that carry a tracker and cost money
-- but never appear in `vehicles` — that table means "a thing with an RC, an
-- insurance policy and a driver", and stretching it to cover a drop-deck
-- trailer would put a fitness-certificate expiry on a machine that has none.
--
-- So assets get their own table, deliberately thinner: no compliance radar, no
-- driver assignment, no odometer. What they do share with vehicles is a device
-- and a position, which is what Fleet View actually plots.

create table if not exists assets (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id) on delete cascade,
  ext_id       text,
  name         text not null,
  asset_type   text not null default 'trailer'
                 check (asset_type in ('trailer','tipper_body','genset','compressor',
                                       'tanker','crane','excavator','container','other')),
  make         text,
  model        text,
  serial_no    text,
  -- Where it is parked when nothing is towing it. A trailer's "home" is how a
  -- yard manager finds it; a vehicle's base depot serves the same purpose.
  base_location text,
  -- A trailer hitched to a truck moves with that truck. Nullable because most
  -- assets are sitting in a yard most of the time.
  towed_by_vehicle_id uuid references vehicles(id) on delete set null,
  status       text not null default 'active'
                 check (status in ('active','idle','maintenance','retired')),
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (org_id, ext_id)
);
create index if not exists idx_assets_org   on assets(org_id, status);
create index if not exists idx_assets_towed on assets(towed_by_vehicle_id);

-- A device can be fitted to a vehicle or to an asset, so devices grows an
-- asset_id rather than assets growing a device_id — one truck or trailer can
-- carry more than one box (tracker plus camera) and the reverse cannot happen.
alter table devices add column if not exists asset_id uuid references assets(id) on delete set null;
create index if not exists idx_devices_asset on devices(asset_id);

create or replace function set_assets_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end;
$$;
drop trigger if exists trg_assets_updated_at on assets;
create trigger trg_assets_updated_at
  before update on assets for each row execute function set_assets_updated_at();

alter table assets enable row level security;

-- An asset has no vehicle_id of its own to scope by, so a supervisor sees the
-- ones hitched to trucks he holds, plus unhitched stock is admin-only. Without
-- the towed_by branch a supervisor could not see the trailer behind his own
-- truck, which is the one he most needs.
drop policy if exists assets_select on assets;
create policy assets_select on assets for select to authenticated
  using (
    is_org_admin(org_id)
    or (towed_by_vehicle_id is not null and can_view_vehicle_id(org_id, towed_by_vehicle_id))
  );

drop policy if exists assets_write on assets;
create policy assets_write on assets for all to authenticated
  using (is_org_admin(org_id)) with check (is_org_admin(org_id));

grant select, insert, update, delete on assets to authenticated;

comment on table assets is
  'Non-vehicle equipment that carries a tracker: trailers, gensets, tankers. '
  'Deliberately thinner than vehicles — no RC, no compliance radar, no driver. '
  'Shares only what Fleet View plots: a device and a position.';

-- ========================= Geofences =========================
-- Stored as centre + radius rather than a polygon. A polygon needs PostGIS and
-- a drawing surface; a circle round a plant gate, a customer yard or a fuel
-- pump covers what these fleets actually ask for, and containment is one
-- distance comparison a phone can do offline.
--
-- If a real polygon need appears later, add a geometry column beside these and
-- let shape_type decide — the entry/exit table below does not care.

create table if not exists geofences (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  name        text not null,
  purpose     text not null default 'other'
                check (purpose in ('depot','customer','fuel','plant','workshop','parking','restricted','other')),
  centre_lat  numeric not null check (centre_lat between -90 and 90),
  centre_lng  numeric not null check (centre_lng between -180 and 180),
  radius_m    numeric not null default 300 check (radius_m between 50 and 50000),
  -- A restricted zone is the inverse alert: entering it is the exception.
  alert_on    text not null default 'both' check (alert_on in ('enter','exit','both','none')),
  site_id     uuid references sites(id) on delete set null,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_geofence_org on geofences(org_id, is_active);

drop trigger if exists trg_geofences_updated_at on geofences;
create trigger trg_geofences_updated_at
  before update on geofences for each row execute function set_assets_updated_at();

alter table geofences enable row level security;

drop policy if exists geofence_select on geofences;
create policy geofence_select on geofences for select to authenticated
  using (is_org_member(org_id));

drop policy if exists geofence_write on geofences;
create policy geofence_write on geofences for all to authenticated
  using (is_org_admin(org_id)) with check (is_org_admin(org_id));

grant select, insert, update, delete on geofences to authenticated;

-- Driver portal reads active fences so the app can warn before the driver
-- enters a restricted zone rather than after.
drop policy if exists geofence_anon on geofences;
create policy geofence_anon on geofences for select to anon
  using (is_active);
grant select on geofences to anon;

create table if not exists geofence_events (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id) on delete cascade,
  geofence_id  uuid not null references geofences(id) on delete cascade,
  vehicle_id   uuid references vehicles(id) on delete cascade,
  asset_id     uuid references assets(id) on delete cascade,
  driver_id    uuid references drivers(id) on delete set null,
  direction    text not null check (direction in ('enter','exit')),
  occurred_at  timestamptz not null default now(),
  latitude     numeric,
  longitude    numeric,
  -- How long it stayed, filled in on the matching exit. Dwell is the number a
  -- fleet actually wants — "reached the plant" matters far less than "sat at
  -- the plant for six hours", which is the detention nobody billed for.
  dwell_seconds int,
  created_at   timestamptz not null default now()
);
create index if not exists idx_gfe_geofence on geofence_events(geofence_id, occurred_at desc);
create index if not exists idx_gfe_vehicle  on geofence_events(vehicle_id, occurred_at desc);

alter table geofence_events enable row level security;

drop policy if exists gfe_select on geofence_events;
create policy gfe_select on geofence_events for select to authenticated
  using (
    is_org_admin(org_id)
    or (vehicle_id is not null and can_view_vehicle_id(org_id, vehicle_id))
  );

drop policy if exists gfe_insert on geofence_events;
create policy gfe_insert on geofence_events for insert to authenticated
  with check (is_org_member(org_id));

grant select, insert on geofence_events to authenticated;

comment on table geofence_events is
  'Entry and exit crossings. dwell_seconds is filled on the exit row because '
  'time spent inside is the billable fact — detention at a plant, not arrival.';

-- Containment as a function so the same arithmetic serves the map, the ingest
-- path and any future edge function. Haversine rather than PostGIS: one
-- dependency fewer for a circle test.
create or replace function geofence_contains(p_geofence uuid, p_lat numeric, p_lng numeric)
returns boolean
language sql stable as $$
  select exists (
    select 1 from geofences g
     where g.id = p_geofence
       and 6371000 * 2 * asin(sqrt(
             power(sin(radians(p_lat - g.centre_lat) / 2), 2)
             + cos(radians(g.centre_lat)) * cos(radians(p_lat))
             * power(sin(radians(p_lng - g.centre_lng) / 2), 2)
           )) <= g.radius_m
  );
$$;
