-- Restore point: policies and table grants exactly as they were BEFORE 20260922110000_rbac_enforce.sql.
-- Generated from pg_policies / role_table_grants. To roll the enforcement layer back:
--   npx supabase db query --linked -f supabase/rollback/rbac_enforce_restore.sql
-- (then delete or supersede the enforcement migration). The RBAC role tables from the core migration stay in place.
begin;
do $$ declare p record; begin for p in select policyname, tablename from pg_policies where schemaname='public' and tablename not in ('rbac_permissions','rbac_roles','rbac_role_permissions','memberships','vehicle_assignments','audit_log') loop execute format('drop policy %I on %I', p.policyname, p.tablename); end loop; end $$;
create policy "admin_read_password_resets" on public.admin_password_resets as permissive for select to authenticated using ((((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));
create policy "assessments_vis" on public.assessments as permissive for all to authenticated using (can_see_request(request_id));
create policy "assets_select" on public.assets as permissive for select to authenticated using ((is_org_admin(org_id) OR ((towed_by_vehicle_id IS NOT NULL) AND can_view_vehicle_id(org_id, towed_by_vehicle_id))));
create policy "assets_write" on public.assets as permissive for all to authenticated using (is_org_admin(org_id)) with check (is_org_admin(org_id));
create policy "attachments_vis" on public.attachments as permissive for all to authenticated using (can_see_request(request_id));
create policy "automation_rules_delete" on public.automation_rules as permissive for delete to authenticated using (is_org_admin(org_id));
create policy "automation_rules_insert" on public.automation_rules as permissive for insert to authenticated with check (is_org_admin(org_id));
create policy "automation_rules_select" on public.automation_rules as permissive for select to authenticated using (is_org_admin(org_id));
create policy "automation_rules_update" on public.automation_rules as permissive for update to authenticated using (is_org_admin(org_id)) with check (is_org_admin(org_id));
create policy "automation_runs_select" on public.automation_runs as permissive for select to authenticated using (is_org_admin(org_id));
create policy "bill_reviews_member_outcome" on public.bill_reviews as permissive for update to authenticated using (is_org_member(org_id)) with check (is_org_member(org_id));
create policy "bill_reviews_member_read" on public.bill_reviews as permissive for select to authenticated using (is_org_member(org_id));
create policy "cmeet_anon" on public.coaching_meetings as permissive for select to anon using ((driver_id IS NOT NULL));
create policy "cmeet_select" on public.coaching_meetings as permissive for select to authenticated using (is_org_member(org_id));
create policy "cmeet_write" on public.coaching_meetings as permissive for all to authenticated using (is_org_member(org_id)) with check (is_org_member(org_id));
create policy "coach_anon_select" on public.coaching_sessions as permissive for select to anon using ((driver_id IS NOT NULL));
create policy "coach_anon_update" on public.coaching_sessions as permissive for update to anon using (((driver_id IS NOT NULL) AND (status = 'assigned'::text))) with check (((driver_id IS NOT NULL) AND (status = ANY (ARRAY['assigned'::text, 'acknowledged'::text]))));
create policy "coach_delete" on public.coaching_sessions as permissive for delete to authenticated using (is_org_admin(org_id));
create policy "coach_insert" on public.coaching_sessions as permissive for insert to authenticated with check ((can_update_vehicle_id(org_id, vehicle_id) OR is_org_admin(org_id)));
create policy "coach_select" on public.coaching_sessions as permissive for select to authenticated using ((can_view_vehicle_id(org_id, vehicle_id) OR is_org_admin(org_id)));
create policy "coach_update" on public.coaching_sessions as permissive for update to authenticated using ((can_update_vehicle_id(org_id, vehicle_id) OR is_org_admin(org_id))) with check ((can_update_vehicle_id(org_id, vehicle_id) OR is_org_admin(org_id)));
create policy "analytics_org_isolation" on public.cold_chain_analytics as permissive for all to public using (is_org_admin(org_id));
create policy "compliance_org_isolation" on public.cold_chain_compliance as permissive for all to public using (is_org_admin(org_id));
create policy "cold_chain_org_isolation" on public.cold_chain_vehicles as permissive for all to public using (is_org_admin(org_id));
create policy "dd_org_admin" on public.daily_dispatch as permissive for all to public using (is_org_admin(org_id));
create policy "dd_supervisor" on public.daily_dispatch as permissive for all to public using (((supervisor_user_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM (sites s
     JOIN site_vehicle_assignments sva ON (((sva.site_id = s.id) AND (sva.removed_date IS NULL))))
  WHERE ((s.supervisor_user_id = auth.uid()) AND (sva.vehicle_id = daily_dispatch.vehicle_id) AND (s.org_id = daily_dispatch.org_id))))));
create policy "events_member_all" on public.device_events as permissive for all to authenticated using (is_org_member(org_id)) with check (is_org_member(org_id));
create policy "devices_delete" on public.devices as permissive for delete to authenticated using (is_org_admin(org_id));
create policy "devices_insert" on public.devices as permissive for insert to authenticated with check (
CASE
    WHEN (vehicle_id IS NULL) THEN is_org_admin(org_id)
    ELSE can_update_vehicle_id(org_id, vehicle_id)
END);
create policy "devices_select" on public.devices as permissive for select to authenticated using (
CASE
    WHEN (vehicle_id IS NULL) THEN is_org_admin(org_id)
    ELSE can_view_vehicle_id(org_id, vehicle_id)
END);
create policy "devices_update" on public.devices as permissive for update to authenticated using (
CASE
    WHEN (vehicle_id IS NULL) THEN is_org_admin(org_id)
    ELSE can_update_vehicle_id(org_id, vehicle_id)
END) with check (
CASE
    WHEN (vehicle_id IS NULL) THEN is_org_admin(org_id)
    ELSE can_update_vehicle_id(org_id, vehicle_id)
END);
create policy "documents_delete" on public.documents as permissive for delete to authenticated using (is_org_admin(org_id));
create policy "documents_select" on public.documents as permissive for select to authenticated using ((is_org_admin(org_id) OR ((entity_type = 'vehicle'::text) AND can_view_vehicle_id(org_id, vehicle_id))));
create policy "documents_update" on public.documents as permissive for update to authenticated using ((is_org_admin(org_id) OR ((entity_type = 'vehicle'::text) AND can_update_vehicle_id(org_id, vehicle_id)))) with check ((is_org_admin(org_id) OR ((entity_type = 'vehicle'::text) AND can_update_vehicle_id(org_id, vehicle_id))));
create policy "documents_write" on public.documents as permissive for insert to authenticated with check ((is_org_admin(org_id) OR ((entity_type = 'vehicle'::text) AND can_update_vehicle_id(org_id, vehicle_id))));
create policy "att_anon_driver" on public.driver_attendance as permissive for select to anon using ((driver_id IS NOT NULL));
create policy "att_anon_driver_insert" on public.driver_attendance as permissive for insert to anon with check (((driver_id IS NOT NULL) AND (source = 'driver'::text) AND (attendance_date >= (CURRENT_DATE - 1)) AND (attendance_date <= CURRENT_DATE)));
create policy "att_delete" on public.driver_attendance as permissive for delete to authenticated using (is_org_admin(org_id));
create policy "att_insert" on public.driver_attendance as permissive for insert to authenticated with check ((is_org_admin(org_id) OR is_my_driver_row(driver_id)));
create policy "att_select" on public.driver_attendance as permissive for select to authenticated using ((is_org_admin(org_id) OR is_my_driver_row(driver_id)));
create policy "att_update" on public.driver_attendance as permissive for update to authenticated using (is_org_admin(org_id)) with check (is_org_admin(org_id));
create policy "drvdoc_admin" on public.driver_documents as permissive for all to authenticated using (is_org_admin(org_id)) with check (is_org_admin(org_id));
create policy "drvdoc_anon_insert" on public.driver_documents as permissive for insert to anon with check (((driver_id IS NOT NULL) AND (submitted_by = 'driver'::text) AND (status = 'pending_review'::text)));
create policy "drvdoc_anon_select" on public.driver_documents as permissive for select to anon using ((driver_id IS NOT NULL));
create policy "drvdoc_anon_update" on public.driver_documents as permissive for update to anon using (((driver_id IS NOT NULL) AND (submitted_by = 'driver'::text))) with check (((driver_id IS NOT NULL) AND (submitted_by = 'driver'::text)));
create policy "driver_entries_insert" on public.driver_entries as permissive for insert to anon with check (((owner_id IS NOT NULL) AND ((length(token) >= 6) AND (length(token) <= 64))));
create policy "driver_entries_owner_select" on public.driver_entries as permissive for select to authenticated using ((auth.uid() = owner_id));
create policy "driver_entries_owner_update" on public.driver_entries as permissive for update to authenticated using ((auth.uid() = owner_id));
create policy "ledger_delete" on public.driver_ledger as permissive for delete to authenticated using (is_org_admin(org_id));
create policy "ledger_insert" on public.driver_ledger as permissive for insert to authenticated with check ((is_org_admin(org_id) OR (is_my_driver_row(driver_id) AND (type = ANY (ARRAY['advance'::text, 'expense'::text])))));
create policy "ledger_select" on public.driver_ledger as permissive for select to authenticated using ((is_org_admin(org_id) OR is_my_driver_row(driver_id)));
create policy "ledger_update" on public.driver_ledger as permissive for update to authenticated using (is_org_admin(org_id)) with check (is_org_admin(org_id));
create policy "dloc_delete" on public.driver_locations as permissive for delete to authenticated using (is_org_admin(org_id));
create policy "dloc_insert" on public.driver_locations as permissive for insert to authenticated with check ((is_my_driver_row(driver_id) AND (EXISTS ( SELECT 1
   FROM drivers d
  WHERE ((d.id = driver_locations.driver_id) AND d.share_location)))));
create policy "dloc_select" on public.driver_locations as permissive for select to authenticated using ((is_org_admin(org_id) OR is_my_driver_row(driver_id)));
create policy "payout_details_admin_delete" on public.driver_payout_details as permissive for delete to authenticated using (is_org_admin(org_id));
create policy "payout_details_admin_select" on public.driver_payout_details as permissive for select to authenticated using (is_org_admin(org_id));
create policy "drivers_admin_write" on public.drivers as permissive for all to authenticated using (is_org_admin(org_id)) with check (is_org_admin(org_id));
create policy "drivers_select" on public.drivers as permissive for select to authenticated using ((is_org_admin(org_id) OR ((vehicle_id IS NOT NULL) AND can_view_vehicle_id(org_id, vehicle_id))));
create policy "drivers_update" on public.drivers as permissive for update to authenticated using (can_update_vehicle_id(org_id, vehicle_id)) with check (can_update_vehicle_id(org_id, vehicle_id));
create policy "estimate_items_vis" on public.estimate_items as permissive for all to authenticated using ((EXISTS ( SELECT 1
   FROM estimates e
  WHERE ((e.id = estimate_items.estimate_id) AND can_see_request(e.request_id)))));
create policy "estimates_vis" on public.estimates as permissive for all to authenticated using (can_see_request(request_id));
create policy "eway_bills_org_isolation" on public.eway_bills as permissive for all to public using (is_org_admin(org_id));
create policy "expcat_member_all" on public.expense_categories as permissive for all to authenticated using (is_org_member(org_id)) with check (is_org_member(org_id));
create policy "ecr_decide" on public.expense_change_requests as permissive for update to authenticated using (is_owner(org_id)) with check (is_owner(org_id));
create policy "ecr_insert" on public.expense_change_requests as permissive for insert to authenticated with check ((can_update_vehicle_id(org_id, vehicle_id) AND (requested_by = auth.uid())));
create policy "ecr_select" on public.expense_change_requests as permissive for select to authenticated using ((is_org_admin(org_id) OR (requested_by = auth.uid())));
create policy "expenses_delete" on public.expenses as permissive for delete to authenticated using (is_org_admin(org_id));
create policy "expenses_insert" on public.expenses as permissive for insert to authenticated with check (can_update_vehicle_id(org_id, vehicle_id));
create policy "expenses_select" on public.expenses as permissive for select to authenticated using (can_view_vehicle_id(org_id, vehicle_id));
create policy "expenses_update" on public.expenses as permissive for update to authenticated using (can_update_vehicle_id(org_id, vehicle_id)) with check (can_update_vehicle_id(org_id, vehicle_id));
create policy "fastag_accounts_select" on public.fastag_accounts as permissive for select to authenticated using (can_view_vehicle_id(org_id, vehicle_id));
create policy "fastag_accounts_write" on public.fastag_accounts as permissive for all to authenticated using (is_org_admin(org_id)) with check (is_org_admin(org_id));
create policy "fastag_anon_driver" on public.fastag_accounts as permissive for select to anon using (((vehicle_id IS NOT NULL) AND (is_active = true)));
create policy "fastag_log_select" on public.fastag_balance_log as permissive for select to authenticated using ((EXISTS ( SELECT 1
   FROM fastag_accounts a
  WHERE ((a.id = fastag_balance_log.account_id) AND can_view_vehicle_id(a.org_id, a.vehicle_id)))));
create policy "feedback_select" on public.feedback as permissive for select to authenticated using (can_see_request(request_id));
create policy "feedback_update" on public.feedback as permissive for update to authenticated using ((EXISTS ( SELECT 1
   FROM service_requests r
  WHERE ((r.id = feedback.request_id) AND is_org_member(r.org_id)))));
create policy "feedback_write" on public.feedback as permissive for insert to authenticated with check ((EXISTS ( SELECT 1
   FROM service_requests r
  WHERE ((r.id = feedback.request_id) AND is_org_member(r.org_id)))));
create policy "own_fleet_delete" on public.fleets as permissive for delete to authenticated using ((auth.uid() = owner_id));
create policy "own_fleet_insert" on public.fleets as permissive for insert to authenticated with check ((auth.uid() = owner_id));
create policy "own_fleet_select" on public.fleets as permissive for select to authenticated using ((auth.uid() = owner_id));
create policy "own_fleet_update" on public.fleets as permissive for update to authenticated using ((auth.uid() = owner_id));
create policy "fuel_alerts_org_isolation" on public.fuel_alerts as permissive for all to public using (is_org_admin(org_id));
create policy "fuel_baseline_org_isolation" on public.fuel_consumption_baseline as permissive for all to public using (is_org_admin(org_id));
create policy "fuel_logs_delete" on public.fuel_logs as permissive for delete to authenticated using (is_org_admin(org_id));
create policy "fuel_logs_insert" on public.fuel_logs as permissive for insert to authenticated with check (can_update_vehicle_id(org_id, vehicle_id));
create policy "fuel_logs_select" on public.fuel_logs as permissive for select to authenticated using (can_view_vehicle_id(org_id, vehicle_id));
create policy "fuel_logs_update" on public.fuel_logs as permissive for update to authenticated using (can_update_vehicle_id(org_id, vehicle_id)) with check (can_update_vehicle_id(org_id, vehicle_id));
create policy "fuel_trips_org_isolation" on public.fuel_trips as permissive for all to public using (is_org_admin(org_id));
create policy "gfe_insert" on public.geofence_events as permissive for insert to authenticated with check (is_org_member(org_id));
create policy "gfe_select" on public.geofence_events as permissive for select to authenticated using ((is_org_admin(org_id) OR ((vehicle_id IS NOT NULL) AND can_view_vehicle_id(org_id, vehicle_id))));
create policy "geofence_anon" on public.geofences as permissive for select to anon using (is_active);
create policy "geofence_select" on public.geofences as permissive for select to authenticated using (is_org_member(org_id));
create policy "geofence_write" on public.geofences as permissive for all to authenticated using (is_org_admin(org_id)) with check (is_org_admin(org_id));
create policy "gst_audit_org_isolation" on public.gst_audit_logs as permissive for all to public using (is_org_admin(org_id));
create policy "gst_config_org_isolation" on public.gst_configuration as permissive for all to public using (is_org_admin(org_id));
create policy "gst_invoices_org_isolation" on public.gst_invoices as permissive for all to public using (is_org_admin(org_id));
create policy "gst_settlement_org_isolation" on public.gst_settlement_summary as permissive for all to public using (is_org_admin(org_id));
create policy "inspections_delete" on public.inspections as permissive for delete to authenticated using (is_org_admin(org_id));
create policy "inspections_insert" on public.inspections as permissive for insert to authenticated with check (can_update_vehicle_id(org_id, vehicle_id));
create policy "inspections_select" on public.inspections as permissive for select to authenticated using (can_view_vehicle_id(org_id, vehicle_id));
create policy "inspections_update" on public.inspections as permissive for update to authenticated using (can_update_vehicle_id(org_id, vehicle_id)) with check (can_update_vehicle_id(org_id, vehicle_id));
create policy "insclaim_all" on public.insurance_claims as permissive for all to authenticated using (is_org_admin(org_id)) with check (is_org_admin(org_id));
create policy "inspol_all" on public.insurance_policies as permissive for all to authenticated using (is_org_admin(org_id)) with check (is_org_admin(org_id));
create policy "admin_all_insurance_quotes" on public.insurance_quotes as permissive for all to authenticated using ((((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text)) with check ((((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));
create policy "anon_insert_insurance_quotes" on public.insurance_quotes as permissive for insert to anon with check (true);
create policy "auth_insert_insurance_quotes" on public.insurance_quotes as permissive for insert to authenticated with check (true);
create policy "invoices_select" on public.invoices as permissive for select to authenticated using (can_see_request(request_id));
create policy "invoices_update" on public.invoices as permissive for update to authenticated using ((EXISTS ( SELECT 1
   FROM service_requests r
  WHERE ((r.id = invoices.request_id) AND is_org_member(r.org_id)))));
create policy "issues_delete" on public.issues as permissive for delete to authenticated using (is_org_admin(org_id));
create policy "issues_insert" on public.issues as permissive for insert to authenticated with check (can_update_vehicle_id(org_id, vehicle_id));
create policy "issues_select" on public.issues as permissive for select to authenticated using (can_view_vehicle_id(org_id, vehicle_id));
create policy "issues_update" on public.issues as permissive for update to authenticated using (can_update_vehicle_id(org_id, vehicle_id)) with check (can_update_vehicle_id(org_id, vehicle_id));
create policy "items_member_all" on public.items as permissive for all to authenticated using (is_org_member(org_id)) with check (is_org_member(org_id));
create policy "admin_update_leads" on public.leads as permissive for update to authenticated using ((((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));
create policy "anon_insert_leads" on public.leads as permissive for insert to anon with check (true);
create policy "auth_read_leads" on public.leads as permissive for select to authenticated using (true);
create policy "mechanics_read" on public.mechanics as permissive for select to authenticated using (((EXISTS ( SELECT 1
   FROM workshops w
  WHERE ((w.id = mechanics.workshop_id) AND (w.owner_user = auth.uid())))) OR (EXISTS ( SELECT 1
   FROM service_requests r
  WHERE ((r.mechanic_id = mechanics.id) AND is_org_member(r.org_id))))));
create policy "org_read" on public.organizations as permissive for select to authenticated using (is_org_member(id));
create policy "parties_admin_all" on public.parties as permissive for all to authenticated using (is_org_admin(org_id)) with check (is_org_admin(org_id));
create policy "parts_admin_delete" on public.parts as permissive for delete to authenticated using (is_org_admin(org_id));
create policy "parts_admin_update" on public.parts as permissive for update to authenticated using (is_org_admin(org_id)) with check (is_org_admin(org_id));
create policy "parts_admin_write" on public.parts as permissive for insert to authenticated with check (is_org_admin(org_id));
create policy "parts_select" on public.parts as permissive for select to authenticated using (is_org_member(org_id));
create policy "payment_requests_admin_all" on public.payment_requests as permissive for all to authenticated using (is_org_admin(org_id)) with check (is_org_admin(org_id));
create policy "payments_insert" on public.payments as permissive for insert to authenticated with check ((EXISTS ( SELECT 1
   FROM (invoices i
     JOIN service_requests r ON ((r.id = i.request_id)))
  WHERE ((i.id = payments.invoice_id) AND is_org_member(r.org_id)))));
create policy "payments_select" on public.payments as permissive for select to authenticated using ((EXISTS ( SELECT 1
   FROM invoices i
  WHERE ((i.id = payments.invoice_id) AND can_see_request(i.request_id)))));
create policy "payout_partner" on public.payout_cycles as permissive for select to authenticated using (is_workshop_user(workshop_id));
create policy "payout_lines_partner" on public.payout_lines as permissive for select to authenticated using ((EXISTS ( SELECT 1
   FROM payout_cycles c
  WHERE ((c.id = payout_lines.cycle_id) AND is_workshop_user(c.workshop_id)))));
create policy "project_sites_org_admin" on public.project_sites as permissive for all to public using (is_org_admin(org_id)) with check (is_org_admin(org_id));
create policy "project_sites_supervisor_read" on public.project_sites as permissive for select to public using ((EXISTS ( SELECT 1
   FROM sites s
  WHERE ((s.id = project_sites.site_id) AND (s.supervisor_user_id = auth.uid())))));
create policy "projects_org_admin" on public.projects as permissive for all to public using (is_org_admin(org_id)) with check (is_org_admin(org_id));
create policy "projects_supervisor_read" on public.projects as permissive for select to public using ((EXISTS ( SELECT 1
   FROM (project_sites ps
     JOIN sites s ON ((s.id = ps.site_id)))
  WHERE ((ps.project_id = projects.id) AND (s.supervisor_user_id = auth.uid())))));
create policy "pol_org_admin" on public.purchase_order_lines as permissive for all to public using (is_org_admin(org_id));
create policy "po_org_admin" on public.purchase_orders as permissive for all to public using (is_org_admin(org_id));
create policy "reminders_delete" on public.reminders as permissive for delete to authenticated using (is_org_admin(org_id));
create policy "reminders_insert" on public.reminders as permissive for insert to authenticated with check (can_update_vehicle_id(org_id, vehicle_id));
create policy "reminders_select" on public.reminders as permissive for select to authenticated using (can_view_vehicle_id(org_id, vehicle_id));
create policy "reminders_update" on public.reminders as permissive for update to authenticated using (can_update_vehicle_id(org_id, vehicle_id)) with check (can_update_vehicle_id(org_id, vehicle_id));
create policy "request_assignments_vis" on public.request_assignments as permissive for all to authenticated using (can_see_request(request_id));
create policy "sew_read" on public.safety_event_weights as permissive for select to authenticated using (((org_id IS NULL) OR is_org_member(org_id)));
create policy "sew_write" on public.safety_event_weights as permissive for all to authenticated using (((org_id IS NOT NULL) AND is_org_admin(org_id))) with check (((org_id IS NOT NULL) AND is_org_admin(org_id)));
create policy "salary_anon_driver" on public.salary_payments as permissive for select to anon using (((driver_ext_id IS NOT NULL) AND (status = ANY (ARRAY['success'::text, 'processing'::text, 'pending'::text]))));
create policy "salary_payments_admin_select" on public.salary_payments as permissive for select to authenticated using (is_org_admin(org_id));
create policy "salary_payments_manual_delete" on public.salary_payments as permissive for delete to authenticated using ((is_org_admin(org_id) AND (source = 'manual'::text)));
create policy "salary_payments_manual_insert" on public.salary_payments as permissive for insert to authenticated with check ((is_org_admin(org_id) AND (source = 'manual'::text) AND (status = 'success'::text) AND (cf_transfer_id IS NULL)));
create policy "salary_payments_manual_update" on public.salary_payments as permissive for update to authenticated using ((is_org_admin(org_id) AND (source = 'manual'::text))) with check ((is_org_admin(org_id) AND (source = 'manual'::text) AND (cf_transfer_id IS NULL)));
create policy "sales_invoice_lines_all" on public.sales_invoice_lines as permissive for all to authenticated using ((EXISTS ( SELECT 1
   FROM sales_invoices i
  WHERE ((i.id = sales_invoice_lines.invoice_id) AND is_org_admin(i.org_id))))) with check ((EXISTS ( SELECT 1
   FROM sales_invoices i
  WHERE ((i.id = sales_invoice_lines.invoice_id) AND is_org_admin(i.org_id)))));
create policy "sales_invoices_all" on public.sales_invoices as permissive for all to authenticated using (is_org_admin(org_id)) with check (is_org_admin(org_id));
create policy "admin_all_scraper_configs" on public.scraper_configs as permissive for all to authenticated using ((((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text)) with check ((((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));
create policy "admin_all_scraper_runs" on public.scraper_runs as permissive for all to authenticated using ((((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text)) with check ((((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));
create policy "service_advisors_admin" on public.service_advisors as permissive for all to authenticated using (COALESCE((((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text), false)) with check (COALESCE((((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text), false));
create policy "sr_owner" on public.service_requests as permissive for all to authenticated using (is_org_member(org_id));
create policy "sr_partner" on public.service_requests as permissive for select to authenticated using (is_workshop_user(workshop_id));
create policy "sr_partner_upd" on public.service_requests as permissive for update to authenticated using (is_workshop_user(workshop_id));
create policy "ssa_org_admin" on public.site_staff_assignments as permissive for all to public using (is_org_admin(org_id));
create policy "sva_org_admin" on public.site_vehicle_assignments as permissive for all to public using (is_org_admin(org_id));
create policy "sva_supervisor_read" on public.site_vehicle_assignments as permissive for select to public using ((EXISTS ( SELECT 1
   FROM sites s
  WHERE ((s.id = site_vehicle_assignments.site_id) AND ((s.supervisor_user_id = auth.uid()) OR is_org_admin(site_vehicle_assignments.org_id))))));
create policy "sites_org_admin" on public.sites as permissive for all to public using (is_org_admin(org_id));
create policy "sites_supervisor_read" on public.sites as permissive for select to public using (((supervisor_user_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM memberships m
  WHERE ((m.user_id = auth.uid()) AND (m.org_id = sites.org_id) AND (m.role = ANY (ARRAY['owner'::text, 'manager'::text])))))));
create policy "admin_all_staff_members" on public.staff_members as permissive for all to authenticated using ((((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text)) with check ((((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));
create policy "status_events_select" on public.status_events as permissive for select to authenticated using (can_see_request(request_id));
create policy "telemetry_member_insert_sim" on public.telemetry as permissive for insert to authenticated with check ((is_org_member(org_id) AND (simulated = true)));
create policy "telemetry_member_read" on public.telemetry as permissive for select to authenticated using (is_org_member(org_id));
create policy "temp_readings_org_isolation" on public.temperature_readings as permissive for all to public using (is_org_admin(org_id));
create policy "violations_org_isolation" on public.temperature_violations as permissive for all to public using (is_org_admin(org_id));
create policy "tire_ai_org_isolation" on public.tire_ai_predictions as permissive for all to public using (is_org_admin(org_id));
create policy "tire_analytics_org_isolation" on public.tire_analytics as permissive for all to public using (is_org_admin(org_id));
create policy "tire_anomalies_org_isolation" on public.tire_anomalies as permissive for all to public using (is_org_admin(org_id));
create policy "tire_fleet_org_isolation" on public.tire_fleet_analytics as permissive for all to public using (is_org_admin(org_id));
create policy "tire_maintenance_org_isolation" on public.tire_maintenance_logs as permissive for all to public using (is_org_admin(org_id));
create policy "tire_pressure_org_isolation" on public.tire_pressure_readings as permissive for all to public using (is_org_admin(org_id));
create policy "tire_registry_org_isolation" on public.tire_registry as permissive for all to public using (is_org_admin(org_id));
create policy "trip_events_owner" on public.trip_events as permissive for select to authenticated using ((EXISTS ( SELECT 1
   FROM trips t
  WHERE ((t.id = trip_events.trip_id) AND can_view_vehicle_id(t.org_id, t.vehicle_id)))));
create policy "trip_events_owner_insert" on public.trip_events as permissive for insert to authenticated with check ((EXISTS ( SELECT 1
   FROM trips t
  WHERE ((t.id = trip_events.trip_id) AND can_update_vehicle_id(t.org_id, t.vehicle_id)))));
create policy "texp_anon_insert" on public.trip_expenses as permissive for insert to anon with check (((driver_id IS NOT NULL) AND (status = 'submitted'::text) AND (amount > (0)::numeric)));
create policy "texp_anon_select" on public.trip_expenses as permissive for select to anon using ((driver_id IS NOT NULL));
create policy "texp_anon_update" on public.trip_expenses as permissive for update to anon using (((driver_id IS NOT NULL) AND (status = 'submitted'::text))) with check (((driver_id IS NOT NULL) AND (status = 'submitted'::text)));
create policy "texp_delete" on public.trip_expenses as permissive for delete to authenticated using (is_org_admin(org_id));
create policy "texp_insert" on public.trip_expenses as permissive for insert to authenticated with check ((can_update_vehicle_id(org_id, vehicle_id) OR is_org_admin(org_id)));
create policy "texp_select" on public.trip_expenses as permissive for select to authenticated using ((can_view_vehicle_id(org_id, vehicle_id) OR is_org_admin(org_id)));
create policy "texp_update" on public.trip_expenses as permissive for update to authenticated using ((can_update_vehicle_id(org_id, vehicle_id) OR is_org_admin(org_id))) with check ((can_update_vehicle_id(org_id, vehicle_id) OR is_org_admin(org_id)));
create policy "trip_req_anon_insert" on public.trip_requests as permissive for insert to anon with check (((org_id IS NOT NULL) AND (trip_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM trips t
  WHERE ((t.id = trip_requests.trip_id) AND (t.vehicle_id IS NOT NULL) AND (t.status = ANY (ARRAY['assigned'::text, 'acknowledged'::text, 'started'::text])))))));
create policy "trip_req_anon_select" on public.trip_requests as permissive for select to anon using ((EXISTS ( SELECT 1
   FROM trips t
  WHERE ((t.id = trip_requests.trip_id) AND (t.vehicle_id IS NOT NULL) AND (t.status = ANY (ARRAY['assigned'::text, 'acknowledged'::text, 'started'::text]))))));
create policy "trip_req_anon_update" on public.trip_requests as permissive for update to anon using ((EXISTS ( SELECT 1
   FROM trips t
  WHERE ((t.id = trip_requests.trip_id) AND (t.vehicle_id IS NOT NULL) AND (t.status = ANY (ARRAY['assigned'::text, 'acknowledged'::text, 'started'::text])))))) with check ((EXISTS ( SELECT 1
   FROM trips t
  WHERE ((t.id = trip_requests.trip_id) AND (t.vehicle_id IS NOT NULL) AND (t.status = ANY (ARRAY['assigned'::text, 'acknowledged'::text, 'started'::text]))))));
create policy "trip_req_delete" on public.trip_requests as permissive for delete to authenticated using (is_org_admin(org_id));
create policy "trip_req_insert" on public.trip_requests as permissive for insert to authenticated with check ((EXISTS ( SELECT 1
   FROM trips t
  WHERE ((t.id = trip_requests.trip_id) AND can_update_vehicle_id(t.org_id, t.vehicle_id)))));
create policy "trip_req_select" on public.trip_requests as permissive for select to authenticated using ((EXISTS ( SELECT 1
   FROM trips t
  WHERE ((t.id = trip_requests.trip_id) AND can_view_vehicle_id(t.org_id, t.vehicle_id)))));
create policy "trip_req_update" on public.trip_requests as permissive for update to authenticated using ((EXISTS ( SELECT 1
   FROM trips t
  WHERE ((t.id = trip_requests.trip_id) AND (can_update_vehicle_id(t.org_id, t.vehicle_id) OR is_org_admin(t.org_id)))))) with check ((EXISTS ( SELECT 1
   FROM trips t
  WHERE ((t.id = trip_requests.trip_id) AND (can_update_vehicle_id(t.org_id, t.vehicle_id) OR is_org_admin(t.org_id))))));
create policy "trips_anon_driver" on public.trips as permissive for select to anon using (((vehicle_id IS NOT NULL) AND (status = ANY (ARRAY['assigned'::text, 'acknowledged'::text, 'started'::text]))));
create policy "trips_delete" on public.trips as permissive for delete to authenticated using (is_org_admin(org_id));
create policy "trips_insert" on public.trips as permissive for insert to authenticated with check (can_update_vehicle_id(org_id, vehicle_id));
create policy "trips_select" on public.trips as permissive for select to authenticated using (can_view_vehicle_id(org_id, vehicle_id));
create policy "trips_update" on public.trips as permissive for update to authenticated using (can_update_vehicle_id(org_id, vehicle_id)) with check (can_update_vehicle_id(org_id, vehicle_id));
create policy "tyre_fitments_delete" on public.tyre_fitments as permissive for delete to authenticated using (is_org_admin(org_id));
create policy "tyre_fitments_select" on public.tyre_fitments as permissive for select to authenticated using (can_view_vehicle_id(org_id, vehicle_id));
create policy "tyre_fitments_update" on public.tyre_fitments as permissive for update to authenticated using (can_update_vehicle_id(org_id, vehicle_id)) with check (can_update_vehicle_id(org_id, vehicle_id));
create policy "tyre_fitments_write" on public.tyre_fitments as permissive for insert to authenticated with check (can_update_vehicle_id(org_id, vehicle_id));
create policy "tyre_readings_delete" on public.tyre_readings as permissive for delete to authenticated using (is_org_admin(org_id));
create policy "tyre_readings_insert" on public.tyre_readings as permissive for insert to authenticated with check (can_update_vehicle_id(org_id, vehicle_id));
create policy "tyre_readings_select" on public.tyre_readings as permissive for select to authenticated using (can_view_vehicle_id(org_id, vehicle_id));
create policy "tyre_readings_update" on public.tyre_readings as permissive for update to authenticated using (can_update_vehicle_id(org_id, vehicle_id)) with check (can_update_vehicle_id(org_id, vehicle_id));
create policy "tyres_select" on public.tyres as permissive for select to authenticated using ((is_org_admin(org_id) OR (EXISTS ( SELECT 1
   FROM tyre_fitments f
  WHERE ((f.tyre_id = tyres.id) AND f.is_current AND can_view_vehicle_id(f.org_id, f.vehicle_id))))));
create policy "tyres_write" on public.tyres as permissive for all to authenticated using (is_org_admin(org_id)) with check (is_org_admin(org_id));
create policy "vos_delete" on public.vehicle_op_statuses as permissive for delete to authenticated using (is_org_admin(org_id));
create policy "vos_select" on public.vehicle_op_statuses as permissive for select to authenticated using (can_view_vehicle_id(org_id, vehicle_id));
create policy "vos_update" on public.vehicle_op_statuses as permissive for update to authenticated using (can_update_vehicle_id(org_id, vehicle_id)) with check (can_update_vehicle_id(org_id, vehicle_id));
create policy "vos_upsert" on public.vehicle_op_statuses as permissive for insert to authenticated with check (can_update_vehicle_id(org_id, vehicle_id));
create policy "telemetry_org_isolation" on public.vehicle_telemetry as permissive for select to public using ((org_id = auth.uid()));
create policy "telemetry_service_insert" on public.vehicle_telemetry as permissive for insert to public with check (true);
create policy "vehicles_admin_delete" on public.vehicles as permissive for delete to authenticated using (is_org_admin(org_id));
create policy "vehicles_admin_update" on public.vehicles as permissive for update to authenticated using (is_org_admin(org_id)) with check (is_org_admin(org_id));
create policy "vehicles_admin_write" on public.vehicles as permissive for insert to authenticated with check (is_org_admin(org_id));
create policy "vehicles_select" on public.vehicles as permissive for select to authenticated using (can_view_vehicle(org_id, ext_id));
create policy "anon_insert_vendor_applications" on public.vendor_applications as permissive for insert to anon with check (true);
create policy "auth_read_vendor_applications" on public.vendor_applications as permissive for select to authenticated using (true);
create policy "auth_update_vendor_applications" on public.vendor_applications as permissive for update to authenticated using (true);
create policy "admin_all_vendor_leads" on public.vendor_leads as permissive for all to authenticated using ((((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text)) with check ((((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));
create policy "vendor_payments_own_select" on public.vendor_payments as permissive for select to authenticated using (((auth.uid() = garage_user_id) OR COALESCE((((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text), false)));
create policy "vendor_pd_own_delete" on public.vendor_payout_details as permissive for delete to authenticated using ((auth.uid() = garage_user_id));
create policy "vendor_pd_own_select" on public.vendor_payout_details as permissive for select to authenticated using (((auth.uid() = garage_user_id) OR COALESCE((((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text), false)));
create policy "wa_contacts_admin_all" on public.whatsapp_contacts as permissive for all to authenticated using (is_org_admin(org_id)) with check (is_org_admin(org_id));
create policy "wa_msg_member_read" on public.whatsapp_messages as permissive for select to authenticated using (is_org_member(org_id));
create policy "wa_tpl_admin" on public.whatsapp_templates as permissive for all to authenticated using ((((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text)) with check ((((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));
create policy "wa_tpl_read" on public.whatsapp_templates as permissive for select to authenticated using (true);
create policy "work_logs_vis" on public.work_logs as permissive for all to authenticated using (can_see_request(request_id));
create policy "wol_admin_write" on public.work_order_lines as permissive for all to authenticated using (is_org_admin(org_id)) with check (is_org_admin(org_id));
create policy "wol_select" on public.work_order_lines as permissive for select to authenticated using ((EXISTS ( SELECT 1
   FROM work_orders w
  WHERE ((w.id = work_order_lines.work_order_id) AND can_view_vehicle_id(w.org_id, w.vehicle_id)))));
create policy "work_orders_delete" on public.work_orders as permissive for delete to authenticated using (is_org_admin(org_id));
create policy "work_orders_insert" on public.work_orders as permissive for insert to authenticated with check (can_update_vehicle_id(org_id, vehicle_id));
create policy "work_orders_select" on public.work_orders as permissive for select to authenticated using (can_view_vehicle_id(org_id, vehicle_id));
create policy "work_orders_update" on public.work_orders as permissive for update to authenticated using (can_update_vehicle_id(org_id, vehicle_id)) with check (can_update_vehicle_id(org_id, vehicle_id));
create policy "work_reports_vis" on public.work_reports as permissive for all to authenticated using (can_see_request(request_id));
create policy "workshop_complaints_select" on public.workshop_complaints as permissive for select to authenticated using ((((request_id IS NOT NULL) AND can_see_request(request_id)) OR ((org_id IS NOT NULL) AND is_org_member(org_id)) OR ((workshop_id IS NOT NULL) AND is_workshop_user(workshop_id))));
create policy "workshop_complaints_update" on public.workshop_complaints as permissive for update to authenticated using (((org_id IS NOT NULL) AND is_org_member(org_id)));
create policy "workshop_complaints_write" on public.workshop_complaints as permissive for insert to authenticated with check (((org_id IS NOT NULL) AND is_org_member(org_id)));
create policy "workshops_directory" on public.workshops as permissive for select to authenticated using ((active = true));
create policy "workshops_own" on public.workshops as permissive for update to authenticated using ((owner_user = auth.uid()));
create policy "workshops_read" on public.workshops as permissive for select to authenticated using (((owner_user = auth.uid()) OR (EXISTS ( SELECT 1
   FROM service_requests r
  WHERE ((r.workshop_id = workshops.id) AND is_org_member(r.org_id))))));
revoke all on all tables in schema public from anon, authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.admin_password_resets to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.admin_password_resets to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.assessments to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.assessments to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.assets to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.assets to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.attachments to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.attachments to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.automation_rules to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.automation_rules to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.automation_runs to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.automation_runs to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.bill_reviews to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.bill_reviews to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.coaching_meetings to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.coaching_meetings to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.coaching_sessions to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.coaching_sessions to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.cold_chain_analytics to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.cold_chain_analytics to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.cold_chain_compliance to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.cold_chain_compliance to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.cold_chain_config to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.cold_chain_config to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.cold_chain_vehicles to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.cold_chain_vehicles to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.daily_dispatch to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.daily_dispatch to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.device_events to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.device_events to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.devices to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.devices to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.documents to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.documents to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.driver_attendance to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.driver_attendance to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.driver_documents to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.driver_documents to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.driver_entries to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.driver_entries to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.driver_ledger to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.driver_ledger to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.driver_locations to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.driver_locations to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.driver_payout_details to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.driver_payout_details to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.drivers to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.drivers to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.estimate_items to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.estimate_items to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.estimates to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.estimates to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.eway_bills to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.eway_bills to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.expense_categories to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.expense_categories to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.expense_change_requests to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.expense_change_requests to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.expenses to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.expenses to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.fastag_accounts to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.fastag_accounts to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.fastag_balance_log to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.fastag_balance_log to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.feedback to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.feedback to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.fleets to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.fleets to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.fuel_alerts to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.fuel_alerts to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.fuel_consumption_baseline to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.fuel_consumption_baseline to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.fuel_logs to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.fuel_logs to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.fuel_trips to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.fuel_trips to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.geofence_events to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.geofence_events to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.geofences to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.geofences to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.gst_audit_logs to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.gst_audit_logs to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.gst_configuration to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.gst_configuration to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.gst_invoices to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.gst_invoices to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.gst_settlement_summary to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.gst_settlement_summary to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.inspections to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.inspections to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.insurance_claims to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.insurance_claims to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.insurance_policies to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.insurance_policies to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.insurance_quotes to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.insurance_quotes to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.invoices to anon;
grant REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.invoices to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.issues to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.issues to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.items to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.items to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.leads to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.leads to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.mechanics to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.mechanics to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.organizations to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.organizations to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.parties to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.parties to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.parts to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.parts to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.payment_requests to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.payment_requests to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.payments to anon;
grant INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE on public.payments to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.payout_cycles to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.payout_cycles to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.payout_lines to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.payout_lines to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.project_sites to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.project_sites to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.projects to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.projects to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.purchase_order_lines to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.purchase_order_lines to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.purchase_orders to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.purchase_orders to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.reminders to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.reminders to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.request_assignments to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.request_assignments to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.safety_event_weights to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.safety_event_weights to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.salary_payments to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.salary_payments to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.sales_invoice_lines to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.sales_invoice_lines to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.sales_invoices to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.sales_invoices to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.scraper_configs to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.scraper_configs to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.scraper_runs to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.scraper_runs to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.service_advisors to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.service_advisors to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.service_requests to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.service_requests to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.site_staff_assignments to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.site_staff_assignments to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.site_vehicle_assignments to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.site_vehicle_assignments to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.sites to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.sites to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.staff_members to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.staff_members to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.status_events to anon;
grant REFERENCES, SELECT, TRIGGER, TRUNCATE on public.status_events to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.telemetry to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.telemetry to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.telemetry_speeding_alerts to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.telemetry_speeding_alerts to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.temperature_readings to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.temperature_readings to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.temperature_violations to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.temperature_violations to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.tire_ai_predictions to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.tire_ai_predictions to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.tire_analytics to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.tire_analytics to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.tire_anomalies to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.tire_anomalies to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.tire_fleet_analytics to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.tire_fleet_analytics to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.tire_maintenance_logs to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.tire_maintenance_logs to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.tire_pressure_readings to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.tire_pressure_readings to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.tire_registry to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.tire_registry to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.trip_events to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.trip_events to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.trip_expenses to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.trip_expenses to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.trip_requests to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.trip_requests to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.trips to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.trips to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.tyre_fitments to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.tyre_fitments to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.tyre_readings to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.tyre_readings to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.tyres to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.tyres to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.v_coachable_queue to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.v_coachable_queue to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.v_driver_expense_summary to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.v_driver_expense_summary to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.v_driver_pay_summary to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.v_driver_pay_summary to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.v_driver_safety_score to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.v_driver_safety_score to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.v_insurance_radar to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.v_insurance_radar to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.v_safety_events to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.v_safety_events to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.v_tyre_manager to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.v_workshop_directory to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.v_workshop_directory to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.vehicle_op_statuses to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.vehicle_op_statuses to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.vehicle_telemetry to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.vehicle_telemetry to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.vehicle_telemetry_daily to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.vehicle_telemetry_daily to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.vehicle_telemetry_hourly to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.vehicle_telemetry_hourly to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.vehicle_telemetry_latest to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.vehicle_telemetry_latest to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.vehicles to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.vehicles to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.vehicles_low_fuel to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.vehicles_low_fuel to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.vendor_applications to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.vendor_applications to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.vendor_leads to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.vendor_leads to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.vendor_payments to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.vendor_payments to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.vendor_payout_details to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.vendor_payout_details to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.whatsapp_contacts to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.whatsapp_contacts to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.whatsapp_messages to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.whatsapp_messages to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.whatsapp_templates to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.whatsapp_templates to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.work_logs to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.work_logs to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.work_order_lines to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.work_order_lines to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.work_orders to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.work_orders to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.work_reports to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.work_reports to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.workshop_complaints to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.workshop_complaints to authenticated;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.workshops to anon;
grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.workshops to authenticated;
grant execute on all functions in schema public to public, anon, authenticated;
commit;
