# FleetWorks Future Platform Architecture Roadmap

Prepared on: 2026-08-01

## Purpose

This document captures the recommended expansion path for FleetWorks so the current application can grow into a strong platform foundation that supports:

- Stronger security vulnerability handling
- Production-grade LLM features
- Telemetry data handling
- IoT-based device handling
- Web and mobile clients
- Small-to-large scale deployments
- Easy plug-in / plug-out feature modules

This is a forward-looking companion to `docs/fleetworks-architecture-design.md`.

For the actual current repository layout, see `docs/architecture/current-folder-structure.md`.

## Current Architecture Position

The current FleetWorks application is a modular static SaaS foundation:

- Static multi-page web app
- Modular-monolith JavaScript organized by domain
- Hexagonal ports, adapters, use cases, and view models for migrated modules
- Module registry with capabilities, dependencies, permissions, tables, and Edge Functions
- Supabase Auth
- Supabase Postgres
- Supabase Row Level Security
- Supabase Storage
- Supabase Edge Functions
- LocalStorage demo/offline fallback

The repository now includes initial IoT, telemetry, LLM, communications,
invoicing, insurance, and plug-compatible module contracts. A backend API layer,
mobile clients, production observability, and asynchronous event processing remain future work.

The recommended approach is not to throw away the current system. Instead, the current web app should become the first client of a larger FleetWorks platform.

## Target Platform Architecture

```text
Web App                    Mobile App                  IoT Devices
fleet.html / future SPA    Android / iOS / PWA         GPS / fuel / sensor devices
        |                         |                         |
        +-------------------------+-------------------------+
                                  |
                                  v
                       API Gateway / BFF Layer
              Auth, tenant context, validation, rate limits
                                  |
        +-------------------------+--------------------------+
        |                         |                          |
        v                         v                          v
 Domain Services            IoT / Telemetry Layer       LLM Gateway
 Fleet Service              MQTT / HTTP ingest          Model routing
 Maintenance Service        Device registry             Prompt versions
 Finance Service            Stream processor            Guardrails
 Team Service               Alerts engine               Usage logs
 Payroll Service            Time-series storage         Evaluations
        |
        v
 Data Platform
 Postgres / Supabase, Storage, Audit Logs, Analytics Warehouse, Time-series DB
        |
        v
 Plugin / Module System
 Feature flags, module registry, permissions, events, extension contracts
```

## Recommended Repository Shape

Future structure can evolve toward:

```text
apps/
  web/                 Current web app or future SPA
  mobile/              Future Android/iOS/PWA app

services/
  api/                 Main backend API / BFF
  iot-ingest/          IoT and telemetry ingestion service
  llm-gateway/         LLM orchestration service

packages/
  domain/              Shared business rules and validation
  sdk/                 Client SDK for web and mobile
  plugins/             Plugin contracts and module definitions
```

Detailed ReactJS, NodeJS, and PostgreSQL folder guidance is documented in:

```text
docs/architecture/react-node-postgres-folder-structure.md
```

## Expansion Principle

Supabase should remain an important backend component, but not the only backend boundary.

Keep Supabase for:

- Authentication
- Postgres
- Row Level Security
- Storage
- Edge Functions
- Admin/internal tooling

Add a backend service layer for:

- Central validation
- Security policy enforcement
- Audit logging
- Rate limiting
- Mobile/web API contracts
- IoT ingestion
- LLM routing and governance
- Plugin orchestration

## Domain Service Layer

Business logic should gradually move out of large browser files and into domain services.

Recommended domains:

```text
Fleet Service
  vehicles, drivers, assignments

Maintenance Service
  inspections, issues, work orders, reminders, parts, tyres

Finance Service
  expenses, trips, ledger, payroll, payment approvals

Team Service
  memberships, roles, permissions, invites

Document Service
  bills, documents, OCR, signed URLs

Workflow Service
  service requests, estimates, invoices, mechanic flow
```

Current browser modules can remain while these domains are extracted gradually.

## Security Foundation

Security should become a first-class platform layer.

Required capabilities:

- Central API input validation using schemas
- Rate limiting per user, tenant, device, and IP
- Audit logs for all sensitive actions
- RLS test suite for every table
- Secret handling only in backend services or Edge Functions
- Permission matrix by role, module, and action
- Device-level credentials for IoT devices
- Security headers and Content Security Policy for the web app
- Dependency scanning and CI security checks
- Error monitoring and alerting

Target request flow:

```text
User / Device
  -> API
  -> Authentication
  -> Tenant Context
  -> Permission Check
  -> Input Validation
  -> Domain Rule
  -> DB / RLS
  -> Audit Log
```

Important principle:

The frontend is trusted for user experience only. Authorization must live in RLS, backend services, or Edge Functions.

## LLM Gateway Architecture

The current Copilot Edge Function is a good starting point, but future LLM work should use a dedicated LLM gateway.

