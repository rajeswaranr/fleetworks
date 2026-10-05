-- ============================================================
-- FleetWorks Knowledge Graph — Phase 1: link remaining tables
-- ============================================================
-- Adds vehicle_id (and driver_id where applicable) to all remaining
-- operational tables that don't have it yet, then backfills from
-- existing FK chains.  Config/reference/financial tables (rbac,
-- signal catalog, payment configs, org settings) stay untouched.
-- Phase 2 (below) builds the graph analysis layer on top.

-- ────────────────────────────────────────────────────────────
-- 1. telemetry  (bigint pk; links via device_id → vehicles)
-- ────────────────────────────────────────────────────────────
alter table telemetry add column if not exists vehicle_id uuid references vehicles(id) on delete set null;
alter table telemetry add column if not exists driver_id  uuid references drivers(id)  on delete set null;
create index if not exists idx_telemetry_vehicle on telemetry(vehicle_id, recorded_at desc);
create index if not exists idx_telemetry_driver  on telemetry(driver_id);

update telemetry t set vehicle_id = d.vehicle_id
  from devices d where t.device_id = d.id and t.vehicle_id is null and d.vehicle_id is not null;
update telemetry t set driver_id = dr.id
  from drivers dr where dr.vehicle_id = t.vehicle_id and t.driver_id is null;

create or replace function telemetry_set_links() returns trigger language plpgsql as $$
begin
  if new.vehicle_id is null and new.device_id is not null then
    select d.vehicle_id into new.vehicle_id from devices d where d.id = new.device_id;
  end if;
  if new.driver_id is null and new.vehicle_id is not null then
    select dr.id into new.driver_id from drivers dr where dr.vehicle_id = new.vehicle_id limit 1;
  end if;
  return new;
end $$;
drop trigger if exists trg_telemetry_links on telemetry;
create trigger trg_telemetry_links before insert on telemetry
  for each row execute function telemetry_set_links();

-- ────────────────────────────────────────────────────────────
-- 2. trip_events  (bigint pk; links via trip_id → trips)
-- ────────────────────────────────────────────────────────────
alter table trip_events add column if not exists vehicle_id uuid references vehicles(id) on delete set null;
alter table trip_events add column if not exists driver_id  uuid references drivers(id)  on delete set null;
create index if not exists idx_trip_events_vehicle on trip_events(vehicle_id);
create index if not exists idx_trip_events_driver  on trip_events(driver_id);

update trip_events e set vehicle_id = t.vehicle_id, driver_id = t.driver_id
  from trips t where e.trip_id = t.id and e.vehicle_id is null;

create or replace function trip_events_set_links() returns trigger language plpgsql as $$
begin
  if (new.vehicle_id is null or new.driver_id is null) and new.trip_id is not null then
    select vehicle_id, driver_id into new.vehicle_id, new.driver_id
    from trips where id = new.trip_id;
  end if;
  return new;
end $$;
drop trigger if exists trg_trip_events_links on trip_events;
create trigger trg_trip_events_links before insert on trip_events
  for each row execute function trip_events_set_links();

-- ────────────────────────────────────────────────────────────
-- 3. trip_requests  (links via trip_id → trips)
-- ────────────────────────────────────────────────────────────
alter table trip_requests add column if not exists vehicle_id uuid references vehicles(id) on delete set null;
alter table trip_requests add column if not exists driver_id  uuid references drivers(id)  on delete set null;
create index if not exists idx_trip_requests_vehicle on trip_requests(vehicle_id);

update trip_requests r set vehicle_id = t.vehicle_id, driver_id = t.driver_id
  from trips t where r.trip_id = t.id and r.vehicle_id is null;

create or replace function trip_requests_set_links() returns trigger language plpgsql as $$
begin
  if (new.vehicle_id is null or new.driver_id is null) and new.trip_id is not null then
    select vehicle_id, driver_id into new.vehicle_id, new.driver_id
    from trips where id = new.trip_id;
  end if;
  return new;
end $$;
drop trigger if exists trg_trip_requests_links on trip_requests;
create trigger trg_trip_requests_links before insert on trip_requests
  for each row execute function trip_requests_set_links();

-- ────────────────────────────────────────────────────────────
-- 4. vehicle_assignments  (vehicle_ext_id text → vehicles.ext_id)
-- ────────────────────────────────────────────────────────────
alter table vehicle_assignments add column if not exists vehicle_id uuid references vehicles(id) on delete set null;
create index if not exists idx_vehicle_assignments_vehicle on vehicle_assignments(vehicle_id);

