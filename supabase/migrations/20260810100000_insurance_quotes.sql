-- ============ FleetWorks — HCV insurance quote requests ============
-- Captures everything an underwriter actually needs to price a commercial
-- vehicle policy, so a licensed intermediary can return real numbers instead of
-- calling the owner back to ask the same twenty questions.
--
-- This is a QUOTE REQUEST table, not a quotes table. FleetWorks does not
-- calculate premiums and does not hold an IRDAI registration: rows here are
-- enquiries passed to a licensed insurer or intermediary, who prices and issues
-- the policy. The distinction is deliberate and load-bearing — see terms.html §7.
--
-- Security mirrors leads/vendor_applications: anonymous visitors may INSERT
-- only. Nothing here is readable without an admin JWT, because these rows carry
-- registration numbers, GSTIN/PAN and claim history.

create table if not exists insurance_quotes (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  ref              text,

  -- who's asking
  owner_name       text not null,
  phone            text not null,
  email            text,
  business_name    text,
  gstin_pan        text,
  state            text,
  district         text,
  town             text,

  -- what's being insured. fleet_size drives whether this is a single-vehicle
  -- quote or a fleet deal, which underwriters price very differently.
  fleet_size       int not null default 1,
  vehicle_class    text,                  -- truck / tipper / trailer / bus / tanker / LCV
  reg_number       text,
  make_model       text,
  manufacture_year int,
  gvw_kg           numeric,
  body_type        text,
  fuel_type        text,
  rto_code         text,
  permit_type      text,                  -- national / state / private carrier
  goods_type       text,                  -- general / hazardous / perishable / market load
  -- Set when a signed-in owner pulls vehicles straight from their FleetWorks
  -- fleet instead of typing them in. Stored as json so a 20-truck fleet is one
  -- row rather than twenty part-filled enquiries.
  vehicles_json    jsonb,

  -- current cover, which is most of what determines the renewal price
  cover_type       text,                  -- comprehensive / third-party only / not sure
  current_insurer  text,
  policy_expiry    date,
  current_idv      numeric,
  ncb_percent      numeric,
  claims_last_year int,
  addons           text[],                -- zero-dep, engine protect, consumables, RSA...

  notes            text,

  -- BDM workflow, same vocabulary as vendor_leads so the console reads alike
  status           text not null default 'new'
                   check (status in ('new','contacted','quoted','converted','lost')),
  assigned_to      uuid references staff_members(id),
  source           text not null default 'website'
);

create index if not exists idx_insurance_quotes_status on insurance_quotes(status);
create index if not exists idx_insurance_quotes_created on insurance_quotes(created_at desc);
-- Renewal date is the single most useful sort for this desk: a policy expiring
-- in nine days is a very different call from one expiring in four months.
create index if not exists idx_insurance_quotes_expiry on insurance_quotes(policy_expiry);

alter table insurance_quotes enable row level security;

-- Visitors may submit, never read.
drop policy if exists "anon_insert_insurance_quotes" on insurance_quotes;
create policy "anon_insert_insurance_quotes" on insurance_quotes
  for insert to anon with check (true);

-- Signed-in owners submit under the authenticated role, not anon, so they need
-- their own insert policy or the form silently fails for exactly the customers
-- whose fleet data makes the quote worth having.
drop policy if exists "auth_insert_insurance_quotes" on insurance_quotes;
create policy "auth_insert_insurance_quotes" on insurance_quotes
  for insert to authenticated with check (true);

-- Reading and working the queue is admin-only.
drop policy if exists "admin_all_insurance_quotes" on insurance_quotes;
create policy "admin_all_insurance_quotes" on insurance_quotes
  for all to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

grant insert on insurance_quotes to anon;
grant select, insert, update, delete on insurance_quotes to authenticated;

-- Verify after running:
--   select column_name from information_schema.columns
--   where table_name = 'insurance_quotes' order by ordinal_position;
