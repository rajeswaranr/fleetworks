# FleetWorks data model

Generated from the live database (Supabase project `crdblxeufbhysglbbtxi`) on
2026-09-29: **131 tables, 16 views, 222 foreign keys**, every table under row-level
security. Every tenant table carries `org_id → organizations`; access is generated
per table from `rbac_table_registry` (see `supabase/migrations/20260922110000_rbac_enforce.sql`).

The diagrams show the main tables of each domain and how they join. Columns are
limited to keys and the fields that define the relationship; the migrations are the
full reference.

## 1. Tenancy and access

```mermaid
erDiagram
  organizations ||--o{ memberships : "has members"
  memberships }o--|| rbac_roles : "has role"
  rbac_roles ||--o{ rbac_role_permissions : grants
  rbac_role_permissions }o--|| rbac_permissions : "permission (resource:action)"
  organizations ||--o{ vehicle_assignments : "scopes supervisors / drivers"
  organizations ||--o{ audit_log : records
  organizations { uuid id PK
    text name }
  memberships { uuid org_id FK
    uuid user_id FK
    uuid role_id FK
    text role }
  rbac_role_permissions { uuid role_id FK
    text permission FK
    text scope "all | assigned | own" }
```

## 2. Fleet core: vehicles, people, places

```mermaid
erDiagram
  organizations ||--o{ vehicles : owns
  organizations ||--o{ drivers : employs
  vehicles ||--o{ drivers : "assigned driver"
  vehicles ||--o{ documents : "RC, permit, insurance…"
  drivers ||--o{ driver_documents : "DL, medical…"
  vehicles ||--o{ assets : "tows trailer / genset"
  organizations ||--o{ sites : "depots, customer sites"
  projects ||--o{ project_sites : covers
  sites ||--o{ project_sites : "part of"
  sites ||--o{ site_vehicle_assignments : deploys
  vehicles ||--o{ site_vehicle_assignments : "deployed to"
  sites ||--o{ geofences : "fenced by"
  sites ||--o{ daily_dispatch : plans
  vehicles { uuid id PK
    uuid org_id FK
    text ext_id "browser id"
    text name "registration"
    numeric tank_capacity }
  drivers { uuid id PK
    uuid vehicle_id FK
    uuid user_id FK "team-portal login" }
```

## 3. Trips, fuel and money

```mermaid
erDiagram
  vehicles ||--o{ trips : runs
  drivers ||--o{ trips : drives
  trips ||--o{ trip_stops : "loading / unloading"
  trips ||--o{ trip_events : milestones
  trips ||--o{ trip_requests : "diesel / advance / toll asks"
  trips ||--o{ trip_expenses : "on-trip spend"
  vehicles ||--o{ fuel_logs : "diesel fills"
  vehicles ||--o{ def_logs : "AdBlue fills"
  vehicles ||--o{ ev_charging_sessions : charges
  vehicles ||--o{ expenses : "costs"
  expense_categories ||--o{ expenses : classifies
  drivers ||--o{ driver_ledger : "khata"
  drivers ||--o{ salary_payments : paid
  vehicles ||--o{ fastag_accounts : "FASTag"
  fastag_accounts ||--o{ fastag_balance_log : balance
  parties ||--o{ sales_invoices : billed
  trips ||--o{ sales_invoices : "freight invoice"
  sales_invoices ||--o{ sales_invoice_lines : lines
  gst_invoices ||--o{ eway_bills : "e-way bill"
```

## 4. Maintenance

```mermaid
erDiagram
  vehicles ||--o{ issues : "problems reported"
  issues ||--o{ work_orders : "job card"
  work_orders ||--o{ work_order_lines : "parts + labour"
  work_orders ||--o{ bill_reviews : "AI bill check"
  work_orders ||--o{ purchase_orders : "parts ordered"
  purchase_orders ||--o{ purchase_order_lines : lines
  vehicles ||--o{ reminders : "service due"
  automation_rules ||--o{ reminders : creates
  automation_rules ||--o{ automation_runs : runs
  vehicles ||--o{ inspections : "checks done"
  vehicles ||--o{ inspection_schedules : "checks due"
  service_programs ||--o{ service_program_tasks : "tasks + intervals"
  service_programs ||--o{ service_program_vehicles : "applies to"
  vehicles ||--o{ vehicle_recalls : "maker recalls"
  vehicles ||--o{ vehicle_faults : "fault codes"
  tyres ||--o{ tyre_fitments : "fitted on"
  vehicles ||--o{ tyre_fitments : wheels
  tyres ||--o{ tyre_readings : "tread / pressure"
```

