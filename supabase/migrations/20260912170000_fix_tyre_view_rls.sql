-- ============ FleetWorks — close the v_tyre_manager cross-tenant leak ============
--
-- Found by Supabase's own security advisor after the FleetInsure work, not by
-- reading the migration that created it.
--
-- v_tyre_manager (20260911130000) was created without `security_invoker`, which
-- makes a view run with its OWNER's rights and skip row-level security
-- entirely. On its own that is survivable if only service_role can read it —
-- six other legacy views are in exactly that position and are fine.
--
-- This one was also granted to `anon`. The anon key is published in the client
-- JavaScript of every page, so the combination meant any person who opened the
-- page source could read the tyre inventory, fitments and tread readings of
-- EVERY organisation on the platform, not just their own.
--
-- Nothing needed the anon grant. loadTyreManager() returns early unless
-- fwCloud.user() is set, so the view has only ever been queried by a signed-in
-- owner. Switching to security_invoker makes the RLS already present on tyres,
-- tyre_fitments and tyre_readings apply to whoever is asking.

alter view public.v_tyre_manager set (security_invoker = true);
revoke all on public.v_tyre_manager from anon;

-- ---------- search_path pinning ----------
-- A SECURITY DEFINER function without a fixed search_path can be pointed at a
-- caller-controlled schema, so `vehicles` resolves to their table rather than
-- ours. These are the helpers added this session.

alter function public.set_inspol_updated_at()    set search_path = public;
alter function public.set_assets_updated_at()    set search_path = public;
alter function public.set_coaching_updated_at()  set search_path = public;
alter function public.set_drvdoc_updated_at()    set search_path = public;
alter function public.set_trip_exp_updated_at()  set search_path = public;
alter function public.geofence_contains(uuid, numeric, numeric) set search_path = public;
alter function public.driver_for_event(uuid, timestamptz)       set search_path = public;

-- ---------- Trigger functions are not API ----------
-- PostgREST exposes every function in the public schema as an RPC endpoint, and
-- EXECUTE is granted by default. A trigger function called directly just errors
-- for want of trigger context, but an endpoint that exists is an endpoint worth
-- removing.
--
-- Deliberately NOT revoked: is_org_member, is_org_admin, can_view_vehicle_id and
-- the other predicates. Those are evaluated inside RLS policies as the querying
-- role, so revoking EXECUTE would break every policy that calls them.

revoke execute on function public.sync_vehicle_insurance_expiry() from anon, authenticated;
revoke execute on function public.set_inspol_updated_at()   from anon, authenticated;
revoke execute on function public.set_assets_updated_at()   from anon, authenticated;
revoke execute on function public.set_coaching_updated_at() from anon, authenticated;
revoke execute on function public.set_drvdoc_updated_at()   from anon, authenticated;
revoke execute on function public.set_trip_exp_updated_at() from anon, authenticated;

-- Verify:
--   select relname, reloptions from pg_class where relname = 'v_tyre_manager';
--   -- expect {security_invoker=true}
