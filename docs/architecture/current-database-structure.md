# Current FleetWorks Database Structure

Prepared on: 2026-08-15

## Purpose

This document describes the current FleetWorks database tables, important fields, and foreign-key relationships.

The schema is PostgreSQL/Supabase based. Supabase provides the `auth.users` table. FleetWorks application tables are defined mainly in:

```text
db/schema.sql
db/schema-fleet.sql
db/schema-normalized.sql
db/schema-db-direct-core.sql
db/schema-db-direct-remaining.sql
db/schema-team-access.sql
db/schema-driver-links.sql
db/schema-payment-approvals.sql
db/schema-expense-approvals.sql
db/schema-payroll.sql
db/schema-service-workflow.sql
db/schema-admin-dashboard.sql
supabase/migrations/*.sql
```

## High-Level Model

```text
auth.users
  -> memberships
      -> organizations
          -> vehicles
              -> fuel_logs
              -> expenses
              -> issues
              -> work_orders
              -> reminders
              -> inspections
              -> tyre_readings
              -> trips
              -> documents
          -> drivers
              -> documents
              -> driver_ledger
              -> payroll records by driver_ext_id
```

Important rules:

- `organizations` is the tenant/company root table.
- Most production fleet tables have `org_id`.
- Most vehicle activity tables also have `vehicle_id`.
- Supabase `auth.users` is the identity table.
- Row Level Security uses org membership and role checks to isolate tenant data.
- Some older or bridge tables still use stable client ids such as `ext_id`, `vehicle_ext_id`, or `driver_ext_id`.

## Core Tenancy Tables

### `organizations`

Tenant/company table.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | uuid | Primary key |
| `name` | text | Organization/fleet name |
| `gstin` | text | GSTIN |
| `city` | text | City |
| `warn_days` | int | Compliance warning window |
| `min_tread_mm` | numeric | Minimum tyre tread setting |
| `mileage_drop_pct` | numeric | Mileage alert setting |
| `created_at` | timestamptz | Created timestamp |
| `updated_at` | timestamptz | Updated timestamp |

Foreign keys: none.

### `memberships`

Connects users to organizations.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | uuid | Primary key |
| `org_id` | uuid | FK to `organizations.id` |
| `user_id` | uuid | FK to `auth.users.id` |
| `role` | text | `owner`, `manager`, `viewer`, `supervisor`, `driver` |
| `created_at` | timestamptz | Created timestamp |

Foreign keys:

| Field | References | Delete behavior |
| --- | --- | --- |
| `org_id` | `organizations(id)` | cascade |
| `user_id` | `auth.users(id)` | cascade |

Unique constraints:

```text
unique (org_id, user_id)
```

## Legacy Cloud Sync Table

### `fleets`

Older per-owner JSON cloud-sync table. Some analytics views still read from this blob shape.

| Field | Type | Notes |
| --- | --- | --- |
| `owner_id` | uuid | Primary key, FK to `auth.users.id` |
| `updated_at` | timestamptz | Last update timestamp |
| `data` | jsonb | Full fleet blob |

Foreign keys:

| Field | References | Delete behavior |
| --- | --- | --- |
| `owner_id` | `auth.users(id)` | cascade |

## Fleet Core Tables

### `vehicles`

Fleet vehicle master table.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | uuid | Primary key |
| `org_id` | uuid | FK to `organizations.id` |
| `ext_id` | text | Stable client-side id from older local/blob model |
| `name` | text | Registration/vehicle name |
| `type` | text | Vehicle type |
| `status` | text | Defaults to `Active` |
| `make` | text | Manufacturer |
| `model` | text | Model |
| `year` | int | Model year |
| `chassis_no` | text | Chassis number |
| `engine_no` | text | Engine number |
| `ownership` | text | Owned/leased/financed/etc. |
| `km_per_month` | numeric | Average monthly running |
| `fleet_group` | text | Group/category |
| `depot` | text | Base depot/city |
| `emission` | text | Emission norm |
| `fuel_type` | text | Fuel type |
| `tank_capacity` | numeric | Tank capacity |
| `color` | text | Vehicle color |
| `gvw` | numeric | Gross vehicle weight |
| `payload` | numeric | Payload capacity |
| `axle_config` | text | Axle configuration |
| `tyre_front_psi` | numeric | Front tyre PSI |
| `tyre_rear_psi` | numeric | Rear tyre PSI |
| `tyre_size` | text | Tyre size |
| `insurance_till` | date | Insurance validity |
| `puc_till` | date | PUC validity |
| `fitness_till` | date | Fitness/FC validity |
| `permit_till` | date | Permit validity |
| `roadtax_till` | date | Road tax validity |
| `rto` | text | RTO office |
| `purchase_date` | date | Purchase date |
| `purchase_price` | numeric | Purchase price |
| `purchase_vendor` | text | Purchased from |
| `in_service_date` | date | In-service date |
| `service_life_months` | int | Estimated service life |
| `resale_value` | numeric | Estimated resale value |
| `notes` | text | Notes |
| `created_at` | timestamptz | Created timestamp |
| `updated_at` | timestamptz | Updated timestamp |

Foreign keys:

| Field | References | Delete behavior |
| --- | --- | --- |
| `org_id` | `organizations(id)` | cascade |

Unique constraints:

```text
unique (org_id, ext_id)
```

