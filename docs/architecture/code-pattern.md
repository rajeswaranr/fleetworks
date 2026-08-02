# FleetWorks Code Pattern

Prepared on: 2026-08-02

## Recommended Pattern

FleetWorks should follow:

```text
Modular Monolith
  + Hexagonal Architecture inside each module
  + MVVM-style frontend projections
  + Plugin/module registry for optional capabilities
```

This pattern is more suitable than pure MVC or pure MVVM because FleetWorks is not only a screen-based app. It has multiple business domains:

- Fleet core
- Drivers and assignments
- Maintenance
- Finance
- Payments
- Maps
- IoT telemetry
- LLM Copilot
- Documents/OCR
- Team access
- Garage workflow

Each domain needs clear business rules, data boundaries, permissions, and integration adapters.

## Layer Responsibilities

```text
UI / HTML
  Static pages, tabs, forms, containers, user events

View Models
  UI-ready data shape, labels, counts, button states, summaries

Use Cases
  Application actions and workflows

Domain
  Business rules, validation, normalization, calculations

Ports
  Interfaces required by use cases

Adapters
  Supabase, localStorage, existing globals, payment gateways, maps, IoT, LLM

Database / External Services
  Supabase tables, RLS, Edge Functions, Storage, external APIs
```

## Standard Module Structure

New modules should use this folder shape:

```text
js/modules/<module-id>/
  domain/
    <module>.domain.js

  ports/
    <module>.port.js

  adapters/
    legacy-<module>.repository.js
    supabase-<module>.repository.js
    <external-provider>.adapter.js

  use-cases/
    <action>.usecase.js

  view-models/
    <module>.viewmodel.js

  <module>.module.js
```

## Dependency Direction

Dependencies should point inward:

```text
UI -> ViewModel -> UseCase -> Port -> Adapter -> External System
                         |
                         v
                      Domain
```

Rules:

- Domain files must not access DOM, `fetch`, Supabase, `localStorage`, or global app state.
- Use cases depend on ports, not concrete adapters.
- Adapters may call `FWApi`, `fwCloud`, existing globals, Supabase, or external services.
- View models convert use-case output into UI-friendly data.
- Module files register capabilities and metadata with `FWPlatform`.

## Platform Runtime Files

```text
js/platform/module-registry.js
  Registers modules, capabilities, navigation hints, lifecycle hooks.

js/platform/hexagonal.js
  Registers ports, adapters, use cases, and view models.

js/platform/api-client.js
  Stable facade over current fwCloud/Supabase access and future API/BFF.
```

## Current Implemented Module Examples

```text
js/modules/fleet-core/
  domain/
  ports/
  adapters/
  use-cases/
  view-models/
  fleet-core.module.js

js/modules/payments/
  domain/
  ports/
  adapters/
  use-cases/
  view-models/
  payment.module.js

js/modules/driver-map/
  domain/
  ports/
  adapters/
  use-cases/
  view-models/
  driver-map.module.js
```

## Plugin / Plug-Out Rule

A feature is plug-compatible only when it declares:

- Module id
- Dependencies
- Permissions
- Tables
- Endpoints / Edge Functions
- Capabilities
- Adapters
- Navigation entries
- Lifecycle hooks

Example:

```js
FWPlatform.registerModule({
  id: "payments",
  dependencies: ["drivers", "fleet_fin"],
  permissions: ["payments.view", "payments.approve"],
  tables: ["payment_requests", "salary_payments"],
  edgeFunctions: ["payroll-transfer"],
  capabilities: ["payments.rail.owner_upi", "payments.gateway.cashfree"],
  init(ctx) {
    ctx.platform.registerCapability("payments.gateway.cashfree", provider);
  },
});
```

## Migration Strategy

Do not move all current code at once.

Use this sequence:

1. Add domain functions for one small behavior.
2. Add port definitions.
3. Add a legacy adapter wrapping current globals.
4. Add use cases that call the port.
5. Add view models for UI-ready data.
6. Keep the existing UI rendering.
7. When stable, migrate UI event handlers to call use cases.
8. Later, replace legacy adapter with Supabase/API adapter.

## What Not To Do

- Do not put new business rules directly inside `fleet.js` when they belong to a domain module.
- Do not let domain files call Supabase or the DOM.
- Do not add new direct external API calls inside UI event handlers.
- Do not rely on frontend checks for authorization.
- Do not introduce microservices before domain boundaries and module contracts are stable.

## Long-Term Direction

This structure lets FleetWorks grow toward:

```text
apps/web
apps/mobile
services/api
services/iot-ingest
services/llm-gateway
packages/sdk
packages/plugin-contracts
```

The current app can stay working while new modules gradually move behind clean boundaries.
