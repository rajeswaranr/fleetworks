# FleetWorks Application Architecture Design

Prepared on: 2026-08-01

## 1. Executive Summary

FleetWorks is a static, browser-first fleet management application backed by Supabase. The application is built with multi-page HTML, shared CSS, and vanilla JavaScript modules that run directly in the browser. Supabase provides the production backend capabilities: authentication, Postgres database, Row Level Security, REST/RPC APIs, private file storage, and Edge Functions.

The current architecture is best described as:

> Static multi-page SaaS/PWA + browser-side business logic + Supabase backend-as-a-service.

There is no traditional application server for business logic. The local Node server only serves static files for development and testing.

## 2. Layer-Wise System Architecture

```text
+--------------------------------------------------------------------------------+
|                                USER CHANNELS                                    |
|                                                                                |
|  Fleet Owner        Supervisor / Driver       Mechanic / Garage       Admin     |
|  fleet.html         team.html                 garage.html             admin.html |
|  index.html         driver.html links         partner.html            signin    |
+--------------------------------------+-----------------------------------------+
                                       |
                                       v
+--------------------------------------------------------------------------------+
|                            PRESENTATION LAYER                                   |
|                                                                                |
|  Static HTML pages, CSS, icons, assets, PWA manifest, service worker             |
|                                                                                |
|  Main pages: index.html, fleet.html, team.html, driver.html, garage.html,        |
|  admin.html, partner.html, signin.html, reset.html                              |
+--------------------------------------+-----------------------------------------+
                                       |
                                       v
+--------------------------------------------------------------------------------+
|                         CLIENT APPLICATION LAYER                                |
|                                                                                |
|  Vanilla browser JavaScript modules loaded as globals:                          |
|                                                                                |
|  fleet.js       Owner dashboard, forms, tabs, render orchestration              |
|  dbcore.js      DB-direct CRUD mapping for normalized fleet entities            |
|  cloudstore.js  Auth/session, Supabase REST/RPC helpers, sync, storage helpers  |
|  team.js        Supervisor/driver authenticated portal                          |
|  driver.js      No-login driver link submissions                                |
|  workflow.js    Owner-to-mechanic service workflow                              |
|  payroll.js     Driver salary logs, payment approvals, Cashfree functions       |
|  analytics.js   Fleet insights and reporting views                              |
|  account.js     Account, team, organization, and settings views                 |
|  copilot.js     Rule-based and LLM-backed assistant UI                          |
+--------------------------------------+-----------------------------------------+
                                       |
                                       v
+--------------------------------------------------------------------------------+
|                         CLIENT STATE AND OFFLINE LAYER                          |
|                                                                                |
|  localStorage keys:                                                             |
|  ff_fleet                 Local/demo fleet state and settings                   |
|  ff_fleet:<user>          Per-user cached fleet blob                            |
|  fw_session:<user>        Supabase auth session cache                           |
|  fw_service_requests      Local playable service workflow state                 |
|                                                                                |
|  Signed-out mode: local/demo state only                                         |
|  Signed-in mode: core entities are DB-direct; settings remain blob-backed       |
+--------------------------------------+-----------------------------------------+
                                       |
                                       v
+--------------------------------------------------------------------------------+
|                            SUPABASE API LAYER                                   |
|                                                                                |
|  Auth API        Email/password login, signup, recovery, token refresh          |
|  PostgREST       Table CRUD and RPC calls from browser modules                  |
|  Storage API     Private bill/document uploads and signed URLs                  |
|  Edge Functions  Secret-bearing or privileged server-side operations            |
+--------------------------------------+-----------------------------------------+
                                       |
                                       v
+--------------------------------------------------------------------------------+
|                       DATA, SECURITY, AND DOMAIN LAYER                          |
|                                                                                |
|  Postgres schema with RLS:                                                      |
|                                                                                |
|  Tenant core: organizations, memberships                                        |
|  Fleet core: vehicles, drivers, expenses, fuel_logs, issues, work_orders        |
|  Operations: reminders, inspections, parts, documents, tyre_readings            |
|  Finance: trips, driver_ledger, salary_payments, payment_requests               |
|  Team access: vehicle_assignments, expense_change_requests                      |
|  Intake: leads, vendor_applications, vendor_leads, driver_entries               |
|  Service workflow: service_requests, assignments, estimates, invoices, payments |
|                                                                                |
|  Main security boundary: Supabase Row Level Security policies                   |
+--------------------------------------+-----------------------------------------+
                                       |
                                       v
+--------------------------------------------------------------------------------+
|                         EXTERNAL SERVICE LAYER                                  |
|                                                                                |
|  Anthropic Claude       Copilot Edge Function                                   |
|  Cashfree Payouts       Payroll Edge Functions                                  |
|  PaddleOCR/FastAPI      Optional bill OCR microservice                          |
|  WhatsApp/UPI links     Client-opened external actions                          |
+--------------------------------------------------------------------------------+
```