## 5. FleetSafe: devices, telemetry, incidents

```mermaid
erDiagram
  vehicles ||--o{ devices : "fitted with"
  devices ||--o{ devices : "sensor attached to tracker"
  devices ||--o{ device_channels : "camera channels"
  devices ||--o{ device_sensors : "parameter → signal mapping"
  vehicle_signals ||--o{ device_sensors : target
  devices ||--o{ telemetry : readings
  devices ||--|| vehicle_twin : "live state"
  devices ||--o{ device_events : "camera / tracker alarms"
  devices ||--o{ ai_events : "rule detections"
  vehicle_signals ||--o{ ai_events : "signal"
  device_events ||--o{ device_media : "clips, snapshots"
  device_events ||--o{ coaching_sessions : "coached"
  coaching_meetings ||--o{ coaching_sessions : groups
  geofences ||--o{ geofence_events : "enter / exit"
  geofences ||--o{ geofence_presence : "inside now"
  vehicles ||--o{ driver_locations : "phone GPS"
  vehicles ||--o{ fleet_alerts : "inbox + SMS outbox"
  cold_chain_vehicles ||--o{ cold_chain_compliance : "nightly record"
  integration_keys ||--o{ ingest_log : "used by"
  telemetry { bigint id PK
    uuid device_id FK
    timestamptz recorded_at
    numeric fuel_level_pct
    numeric cargo_temp_c
    jsonb raw "every parameter as sent" }
  fleet_alerts { uuid id PK
    text source "table it came from"
    uuid source_id
    text delivery "in_app | pending | sent | failed | skipped" }
```

`incident_analyses` points at either `ai_events` or `device_events` by
(`source`, `event_id`): a polymorphic reference, so it has no foreign key.

## 6. Workshop marketplace and service workflow

```mermaid
erDiagram
  vehicles ||--o{ service_requests : "book service"
  workshops ||--o{ mechanics : employs
  service_advisors ||--o{ workshops : manages
  service_requests ||--o{ request_assignments : "offered to"
  service_requests ||--o{ assessments : inspected
  assessments ||--o{ estimates : quoted
  estimates ||--o{ estimate_items : lines
  service_requests ||--o{ work_logs : work
  service_requests ||--o{ invoices : billed
  invoices ||--o{ payments : paid
  workshops ||--o{ payout_cycles : "fortnightly payout"
  payout_cycles ||--o{ payout_lines : lines
  service_requests ||--o{ status_events : "12-stage audit"
  service_requests ||--o{ feedback : rated
```

Also: `insurance_policies → insurance_claims`, `whatsapp_contacts → whatsapp_messages`,
`vendor_leads / scraper_runs` (partner sourcing), `leads`, `vendor_applications`.

## 7. Which page uses which tables

