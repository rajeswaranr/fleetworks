-- ============ FleetWorks — Google Maps Scraper Configuration & History ============
-- Stores scrape configurations (what vendor types + cities to scrape)
-- and audit trail of scrape runs for admin dashboard.

create table if not exists scraper_configs (
  id             uuid primary key default gen_random_uuid(),
  vendor_type    text not null check (vendor_type in ('mechanic', 'electrician', 'battery', 'tyre', 'puncture')),
  city           text not null,
  search_query   text,                     -- e.g. "auto repair near Chennai" — if null, defaults to "{vendor_type} near {city}"
  enabled        boolean not null default true,
  created_at     timestamptz not null default now(),
  unique(vendor_type, city)
);
create index if not exists idx_scraper_configs_enabled on scraper_configs(enabled);

create table if not exists scraper_runs (
  id             uuid primary key default gen_random_uuid(),
  config_id      uuid references scraper_configs(id) on delete set null,
  vendor_type    text,                     -- denormalized for queries even if config deleted
  city           text,
  status         text not null default 'pending' check (status in ('pending', 'running', 'completed', 'failed')),
  records_found  int default 0,
  records_new    int default 0,            -- inserted (place_id didn't exist)
  records_duped  int default 0,            -- skipped (place_id already exists)
  error_message  text,
  started_at     timestamptz,
  completed_at   timestamptz,
  created_at     timestamptz not null default now()
);
create index if not exists idx_scraper_runs_status on scraper_runs(status);
create index if not exists idx_scraper_runs_completed_at on scraper_runs(completed_at desc);

-- Admin-only access, same pattern as vendor_leads
alter table scraper_configs enable row level security;
drop policy if exists "admin_all_scraper_configs" on scraper_configs;
create policy "admin_all_scraper_configs" on scraper_configs
  for all to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
grant select, insert, update, delete on scraper_configs to authenticated;

alter table scraper_runs enable row level security;
drop policy if exists "admin_all_scraper_runs" on scraper_runs;
create policy "admin_all_scraper_runs" on scraper_runs
  for all to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
grant select, insert, update, delete on scraper_runs to authenticated;
