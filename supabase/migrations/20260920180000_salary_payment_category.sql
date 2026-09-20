-- Payment type on payroll entries: what a payment to a driver was for.
--   salary, advance, trip_advance, salary_advance, last_month_salary,
--   pending_payment, miscellaneous
-- Existing rows are salary, which is what every row was until now.
-- Safe to re-run.

alter table salary_payments add column if not exists category text not null default 'salary';

alter table salary_payments drop constraint if exists salary_payments_category_check;
alter table salary_payments add constraint salary_payments_category_check
  check (category in ('salary', 'advance', 'trip_advance', 'salary_advance',
                      'last_month_salary', 'pending_payment', 'miscellaneous'));
