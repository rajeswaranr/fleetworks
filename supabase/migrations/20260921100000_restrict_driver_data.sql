-- Drivers and supervisors must only see what is theirs.
--
-- The team-access design scopes vehicles, expenses, work orders and the like to
-- the vehicles a login is assigned to, and the ledger (khata) to the driver's own
-- row. Several later migrations put blanket "any member of the organisation"
-- policies back on some tables. Row-level-security policies are permissive and
-- add together, so those blanket policies silently defeated the scoped ones: a
-- driver login could read every driver's khata and every vehicle in the fleet
-- straight from the API, whatever the app displayed.
--
-- This removes those blanket policies and gives the tables that lost their only
-- policy an explicit owner/manager one. Owners and managers keep full access
-- (is_org_admin); drivers and supervisors keep exactly the scoped access the
-- existing per-vehicle / per-driver policies give them. Safe to re-run.

-- ── the ledger (khata): own rows only for drivers ──────────────────────────
-- Remaining policies: ledger_select (admin or own row), ledger_insert (admin, or
-- own advance/expense), ledger_update and ledger_delete (admin).
drop policy if exists org_members_all_driver_ledger on driver_ledger;

-- ── vehicles: only assigned vehicles for drivers/supervisors ───────────────
-- Remaining: vehicles_select (can_view_vehicle) plus admin insert/update/delete.
drop policy if exists org_members_all_vehicles on vehicles;
drop policy if exists vehicles_rw on vehicles;

-- ── parts: members can read the catalogue, only admins change it ───────────
drop policy if exists org_members_all_parts on parts;

-- ── owner money and contacts: owners/managers only ─────────────────────────
drop policy if exists org_members_all_payment_requests on payment_requests;
drop policy if exists payment_requests_admin_all on payment_requests;
create policy payment_requests_admin_all on payment_requests
  for all to authenticated using (is_org_admin(org_id)) with check (is_org_admin(org_id));

drop policy if exists parties_member_all on parties;
drop policy if exists parties_admin_all on parties;
create policy parties_admin_all on parties
  for all to authenticated using (is_org_admin(org_id)) with check (is_org_admin(org_id));

drop policy if exists wa_contacts_member on whatsapp_contacts;
drop policy if exists wa_contacts_admin_all on whatsapp_contacts;
create policy wa_contacts_admin_all on whatsapp_contacts
  for all to authenticated using (is_org_admin(org_id)) with check (is_org_admin(org_id));

-- ── work order lines follow their work order ───────────────────────────────
-- Readable when the parent work order's vehicle is visible; changed by admins.
drop policy if exists wol_member_all on work_order_lines;
drop policy if exists wol_select on work_order_lines;
drop policy if exists wol_admin_write on work_order_lines;
create policy wol_select on work_order_lines
  for select to authenticated using (
    exists (
      select 1 from work_orders w
      where w.id = work_order_lines.work_order_id
        and can_view_vehicle_id(w.org_id, w.vehicle_id)
    )
  );
create policy wol_admin_write on work_order_lines
  for all to authenticated using (is_org_admin(org_id)) with check (is_org_admin(org_id));
