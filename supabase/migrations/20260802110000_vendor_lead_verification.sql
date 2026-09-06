-- ============ FleetWorks — vendor lead verification gate + scrape progress ============
-- Scraped leads arrive unchecked: Google's categories are approximate, and the
-- weaker searches (body works especially) return car shops alongside truck
-- shops. So a scrape now lands rows as UNVERIFIED, and someone eyeballs them —
-- Google category, rating, phone — before they enter the BDM pipeline.
--
-- This is deliberately NOT folded into the existing `status` column. `status`
-- tracks sales progress (new -> contacted -> qualified -> converted), which
-- only becomes meaningful once we've agreed the shop is worth calling at all.
-- Verification is the gate in front of that, so it gets its own flag.
--
-- Existing rows are backfilled to verified = true: they were added before this
-- gate existed and are already in the BDM's working set, so silently demoting
-- them to "unverified" would hide live work.

alter table vendor_leads add column if not exists verified    boolean not null default false;
alter table vendor_leads add column if not exists verified_at timestamptz;

update vendor_leads set verified = true, verified_at = coalesce(verified_at, created_at)
where verified = false and created_at < now();

create index if not exists idx_vendor_leads_verified on vendor_leads(verified);

-- New leads from here on start unverified.
alter table vendor_leads alter column verified set default false;

-- ---------- Scrape progress ----------
-- The scrape is a single synchronous call, so the console cannot see inside it.
-- The edge function writes a human-readable stage here as it goes ("Searching
-- Google Maps…", "Found 47, saving…") and the console polls this row, so the
-- progress shown is the real server state rather than a client-side guess.
alter table scraper_runs add column if not exists progress text;

-- Verify after running:
--   select column_name from information_schema.columns
--   where table_name = 'vendor_leads' and column_name like 'verified%';
