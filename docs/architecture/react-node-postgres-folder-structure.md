# Future React, Node, And PostgreSQL Folder Structure

Prepared on: 2026-08-13

## Purpose

This document captures the recommended future folder structure if FleetWorks moves from the current static HTML/CSS/JavaScript app into a ReactJS frontend, NodeJS backend, and PostgreSQL database architecture.

Important: this is not the current repo layout. The current app does not have `frontend/`, `backend/`, or `backend/src/app.js`. Today, FleetWorks is still served by `server/static-server.mjs`, and active UI controllers live under `js/modules/*/controllers/`.

The current static app should not be rewritten all at once. This structure is a target shape for a future migration, while the current `js/modules/*` architecture continues to work.

## Future Recommended Root Structure

```text
fleetworks/
  frontend/
    ReactJS web application

  backend/
    NodeJS API / BFF application

  database/
    PostgreSQL schema, migrations, and seed data

  docs/
    Architecture, setup, API, and operations documentation

  tests/
    Frontend, backend, and integration tests

  package.json
  .gitignore
```

## Frontend Structure

Use `frontend/` for the ReactJS application.

```text
frontend/
  public/
    index.html
    favicon.ico
    assets/
      images/
      icons/

  src/
    app/
      App.jsx
      routes.jsx
      providers.jsx

    modules/
      auth/
        pages/
        components/
        services/
        hooks/

      fleet-ops/
        pages/
        components/
        services/
        hooks/

      fleet-fin/
        pages/
        components/
        services/
        hooks/

      fleet-iq/
        pages/
        components/
        services/
        hooks/

      garage-ops/
        pages/
        components/
        services/
        hooks/

      team-access/
        pages/
        components/
        services/
        hooks/

      driver-portal/
        pages/
        components/
        services/
        hooks/

      payments/
      service-workflow/
      bulk-import/
      driver-map/
      llm-gateway/

    shared/
      components/
      hooks/
      utils/
      constants/
      styles/

    api/
      client.js
      endpoints.js

    styles/
      global.css
      variables.css
      layout.css

    main.jsx

  package.json
  vite.config.js
```

### Frontend Rules

- Keep page-level React screens inside `modules/<module>/pages/`.
- Keep reusable UI pieces inside `modules/<module>/components/` when they belong to one module.
- Keep truly shared UI pieces inside `shared/components/`.
- Keep browser API calls inside `api/` or module `services/`.
- Do not put business rules directly inside React components.
- Keep the same module names used by the current app: `auth`, `fleet-ops`, `fleet-fin`, `fleet-iq`, `garage-ops`, `team-access`, `driver-portal`, `payments`, `service-workflow`, `bulk-import`, `driver-map`, and `llm-gateway`.

## Backend Structure

Use `backend/` for the NodeJS API or backend-for-frontend.

```text
backend/
  src/
    app.js
    server.js

    config/
      db.js
      env.js

    modules/
      auth/
        auth.routes.js
        auth.controller.js
        auth.service.js
        auth.repository.js

      fleet-ops/
        fleet.routes.js
        fleet.controller.js
        fleet.service.js
        fleet.repository.js

      fleet-fin/
        fleet-fin.routes.js
        fleet-fin.controller.js
        fleet-fin.service.js
        fleet-fin.repository.js

      fleet-iq/
        fleet-iq.routes.js
        fleet-iq.controller.js
        fleet-iq.service.js
        fleet-iq.repository.js

      garage-ops/
      team-access/
      driver-portal/
      payments/
      service-workflow/
      bulk-import/
      driver-map/
      llm-gateway/

    middleware/
      auth.middleware.js
      error.middleware.js
      validate.middleware.js

    shared/
      utils/
      constants/
      validators/

    db/
      pool.js
      migrations.js

  package.json
  .env
```

### Backend Rules

- Routes define HTTP endpoints only.
- Controllers handle request/response mapping only.
- Services contain application workflow logic.
- Repositories contain database queries.
- Middleware handles authentication, validation, and error handling.
- PostgreSQL access should go through repositories, not directly from controllers.
- Authorization must be enforced in the backend and/or PostgreSQL RLS, not only in the frontend.

## Database Structure

Use `database/` for PostgreSQL schema, migrations, and seed data.

```text
database/
  migrations/
    001_create_users.sql
    002_create_vehicles.sql
    003_create_drivers.sql
    004_create_expenses.sql
    005_create_service_requests.sql
    006_create_payments.sql

  seeds/
    users.seed.sql
    vehicles.seed.sql
    drivers.seed.sql
    expenses.seed.sql

  schema.sql
```

### Database Rules

- Use migrations for every schema change.
- Use seed files only for local/dev/test data.
- Keep tenant isolation in PostgreSQL RLS policies where applicable.
- Keep indexes near the tables and queries they support.
- Do not rely on frontend filters for data security.

## Tests Structure

```text
tests/
  frontend/
    components/
    pages/

  backend/
    modules/
    middleware/

  integration/
    auth-flow.test.js
    fleet-workflow.test.js
    payment-flow.test.js
```

### Test Rules

- Frontend tests should verify component rendering and user flows.
- Backend tests should verify services, repositories, validation, and permissions.
- Integration tests should verify end-to-end workflows across React, NodeJS, and PostgreSQL.
- Keep RLS and tenant-isolation tests as required production safety checks.

## FleetWorks Module Mapping

The same business module names should exist across frontend and backend:

```text
auth
fleet-ops
fleet-fin
fleet-iq
garage-ops
team-access
driver-portal
payments
service-workflow
bulk-import
driver-map
llm-gateway
```

Example end-to-end mapping:

```text
frontend/src/modules/fleet-ops/
  React pages, components, hooks, and frontend services

backend/src/modules/fleet-ops/
  API routes, controllers, services, and repositories

database/migrations/
  vehicles, drivers, assignments, inspections, and related tables
```

## Migration Guidance From Current App

Current app:

```text
fleet.html
garage.html
team.html
driver.html
css/
js/modules/
js/modules/*/controllers/
supabase/
```

Future app:

```text
frontend/src/modules/
backend/src/modules/
database/migrations/
```

Recommended migration order:

1. Keep the existing static app working.
2. Keep current business boundaries in `js/modules/*`.
3. Create React pages module by module, starting with low-risk pages.
4. Move API access behind backend module services.
5. Move PostgreSQL schema changes into formal migrations.
6. Add tests for every migrated module before removing old UI paths.
7. Retire old static pages only after the React route fully replaces the same workflow.

## Important Decision

For FleetWorks, use the same module names in the frontend, backend, and database documentation. This makes it easy to trace any feature from UI to API to PostgreSQL.
