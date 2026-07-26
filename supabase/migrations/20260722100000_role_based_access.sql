-- ============ FleetWorks — role-based access (Phase 3) ============
-- Run in Supabase: SQL Editor -> New query -> paste -> Run.
--
-- SECURITY FIX #1: the original schema.sql granted "select" on leads and
-- vendor_applications to ANY authenticated user, written back when only
-- the admin account existed. Since Phase 2 added real login accounts for
-- transport owners (same `authenticated` role), that policy has been
-- letting any signed-in owner read every customer's phone number and
-- every partner's PAN/GSTIN via a direct REST call.
--
-- This migration adds partner login (vendor_applications gets an
-- owner_id) and restricts "see everything" access to accounts explicitly
-- flagged as admin -- while keeping each role's data strictly isolated
-- from the others:
--   - Anonymous visitors: insert only, and only with owner_id left null
--     (enforced by the database, not just "the UI doesn't send it" --
--     a raw API request cannot plant owner_id = someone else's real
--     account id to pollute their partner portal).
--   - Partners: can read/update only the application row(s) where
--     owner_id = their own account id.
--   - Admin: full read/update, gated on app_metadata.role = 'admin',
--     which only you (via the dashboard) can set -- never user-editable,
--     so no partner or owner account can self-promote to admin.
--   - The one-time "claim an application submitted before you had an
--     account" fallback matches on the JWT's verified `email` claim
--     (proven by actually confirming that inbox), never on phone number
--     alone, which anyone could type in without proving they own it.
--
-- ---------- One-time manual step (do this after running the SQL) ----------
-- Mark your own admin account so admin.html keeps working:
--   Supabase Dashboard -> Authentication -> Users -> click your admin user
--   -> "Raw App Meta Data" -> set it to:  {"role": "admin"}
--   -> Save.

-- ---------- Partner login support ----------
alter table vendor_applications add column if not exists owner_id uuid references auth.users(id);

-- ---------- Drop the old, overly-broad / now-superseded policies ----------
drop policy if exists "auth_read_leads" on leads;
drop policy if exists "auth_read_vendor_applications" on vendor_applications;
drop policy if exists "auth_update_vendor_applications" on vendor_applications;
drop policy if exists "anon_insert_vendor_applications" on vendor_applications;

-- ---------- Admin: full access, only for accounts flagged as admin ----------
create policy "admin_read_leads" on leads
  for select to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

create policy "admin_read_vendor_applications" on vendor_applications
  for select to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

create policy "admin_update_vendor_applications" on vendor_applications
  for update to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- ---------- Anonymous submission: never allowed to claim an owner ----------
create policy "anon_insert_vendor_applications" on vendor_applications
  for insert to anon
  with check (owner_id is null);

-- ---------- Authenticated submission: may only claim themselves ----------
-- Used when the partner's account is created in the same step as
-- registration (no email-confirmation wait), so owner_id can be set
-- immediately rather than left for the claim fallback below.
create policy "authenticated_insert_own_application" on vendor_applications
  for insert to authenticated
  with check (auth.uid() = owner_id);

-- ---------- Partner: read only their own application ----------
create policy "partner_read_own_application" on vendor_applications
  for select to authenticated
  using (auth.uid() = owner_id);

-- ---------- Partner: claim an application submitted before sign-up ----------
-- Matches on the JWT's verified email claim (proven by confirming that
-- inbox) -- NOT phone number, which anyone can type in without proving
-- they own it.
create policy "partner_claim_own_application" on vendor_applications
  for update to authenticated
  using (owner_id is null and email is not null and email = (auth.jwt() ->> 'email'))
  with check (owner_id = auth.uid());