update vehicle_assignments a set vehicle_id = v.id
  from vehicles v where v.ext_id = a.vehicle_ext_id and a.vehicle_id is null;

-- ────────────────────────────────────────────────────────────
-- 5. coaching_meetings  (driver_id → drivers.vehicle_id)
-- ────────────────────────────────────────────────────────────
alter table coaching_meetings add column if not exists vehicle_id uuid references vehicles(id) on delete set null;
create index if not exists idx_coaching_meetings_vehicle on coaching_meetings(vehicle_id);

update coaching_meetings m set vehicle_id = dr.vehicle_id
  from drivers dr where dr.id = m.driver_id and m.vehicle_id is null;

create or replace function coaching_meetings_set_links() returns trigger language plpgsql as $$
begin
  if new.vehicle_id is null and new.driver_id is not null then
    select vehicle_id into new.vehicle_id from drivers where id = new.driver_id;
  end if;
  return new;
end $$;
drop trigger if exists trg_coaching_meetings_links on coaching_meetings;
create trigger trg_coaching_meetings_links before insert on coaching_meetings
  for each row execute function coaching_meetings_set_links();

-- ────────────────────────────────────────────────────────────
-- 6. eway_bills  (gst_invoice_id → gst_invoices.vehicle_id,
--                 fallback: match vehicle_number text vs vehicles.ext_id)
-- ────────────────────────────────────────────────────────────
alter table eway_bills add column if not exists vehicle_id uuid references vehicles(id) on delete set null;
alter table eway_bills add column if not exists driver_id  uuid references drivers(id)  on delete set null;
create index if not exists idx_eway_bills_vehicle on eway_bills(vehicle_id);

update eway_bills e set vehicle_id = gi.vehicle_id, driver_id = gi.driver_id
  from gst_invoices gi where gi.id = e.gst_invoice_id and e.vehicle_id is null;

-- Fallback: match by registration number string (ext_id in vehicles)
update eway_bills e set vehicle_id = v.id
  from vehicles v
  where upper(replace(replace(v.ext_id,' ',''),'-','')) = upper(replace(replace(e.vehicle_number,' ',''),'-',''))
    and e.vehicle_id is null and e.vehicle_number is not null;

-- ────────────────────────────────────────────────────────────
-- 7. fastag_balance_log  (account_id → fastag_accounts.vehicle_id)
-- ────────────────────────────────────────────────────────────
alter table fastag_balance_log add column if not exists vehicle_id uuid references vehicles(id) on delete set null;
create index if not exists idx_fastag_balance_log_vehicle on fastag_balance_log(vehicle_id);

update fastag_balance_log l set vehicle_id = a.vehicle_id
  from fastag_accounts a where a.id = l.account_id and l.vehicle_id is null;

create or replace function fastag_balance_log_set_links() returns trigger language plpgsql as $$
begin
  if new.vehicle_id is null and new.account_id is not null then
    select vehicle_id into new.vehicle_id from fastag_accounts where id = new.account_id;
  end if;
  return new;
end $$;
drop trigger if exists trg_fastag_balance_log_links on fastag_balance_log;
create trigger trg_fastag_balance_log_links before insert on fastag_balance_log
  for each row execute function fastag_balance_log_set_links();

-- ────────────────────────────────────────────────────────────
-- 8. driver_ledger  (driver_id → drivers.vehicle_id)
-- ────────────────────────────────────────────────────────────
alter table driver_ledger add column if not exists vehicle_id uuid references vehicles(id) on delete set null;
create index if not exists idx_driver_ledger_vehicle on driver_ledger(vehicle_id);

update driver_ledger l set vehicle_id = dr.vehicle_id
  from drivers dr where dr.id = l.driver_id and l.vehicle_id is null;

create or replace function driver_ledger_set_links() returns trigger language plpgsql as $$
begin
  if new.vehicle_id is null and new.driver_id is not null then
    select vehicle_id into new.vehicle_id from drivers where id = new.driver_id;
  end if;
  return new;
end $$;
drop trigger if exists trg_driver_ledger_links on driver_ledger;
create trigger trg_driver_ledger_links before insert on driver_ledger
  for each row execute function driver_ledger_set_links();

-- ────────────────────────────────────────────────────────────
-- 9. salary_payments  (driver_ext_id text → add driver_id UUID FK)
-- ────────────────────────────────────────────────────────────
alter table salary_payments add column if not exists driver_id  uuid references drivers(id)  on delete set null;
alter table salary_payments add column if not exists vehicle_id uuid references vehicles(id)  on delete set null;
create index if not exists idx_salary_payments_driver  on salary_payments(driver_id);
create index if not exists idx_salary_payments_vehicle on salary_payments(vehicle_id);

