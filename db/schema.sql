-- ============ FleetWorks — Supabase schema (Phase 1) ============
-- Run this once in Supabase: SQL Editor -> New query -> paste -> Run.
-- Captures customer booking leads and vendor applications.
-- Security model: anonymous visitors can ONLY insert; reading requires
-- a logged-in user (you, via admin.html).

-- ---------- Customer booking leads ----------
create table if not exists leads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  ref text,
  name text,
  phone text not null,
  city text,
  vehicle text,
  service text,
  issue text,
  source text not null default 'website'
);

-- ---------- Vendor / workshop applications ----------
create table if not exists vendor_applications (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  ref text,
  status text not null default 'Under Review',
  business_name text not null,
  owner_name text,
  business_type text,
  phone text not null,
  email text,
  city text,
  pincode text,
  address text,
  services text[],
  vehicles text[],
  mechanics text,
  bays text,
  all_night text,
  doorstep text,
  experience text,
  gstin text,
  pan text,
  bank_ready text
);

-- ---------- Row Level Security ----------
alter table leads enable row level security;
alter table vendor_applications enable row level security;

-- Visitors (anon key) may submit, never read:
create policy "anon_insert_leads" on leads
  for insert to anon with check (true);
create policy "anon_insert_vendor_applications" on vendor_applications
  for insert to anon with check (true);

-- Logged-in users (you) may read everything:
create policy "auth_read_leads" on leads
  for select to authenticated using (true);
create policy "auth_read_vendor_applications" on vendor_applications
  for select to authenticated using (true);
create policy "auth_update_vendor_applications" on vendor_applications
  for update to authenticated using (true);

-- ---------- Applicant status check (safe, limited) ----------
-- Lets the partner page show an applicant their own status by phone
-- number without exposing the table to anonymous reads.
create or replace function check_application_status(p_phone text)
returns table(business_name text, ref text, status text, created_at timestamptz)
language sql
security definer
set search_path = public
as $$
  select business_name, ref, status, created_at
  from vendor_applications
  where phone = p_phone
  order by created_at desc
  limit 1;
$$;
