-- ============ FleetWorks — monthly vs daily-wage drivers ============
-- Payroll assumed every driver is on a monthly salary: salary_payments.period
-- held a month like "2026-07" and the entry form offered only a month picker.
-- A large share of Indian commercial-vehicle drivers are paid by the day or by
-- the trip, and recording a daily wage against a whole month is simply wrong —
-- it loses which day was paid and makes several payments in one month
-- indistinguishable from each other.
--
-- Each driver now carries how they are paid, set when the driver is configured.
-- Monthly drivers keep the month picker; daily drivers get a date picker
-- defaulting to today, and period holds a full date like "2026-08-02".
--
-- `period` stays text rather than becoming a date column: it now legitimately
-- holds two shapes, and the driver's pay_basis is what says which to expect.
-- Splitting it into two nullable columns would push that same branch into every
-- read anyway, with the added risk of both being set at once.
--
-- Existing drivers default to monthly, which is what the app has been assuming
-- all along, so no historical row changes meaning.

alter table drivers add column if not exists pay_basis text not null default 'monthly'
  check (pay_basis in ('monthly', 'daily'));

-- Verify after running:
--   select ext_id, name, pay_basis from drivers limit 10;