| Page | Tables (read / write) |
|---|---|
| Home, FleetOps Dashboard | vehicles, drivers, issues, work_orders, reminders, documents, inspections, expenses, fuel_logs |
| Add Vehicle, Vehicle List & RTO | vehicles, documents |
| Trips & Loads | trips, trip_stops, trip_events, trip_requests, trip_expenses |
| Drivers & Contacts, Assignments | drivers, vehicle_assignments |
| Work Orders, Service History, Service Tasks | work_orders, work_order_lines, bill_reviews, issues |
| **Service Programs** | service_programs, service_program_tasks, service_program_vehicles *(new)* |
| Spares Godown, Purchase Orders | parts, purchase_orders, purchase_order_lines |
| Tyre Readings | tyres, tyre_fitments, tyre_readings (v_tyre_manager) |
| Inspections, Forms | inspections |
| **Inspection Schedules** | inspection_schedules *(new)* |
| Issues | issues |
| **Faults** | vehicle_faults *(new)* |
| **Recalls** | vehicle_recalls *(new)* |
| Reminders, Renewals, Compliance Radar | reminders, documents, driver_documents, vehicles |
| Fuel Dashboard, Diesel & Mileage | fuel_logs |
| **DEF / AdBlue** | def_logs *(new)* |
| **EV Charging** | ev_charging_sessions *(new)* |
| **Places** | sites, geofences *(no new table)* |
| FleetFin: Expenses, Bills, Accounts, Reports | expenses, expense_categories, expense_change_requests, gst_invoices |
| Driver Khata, Payroll | driver_ledger, salary_payments, payment_requests, driver_payout_details |
| Toll & FASTag | fastag_accounts, fastag_balance_log |
| Invoices, Purchase Invoices | sales_invoices, sales_invoice_lines, parties, items |
| WhatsApp | whatsapp_contacts, whatsapp_messages, whatsapp_templates |
| Command Centre, Safety & Coaching | v_safety_events, v_driver_safety_score, coaching_sessions, ai_events, devices |
| Incident Triage | ai_events, device_events, incident_analyses, device_media |
| AI Vision | devices, device_events |
| Fleet View, Operation Centre | vehicles, driver_locations, vehicle_twin, geofences, assets, ai_events |
| Geofences, Assets & Trailers | geofences, geofence_events, assets |
| Device Hub | devices, device_channels, device_sensors, integration_keys, ingest_log, fleet_alerts, fleetsafe_settings |
| Fuel Sensor & Theft | telemetry, ai_events, devices |
| Insurance | insurance_policies, insurance_claims (v_insurance_radar) |
| Book Service, Find a Garage | service_requests and the workflow tables, v_workshop_directory |
| Team & Access | memberships, rbac_roles, vehicle_assignments |
| Sites & Projects, Daily Dispatch | sites, projects, project_sites, site_vehicle_assignments, daily_dispatch |

The six pages marked *new* have their tables from migration
`20260929110000_placeholder_pages_tables.sql`; their screens are still "Coming soon".

## 8. Known model debt

* **Two tyre models.** `tyres / tyre_fitments / tyre_readings` (used by the app) and
  `tire_registry / tire_pressure_readings / tire_*` (unused). Pick one and drop the other.
* **Two telemetry models.** `telemetry` (the live pipeline) and `vehicle_telemetry` plus its
  `_hourly / _daily / _latest` views from the abandoned TimescaleDB design. The same for
  `temperature_readings` (superseded by `telemetry.cargo_temp_c`) and
  `fuel_trips / fuel_alerts` (superseded by `ai_events`).
* **Deletes blocked.** 20 foreign keys to `organizations` / `vehicles` have no `on delete`
  rule, so deleting a fleet or a vehicle fails. A fix is queued as a separate task.
* **`fleets`** still holds the per-owner JSON blob; since the DB-direct migration it carries
  settings only.

## 9. Should FleetWorks move to a graph database?

**No, not as the system of record.** A graph model is the right tool when the questions
are deep, variable-length relationship walks ("everyone within 5 hops of X"). FleetWorks'
data is the opposite shape:

* **Tenant-scoped and permissioned row by row.** Security is Postgres row-level
  security generated per table; no graph database offers an equivalent that plugs
  into Supabase auth.
* **Transactions matter.** A reading, the geofence edge it causes and the alert it
  raises commit together; payroll, invoices and GST need strict consistency.
* **Most data is time series and ledgers** (telemetry, fuel, expenses, khata), which
  graph stores handle poorly.
* **The relationships are shallow**: vehicle → driver → trip → site is 1–3 joins, which
  Postgres answers in milliseconds with the foreign keys above.
* **Platform fit.** Supabase does not offer Apache AGE, the extension that gives Postgres a
  Cypher graph layer. A separate graph database (Neo4j and the like) would be a second
  datastore to run and sync, against the no-extra-infrastructure rule.

**What gives the graph view without the cost**, all available on this database:

1. **`pg_graphql`** (available, not enabled): query the existing tables as a graph of
   linked records (`vehicle { drivers { trips { stops } } }`) over the same RLS.
2. **Recursive CTEs** for the few real traversals (who-reports-to-whom, part ←
   supplier ← vendor chains).
3. **`pgRouting`** (available) if route optimisation on a road network is ever needed:
   graph algorithms where they actually help.
4. A **relationship view** (`from_type, from_id, rel, to_type, to_id`) generated from the
   foreign keys, if a graph visualisation of a fleet is wanted in the UI.
