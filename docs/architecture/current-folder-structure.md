# Current FleetWorks Folder Structure

Prepared on: 2026-08-13

## Purpose

This document describes the actual folder structure of the current FleetWorks repository.

FleetWorks is currently a static HTML/CSS/JavaScript application served by a small Node static server. It is not currently organized as a React `frontend/` plus Node `backend/` application.

## Current Root Structure

```text
fleetworks/
  admin.html
  dashboard.html
  driver.html
  fleet.html
  garage.html
  index.html
  my.html
  partner.html
  privacy.html
  reset.html
  signin.html
  team.html
  why.html

  css/
    landing.css
    style.css

  js/
    account.js
    auth-reset.js
    backend.js
    cloudstore.js
    dbcore.js
    icons.js
    main.js
    partner.js
    reset-password.js
    testdata.js
    legacy/
    modules/
    platform/
    vendor/

  db/
    schema*.sql
    analytics-views.sql
    cleanup-demo-data.sql
    tests/

  supabase/
    config.toml
    migrations/
    functions/

  server/
    static-server.mjs
    ocr/

  scripts/
    seed-overview-data.mjs
    seed-vehicles.mjs

  tests/
    *.test.mjs

  docs/
    architecture/
    fleetworks-architecture-design.md
    fleetworks-platform-foundation.md
    fleetworks-future-platform-roadmap.md

  assets/
  icons/
  manifest.json
  sw.js
  package.json
```

## Current Server Entry

The current local app server is:

```text
server/static-server.mjs
```

It is started through `package.json`:

```text
npm run dev
npm start
```

There is no current `backend/src/app.js` file.

## Current UI Controller Structure

Active page controllers now live inside module folders:

```text
js/modules/fleet-ops/controllers/fleet.controller.js
js/modules/fleet-iq/controllers/analytics.controller.js
js/modules/garage-ops/controllers/garage.controller.js
js/modules/bulk-import/controllers/bulkimport.controller.js
js/modules/service-workflow/controllers/workflow.controller.js
js/modules/payments/controllers/payroll.controller.js
js/modules/driver-map/controllers/fleetmap.controller.js
js/modules/llm-gateway/controllers/copilot.controller.js
js/modules/team-access/controllers/team.controller.js
js/modules/driver-portal/controllers/driver.controller.js
```

The old `js/legacy/*.js` controller files are deprecated compatibility markers only.

## Current Module Structure

Most business modules follow this shape:

```text
js/modules/<module-id>/
  domain/
  ports/
  adapters/
  use-cases/
  view-models/
  controllers/
  <module>.module.js
```

Not every module has every folder yet. Some modules are still contract-only or do not yet need a controller.

Current modules include:

```text
auth
bulk-import
driver-map
driver-portal
fleet-core
fleet-fin
fleet-iq
fleet-ops
garage-ops
iot-telemetry
llm-gateway
maintenance
payments
security
service-workflow
team-access
```

## Current Database And Supabase Files

Current SQL files live mainly in:

```text
db/
supabase/migrations/
```

Detailed table, field, and foreign-key documentation:

```text
docs/architecture/current-database-structure.md
```

Current Supabase Edge Functions live in:

```text
supabase/functions/copilot/
supabase/functions/payroll-add-beneficiary/
supabase/functions/payroll-transfer/
supabase/functions/payroll-webhook/
supabase/functions/team-invite/
```

## Current Tests

Current Node test files live in:

```text
tests/
db/tests/
```

The main test command is:

```text
npm test
```

## Future Structure

The ReactJS, NodeJS, and PostgreSQL folder structure is documented separately as a future target:

```text
docs/architecture/react-node-postgres-folder-structure.md
```

That future structure mentions folders such as `frontend/`, `backend/`, and `database/`, but those folders are not part of the current app layout.