### `drivers`

Driver master table.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | uuid | Primary key |
| `org_id` | uuid | FK to `organizations.id` |
| `ext_id` | text | Stable client-side id |
| `name` | text | Driver name |
| `phone` | text | Mobile number |
| `dl_no` | text | Driving licence number |
| `dl_expiry` | date | Licence expiry |
| `vehicle_id` | uuid | Optional assigned vehicle |
| `upi_id` | text | Driver UPI id |
| `bank_account` | text | Driver bank account |
| `bank_ifsc` | text | Driver IFSC |
| `created_at` | timestamptz | Created timestamp |
| `updated_at` | timestamptz | Updated timestamp |

Foreign keys:

| Field | References | Delete behavior |
| --- | --- | --- |
| `org_id` | `organizations(id)` | cascade |
| `vehicle_id` | `vehicles(id)` | set null |

Unique constraints:

```text
unique (org_id, ext_id)
```

### `documents`

Vehicle or driver document table.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | uuid | Primary key |
| `org_id` | uuid | FK to `organizations.id` |
| `entity_type` | text | `vehicle` or `driver` |
| `vehicle_id` | uuid | FK to `vehicles.id`, required when `entity_type = vehicle` |
| `driver_id` | uuid | FK to `drivers.id`, required when `entity_type = driver` |
| `doc_type` | text | Document type |
| `number` | text | Document number |
| `issue_date` | date | Issue date |
| `expiry_date` | date | Expiry date |
| `note` | text | Notes |
| `file_path` | text | Supabase Storage path |
| `created_at` | timestamptz | Created timestamp |

Foreign keys:

| Field | References | Delete behavior |
| --- | --- | --- |
| `org_id` | `organizations(id)` | cascade |
| `vehicle_id` | `vehicles(id)` | cascade |
| `driver_id` | `drivers(id)` | cascade |

Check constraint:

```text
entity_type = vehicle -> vehicle_id required and driver_id null
entity_type = driver  -> driver_id required and vehicle_id null
```

### `fuel_logs`

Fuel/diesel log table.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | uuid | Primary key |
| `org_id` | uuid | FK to `organizations.id` |
| `vehicle_id` | uuid | FK to `vehicles.id` |
| `log_date` | date | Fill date |
| `litres` | numeric | Litres |
| `amount` | numeric | Amount |
| `odometer` | numeric | Odometer reading |
| `opening` | boolean | Opening fuel entry flag |
| `created_at` | timestamptz | Created timestamp |

Foreign keys:

| Field | References | Delete behavior |
| --- | --- | --- |
| `org_id` | `organizations(id)` | cascade |
| `vehicle_id` | `vehicles(id)` | cascade |

### `expenses`

Vehicle expense/bill table.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | uuid | Primary key |
| `org_id` | uuid | FK to `organizations.id` |
| `vehicle_id` | uuid | FK to `vehicles.id` |
| `expense_date` | date | Expense date |
| `category` | text | Expense category |
| `amount` | numeric | Amount |
| `odo` | numeric | Odometer |
| `title` | text | Bill title |
| `vendor` | text | Vendor name |
| `gstin` | text | Vendor GSTIN |
| `bill_no` | text | Bill number |
| `bill_path` | text | Uploaded bill path |
| `items` | jsonb | Bill line items from OCR/manual entry |
| `created_at` | timestamptz | Created timestamp |

Foreign keys:

| Field | References | Delete behavior |
| --- | --- | --- |
| `org_id` | `organizations(id)` | cascade |
| `vehicle_id` | `vehicles(id)` | cascade |

### `issues`

Reported vehicle issue table.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | uuid | Primary key |
| `org_id` | uuid | FK to `organizations.id` |
| `ext_id` | text | Stable client-side id |
| `vehicle_id` | uuid | FK to `vehicles.id` |
| `title` | text | Issue title |
| `severity` | text | Severity |
| `status` | text | Status |
| `reported_at` | date | Reported date |
| `resolved_at` | date | Resolved date |
| `source` | text | Source |
| `created_at` | timestamptz | Created timestamp |

Foreign keys:

| Field | References | Delete behavior |
| --- | --- | --- |
| `org_id` | `organizations(id)` | cascade |
| `vehicle_id` | `vehicles(id)` | cascade |

Unique constraints:

```text
unique (org_id, ext_id)
```

### `work_orders`

Vehicle maintenance work order table.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | uuid | Primary key |
| `org_id` | uuid | FK to `organizations.id` |
| `ext_id` | text | Stable client-side id |
| `vehicle_id` | uuid | FK to `vehicles.id` |
| `issue_id` | uuid | Optional FK to `issues.id` |
| `title` | text | Work title |
| `vendor` | text | Vendor/workshop |
| `est_cost` | numeric | Estimated cost |
| `final_cost` | numeric | Final cost |
| `status` | text | Status |
| `opened_at` | date | Opened date |
| `completed_at` | date | Completed date |
| `created_at` | timestamptz | Created timestamp |

Foreign keys:

| Field | References | Delete behavior |
| --- | --- | --- |
| `org_id` | `organizations(id)` | cascade |
| `vehicle_id` | `vehicles(id)` | cascade |
| `issue_id` | `issues(id)` | set null |

Unique constraints:

```text
unique (org_id, ext_id)
```

### `parts`

