-- ============ FleetWorks — Vendor Leads (Google Maps scraper ingestion) ============
-- Sourced candidates for the workshop-partner network (mechanics,
-- electricians, battery shops, tyre shops, puncture repair) — distinct
-- from vendor_applications, which are self-registered partners. A scraped
-- lead only becomes a real vendor_applications row once a BDM has
-- called/verified it (manual promotion, not automatic).
--
-- Not org-scoped (this is FleetWorks' own sourcing pipeline, not a
-- transport owner's data) — same pattern as leads/vendor_applications/
-- staff_members: gated purely by app_metadata.role = 'admin'.
--
-- place_id (Google's own unique id) is unique so re-uploading the same
-- scrape (or an overlapping one across query terms/cities) never creates
-- duplicates — insert conflicts are just ignored by the client.

create table if not exists vendor_leads (
  id             uuid primary key default gen_random_uuid(),
  source         text not null default 'google_maps_scraper',
  service_category text,                 -- our own taxonomy: mechanic/electrician/battery/tyre/puncture
  place_id       text unique,             -- Google's unique place id — natural dedupe key
  business_name  text not null,
  google_category text,                  -- Google's own category text (e.g. "Auto repair shop")
  phone          text,
  website        text,
  address        text,
  city           text,                   -- tagged from the search query at ingestion time
  state          text default 'Tamil Nadu',
  latitude       numeric,
  longitude      numeric,
  rating         numeric,
  review_count   int,
  emails         text[],
  maps_link      text,
  status         text not null default 'new' check (status in ('new','contacted','qualified','rejected','converted')),
  assigned_to    uuid references staff_members(id),
  notes          text,
  raw            jsonb,                  -- full original scraped record, nothing lost
  created_at     timestamptz not null default now()
);
create index if not exists idx_vendor_leads_status on vendor_leads(status);
create index if not exists idx_vendor_leads_category on vendor_leads(service_category);
create index if not exists idx_vendor_leads_city on vendor_leads(city);

alter table vendor_leads enable row level security;
drop policy if exists "admin_all_vendor_leads" on vendor_leads;
create policy "admin_all_vendor_leads" on vendor_leads
  for all to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
grant select, insert, update, delete on vendor_leads to authenticated;

-- Verify after running:
--   select column_name from information_schema.columns where table_name = 'vendor_leads' order by 1;
