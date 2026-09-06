-- ============ FleetWorks — trip, tonnage and custom pay bases ============
-- Drivers in Indian road transport are paid in more ways than a calendar can
-- express: per trip, per tonne carried, or an arrangement peculiar to one
-- operator ("custom"). The basis lives on the driver; each payment then
-- captures the quantity and rate that produced its amount.
--
--   trip     -> qty = number of trips, rate = salary per trip
--   tonnage  -> qty = tonnes carried,  rate = rate per tonne
--   custom   -> qty/rate optional; amount stands on its own
--
-- qty and rate are stored on the payment, not derived at read time, because
-- rates change — a payment made when the trip rate was 800 must still read
-- "12 trips x 800" after the operator moves to 900.
--
-- amount stays authoritative and is NOT a generated column: operators round
-- ("call it 10,000"), deduct advances, and add bata, so qty x rate is the
-- explanation of the figure, never its enforcement.
--
-- No existing data changes: constraints widen only, new columns arrive null.

alter table drivers drop constraint if exists drivers_pay_basis_check;
alter table drivers add constraint drivers_pay_basis_check
  check (pay_basis in ('monthly', 'weekly', 'daily', 'trip', 'tonnage', 'custom'));

alter table salary_payments drop constraint if exists salary_payments_pay_basis_check;
alter table salary_payments add constraint salary_payments_pay_basis_check
  check (pay_basis is null or pay_basis in ('monthly', 'weekly', 'daily', 'trip', 'tonnage', 'custom'));

alter table salary_payments add column if not exists qty  numeric check (qty is null or qty > 0);
alter table salary_payments add column if not exists rate numeric check (rate is null or rate > 0);

-- Verify after running:
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--   where conname like '%pay_basis%';