## 3. Typical System Context Diagram

```text
                          +-----------------------------+
                          |       FleetWorks Users      |
                          | Owner, Driver, Mechanic,    |
                          | Partner, Admin              |
                          +--------------+--------------+
                                         |
                                         v
              +---------------------------------------------------+
              | Static FleetWorks Web App                         |
              | HTML + CSS + vanilla JS + PWA assets              |
              +------+----------------------+---------------------+
                     |                      |
                     | REST/Auth/RPC        | Function calls
                     v                      v
       +----------------------------+   +------------------------------+
       | Supabase Platform          |   | Supabase Edge Functions      |
       | Auth, PostgREST, Storage   |   | team-invite, payroll,        |
       | RLS-secured Postgres       |   | copilot                      |
       +-------------+--------------+   +---------------+--------------+
                     |                                  |
                     v                                  v
       +----------------------------+   +------------------------------+
       | FleetWorks Database        |   | External Providers           |
       | Tenant, fleet, workflow,   |   | Anthropic, Cashfree, OCR     |
       | payroll, leads, documents  |   | service, WhatsApp, UPI       |
       +----------------------------+   +------------------------------+
```

## 4. Runtime and Deployment Architecture

```text
+---------------------------+      +--------------------------------+
| Developer / Local Machine |      | Production Static Hosting      |
|                           |      | fleetworks.in                  |
| npm start                 |      |                                |
| server/static-server.mjs  |      | Static HTML/CSS/JS/assets      |
+------------+--------------+      +---------------+----------------+
             |                                     |
             | serves static files                 | serves static files
             v                                     v
+--------------------------------------------------------------------+
| Browser                                                            |
| Executes global JS modules, stores local state, calls Supabase APIs |
+-------------------------------+------------------------------------+
                                |
                                v
+--------------------------------------------------------------------+
| Supabase Project                                                   |
| Auth + PostgREST + Postgres + RLS + Storage + Edge Functions       |
+--------------------------------------------------------------------+
```

The local server in `server/static-server.mjs` only maps URL paths to files and returns them with the right MIME type. Production can be hosted on any static hosting platform as long as the Supabase project remains configured.

## 5. Main Application Modules

Current code is split into two layers:

- `js/modules/*` owns migrated business workflows, domain rules, ports, adapters, use cases, and view-model helpers.
- `js/legacy/*` owns the current static-page UI shells: DOM rendering, form binding, tab orchestration, and compatibility fallbacks.

New business logic should be added under `js/modules/*`. The legacy UI shells should call module APIs first and keep inline behavior only as a temporary fallback while UI controllers are migrated.

### 5.1 Owner Fleet Manager

Primary page: `fleet.html`

Business modules loaded by this page:

- `js/modules/auth/*`
- `js/modules/fleet-core/*`
- `js/modules/fleet-ops/*`
- `js/modules/maintenance/*`
- `js/modules/fleet-fin/*`
- `js/modules/fleet-iq/*`
- `js/modules/team-access/*`
- `js/modules/bulk-import/*`
- `js/modules/service-workflow/*`
- `js/modules/payments/*`
- `js/modules/driver-map/*`
- `js/modules/llm-gateway/*`
- `js/modules/security/*`
- `js/modules/iot-telemetry/*`

Legacy UI shell scripts:

- `js/legacy/fleet.js`
- `js/dbcore.js`
- `js/cloudstore.js`
- `js/legacy/analytics.js`
- `js/account.js`
- `js/legacy/payroll.js`
- `js/legacy/bulkimport.js`
- `js/legacy/fleetmap.js`
- `js/legacy/workflow.js`
- `js/legacy/copilot.js`

Responsibilities:

- Authentication gate and demo mode
- Vehicle and driver management
- Compliance tracking for insurance, PUC, fitness, permits, and road tax
- Fuel and mileage tracking
- Expense tracking and approvals
- Inspections and issue management
- Work orders and service reminders
- Parts inventory and tyre health
- Trips, loads, driver ledger, and payroll
- FleetIQ analytics, reports, and Copilot assistant

### 5.2 Team Portal

Primary page: `team.html`

Business module: `js/modules/team-access/*`

Legacy UI shell: `js/legacy/team.js`

Responsibilities:

- Supervisor/driver login via Supabase Auth
- Read only the vehicles allowed by RLS and `vehicle_assignments`
- Log fuel
- Report issues
- Submit expense change requests for owner approval
- View recent vehicle history

