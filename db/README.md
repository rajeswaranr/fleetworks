# Database changes now go through Supabase CLI migrations

As of 2026-07-26, schema changes are no longer standalone `.sql` files run
manually in the Supabase SQL Editor. The 17 files that used to live in this
folder are now baselined as migrations in `supabase/migrations/` and are
tracked as "applied" against the live project (`crdblxeufbhysglbbtxi`) — the
files in this `db/` folder are kept only as historical reference and are no
longer the source of truth.

## Making a new schema change

```bash
npx supabase migration new short_description_here
```

This creates `supabase/migrations/<timestamp>_short_description_here.sql`.
Write the change there (idempotent — `create table if not exists`,
`add column if not exists`, etc., same style as before).

## Applying it to the live database

```bash
npx supabase db push
```

This applies only the migrations not yet recorded as applied — it will
never re-run something already live. Add `--dry-run` first to see what
would be applied without touching anything.

## Checking sync state

```bash
npx supabase migration list
```

Shows `local` vs `remote` for every migration. They should always match;
if `local` has entries `remote` doesn't, run `db push`.

## Why this is safer than the old way

- No more "did I already run this one?" — the remote tracking table
  (`supabase_migrations.schema_migrations`) is the single source of truth.
- Changes are ordered and timestamped, so drift between files and what's
  actually live is now a `migration list` check away instead of a guess.
- `--dry-run` lets you see exactly what SQL would run before it does.

Note: `supabase db pull`/`db diff` want a local Docker-backed shadow
database to compute diffs and aren't available on this machine (Docker
Desktop isn't installed). This doesn't block `migration new` + `db push`,
which is the actual day-to-day workflow — it only affects auto-generating
a migration FROM an existing manual change, which shouldn't come up again
now that changes go through `migration new` from the start.
