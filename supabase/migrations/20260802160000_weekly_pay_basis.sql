-- ============ FleetWorks — weekly-wage drivers ============
-- Adds 'weekly' alongside 'monthly' and 'daily'. Plenty of Indian transport
-- operators settle driver wages once a week rather than per day or per month.
--
-- A weekly period is stored as the WEEK-ENDING DATE (a plain date, e.g.
-- 2026-08-09), not an ISO week string like "2026-W32". Three reasons:
-- <input type="week"> is unsupported in Safari and Firefox; an ISO week number
-- is unreadable to a driver checking a payslip; and a real date sorts and
-- compares correctly against the daily rows already in this column.
--
-- No existing data changes: both constraints are widened only, and widening a
-- CHECK can never invalidate a row that already passes the narrower one.

alter table drivers drop constraint if exists drivers_pay_basis_check;
alter table drivers add constraint drivers_pay_basis_check
  check (pay_basis in ('monthly', 'weekly', 'daily'));

alter table salary_payments drop constraint if exists salary_payments_pay_basis_check;
alter table salary_payments add constraint salary_payments_pay_basis_check
  check (pay_basis is null or pay_basis in ('monthly', 'weekly', 'daily'));

-- Verify after running:
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--   where conname in ('drivers_pay_basis_check','salary_payments_pay_basis_check');