Spares inventory table.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | uuid | Primary key |
| `org_id` | uuid | FK to `organizations.id` |
| `name` | text | Part name |
| `part_number` | text | Part number |
| `make` | text | Make |
| `category` | text | Category |
| `sourcing` | text | Sourcing type |
| `vendor` | text | Vendor |
| `vendor_contact` | text | Vendor contact |
| `unit_cost` | numeric | Unit cost |
| `qty` | numeric | Quantity |
| `min_qty` | numeric | Minimum quantity |
| `location` | text | Storage location |
| `purchase_date` | date | Purchase date |
| `warranty_expiry` | date | Warranty expiry |
| `created_at` | timestamptz | Created timestamp |

Foreign keys:

| Field | References | Delete behavior |
| --- | --- | --- |
| `org_id` | `organizations(id)` | cascade |

### `reminders`

Vehicle service/compliance reminder table.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | uuid | Primary key |
| `org_id` | uuid | FK to `organizations.id` |
| `vehicle_id` | uuid | FK to `vehicles.id` |
| `task` | text | Reminder task |
| `every_months` | int | Interval in months |
| `last_date` | date | Last done date |
| `created_at` | timestamptz | Created timestamp |

Foreign keys:

| Field | References | Delete behavior |
| --- | --- | --- |
| `org_id` | `organizations(id)` | cascade |
| `vehicle_id` | `vehicles(id)` | cascade |

### `inspections`

Vehicle inspection checklist table.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | uuid | Primary key |
| `org_id` | uuid | FK to `organizations.id` |
| `vehicle_id` | uuid | FK to `vehicles.id` |
| `inspection_date` | date | Inspection date |
| `passed` | boolean | Passed flag |
| `results` | jsonb | Checklist result payload |
| `odo` | numeric | Odometer |
| `notes` | text | Notes |
| `created_at` | timestamptz | Created timestamp |

Foreign keys:

| Field | References | Delete behavior |
| --- | --- | --- |
| `org_id` | `organizations(id)` | cascade |
| `vehicle_id` | `vehicles(id)` | cascade |

### `tyre_readings`

Tyre tread/pressure reading table.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | uuid | Primary key |
| `org_id` | uuid | FK to `organizations.id` |
| `vehicle_id` | uuid | FK to `vehicles.id` |
| `position` | text | Wheel position |
| `tread_depth_mm` | numeric | Tread depth |
| `pressure_psi` | numeric | Tyre pressure |
| `odometer` | numeric | Odometer |
| `reading_date` | date | Reading date |
| `created_at` | timestamptz | Created timestamp |

Foreign keys:

| Field | References | Delete behavior |
| --- | --- | --- |
| `org_id` | `organizations(id)` | cascade |
| `vehicle_id` | `vehicles(id)` | cascade |

### `trips`

Trip/freight table.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | uuid | Primary key |
| `org_id` | uuid | FK to `organizations.id` |
| `vehicle_id` | uuid | FK to `vehicles.id` |
| `trip_date` | date | Trip date |
| `from_loc` | text | Start location |
| `to_loc` | text | End location |
| `freight` | numeric | Freight amount |
| `km` | numeric | Trip kilometers |
| `created_at` | timestamptz | Created timestamp |

Foreign keys:

| Field | References | Delete behavior |
| --- | --- | --- |
| `org_id` | `organizations(id)` | cascade |
| `vehicle_id` | `vehicles(id)` | cascade |

### `driver_ledger`

Driver khata/ledger table.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | uuid | Primary key |
| `org_id` | uuid | FK to `organizations.id` |
| `driver_id` | uuid | FK to `drivers.id` |
| `entry_date` | date | Entry date |
| `type` | text | Entry type |
| `amount` | numeric | Amount |
| `note` | text | Note |
| `created_at` | timestamptz | Created timestamp |

Foreign keys:

| Field | References | Delete behavior |
| --- | --- | --- |
| `org_id` | `organizations(id)` | cascade |
| `driver_id` | `drivers(id)` | cascade |

## Team Access And Approval Tables

### `vehicle_assignments`

Vehicle-level access table for supervisors/drivers.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | uuid | Primary key |
| `org_id` | uuid | FK to `organizations.id` |
| `user_id` | uuid | FK to `auth.users.id` |
| `vehicle_ext_id` | text | Stable vehicle ext id |
| `access` | text | `view` or `update` |
| `created_at` | timestamptz | Created timestamp |

Foreign keys:

| Field | References | Delete behavior |
| --- | --- | --- |
| `org_id` | `organizations(id)` | cascade |
| `user_id` | `auth.users(id)` | cascade |

Unique constraints:

```text
unique (org_id, user_id, vehicle_ext_id)
```

### `expense_change_requests`

Approval queue for non-owner expense create/update requests.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | uuid | Primary key |
| `org_id` | uuid | FK to `organizations.id` |
| `expense_id` | uuid | Optional FK to `expenses.id`; null means new expense |
| `vehicle_id` | uuid | FK to `vehicles.id` |
| `action` | text | `create` or `update` |
| `patch` | jsonb | Proposed expense fields |
| `status` | text | `pending`, `approved`, `rejected` |
| `requested_by` | uuid | FK to `auth.users.id` |
| `decided_by` | uuid | FK to `auth.users.id` |
| `decided_at` | timestamptz | Decision timestamp |
| `note` | text | Decision/review note |
| `created_at` | timestamptz | Created timestamp |

