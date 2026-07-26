-- ============ FleetWorks — new-module analytics views (Phase 4) ============
-- Run in Supabase: SQL Editor -> New query -> paste -> Run.
--
-- Covers the four modules added to the Fleet Manager on 2026-07-22:
--   Document Vault, Tyre Health, Compliance Radar and Settings.
--
-- IMPORTANT — no new storage table is needed. Every one of these modules
-- already persists: the whole fleet (vehicles, drivers, documents, tyre
-- readings, settings, ...) is one jsonb blob in fleets.data, written by
-- fwCloud.push() and protected by the per-owner RLS on `fleets` (see
-- schema-fleet.sql). This migration only adds *structured read-only views*
-- over the new jsonb collections, exactly like the v_* views in
-- analytics-views.sql, so the data is queryable in Superset / Preset / any
-- BI tool. Adding these does not change how the app reads or writes data.
--
-- Like all analytics views these bypass RLS, so they are revoked from the
-- public API roles at the bottom and reached only by a direct Postgres
-- (BI) connection.
--
-- PREREQUISITE: run schema-fleet.sql and analytics-views.sql first — the
-- unified v_renewals view below builds on v_vehicles and v_drivers defined
-- in analytics-views.sql. Run order: schema.sql -> schema-fleet.sql ->
-- schema-roles.sql -> analytics-views.sql -> schema-modules.sql.

-- ---------- Documents (Document Vault) ----------
create or replace view v_documents as
select
  f.owner_id,
  d ->> 'entityType'                       as entity_type,   -- 'vehicle' | 'driver'
  d ->> 'entityId'                         as entity_id,
  d ->> 'docType'                          as doc_type,
  d ->> 'number'                           as doc_number,
  (nullif(d ->> 'issueDate',  ''))::date   as issued_on,
  (nullif(d ->> 'expiryDate', ''))::date   as valid_till,
  ((nullif(d ->> 'expiryDate', ''))::date - current_date) as days_to_expiry,
  d ->> 'note'                             as note
from fleets f,
     jsonb_array_elements(coalesce(f.data -> 'documents', '[]'::jsonb)) d;

-- ---------- Parts (Spares Godown) — incl. warranty expiry ----------
create or replace view v_parts as
select
  f.owner_id,
  p ->> 'name'                             as part_name,
  p ->> 'partNumber'                       as part_number,
  p ->> 'make'                             as make,
  p ->> 'category'                         as category,
  p ->> 'sourcing'                         as sourcing,
  p ->> 'vendor'                           as vendor,
  (nullif(p ->> 'unitCost', ''))::numeric  as unit_cost,
  (nullif(p ->> 'qty', ''))::numeric       as qty,
  (nullif(p ->> 'minQty', ''))::numeric    as min_qty,
  p ->> 'location'                         as location,
  (nullif(p ->> 'purchaseDate',   ''))::date as purchased_on,
  (nullif(p ->> 'warrantyExpiry', ''))::date as warranty_till
from fleets f,
     jsonb_array_elements(coalesce(f.data -> 'parts', '[]'::jsonb)) p;

-- ---------- Tyre readings (Tyre Health) ----------
create or replace view v_tyre_readings as
select
  f.owner_id,
  t ->> 'vehicleId'                        as vehicle_id,
  t ->> 'position'                         as wheel_position,
  (nullif(t ->> 'treadDepth', ''))::numeric as tread_depth_mm,
  (nullif(t ->> 'pressure',   ''))::numeric as pressure_psi,
  (nullif(t ->> 'odo',        ''))::numeric as odometer,
  (nullif(t ->> 'date',       ''))::date    as reading_date
from fleets f,
     jsonb_array_elements(coalesce(f.data -> 'tyreReadings', '[]'::jsonb)) t;

-- Latest reading per wheel position, with a worn flag against the owner's
-- configured safe tread limit (falls back to the 1.6 mm legal minimum).
create or replace view v_tyre_health as
select distinct on (r.owner_id, r.vehicle_id, r.wheel_position)
  r.owner_id,
  r.vehicle_id,
  r.wheel_position,
  r.tread_depth_mm,
  r.pressure_psi,
  r.reading_date,
  coalesce((f.data -> 'settings' ->> 'minTread')::numeric, 1.6) as safe_limit_mm,
  (r.tread_depth_mm <= coalesce((f.data -> 'settings' ->> 'minTread')::numeric, 1.6)) as is_worn