update salary_payments s set driver_id = dr.id
  from drivers dr where dr.ext_id = s.driver_ext_id and s.driver_id is null;
update salary_payments s set vehicle_id = dr.vehicle_id
  from drivers dr where dr.id = s.driver_id and s.vehicle_id is null;

-- ────────────────────────────────────────────────────────────
-- 10. bill_reviews  (work_order_id → work_orders.vehicle_id)
-- ────────────────────────────────────────────────────────────
alter table bill_reviews add column if not exists vehicle_id uuid references vehicles(id) on delete set null;
create index if not exists idx_bill_reviews_vehicle on bill_reviews(vehicle_id);

update bill_reviews b set vehicle_id = w.vehicle_id
  from work_orders w where w.id = b.work_order_id and b.vehicle_id is null;

create or replace function bill_reviews_set_links() returns trigger language plpgsql as $$
begin
  if new.vehicle_id is null and new.work_order_id is not null then
    select vehicle_id into new.vehicle_id from work_orders where id = new.work_order_id;
  end if;
  return new;
end $$;
drop trigger if exists trg_bill_reviews_links on bill_reviews;
create trigger trg_bill_reviews_links before insert on bill_reviews
  for each row execute function bill_reviews_set_links();

-- ────────────────────────────────────────────────────────────
-- 11. work_order_lines  (work_order_id → work_orders.vehicle_id)
-- ────────────────────────────────────────────────────────────
alter table work_order_lines add column if not exists vehicle_id uuid references vehicles(id) on delete set null;
create index if not exists idx_work_order_lines_vehicle on work_order_lines(vehicle_id);

update work_order_lines l set vehicle_id = w.vehicle_id
  from work_orders w where w.id = l.work_order_id and l.vehicle_id is null;

create or replace function work_order_lines_set_links() returns trigger language plpgsql as $$
begin
  if new.vehicle_id is null and new.work_order_id is not null then
    select vehicle_id into new.vehicle_id from work_orders where id = new.work_order_id;
  end if;
  return new;
end $$;
drop trigger if exists trg_work_order_lines_links on work_order_lines;
create trigger trg_work_order_lines_links before insert on work_order_lines
  for each row execute function work_order_lines_set_links();

-- ────────────────────────────────────────────────────────────
-- 12. ingest_log  (ident → devices.ext_id or serial → vehicle)
-- ────────────────────────────────────────────────────────────
alter table ingest_log add column if not exists vehicle_id uuid references vehicles(id) on delete set null;
create index if not exists idx_ingest_log_vehicle on ingest_log(vehicle_id);

update ingest_log l set vehicle_id = d.vehicle_id
  from devices d
  where (d.imei = l.ident or d.external_id = l.ident)
    and l.vehicle_id is null and d.vehicle_id is not null;


-- ============================================================
-- Phase 2: Fleet Knowledge Graph Analysis Layer
-- ============================================================
-- Three views build a graph-DB–style query surface:
--
--  v_fleet_graph_nodes  — every entity as a labelled node
--  v_fleet_graph_edges  — every FK as a directed edge
--  v_vehicle_360        — per-vehicle 360° aggregate (all linked data)
--  v_driver_360         — per-driver 360° aggregate
--  fn_vehicle_subgraph  — recursive CTE traversal from any vehicle
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- Node registry
-- ────────────────────────────────────────────────────────────
create or replace view v_fleet_graph_nodes as

  select 'vehicle'::text as node_type,
         id::text        as node_id,
         coalesce(name, ext_id::text) as label,
         org_id, created_at
  from vehicles

  union all
  select 'driver', id::text,
         coalesce(name, phone, ext_id::text),
         org_id, created_at
  from drivers

  union all
  select 'trip', id::text,
         coalesce(trip_date::text, id::text),
         org_id, created_at
  from trips

  union all
  select 'device', id::text,
         coalesce(imei, external_id::text, model),
         org_id, created_at
  from devices

  union all
  select 'work_order', id::text,
         coalesce(ext_id::text, title, id::text),
         org_id, created_at
  from work_orders

  union all
  select 'issue', id::text,
         coalesce(title, id::text),
         org_id, created_at
  from issues

  union all
  select 'inspection', id::text,
         coalesce(inspection_date::text, id::text),
         org_id, created_at
  from inspections

  union all
  select 'reminder', id::text,
         coalesce(task, id::text),
         org_id, created_at
  from reminders

  union all
  select 'consignment', id::text,
         coalesce(lr_no, id::text),
         org_id, created_at
  from consignments

  union all
  select 'insurance_policy', id::text,
         coalesce(policy_no, id::text),
         org_id, created_at
  from insurance_policies

  union all
  select 'document', id::text,
         coalesce(doc_type, id::text),
         org_id, created_at
  from documents

  union all
  select 'device_event', id::text,
         event_type,
         org_id, occurred_at
  from device_events

  union all
  select 'fuel_log', id::text,
         ('Fill ' || coalesce(litres::text, '') || 'L'),
         org_id, created_at
  from fuel_logs

  union all
  select 'expense', id::text,
         coalesce(category, id::text),
         org_id, created_at
  from expenses

  union all
  select 'geofence_event', id::text,
         direction,
         org_id, occurred_at
  from geofence_events