Foreign keys:

| Field | References | Delete behavior |
| --- | --- | --- |
| `org_id` | `organizations(id)` | cascade |
| `expense_id` | `expenses(id)` | cascade |
| `vehicle_id` | `vehicles(id)` | cascade |
| `requested_by` | `auth.users(id)` | default |
| `decided_by` | `auth.users(id)` | default |

### `driver_entries`

No-login driver submission table for fuel, issue, and inspection entries.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | uuid | Primary key |
| `owner_id` | uuid | Owner user id; not declared as FK in current SQL |
| `token` | text | Driver link token |
| `driver_name` | text | Driver name |
| `vehicle_name` | text | Vehicle name |
| `kind` | text | `fuel`, `issue`, or `inspection` |
| `payload` | jsonb | Submitted data |
| `consumed` | boolean | Whether owner app consumed the row |
| `created_at` | timestamptz | Created timestamp |

Foreign keys: none declared in current SQL.

## Finance, Payments, And Payroll Tables

### `payment_requests`

Owner-UPI payment approval queue.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | uuid | Primary key |
| `org_id` | uuid | FK to `organizations.id` |
| `driver_ext_id` | text | Stable driver ext id |
| `amount` | numeric | Amount |
| `period` | text | Salary period, example `2026-07` |
| `note` | text | Request note |
| `status` | text | `pending`, `paid`, `rejected` |
| `utr` | text | UPI reference |
| `requested_by` | uuid | User who queued it; not declared as FK |
| `decided_at` | timestamptz | Decision timestamp |
| `created_at` | timestamptz | Created timestamp |

Foreign keys:

| Field | References | Delete behavior |
| --- | --- | --- |
| `org_id` | `organizations(id)` | cascade |

### `driver_payout_details`

Masked Cashfree beneficiary/payout detail table.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | uuid | Primary key |
| `org_id` | uuid | FK to `organizations.id` |
| `driver_ext_id` | text | Stable driver ext id |
| `method` | text | `bank` or `upi` |
| `account_holder_name` | text | Account holder name |
| `bank_ifsc` | text | IFSC |
| `bank_account_last4` | text | Last 4 digits only |
| `upi_id_masked` | text | Masked UPI id |
| `cf_beneficiary_id` | text | Cashfree beneficiary id |
| `beneficiary_status` | text | Cashfree beneficiary status |
| `created_at` | timestamptz | Created timestamp |
| `updated_at` | timestamptz | Updated timestamp |

Foreign keys:

| Field | References | Delete behavior |
| --- | --- | --- |
| `org_id` | `organizations(id)` | cascade |

Unique constraints:

```text
unique (org_id, driver_ext_id)
```

### `salary_payments`

Driver salary payment ledger.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | uuid | Primary key |
| `org_id` | uuid | FK to `organizations.id` |
| `driver_ext_id` | text | Stable driver ext id |
| `period` | text | Salary period |
| `amount` | numeric | Amount |
| `method` | text | Payment method |
| `source` | text | `manual` or `cashfree` |
| `status` | text | `pending`, `processing`, `success`, `failed`, `reversed` |
| `transfer_ref` | text | FleetWorks/Cashfree transfer reference |
| `cf_transfer_id` | text | Cashfree transfer id |
| `utr` | text | UTR/UPI reference |
| `failure_reason` | text | Failure reason |
| `notes` | text | Notes |
| `initiated_by` | uuid | FK to `auth.users.id` |
| `initiated_at` | timestamptz | Initiated timestamp |
| `completed_at` | timestamptz | Completion timestamp |

Foreign keys:

| Field | References | Delete behavior |
| --- | --- | --- |
| `org_id` | `organizations(id)` | cascade |
| `initiated_by` | `auth.users(id)` | default |

Unique constraints:

```text
unique (org_id, transfer_ref)
```

## Garage And Service Workflow Tables

Service workflow stages:

```text
raised -> assigned -> accepted -> reached -> assessed -> approved
-> in_progress -> completed -> invoiced -> paid -> reported -> closed
```

Enums:

| Enum | Values |
| --- | --- |
| `request_stage` | `raised`, `assigned`, `accepted`, `reached`, `assessed`, `approved`, `in_progress`, `completed`, `invoiced`, `paid`, `reported`, `closed`, `cancelled` |
| `actor_role` | `owner`, `mechanic`, `fleetworks`, `system` |
| `estimate_status` | `draft`, `sent`, `approved`, `rejected`, `expired` |
| `invoice_status` | `draft`, `issued`, `paid`, `void` |
| `payout_status` | `accruing`, `due`, `paid` |
| `attachment_kind` | `repair_photo`, `assessment_photo`, `invoice_pdf`, `report_pdf`, `other` |

### `workshops`

Partner workshop table.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | uuid | Primary key |
| `owner_user` | uuid | Partner auth user id; not declared as FK |
| `name` | text | Workshop name |
| `city` | text | City |
| `address` | text | Address |
| `lat` | double precision | Latitude |
| `lng` | double precision | Longitude |
| `phone` | text | Phone |
| `gstin` | text | GSTIN |
| `services` | text[] | Services offered |
| `rating` | numeric | Rating |
| `active` | boolean | Active flag |
| `advisor_id` | uuid | FK to `service_advisors.id` |
| `created_at` | timestamptz | Created timestamp |