### 5.3 No-Login Driver Link

Primary page: `driver.html`

Business module: `js/modules/driver-portal/*`

Legacy UI shell: `js/legacy/driver.js`

Responsibilities:

- Accept owner id, token, driver name, and vehicle name from URL query parameters
- Let a driver submit fuel, issue, or inspection entries without signing in
- Insert rows into `driver_entries` using the anonymous Supabase role
- Owner later pulls and merges entries

### 5.4 Garage / Mechanic Workflow

Primary page: `garage.html`

Business modules:

- `js/modules/garage-ops/*`
- `js/modules/service-workflow/*`

Legacy UI shells:

- `js/legacy/garage.js`
- `js/legacy/workflow.js`

Responsibilities:

- Service request lifecycle from complaint to closure
- Mechanic assessment, estimate, work progress, completion report, invoice, payment, feedback
- Local playable flow via `fw_service_requests`
- Cloud twin via normalized service workflow tables

### 5.5 Public Intake and Admin

Primary pages:

- `index.html`
- `partner.html`
- `admin.html`
- `signin.html`

Responsibilities:

- Lead capture into `leads`
- Vendor/partner application intake
- Admin review and update flows
- Staff/admin access gated by app metadata and RLS policies

## 6. Data Architecture

### 6.1 Tenant Model

```text
auth.users
    |
    v
memberships ----> organizations
    |
    +-- role: owner, manager, viewer, supervisor, driver
```

The organization is the main tenant boundary. Most operational tables include `org_id`, and access is controlled by RLS functions such as `is_org_member`, `is_org_admin`, and vehicle-specific access helpers.

### 6.2 Core Fleet Entity Model

```text
organizations
    |
    +-- vehicles
    |     |
    |     +-- fuel_logs
    |     +-- expenses
    |     +-- issues
    |     |     |
    |     |     +-- work_orders
    |     |
    |     +-- reminders
    |     +-- inspections
    |     +-- tyre_readings
    |     +-- documents
    |     +-- trips
    |
    +-- drivers
    |     |
    |     +-- documents
    |     +-- driver_ledger
    |     +-- driver_payout_details
    |
    +-- parts
    +-- memberships
    +-- vehicle_assignments
```

Important ID convention:

- Vehicles, drivers, and issues keep a stable browser-era `ext_id` as local `id`.
- Their real Postgres UUID is held as `dbId` in the browser.
- Other DB-direct records use the Postgres UUID directly as their local `id`.

This preserves compatibility with older render code while moving core data into normalized tables.

### 6.3 Hybrid Storage Model

```text
Signed out:
  Browser localStorage only

Signed in:
  Core entities:
    vehicles, drivers, expenses, fuel_logs, issues, work_orders,
    reminders, inspections, parts, documents, tyre_readings, trips,
    driver_ledger
    -> Supabase normalized tables

  Settings/demo metadata:
    -> localStorage + fleets.data blob
    -> projected into organizations by sync_fleet_from_blob
```

This design prevents stale JSON blob data from overwriting normalized direct writes.

## 7. Backend Components

### 7.1 Supabase Auth

Used for:

- Owner login/signup
- Supervisor/driver/team accounts
- Password recovery
- JWT-based access to PostgREST
- Edge Function caller verification

### 7.2 Supabase PostgREST

The browser calls Supabase REST endpoints directly through helpers in `cloudstore.js`:

- `authGet`
- `authInsert`
- `authInsertRet`
- `authPatch`
- `authDelete`
- `authRpc`

### 7.3 Supabase RLS

RLS is the primary authorization layer. The browser may request data, but the database decides what is visible or writable.

Policy groups include:

- Owner-only fleet blob access
- Organization membership access
- Vehicle assignment access for supervisors/drivers
- Expense approval workflow
- Payroll visibility and updates
- Admin access for leads and vendor applications
- Private storage object access by user folder

### 7.4 Supabase Storage

Private `bills` bucket stores uploaded bill images/PDFs. Object access is scoped by user id folder and signed URLs.

### 7.5 Edge Functions

```text
team-invite
  Creates auth users, memberships, and vehicle assignments using service role.

copilot
  Holds Anthropic API key server-side and returns fleet assistant answers.

payroll-add-beneficiary
payroll-transfer
payroll-webhook
  Integrate with Cashfree payouts and record payroll activity.
```

## 8. External Integration Architecture

