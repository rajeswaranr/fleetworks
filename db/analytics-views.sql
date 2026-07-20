-- ============ FleetWorks — analytics views (for Apache Superset / BI) ============
-- Tabular views over the fleet jsonb store + business tables, ready for
-- charting in Superset (Preset.io), Metabase, Grafana or any SQL BI tool.

-- Vehicles (one row per vehicle across all fleets)
create or replace view v_vehicles as
select
  f.owner_id,
  v ->> 'id' as vehicle_id,
  v ->> 'name' as vehicle,
  v ->> 'type' as vehicle_type,
  (v ->> 'kmPerMonth')::numeric as km_per_month,
  (v -> 'compliance' ->> 'insurance')::date as insurance_till,
  (v -> 'compliance' ->> 'puc')::date as puc_till,
  (v -> 'compliance' ->> 'fitness')::date as fitness_till,
  (v -> 'compliance' ->> 'permit')::date as permit_till,
  (v -> 'compliance' ->> 'roadtax')::date as roadtax_till
from fleets f, jsonb_array_elements(coalesce(f.data -> 'vehicles', '[]'::jsonb)) v;

-- Expenses
create or replace view v_expenses as
select
  f.owner_id,
  e ->> 'vehicleId' as vehicle_id,
  (e ->> 'date')::date as expense_date,
  date_trunc('month', (e ->> 'date')::date)::date as expense_month,
  e ->> 'category' as category,
  (e ->> 'amount')::numeric as amount
from fleets f, jsonb_array_elements(coalesce(f.data -> 'expenses', '[]'::jsonb)) e;

-- Fuel logs
create or replace view v_fuel_logs as
select
  f.owner_id,
  fl ->> 'vehicleId' as vehicle_id,
  (fl ->> 'date')::date as fill_date,
  (fl ->> 'litres')::numeric as litres,
  (fl ->> 'amount')::numeric as amount,
  (fl ->> 'odo')::numeric as odometer
from fleets f, jsonb_array_elements(coalesce(f.data -> 'fuelLogs', '[]'::jsonb)) fl;

-- Issues
create or replace view v_issues as
select
  f.owner_id,
  i ->> 'vehicleId' as vehicle_id,
  i ->> 'title' as title,
  i ->> 'severity' as severity,
  i ->> 'status' as status,
  (i ->> 'createdAt')::date as created_at,
  (i ->> 'resolvedAt')::date as resolved_at,
  i ->> 'source' as source
from fleets f, jsonb_array_elements(coalesce(f.data -> 'issues', '[]'::jsonb)) i;

-- Drivers
create or replace view v_drivers as
select
  f.owner_id,
  d ->> 'name' as driver,
  d ->> 'dlNo' as dl_no,
  (d ->> 'dlExpiry')::date as dl_expiry,
  d ->> 'vehicleId' as vehicle_id
from fleets f, jsonb_array_elements(coalesce(f.data -> 'drivers', '[]'::jsonb)) d;

-- Handy joined view: expense enriched with vehicle info
create or replace view v_expense_details as
select e.owner_id, e.expense_date, e.expense_month, e.category, e.amount,
       v.vehicle, v.vehicle_type, v.km_per_month
from v_expenses e
left join v_vehicles v on v.owner_id = e.owner_id and v.vehicle_id = e.vehicle_id;