from v_tyre_readings r
join fleets f on f.owner_id = r.owner_id
order by r.owner_id, r.vehicle_id, r.wheel_position, r.reading_date desc;

-- ---------- Settings (one row per owner) ----------
create or replace view v_settings as
select
  f.owner_id,
  f.data -> 'settings' ->> 'businessName'          as business_name,
  f.data -> 'settings' ->> 'gstin'                 as gstin,
  f.data -> 'settings' ->> 'city'                  as city,
  coalesce((f.data -> 'settings' ->> 'warnDays')::int, 30)        as warn_days,
  coalesce((f.data -> 'settings' ->> 'minTread')::numeric, 1.6)   as min_tread_mm,
  (f.data -> 'settings' ->> 'mileageDropPct')::numeric            as mileage_drop_pct
from fleets f
where f.data ? 'settings';

-- ---------- Unified renewals (the Compliance Radar, in SQL) ----------
-- Every dated renewal across a fleet in one place: vehicle RTO documents,
-- stored Document Vault items, driver licences and part warranties — with
-- an urgency status computed against each owner's warn-days setting. This
-- is what powers a fleet-wide / admin compliance overview.
create or replace view v_renewals as
with items as (
  -- vehicle compliance dates (unpivot the 5 RTO fields)
  select v.owner_id, 'Vehicle'::text as category, v.vehicle as entity,
         c.renewal_type, c.valid_till
  from v_vehicles v
  cross join lateral (values
    ('Insurance',       v.insurance_till),
    ('PUC',             v.puc_till),
    ('Fitness (FC)',    v.fitness_till),
    ('National Permit', v.permit_till),
    ('Road Tax',        v.roadtax_till)
  ) as c(renewal_type, valid_till)
  where c.valid_till is not null

  union all
  -- Document Vault items (resolve the attached vehicle/driver name from the
  -- blob by id, since a document may attach to either)
  select d.owner_id, initcap(d.entity_type) as category,
         coalesce(
           (select x ->> 'name' from fleets ff,
                   jsonb_array_elements(coalesce(ff.data -> 'vehicles', '[]'::jsonb)) x
             where ff.owner_id = d.owner_id and x ->> 'id' = d.entity_id),
           (select x ->> 'name' from fleets ff,
                   jsonb_array_elements(coalesce(ff.data -> 'drivers', '[]'::jsonb)) x
             where ff.owner_id = d.owner_id and x ->> 'id' = d.entity_id),
           d.entity_id
         ) as entity,
         d.doc_type as renewal_type, d.valid_till
  from v_documents d
  where d.valid_till is not null

  union all
  -- driver licences
  select dr.owner_id, 'Driver'::text as category, dr.driver as entity,
         'Driving Licence'::text as renewal_type, dr.dl_expiry as valid_till
  from v_drivers dr
  where dr.dl_expiry is not null

  union all
  -- part warranties
  select p.owner_id, 'Warranty'::text as category, p.part_name as entity,
         'Warranty'::text as renewal_type, p.warranty_till as valid_till
  from v_parts p
  where p.warranty_till is not null
)
select
  i.owner_id, i.category, i.entity, i.renewal_type, i.valid_till,
  (i.valid_till - current_date) as days_to_expiry,
  case
    when i.valid_till < current_date then 'Overdue'
    when i.valid_till <= current_date + coalesce(s.warn_days, 30) then 'Due Soon'
    else 'Upcoming'
  end as status
from items i
left join v_settings s on s.owner_id = i.owner_id;

-- ============ Security hardening ============
-- Views bypass RLS, so they must never be reachable through the public REST
-- API. BI tools connect directly to Postgres and are unaffected.
revoke all on
  v_documents, v_parts, v_tyre_readings, v_tyre_health,
  v_settings, v_renewals
from anon, authenticated;
