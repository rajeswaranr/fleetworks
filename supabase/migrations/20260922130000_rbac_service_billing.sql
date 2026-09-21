-- Workshop billing/feedback writes were open to every member of the organisation
-- (a driver could edit an invoice or record a payment). They now need the
-- service_requests:update permission, which owner/manager (and roles the owner
-- grants it to) hold. Reads are unchanged (can_see_request).
drop policy if exists feedback_write on feedback;
create policy feedback_write on feedback for insert to authenticated
  with check (exists (select 1 from service_requests r where r.id = feedback.request_id and has_perm(r.org_id, 'service_requests:update')));
drop policy if exists feedback_update on feedback;
create policy feedback_update on feedback for update to authenticated
  using (exists (select 1 from service_requests r where r.id = feedback.request_id and has_perm(r.org_id, 'service_requests:update')));
drop policy if exists invoices_update on invoices;
create policy invoices_update on invoices for update to authenticated
  using (exists (select 1 from service_requests r where r.id = invoices.request_id and has_perm(r.org_id, 'service_requests:update')));
drop policy if exists payments_insert on payments;
create policy payments_insert on payments for insert to authenticated
  with check (exists (select 1 from invoices i join service_requests r on r.id = i.request_id
                       where i.id = payments.invoice_id and has_perm(r.org_id, 'service_requests:update')));