;

-- ────────────────────────────────────────────────────────────
-- Edge registry — every FK as a directed edge
-- ────────────────────────────────────────────────────────────
create or replace view v_fleet_graph_edges as

  -- driver → vehicle (assignment)
  select 'driver'::text src_type, id::text src_id,
         'assigned_to'  edge_type,
         'vehicle'::text tgt_type, vehicle_id::text tgt_id,
         org_id, updated_at ts
  from drivers where vehicle_id is not null

  union all
  select 'device', id::text, 'mounted_on', 'vehicle', vehicle_id::text, org_id, installed_at
  from devices where vehicle_id is not null

  union all
  select 'trip', id::text, 'uses', 'vehicle', vehicle_id::text, org_id, created_at
  from trips where vehicle_id is not null

  union all
  select 'trip', id::text, 'driven_by', 'driver', driver_id::text, org_id, created_at
  from trips where driver_id is not null

  union all
  select 'fuel_log', id::text, 'for', 'vehicle', vehicle_id::text, org_id, created_at
  from fuel_logs where vehicle_id is not null

  union all
  select 'fuel_log', id::text, 'by', 'driver', driver_id::text, org_id, created_at
  from fuel_logs where driver_id is not null

  union all
  select 'issue', id::text, 'on', 'vehicle', vehicle_id::text, org_id, created_at
  from issues where vehicle_id is not null

  union all
  select 'issue', id::text, 'reported_by', 'driver', driver_id::text, org_id, created_at
  from issues where driver_id is not null

  union all
  select 'work_order', id::text, 'for', 'vehicle', vehicle_id::text, org_id, created_at
  from work_orders where vehicle_id is not null

  union all
  select 'inspection', id::text, 'of', 'vehicle', vehicle_id::text, org_id, created_at
  from inspections where vehicle_id is not null

  union all
  select 'reminder', id::text, 'for', 'vehicle', vehicle_id::text, org_id, created_at
  from reminders where vehicle_id is not null

  union all
  select 'device_event', id::text, 'on', 'vehicle', vehicle_id::text, org_id, occurred_at
  from device_events where vehicle_id is not null

  union all
  select 'device_event', id::text, 'by', 'driver', driver_id::text, org_id, occurred_at
  from device_events where driver_id is not null

  union all
  select 'expense', id::text, 'for', 'vehicle', vehicle_id::text, org_id, created_at
  from expenses where vehicle_id is not null

  union all
  select 'expense', id::text, 'by', 'driver', driver_id::text, org_id, created_at
  from expenses where driver_id is not null

  union all
  select 'consignment', id::text, 'carried_by', 'vehicle', vehicle_id::text, org_id, created_at
  from consignments where vehicle_id is not null

  union all
  select 'consignment', id::text, 'delivered_by', 'driver', driver_id::text, org_id, created_at
  from consignments where driver_id is not null

  union all
  select 'consignment', id::text, 'on_trip', 'trip', trip_id::text, org_id, created_at
  from consignments where trip_id is not null

  union all
  select 'trip_expense', id::text, 'for', 'vehicle', vehicle_id::text, org_id, created_at
  from trip_expenses where vehicle_id is not null

  union all
  select 'trip_expense', id::text, 'claimed_by', 'driver', driver_id::text, org_id, created_at
  from trip_expenses where driver_id is not null

  union all
  select 'geofence_event', id::text, 'triggered_by', 'vehicle', vehicle_id::text, org_id, occurred_at
  from geofence_events where vehicle_id is not null

  union all
  select 'insurance_policy', id::text, 'covers', 'vehicle', vehicle_id::text, org_id, created_at
  from insurance_policies where vehicle_id is not null

  union all
  select 'document', id::text, 'belongs_to_vehicle', 'vehicle', vehicle_id::text, org_id, created_at
  from documents where vehicle_id is not null

  union all
  select 'document', id::text, 'belongs_to_driver', 'driver', driver_id::text, org_id, created_at
  from documents where driver_id is not null

  union all
  select 'salary_payment', id::text, 'paid_to', 'driver', driver_id::text, org_id, initiated_at
  from salary_payments where driver_id is not null

  union all
  select 'salary_payment', id::text, 'for_vehicle', 'vehicle', vehicle_id::text, org_id, initiated_at
  from salary_payments where vehicle_id is not null

  union all
  select 'work_order', id::text, 'spawned_by', 'issue', issue_id::text, org_id, created_at
  from work_orders where issue_id is not null