Foreign keys:

| Field | References | Delete behavior |
| --- | --- | --- |
| `advisor_id` | `service_advisors(id)` | default |

### `mechanics`

Mechanic table under a workshop.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | uuid | Primary key |
| `workshop_id` | uuid | FK to `workshops.id` |
| `name` | text | Mechanic name |
| `phone` | text | Phone |
| `years_exp` | int | Years of experience |
| `specialties` | text[] | Specialties |
| `rating` | numeric | Rating |
| `active` | boolean | Active flag |
| `created_at` | timestamptz | Created timestamp |

Foreign keys:

| Field | References | Delete behavior |
| --- | --- | --- |
| `workshop_id` | `workshops(id)` | cascade |

### `service_advisors`

FleetWorks service advisor table.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | uuid | Primary key |
| `name` | text | Advisor name |
| `phone` | text | Phone |
| `email` | text | Email |
| `cluster` | text | Cluster/region |

Foreign keys: none.

### `service_requests`

Owner service request/complaint table.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | uuid | Primary key |
| `org_id` | uuid | FK to `organizations.id` |
| `vehicle_id` | uuid | FK to `vehicles.id` |
| `raised_by` | uuid | Owner-side auth user id; not declared as FK |
| `issue` | text | Issue description |
| `severity` | text | `Low`, `Medium`, `High` |
| `stage` | request_stage | Current workflow stage |
| `workshop_id` | uuid | FK to `workshops.id` |
| `mechanic_id` | uuid | FK to `mechanics.id` |
| `created_at` | timestamptz | Created timestamp |
| `updated_at` | timestamptz | Updated timestamp |

Foreign keys:

| Field | References | Delete behavior |
| --- | --- | --- |
| `org_id` | `organizations(id)` | cascade |
| `vehicle_id` | `vehicles(id)` | default |
| `workshop_id` | `workshops(id)` | default |
| `mechanic_id` | `mechanics(id)` | default |

### `request_assignments`

Assignment history for service requests.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | uuid | Primary key |
| `request_id` | uuid | FK to `service_requests.id` |
| `workshop_id` | uuid | FK to `workshops.id` |
| `mechanic_id` | uuid | FK to `mechanics.id` |
| `distance_km` | numeric | Distance |
| `assigned_by` | actor_role | Assigned by |
| `assigned_at` | timestamptz | Assigned timestamp |
| `owner_accepted_at` | timestamptz | Owner accepted timestamp |
| `declined_at` | timestamptz | Declined timestamp |
| `decline_reason` | text | Decline reason |

Foreign keys:

| Field | References | Delete behavior |
| --- | --- | --- |
| `request_id` | `service_requests(id)` | cascade |
| `workshop_id` | `workshops(id)` | default |
| `mechanic_id` | `mechanics(id)` | default |

### `assessments`

Mechanic assessment for a request.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | uuid | Primary key |
| `request_id` | uuid | FK to `service_requests.id` |
| `mechanic_id` | uuid | FK to `mechanics.id` |
| `notes` | text | Assessment notes |
| `tat_hours` | int | Turnaround estimate |
| `odo_km` | int | Odometer |
| `created_at` | timestamptz | Created timestamp |

Foreign keys:

| Field | References | Delete behavior |
| --- | --- | --- |
| `request_id` | `service_requests(id)` | cascade |
| `mechanic_id` | `mechanics(id)` | default |

### `estimates`

Estimate header table.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | uuid | Primary key |
| `request_id` | uuid | FK to `service_requests.id` |
| `assessment_id` | uuid | FK to `assessments.id` |
| `status` | estimate_status | Estimate status |
| `currency` | text | Currency |
| `valid_till` | date | Valid until |
| `sent_at` | timestamptz | Sent timestamp |
| `approved_at` | timestamptz | Approved timestamp |
| `approved_by` | uuid | Owner auth user id; not declared as FK |
| `rejected_reason` | text | Rejection reason |
| `created_at` | timestamptz | Created timestamp |

Foreign keys:

| Field | References | Delete behavior |
| --- | --- | --- |
| `request_id` | `service_requests(id)` | cascade |
| `assessment_id` | `assessments(id)` | default |

### `estimate_items`

Estimate line item table.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | uuid | Primary key |
| `estimate_id` | uuid | FK to `estimates.id` |
| `description` | text | Line description |
| `qty` | numeric | Quantity |
| `rate` | numeric | Rate |
| `amount` | numeric | Generated as `qty * rate` |
| `part_id` | uuid | Optional part id; not declared as FK |

Foreign keys:

| Field | References | Delete behavior |
| --- | --- | --- |
| `estimate_id` | `estimates(id)` | cascade |

### `work_logs`

Repair progress log table.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | uuid | Primary key |
| `request_id` | uuid | FK to `service_requests.id` |
| `mechanic_id` | uuid | FK to `mechanics.id` |
| `note` | text | Work note |
| `created_at` | timestamptz | Created timestamp |

Foreign keys:

| Field | References | Delete behavior |
| --- | --- | --- |
| `request_id` | `service_requests(id)` | cascade |
| `mechanic_id` | `mechanics(id)` | default |

### `attachments`

