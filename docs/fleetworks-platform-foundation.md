# FleetWorks Platform Foundation Implementation

Prepared on: 2026-08-02

## Purpose

This document describes the first non-breaking architecture expansion added to the current FleetWorks app. The goal is to create a stronger base for future security, LLM, telemetry, IoT, web/mobile, map, payment, and plug-in requirements without breaking the existing static web application.

## What Changed

The current app still works the same way. UI controllers now live under module folders such as `js/modules/fleet-ops/controllers/fleet.controller.js`, while shared support files such as `cloudstore.js` and `dbcore.js` keep their existing roles.

New platform files were added beside the existing code:

```text
js/
  platform/
    module-registry.js
    hexagonal.js
    api-client.js

  modules/
    index.js
    fleet-core/
      domain/
      ports/
      adapters/
      use-cases/
      view-models/
      fleet-core.module.js
    security/
      security.module.js
    driver-map/
      domain/
      ports/
      adapters/
      use-cases/
      view-models/
      driver-map.module.js
    payments/
      domain/
      ports/
      adapters/
      use-cases/
      view-models/
      payment.module.js
    llm-gateway/
      llm-gateway.module.js
    iot-telemetry/
      iot-telemetry.module.js
```

These files introduce a stable module and capability layer for future work.

## Current Wiring

The new platform files are loaded after the existing application scripts in `fleet.html`.

```text
Existing app scripts
  icons.js
  backend.js
  cloudstore.js
  fleet.js
  dbcore.js
  analytics.js
  account.js
  payroll.js
  testdata.js
  bulkimport.js
  fleetmap.js
  workflow.js
  copilot.js

New platform scripts
  platform/module-registry.js
  platform/hexagonal.js
  platform/api-client.js
  modules/fleet-core/domain/fleet-core.domain.js
  modules/fleet-core/ports/fleet-repository.port.js
  modules/fleet-core/adapters/legacy-fleet.repository.js
  modules/fleet-core/use-cases/list-fleet-summary.usecase.js
  modules/fleet-core/view-models/fleet-core.viewmodel.js
  modules/fleet-core/fleet-core.module.js
  modules/security/security.module.js
  modules/driver-map/domain/driver-map.domain.js
  modules/driver-map/ports/driver-map.port.js
  modules/driver-map/adapters/legacy-driver-map.repository.js
  modules/driver-map/use-cases/driver-map.usecases.js
  modules/driver-map/view-models/driver-map.viewmodel.js
  modules/driver-map/driver-map.module.js
  modules/payments/domain/payment.domain.js
  modules/payments/ports/payment-repository.port.js
  modules/payments/adapters/legacy-payment.repository.js
  modules/payments/use-cases/payment.usecases.js
  modules/payments/view-models/payment.viewmodel.js
  modules/payments/payment.module.js
  modules/llm-gateway/llm-gateway.module.js
  modules/iot-telemetry/iot-telemetry.module.js
  modules/index.js
```

The new layer is additive. It does not replace the existing global functions or current render flow.

## New Platform Responsibilities

### `js/platform/module-registry.js`

Provides `window.FWPlatform`.

Responsibilities:

- Register modules
- Enable/disable modules
- Store module metadata
- Register capabilities
- Expose navigation hints
- Provide lifecycle hooks
- Emit platform events

Important APIs:

```js
FWPlatform.registerModule(definition)
FWPlatform.listModules()
FWPlatform.getModule(id)
FWPlatform.isModuleEnabled(id)
FWPlatform.enableModule(id)
FWPlatform.disableModule(id)
FWPlatform.registerCapability(name, provider)
FWPlatform.capability(name)
FWPlatform.navigationEntries()
FWPlatform.boot()
```

### `js/platform/api-client.js`

Provides `window.FWApi`.

Responsibilities:

- Create a stable API facade for current and future modules
- Wrap current `fwCloud` helpers
- Provide a future migration path from direct Supabase calls to an API/BFF layer
- Expose domain helpers for fleet, payments, and maps

Important APIs:

```js
FWApi.runtime.mode()
FWApi.auth.user()
FWApi.auth.uid()
FWApi.db.orgId()
FWApi.rest.get(table, query)
FWApi.rest.insert(table, row)
FWApi.rest.patch(path, body)
FWApi.rest.delete(table, query)
FWApi.rest.rpc(fn, args)
FWApi.functions.call(name, body)
FWApi.storage.uploadFile(bucket, path, file)
FWApi.storage.signUrl(bucket, path, expiresIn)
```