;

-- ────────────────────────────────────────────────────────────
-- v_vehicle_360 — full 360° aggregate per vehicle
-- ────────────────────────────────────────────────────────────
create or replace view v_vehicle_360 as
select
  v.id                                          as vehicle_id,
  v.org_id,
  coalesce(v.name, v.ext_id::text)              as vehicle_name,
  v.make, v.model, v.year,
  v.type                                        as vehicle_type,
  -- current assignment
  dr.id                                         as driver_id,
  dr.name                                       as driver_name,
  dv.id                                         as device_id,
  dv.imei                                       as device_serial,
  -- trips & utilization
  (select count(*) from trips       where vehicle_id = v.id)::int  as total_trips,
  (select count(*) from trips       where vehicle_id = v.id and trip_date >= current_date - 30)::int as trips_30d,
  (select max(trip_date) from trips where vehicle_id = v.id)       as last_trip_date,
  -- fuel
  (select count(*) from fuel_logs   where vehicle_id = v.id)::int  as fuel_fills,
  (select max(odometer) from fuel_logs where vehicle_id = v.id)    as latest_odo,
  (select min(odometer) from fuel_logs where vehicle_id = v.id)    as first_odo,
  (select coalesce(sum(amount),0) from fuel_logs where vehicle_id = v.id)::numeric as total_fuel_cost,
  -- maintenance
  (select count(*) from issues      where vehicle_id = v.id and status <> 'Resolved')::int as open_issues,
  (select count(*) from issues      where vehicle_id = v.id and status = 'Resolved')::int  as resolved_issues,
  (select count(*) from work_orders where vehicle_id = v.id and status <> 'Completed')::int as open_work_orders,
  (select count(*) from reminders   where vehicle_id = v.id)::int  as reminders_count,
  (select count(*) from reminders   where vehicle_id = v.id and due_date < current_date)::int as overdue_services,
  (select count(*) from inspections where vehicle_id = v.id)::int  as inspections_count,
  -- safety (30 days)
  (select count(*) from device_events
   where vehicle_id = v.id
     and event_type in ('harsh_brake','harsh_accel','harsh_corner','overspeed')
     and occurred_at > now() - interval '30 days')::int             as hard_events_30d,
  (select count(*) from device_events
   where vehicle_id = v.id
     and event_type in ('fatigue','distraction','phone_use','no_seatbelt')
     and occurred_at > now() - interval '30 days')::int             as dms_events_30d,
  (select max(occurred_at) from device_events where vehicle_id = v.id) as last_event_at,
  -- freight / logistics
  (select count(*) from consignments where vehicle_id = v.id)::int  as consignments_count,
  (select coalesce(sum(freight_amount),0) from consignments where vehicle_id = v.id)::numeric as total_freight,
  -- financials
  (select coalesce(sum(amount),0) from expenses where vehicle_id = v.id)::numeric as total_expenses,
  -- compliance
  (select count(*) from insurance_policies where vehicle_id = v.id)::int as insurance_count,
  (select count(*) from documents           where vehicle_id = v.id)::int as documents_count,
  (select count(*) from vehicle_faults      where vehicle_id = v.id)::int as faults_count,
  -- telemetry events
  (select count(*) from device_events where vehicle_id = v.id)::int as total_device_events,
  (select count(*) from geofence_events where vehicle_id = v.id)::int as geofence_events_count
from vehicles v
left join drivers dr on dr.vehicle_id = v.id
left join devices dv on dv.vehicle_id = v.id
;