Photos/files attached to service request.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | uuid | Primary key |
| `request_id` | uuid | FK to `service_requests.id` |
| `kind` | attachment_kind | Attachment type |
| `storage_path` | text | Supabase Storage path |
| `caption` | text | Caption |
| `uploaded_by` | actor_role | Uploader role |
| `created_at` | timestamptz | Created timestamp |

Foreign keys:

| Field | References | Delete behavior |
| --- | --- | --- |
| `request_id` | `service_requests(id)` | cascade |

### `work_reports`

Final repair report table.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | uuid | Primary key |
| `request_id` | uuid | FK to `service_requests.id` |
| `summary` | text | Report summary |
| `parts_replaced` | text | Parts replaced |
| `odo_km` | int | Odometer |
| `next_service_hint` | text | Next service hint |
| `created_at` | timestamptz | Created timestamp |

Foreign keys:

| Field | References | Delete behavior |
| --- | --- | --- |
| `request_id` | `service_requests(id)` | cascade |

### `invoices`

Service invoice table.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | uuid | Primary key |
| `request_id` | uuid | Unique FK to `service_requests.id` |
| `number` | text | Unique invoice number |
| `status` | invoice_status | Invoice status |
| `subtotal` | numeric | Subtotal |
| `platform_fee` | numeric | Platform fee |
| `gst_rate` | numeric | GST rate |
| `gst_amount` | numeric | GST amount |
| `total` | numeric | Total |
| `issued_at` | timestamptz | Issued timestamp |
| `due_at` | date | Due date |

Foreign keys:

| Field | References | Delete behavior |
| --- | --- | --- |
| `request_id` | `service_requests(id)` | default |

Unique constraints:

```text
unique (request_id)
unique (number)
```

### `payments`

Service invoice payment table.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | uuid | Primary key |
| `invoice_id` | uuid | FK to `invoices.id` |
| `amount` | numeric | Payment amount |
| `method` | text | `upi`, `netbanking`, `card`, `credit_line`, `cash` |
| `reference` | text | Payment reference |
| `paid_at` | timestamptz | Paid timestamp |

Foreign keys:

| Field | References | Delete behavior |
| --- | --- | --- |
| `invoice_id` | `invoices(id)` | default |

### `payout_cycles`

Workshop payout cycle table.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | uuid | Primary key |
| `workshop_id` | uuid | FK to `workshops.id` |
| `period_start` | date | Cycle start |
| `period_end` | date | Cycle end |
| `gross` | numeric | Gross amount |
| `commission_rate` | numeric | Commission rate |
| `commission` | numeric | Commission amount |
| `net` | numeric | Net payout |
| `status` | payout_status | Payout status |
| `paid_on` | date | Paid date |
| `utr_reference` | text | UTR reference |

Foreign keys:

| Field | References | Delete behavior |
| --- | --- | --- |
| `workshop_id` | `workshops(id)` | default |

Unique constraints:

```text
unique (workshop_id, period_start)
```

### `payout_lines`

Individual service requests included in a workshop payout.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | uuid | Primary key |
| `cycle_id` | uuid | FK to `payout_cycles.id` |
| `request_id` | uuid | FK to `service_requests.id` |
| `amount` | numeric | Line amount |

Foreign keys:

| Field | References | Delete behavior |
| --- | --- | --- |
| `cycle_id` | `payout_cycles(id)` | cascade |
| `request_id` | `service_requests(id)` | default |

### `feedback`

Owner feedback for a service request.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | uuid | Primary key |
| `request_id` | uuid | Unique FK to `service_requests.id` |
| `rating` | int | 1 to 5 |
| `comments` | text | Comments |
| `created_at` | timestamptz | Created timestamp |

Foreign keys:

| Field | References | Delete behavior |
| --- | --- | --- |
| `request_id` | `service_requests(id)` | default |

Unique constraints:

```text
unique (request_id)
```

### `workshop_complaints`

Complaints against a workshop.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | uuid | Primary key |
| `request_id` | uuid | FK to `service_requests.id` |
| `org_id` | uuid | FK to `organizations.id` |
| `workshop_id` | uuid | FK to `workshops.id` |
| `text` | text | Complaint text |
| `status` | text | `Open`, `In Review`, `Resolved` |
| `resolved_at` | timestamptz | Resolved timestamp |
| `created_at` | timestamptz | Created timestamp |

Foreign keys:

| Field | References | Delete behavior |
| --- | --- | --- |
| `request_id` | `service_requests(id)` | default |
| `org_id` | `organizations(id)` | default |
| `workshop_id` | `workshops(id)` | default |

### `status_events`

Audit trail for service request stage changes.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | bigint identity | Primary key |
| `request_id` | uuid | FK to `service_requests.id` |
| `from_stage` | request_stage | Previous stage |
| `to_stage` | request_stage | New stage |
| `actor` | actor_role | Actor role |
| `actor_user` | uuid | Auth user id; not declared as FK |
| `note` | text | Event note |
| `created_at` | timestamptz | Created timestamp |

Foreign keys:

| Field | References | Delete behavior |
| --- | --- | --- |
| `request_id` | `service_requests(id)` | cascade |

## Public, Partner, And Admin Tables

### `leads`

