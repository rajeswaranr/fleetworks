-- ============ FleetWorks — edit driver salary payments ============
-- The payroll history was append-only: a manual entry could be inserted or
-- deleted, never corrected. A wrong amount or period therefore had to be
-- deleted and re-entered, which loses the original timestamp and reads as two
-- events in the books instead of one correction.
--
-- This adds UPDATE, restricted to manual rows.
--
-- Cashfree-sourced rows stay untouchable from the client, deliberately. They
-- mirror what the payment gateway actually did; letting an owner edit an
-- amount or UTR would put the app's books permanently out of step with
-- Cashfree's, with no way to tell which is right. Those rows are written by
-- payroll-transfer and payroll-webhook under the service role and stay that way.
--
-- The WITH CHECK is the important half. Without it an owner could take a manual
-- row they are allowed to edit and flip source to 'cashfree', manufacturing a
-- record that claims a gateway transfer happened. Pinning source='manual' and
-- cf_transfer_id is null on the post-update row closes that, and repeating
-- is_org_admin stops a row being moved into another org.

alter table salary_payments add column if not exists updated_at timestamptz;

drop policy if exists salary_payments_manual_update on salary_payments;
create policy salary_payments_manual_update on salary_payments for update to authenticated
  using (is_org_admin(org_id) and source = 'manual')
  with check (is_org_admin(org_id) and source = 'manual' and cf_transfer_id is null);

grant update on salary_payments to authenticated;

-- Stamped by the database rather than the client, so an edit can't be made to
-- look like it never happened.
create or replace function set_salary_payment_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_salary_payments_updated_at on salary_payments;
create trigger trg_salary_payments_updated_at
  before update on salary_payments
  for each row execute function set_salary_payment_updated_at();

-- Verify after running:
--   select polname, pg_get_expr(polqual, polrelid) from pg_policy
--   where polrelid = 'salary_payments'::regclass;