-- ────────────────────────────────────────────────────────────
-- v_driver_360 — full 360° aggregate per driver
-- ────────────────────────────────────────────────────────────
create or replace view v_driver_360 as
select
  dr.id                                           as driver_id,
  dr.org_id,
  dr.name                                         as driver_name,
  dr.phone,
  dr.dl_no,
  dr.dl_expiry,
  -- current vehicle
  v.id                                            as vehicle_id,
  coalesce(v.name, v.ext_id::text)                as vehicle_name,
  v.type                                          as vehicle_type,
  -- trips
  (select count(*) from trips where driver_id = dr.id)::int         as total_trips,
  (select count(*) from trips where driver_id = dr.id
     and trip_date >= current_date - 30)::int                        as trips_30d,
  (select max(trip_date) from trips where driver_id = dr.id)         as last_trip_date,
  -- expenses / claims
  (select count(*) from trip_expenses where driver_id = dr.id)::int  as expense_claims,
  (select coalesce(sum(amount),0) from trip_expenses
   where driver_id = dr.id and status = 'paid')::numeric             as total_reimbursed,
  -- payroll
  (select coalesce(sum(amount),0) from salary_payments
   where driver_id = dr.id and status = 'completed')::numeric        as total_salary_paid,
  -- safety (30d)
  (select count(*) from device_events
   where driver_id = dr.id
     and event_type in ('harsh_brake','harsh_accel','harsh_corner','overspeed')
     and occurred_at > now() - interval '30 days')::int              as hard_events_30d,
  (select count(*) from device_events
   where driver_id = dr.id
     and event_type in ('fatigue','distraction','phone_use','no_seatbelt')
     and occurred_at > now() - interval '30 days')::int              as dms_events_30d,
  -- activity
  (select count(*) from inspections      where driver_id = dr.id)::int as inspections_done,
  (select count(*) from issues           where driver_id = dr.id)::int as issues_reported,
  (select count(*) from consignments     where driver_id = dr.id)::int as deliveries,
  (select count(*) from coaching_sessions where driver_id = dr.id)::int as coaching_count,
  (select count(*) from driver_attendance where driver_id = dr.id)::int as attendance_days,
  -- last activity
  (select max(occurred_at) from device_events where driver_id = dr.id) as last_event_at
from drivers dr
left join vehicles v on v.id = dr.vehicle_id
;

-- ────────────────────────────────────────────────────────────
-- fn_vehicle_subgraph — traverse the knowledge graph from a vehicle
-- Usage: select * from fn_vehicle_subgraph('<vehicle_uuid>', 2);
-- Returns all nodes within N hops (default 2) of the given vehicle.
-- ────────────────────────────────────────────────────────────
create or replace function fn_vehicle_subgraph(p_vehicle_id uuid, p_hops int default 2)
returns table(node_type text, node_id text, label text, hop int, path text[])
language sql stable as $$
  with recursive graph(node_type, node_id, hop, path) as (
    select 'vehicle'::text, p_vehicle_id::text, 0, array[p_vehicle_id::text]
    union all
    select
      case when e.src_id = g.node_id then e.tgt_type else e.src_type end,
      case when e.src_id = g.node_id then e.tgt_id   else e.src_id  end,
      g.hop + 1,
      g.path || (case when e.src_id = g.node_id then e.tgt_id else e.src_id end)
    from graph g
    join v_fleet_graph_edges e
      on (e.src_id = g.node_id or e.tgt_id = g.node_id)
    where g.hop < p_hops
      and not (case when e.src_id = g.node_id then e.tgt_id else e.src_id end) = any(g.path)
  )
  select distinct on (g.node_id) g.node_type, g.node_id, n.label, g.hop, g.path
  from graph g
  join v_fleet_graph_nodes n on n.node_id = g.node_id
  order by g.node_id, g.hop
$$;

comment on view v_fleet_graph_nodes is
  'Every entity as a labelled node — vehicles, drivers, trips, devices, events, issues, documents, etc.';
comment on view v_fleet_graph_edges is
  'Every FK relationship as a directed edge. Traverse with recursive CTEs or fn_vehicle_subgraph().';
comment on view v_vehicle_360 is
  '360° per-vehicle view: trips, fuel, issues, work-orders, safety events, freight, financials and compliance all in one row.';
comment on view v_driver_360 is
  '360° per-driver view: trips, safety events, deliveries, coaching, payroll and attendance all in one row.';
comment on function fn_vehicle_subgraph(uuid, int) is
  'Returns all nodes reachable from p_vehicle_id within p_hops hops of the knowledge graph.';
