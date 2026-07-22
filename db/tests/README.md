# Database migration tests

Executable validation for the FleetWorks SQL migrations — run against a real
**Postgres 16** engine compiled to WASM ([PGlite](https://github.com/electric-sql/pglite)),
so no database server or Supabase connection is needed.

## Run

```bash
cd db/tests
npm install
npm test
```

## What `schema-normalized.test.mjs` covers

It stubs the Supabase-specific bits (the `auth` schema, `auth.uid()`,
`auth.jwt()`, the `anon`/`authenticated` roles and the `fleets` blob table),
runs `db/schema-normalized.sql`, then drives it with a realistic fleet blob:

- **Execution** — the whole schema file runs with no errors.
- **Projection fidelity** — all 12 tables get the right row counts, and values
  land correctly (compliance dates on the right columns, numerics, booleans,
  `jsonb` inspection results, org settings).
- **Link resolution** — driver → vehicle, work order → issue, and vehicle vs
  driver documents re-link by the blob's client ids.
- **Bridge behaviour** — the `fleets` trigger projects on insert/update, is
  idempotent (no duplicate rows or orgs on re-sync), and re-projects on update.
- **RLS tenant isolation** — an org sees only its own rows, a non-member sees
  nothing, and a global admin (`app_metadata.role = 'admin'`) sees all; the
  `authenticated` grants are exercised in the process.
- **Nasty inputs** — apostrophes in names, string-typed numbers, dangling
  vehicle references, orphan documents (skipped, `CHECK` respected), and a
  missing `settings` object (org name defaults).
- **Idempotency** — the entire schema file re-runs cleanly.

A non-zero exit code means a check failed.