```text
Browser
  |
  +-- Supabase Edge Function: copilot
  |       |
  |       +-- Anthropic Claude API
  |
  +-- Supabase Edge Function: payroll-*
  |       |
  |       +-- Cashfree Payouts
  |
  +-- Optional OCR API: server/ocr/app.py
  |       |
  |       +-- PaddleOCR model
  |
  +-- Client-opened links
          |
          +-- WhatsApp click-to-chat
          +-- UPI payment deep links
```

## 9. Key Data Flows

### 9.1 Owner Sign-In and Boot

```text
fleet.html
  -> cloudstore.js login
  -> Supabase Auth token
  -> pull fleets.data settings blob
  -> dbcore.js resolves org_id
  -> load normalized core tables
  -> fleet.js renderAll
```

### 9.2 Owner Saves a Core Record

```text
Fleet form submit
  -> fleet.js validates and builds local shape
  -> dbcore.js maps local shape to database row
  -> fwCloud authenticated REST helper
  -> Supabase PostgREST
  -> RLS check
  -> Postgres write
  -> local in-memory db updated
  -> render affected panels
```

### 9.3 Team Member Updates Vehicle Activity

```text
team.html login
  -> membership lookup
  -> vehicle_assignments lookup
  -> vehicles query
  -> RLS limits returned vehicles
  -> fuel/issues writes direct when allowed
  -> expense writes become expense_change_requests
  -> owner approves/rejects in fleet.html
```

### 9.4 No-Login Driver Submission

```text
Owner copies driver link
  -> driver.html?o=<owner>&t=<token>&n=<driver>&v=<vehicle>
  -> driver submits fuel/issue/inspection
  -> anonymous insert into driver_entries
  -> owner app later imports/merges entries
```

### 9.5 Copilot Question

```text
copilot.js
  -> creates compact fleet summary
  -> calls Supabase Edge Function copilot
  -> Edge Function calls Anthropic
  -> answer returned to browser
  -> rule-based fallback remains available
```

## 10. Security Architecture

Security model:

- Public anon key is intentionally present in the frontend.
- Supabase RLS protects table access.
- Authenticated browser requests use the user's JWT.
- Service role key is only inside Edge Functions.
- Sensitive integrations such as Anthropic and Cashfree run server-side.
- Storage files are private and scoped by user id path.
- Team users see only assigned vehicles through RLS.
- No-login driver links can only insert into the specific submission table.

Important security implication:

The browser is trusted for UX, not for authorization. Authorization must stay in Supabase RLS and Edge Functions.

## 11. Current Architectural Strengths

- Simple static hosting and low operational complexity
- Good offline/demo fallback through localStorage
- Strong Supabase-centered authorization model
- Clear multi-tenant boundary via organizations and memberships
- Normalized DB-direct path for important operational records
- Edge Functions keep privileged actions and external secrets out of the browser
- Modular feature files make the current code easy to navigate without a build step

## 12. Current Architectural Risks and Improvement Areas

- Browser-global module order is part of the runtime contract.
- `fleet.js` is a large orchestration file and contains many responsibilities.
- Shared mutable global `db` object can make state changes hard to reason about.
- Some state remains hybrid between normalized tables, localStorage, and blob sync.
- DOC/workflow comments show production cloud twins, but some flows are still local-first/playable.
- Direct PostgREST calls from many modules can duplicate mapping and error-handling patterns.

## 13. Recommended Next Architecture Evolution

Short term:

- Keep the static/Supabase architecture.
- Keep module ownership and data ownership documented per feature.
- Continue moving production records from blobs/localStorage to normalized tables.
- Keep all authorization in RLS, not client-side filters.
- Keep `js/legacy/*` as UI shells only; add new business rules to `js/modules/*`.

Medium term:

- Extract a small typed data-access layer per domain.
- Move page controllers and render orchestration out of `js/legacy/*` into module-owned controllers/view models.
- Define a single app state facade around `db`.
- Add integration tests for key RLS-driven flows.

Long term:

- Consider a component framework only when UI/state complexity outweighs the simplicity of static HTML.
- Consider a small backend-for-frontend only if orchestration becomes too complex for browser-plus-Supabase.
- Add observability for Edge Functions and critical PostgREST failures.

## 14. Source Files Referenced

- `package.json`
- `server/static-server.mjs`
- `fleet.html`
- `team.html`
- `driver.html`
- `garage.html`
- `js/backend.js`
- `js/cloudstore.js`
- `js/dbcore.js`
- `js/modules/*`
- `js/legacy/fleet.js`
- `js/legacy/team.js`
- `js/legacy/driver.js`
- `js/legacy/workflow.js`
- `js/legacy/payroll.js`
- `js/legacy/copilot.js`
- `supabase/migrations/*.sql`
- `supabase/functions/*/index.ts`
- `server/ocr/app.py`