Customer booking lead table.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | uuid | Primary key |
| `created_at` | timestamptz | Created timestamp |
| `ref` | text | Lead reference |
| `name` | text | Customer name |
| `phone` | text | Customer phone |
| `city` | text | City |
| `vehicle` | text | Vehicle details |
| `service` | text | Requested service |
| `issue` | text | Issue |
| `source` | text | Source, defaults to `website` |
| `assigned_to` | uuid | FK to `staff_members.id` added by admin schema |

Foreign keys:

| Field | References | Delete behavior |
| --- | --- | --- |
| `assigned_to` | `staff_members(id)` | default |

### `vendor_applications`

Partner/workshop application table.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | uuid | Primary key |
| `created_at` | timestamptz | Created timestamp |
| `ref` | text | Application reference |
| `status` | text | Application status |
| `business_name` | text | Business name |
| `owner_name` | text | Owner name |
| `business_type` | text | Business type |
| `phone` | text | Phone |
| `email` | text | Email |
| `city` | text | City |
| `pincode` | text | Pincode |
| `address` | text | Address |
| `services` | text[] | Services offered |
| `vehicles` | text[] | Supported vehicles |
| `mechanics` | text | Mechanics count/detail |
| `bays` | text | Bay count/detail |
| `all_night` | text | 24/7 availability |
| `doorstep` | text | Doorstep service |
| `experience` | text | Experience |
| `gstin` | text | GSTIN |
| `pan` | text | PAN |
| `bank_ready` | text | Bank readiness |
| `owner_id` | uuid | FK to `auth.users.id` added by roles schema |
| `assigned_to` | uuid | FK to `staff_members.id` added by admin schema |

Foreign keys:

| Field | References | Delete behavior |
| --- | --- | --- |
| `owner_id` | `auth.users(id)` | default |
| `assigned_to` | `staff_members(id)` | default |

### `staff_members`

FleetWorks internal staff/BDM table.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | uuid | Primary key |
| `name` | text | Staff name |
| `email` | text | Email |
| `role` | text | `bdm` or `admin` |
| `active` | boolean | Active flag |
| `created_at` | timestamptz | Created timestamp |

Foreign keys: none.

### `vendor_leads`

Sourced workshop/vendor lead table.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | uuid | Primary key |
| `source` | text | Source, default `google_maps_scraper` |
| `service_category` | text | Internal service category |
| `place_id` | text | Unique Google place id |
| `business_name` | text | Business name |
| `google_category` | text | Google category |
| `phone` | text | Phone |
| `website` | text | Website |
| `address` | text | Address |
| `city` | text | City |
| `state` | text | State |
| `latitude` | numeric | Latitude |
| `longitude` | numeric | Longitude |
| `rating` | numeric | Rating |
| `review_count` | int | Review count |
| `emails` | text[] | Emails |
| `maps_link` | text | Google Maps link |
| `status` | text | `new`, `contacted`, `qualified`, `rejected`, `converted` |
| `assigned_to` | uuid | FK to `staff_members.id` |
| `notes` | text | Notes |
| `raw` | jsonb | Full raw scraped record |
| `created_at` | timestamptz | Created timestamp |

Foreign keys:

| Field | References | Delete behavior |
| --- | --- | --- |
| `assigned_to` | `staff_members(id)` | default |

Unique constraints:

```text
unique (place_id)
```

## Analytics And BI Views

These are views, not tables. They mostly project data out of the legacy `fleets.data` jsonb blob for BI/reporting.

| View | Purpose |
| --- | --- |
| `fleet_vehicle_stats` | Vehicle type and km/month from `fleets.data` |
| `v_vehicles` | Vehicle rows from `fleets.data` |
| `v_expenses` | Expense rows from `fleets.data` |
| `v_fuel_logs` | Fuel rows from `fleets.data` |
| `v_issues` | Issue rows from `fleets.data` |
| `v_drivers` | Driver rows from `fleets.data` |
| `v_expense_details` | Expenses joined with vehicle details |
| `v_documents` | Document rows from `fleets.data` |
| `v_parts` | Parts rows from `fleets.data` |
| `v_tyre_readings` | Tyre rows from `fleets.data` |
| `v_tyre_health` | Latest tyre reading per wheel |
| `v_settings` | Owner settings from `fleets.data` |
| `v_renewals` | Unified compliance/expiry view |

Security note: analytics views bypass normal RLS behavior, so the schema revokes them from `anon` and `authenticated` API roles. They are intended for direct BI/Postgres access, not public REST access.

## Foreign-Key Summary

### Supabase Auth Relationships

| Application field | References |
| --- | --- |
| `memberships.user_id` | `auth.users(id)` |
| `fleets.owner_id` | `auth.users(id)` |
| `vehicle_assignments.user_id` | `auth.users(id)` |
| `expense_change_requests.requested_by` | `auth.users(id)` |
| `expense_change_requests.decided_by` | `auth.users(id)` |
| `salary_payments.initiated_by` | `auth.users(id)` |
| `vendor_applications.owner_id` | `auth.users(id)` |

Some fields store auth user ids without declared FKs in the current SQL:

```text
driver_entries.owner_id
payment_requests.requested_by
workshops.owner_user
service_requests.raised_by
estimates.approved_by
status_events.actor_user
```

### Organization Relationships