## New Pluggable Modules

### Fleet Core Module

File:

```text
js/modules/fleet-core/fleet-core.module.js
```

Global:

```js
window.FWFleetCore
```

Purpose:

- Define the core vehicle, driver, assignment, and tenant fleet contract
- Provide future web/mobile/API work a stable boundary around core fleet data
- Register core fleet capabilities before feature modules boot

Registered module id:

```text
fleet_core
```

Capabilities:

```text
fleet.core
fleet.assignments
```

### Security Foundation Module

File:

```text
js/modules/security/security.module.js
```

Global:

```js
window.FWSecurity
```

Purpose:

- Centralize permission names for modules
- Provide a client-side permission helper for UI decisions
- Provide an audit-event hook for future API/BFF persistence
- Keep the source of truth for authorization in Supabase RLS and future backend services

Registered module id:

```text
security
```

Capabilities:

```text
security.permissions
security.audit
```

### Driver Map Module

File:

```text
js/modules/driver-map/driver-map.module.js
```

Global:

```js
window.FWDriverMap
```

Purpose:

- Wrap the current depot/city map module
- Define the future extension contract for driver map, GPS, IoT, and telemetry support
- Register map-related platform capabilities

Registered module id:

```text
driver_map
```

Capabilities:

```text
maps.driver
maps.depot
telemetry.latest
```

Future data contracts:

```text
devices
vehicle_device_links
telemetry_latest
telemetry_alerts
```

Current provider:

```text
Depot / City Map
```

Future providers:

```text
Browser Location Capture
GPS / IoT Telemetry
```

### Payments Module

File:

```text
js/modules/payments/payment.module.js
```

Global:

```js
window.FWPayments
```

Purpose:

- Wrap current payroll/payment support
- Define future payment gateway extension points
- Register payment rails as platform capabilities

Registered module id:

```text
payments
```

Capabilities:

```text
payments.rail.owner_upi
payments.rail.manual_log
payments.gateway.cashfree
```

Current rails:

```text
Owner UPI
Manual Payment Log
Cashfree Payouts
```

Current tables:

```text
payment_requests
salary_payments
driver_payout_details
```

Current Edge Functions:

```text
payroll-add-beneficiary
payroll-transfer
payroll-webhook
```

### LLM Gateway Module

File:

```text
js/modules/llm-gateway/llm-gateway.module.js
```

Global:

```js
window.FWLlmGateway
```

Purpose:

- Define the future LLM gateway boundary around Copilot
- Support model routing, prompt versions, guardrails, usage logging, and evaluations later
- Wrap the current Supabase `copilot` Edge Function as one provider

Registered module id:

```text
llm_gateway
```

Capabilities:

```text
llm.gateway
llm.provider.rule_based
llm.provider.copilot_edge
```

### IoT Telemetry Module

File:

```text
js/modules/iot-telemetry/iot-telemetry.module.js
```

Global:

```js
window.FWTelemetry
```

Purpose:

- Define device registry and telemetry ingestion contracts
- Establish future table and endpoint names for GPS, FASTag, fault codes, and sensor streams
- Provide event normalization helpers for future ingestion pipelines

Registered module id:

```text
iot_telemetry
```

Capabilities:

```text
telemetry.ingestion
telemetry.latest
telemetry.normalize
```

Future table contracts:

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

### Migrated Feature Modules

The following feature modules now own business rules and workflows that used to live directly inside page scripts:

| Module | Folder | Global | Primary UI Controller |
| --- | --- | --- | --- |
| Auth | `js/modules/auth/` | `window.FWAuth` | `js/auth-reset.js`, `js/cloudstore.js`, reset/login pages |
| FleetOps | `js/modules/fleet-ops/` | `window.FWFleetOps` | `js/modules/fleet-ops/controllers/fleet.controller.js` |
| Maintenance | `js/modules/maintenance/` | `window.FWMaintenance` | `js/modules/fleet-ops/controllers/fleet.controller.js` |
| FleetFin | `js/modules/fleet-fin/` | `window.FWFleetFin` | `js/modules/fleet-ops/controllers/fleet.controller.js`, `js/modules/fleet-iq/controllers/analytics.controller.js` |
| FleetIQ | `js/modules/fleet-iq/` | `window.FWFleetIQ` | `js/modules/fleet-iq/controllers/analytics.controller.js` |
| Team Access | `js/modules/team-access/` | `window.FWTeamAccess` | `js/modules/team-access/controllers/team.controller.js`, `js/account.js` |
| Driver Portal | `js/modules/driver-portal/` | `window.FWDriverPortal` | `js/modules/driver-portal/controllers/driver.controller.js` |
| GarageOps | `js/modules/garage-ops/` | `window.FWGarageOps` | `js/modules/garage-ops/controllers/garage.controller.js` |
| Bulk Import | `js/modules/bulk-import/` | `window.FWBulkImport` | `js/modules/bulk-import/controllers/bulkimport.controller.js` |
| Service Workflow | `js/modules/service-workflow/` | `window.FWServiceWorkflow` | `js/modules/service-workflow/controllers/workflow.controller.js` |

The active static-page UI controllers now live under `js/modules/*/controllers/`. The old `js/legacy/*` controller files are deprecated compatibility markers only.

## Plugin Contract

Future modules should register themselves using:

```js
FWPlatform.registerModule({
  id: "module_id",
  name: "Module Name",
  version: "0.1.0",
  layer: "feature",
  order: 100,
  description: "What this module does.",
  dependencies: ["fleet_core"],
  permissions: ["module.view", "module.manage"],
  tables: ["table_a", "table_b"],
  endpoints: ["/api/module"],
  edgeFunctions: ["module-function"],
  navigation: [
    { workspace: "ops", tab: "module", label: "Module", icon: "box" }
  ],
  capabilities: ["module.capability"],
  adapters: {},
  init(ctx) {
    ctx.platform.registerCapability("module.capability", provider);
  },
});
```

## Why This Is Non-Breaking

- Existing page shells still load and render the current UI.
- Existing global functions still work from their new `js/modules/*/controllers/` paths.
- Existing forms, tabs, and render functions are not replaced.
- The new registry only records module metadata and capabilities.
- If a new module fails during boot, the platform logs the error and continues.
- Modules can be disabled through `localStorage` or future feature flags.

## How This Supports Future Requirements

### Security

The registry creates a place to attach permissions per module. This can later connect to:

- Role-based UI visibility
- Server-side permission checks
- Audit logging
- Feature-level RLS tests

### LLM

Future LLM modules can register:

- LLM gateway capabilities
- Model providers
- Prompt versions
- Retrieval permissions
- Cost/usage policies

### Telemetry And IoT

The map module already names the expected future telemetry contracts:

- device registry
- device-to-vehicle links
- latest telemetry state
- telemetry alerts

The module system lets IoT support plug into maps, alerts, maintenance, and analytics without rewriting the whole app.

### Web And Mobile

`FWApi` is a transition point toward a shared client SDK. Today it wraps `fwCloud`. Later it can call a backend-for-frontend API while feature modules keep the same high-level interface.

### `js/platform/hexagonal.js`

Provides `window.FWHex`.

Responsibilities:

- Define ports
- Register adapters
- Register use cases
- Register view models
- Run use cases through stable names
- Inspect active architecture wiring

Important APIs:

```js
FWHex.definePort(name, methods)
FWHex.registerAdapter(portName, adapter)
FWHex.adapter(portName)
FWHex.registerUseCase(name, fn)
FWHex.run(name, input)
FWHex.registerViewModel(name, factory)
FWHex.viewModel(name, input)
FWHex.inspect()
```

### Pluggable Components

Each feature can declare:

- Dependencies
- Permissions
- Tables
- APIs
- Edge Functions
- Navigation
- Capabilities
- Adapters

This turns the current script-per-feature approach into a formal module contract.

## Next Recommended Implementation Steps

1. Add database migrations for `audit_events`, `devices`, `vehicle_device_links`, `telemetry_latest`, and `telemetry_alerts`.
2. Add tests for module registration, boot order, and feature flags.
3. Start migrating new code to `FWApi` instead of direct `fwCloud` calls.
4. Generate navigation from `FWPlatform.navigationEntries()` once the module registry is mature.
5. Move high-risk writes behind a backend API/BFF while keeping Supabase RLS as enforcement.
6. Expand the LLM gateway into a server-side model router with prompt versions, usage logs, and evaluations.
7. Add an IoT ingestion service for HTTPS/MQTT device events.
