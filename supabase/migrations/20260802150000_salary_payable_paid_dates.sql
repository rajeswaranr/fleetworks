-- ============ FleetWorks — payable date vs paid date on salary payments ============
-- A daily-wage payment has two dates that genuinely differ: the day the driver
-- worked (what the money is FOR) and the day the money actually left (when it
-- was paid). Three days' wages settled together on Friday share one paid date
-- but three different payable dates, and `period` alone cannot express that.
--
-- Monthly salaries keep using `period` ("2026-07") for what the money is for,
-- because a month is not a date and forcing one would invent a day that means
-- nothing.
--
-- pay_basis is snapshotted onto the payment itself, not just read from the
-- driver. A driver can move from monthly to daily, and without this every one
-- of their historical monthly payments would start rendering as if it had
-- always been a daily wage.
--
-- ---------- Existing data ----------
-- Nothing is dropped or rewritten: `period` is untouched and stays the source
-- of truth for monthly rows. The new columns are only ever filled in from what
-- each row already tells us, and nothing is invented:
--   pay_basis    <- 'daily' if period already looks like a full date, else
--                   'monthly' (which is what the app assumed before today)
--   payable_date <- period, but ONLY where it is already a full date
--   paid_date    <- completed_at if present, else initiated_at, both of which
--                   are the real recorded time the payment happened
-- A monthly row therefore ends with payable_date null, which is correct — it
-- was never paid for a single day.

alter table salary_payments add column if not exists payable_date date;
alter table salary_payments add column if not exists paid_date     date;
alter table salary_payments add column if not exists pay_basis     text;

-- Backfill. Guarded on "is null" so re-running can never overwrite a real value.
update salary_payments
   set pay_basis = case when period ~ '^\d{4}-\d{2}-\d{2}$' then 'daily' else 'monthly' end
 where pay_basis is null;

update salary_payments
   set payable_date = period::date
 where payable_date is null
   and period ~ '^\d{4}-\d{2}-\d{2}$';

update salary_payments
   set paid_date = coalesce(completed_at, initiated_at)::date
 where paid_date is null;

-- Constrain only after backfilling, so the update above can't trip it.
alter table salary_payments drop constraint if exists salary_payments_pay_basis_check;
alter table salary_payments add constraint salary_payments_pay_basis_check
  check (pay_basis is null or pay_basis in ('monthly', 'daily'));

alter table salary_payments alter column pay_basis set default 'monthly';

create index if not exists idx_salary_payments_paid_date on salary_payments(org_id, paid_date desc);

-- Verify after running — expect zero rows with a null paid_date, and no
-- monthly row carrying a payable_date:
--   select pay_basis, count(*), count(payable_date) as with_payable,
--          count(paid_date) as with_paid
--     from salary_payments group by pay_basis;