| Child table | FK |
| --- | --- |
| `memberships` | `org_id -> organizations.id` |
| `vehicles` | `org_id -> organizations.id` |
| `drivers` | `org_id -> organizations.id` |
| `documents` | `org_id -> organizations.id` |
| `fuel_logs` | `org_id -> organizations.id` |
| `expenses` | `org_id -> organizations.id` |
| `issues` | `org_id -> organizations.id` |
| `work_orders` | `org_id -> organizations.id` |
| `parts` | `org_id -> organizations.id` |
| `reminders` | `org_id -> organizations.id` |
| `inspections` | `org_id -> organizations.id` |
| `tyre_readings` | `org_id -> organizations.id` |
| `trips` | `org_id -> organizations.id` |
| `driver_ledger` | `org_id -> organizations.id` |
| `vehicle_assignments` | `org_id -> organizations.id` |
| `expense_change_requests` | `org_id -> organizations.id` |
| `payment_requests` | `org_id -> organizations.id` |
| `driver_payout_details` | `org_id -> organizations.id` |
| `salary_payments` | `org_id -> organizations.id` |
| `service_requests` | `org_id -> organizations.id` |
| `workshop_complaints` | `org_id -> organizations.id` |

### Vehicle Relationships

| Child table | FK |
| --- | --- |
| `drivers` | `vehicle_id -> vehicles.id` |
| `documents` | `vehicle_id -> vehicles.id` |
| `fuel_logs` | `vehicle_id -> vehicles.id` |
| `expenses` | `vehicle_id -> vehicles.id` |
| `issues` | `vehicle_id -> vehicles.id` |
| `work_orders` | `vehicle_id -> vehicles.id` |
| `reminders` | `vehicle_id -> vehicles.id` |
| `inspections` | `vehicle_id -> vehicles.id` |
| `tyre_readings` | `vehicle_id -> vehicles.id` |
| `trips` | `vehicle_id -> vehicles.id` |
| `expense_change_requests` | `vehicle_id -> vehicles.id` |
| `service_requests` | `vehicle_id -> vehicles.id` |

### Driver Relationships

| Child table | FK |
| --- | --- |
| `documents` | `driver_id -> drivers.id` |
| `driver_ledger` | `driver_id -> drivers.id` |

Payment/payroll tables currently use `driver_ext_id` instead of `drivers.id` because earlier sync behavior reinserted driver rows and made UUID links unstable.

### Service Workflow Relationships

| Child table | FK |
| --- | --- |
| `mechanics` | `workshop_id -> workshops.id` |
| `workshops` | `advisor_id -> service_advisors.id` |
| `service_requests` | `org_id -> organizations.id`, `vehicle_id -> vehicles.id`, `workshop_id -> workshops.id`, `mechanic_id -> mechanics.id` |
| `request_assignments` | `request_id -> service_requests.id`, `workshop_id -> workshops.id`, `mechanic_id -> mechanics.id` |
| `assessments` | `request_id -> service_requests.id`, `mechanic_id -> mechanics.id` |
| `estimates` | `request_id -> service_requests.id`, `assessment_id -> assessments.id` |
| `estimate_items` | `estimate_id -> estimates.id` |
| `work_logs` | `request_id -> service_requests.id`, `mechanic_id -> mechanics.id` |
| `attachments` | `request_id -> service_requests.id` |
| `work_reports` | `request_id -> service_requests.id` |
| `invoices` | `request_id -> service_requests.id` |
| `payments` | `invoice_id -> invoices.id` |
| `payout_cycles` | `workshop_id -> workshops.id` |
| `payout_lines` | `cycle_id -> payout_cycles.id`, `request_id -> service_requests.id` |
| `feedback` | `request_id -> service_requests.id` |
| `workshop_complaints` | `request_id -> service_requests.id`, `org_id -> organizations.id`, `workshop_id -> workshops.id` |
| `status_events` | `request_id -> service_requests.id` |

### Admin And Lead Relationships

| Child table | FK |
| --- | --- |
| `leads` | `assigned_to -> staff_members.id` |
| `vendor_applications` | `owner_id -> auth.users.id`, `assigned_to -> staff_members.id` |
| `vendor_leads` | `assigned_to -> staff_members.id` |

## Row Level Security Summary

The database uses RLS heavily.

Core predicates:

| Function | Purpose |
| --- | --- |
| `is_org_member(org_id)` | Allows org members and FleetWorks admins |
| `is_org_admin(org_id)` | Allows owner/manager/admin |
| `is_owner(org_id)` | Allows owner/admin only |
| `can_view_vehicle(org_id, vehicle_ext_id)` | Allows assigned vehicle viewing |
| `can_update_vehicle(org_id, vehicle_ext_id)` | Allows assigned vehicle updates |
| `can_view_vehicle_id(org_id, vehicle_id)` | Resolves UUID vehicle to ext id before view check |
| `can_update_vehicle_id(org_id, vehicle_id)` | Resolves UUID vehicle to ext id before update check |

Security pattern:

```text
owner/manager
  -> full org management

supervisor/driver
  -> assigned vehicle view/update only

viewer
  -> read-only org access

admin
  -> FleetWorks platform admin access
```

## Important Naming Notes

- `payments` is the service-workflow invoice payment table.
- `payment_requests` is the owner-UPI salary approval queue.
- `salary_payments` is the driver salary ledger.
- `fleets` is the older JSON blob table.
- Normalized operational data now lives in tables such as `vehicles`, `drivers`, `expenses`, `fuel_logs`, and related child tables.