Target flow:

```text
Client
  -> LLM Gateway
      -> Auth + tenant check
      -> Prompt template version
      -> Data access policy
      -> Retrieval / fleet summary
      -> Model router
      -> Guardrails
      -> Cost limit
      -> Logs and evals
      -> Response
```

Capabilities to support:

- Multiple models
- Prompt versioning
- Model routing
- Cost control
- Usage logging
- User-level and tenant-level permissions
- Fleet-specific retrieval controls
- Safety filtering
- Evaluation testing
- Offline/rule-based fallback

## IoT And Telemetry Architecture

High-volume telemetry should not go through the normal browser/PostgREST workflow.

Recommended flow:

```text
Device
  -> MQTT or HTTPS ingestion API
  -> Device authentication
  -> Queue / stream
  -> Validation and normalization
  -> Time-series storage
  -> Alert engine
  -> Aggregated summaries into Postgres
  -> Dashboard / mobile notifications
```

Suggested tables or services:

```text
devices
device_credentials
vehicle_device_links
telemetry_events_raw
telemetry_latest
telemetry_alerts
geofence_events
maintenance_predictions
```

For small scale:

- Supabase/Postgres can store latest state, alerts, and summarized telemetry.

For larger scale:

- Add time-series or analytical storage such as TimescaleDB, ClickHouse, InfluxDB, or a managed warehouse/streaming pipeline.

## Web And Mobile Readiness

The future mobile app should consume stable domain APIs and shared contracts, not browser controllers or globals.

Instead, create a shared API and client SDK:

```text
FleetWorks API
  GET /vehicles
  POST /vehicles
  POST /fuel-logs
  POST /inspections
  GET /dashboard-summary
  POST /service-requests
  POST /payroll/payments
```

Then:

```text
Web app uses SDK
Mobile app uses same SDK
IoT services use backend-only APIs
```

This creates one stable contract for all clients.

## Plugin / Module System

To support easy plug-in / plug-out components, add a module registry.

Example modules:

```text
fleet_ops
fleet_fin
fleet_iq
payroll
iot_tracking
document_ocr
garage_workflow
driver_portal
```

Each module should define:

- id
- name
- routes / screens
- permissions
- database tables used
- API endpoints used
- feature flags
- dependencies
- billing plan requirement
- navigation entries

Example module definition:

```json
{
  "id": "payroll",
  "dependsOn": ["fleet_core", "drivers"],
  "permissions": ["payroll.view", "payroll.manage"],
  "tables": ["salary_payments", "payment_requests"],
  "enabledByPlan": ["pro", "enterprise"]
}
```

This is what creates real plug-in/plug-out ability. The current script-per-feature model is modular, but not yet a true plugin system because modules depend on shared globals, DOM ids, and load order.

## Practical Roadmap

### Phase 1: Foundation Cleanup

- Completed: moved active controllers into domain module folders.
- Completed: introduced the API facade, module registry, and hexagonal registry.
- Completed: documented module metadata, ownership boundaries, and permission names.
- Remaining: reduce the FleetOps controller and shared mutable `db` state further.
- Remaining: migrate transitional direct `fwCloud` calls behind module ports and adapters.
- Remaining: expand schema validation and RLS integration tests.

### Phase 2: Backend API Layer

- Add `services/api`.
- Move important writes behind API endpoints.
- Keep Supabase RLS as backup enforcement.
- Add audit logging.
- Add centralized permissions.

### Phase 3: Plugin Foundation

- Extend the existing module registry with tenant-scoped runtime controls.
- Add feature flags per tenant.
- Generate navigation from enabled modules.
- Enforce the permissions already declared by each module at server boundaries.

### Phase 4: LLM Gateway

- Replace direct Copilot function with LLM gateway.
- Add prompt versions.
- Add usage logs.
- Add cost limits.
- Add model fallback.
- Add evaluation tests.
- Add safe retrieval rules.

### Phase 5: IoT / Telemetry

- Add device registry.
- Add HTTP/MQTT ingestion.
- Add raw telemetry store and latest-state table.
- Add alert rules.
- Add dashboard summaries.

### Phase 6: Mobile-Ready Platform

- Build mobile app against the same API/SDK.
- Add push notifications.
- Add offline sync rules.
- Add mobile-specific auth/session handling.

## Recommended Implementation Order

Build the stronger foundation in this order:

1. Domain separation
2. Central API/service layer
3. Security and audit layer
4. Plugin/module registry
5. LLM gateway
6. IoT telemetry pipeline
7. Mobile app

## Final Recommendation

Keep the current static/Supabase app as the working MVP and first production web client. Do not rewrite everything immediately.

Create a platform backend and domain foundation beside it, then migrate high-risk and high-scale features gradually into that platform.

This gives FleetWorks a stronger base without breaking the current application.
