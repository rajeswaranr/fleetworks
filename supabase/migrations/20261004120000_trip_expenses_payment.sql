-- Driver bill/expense claims → FleetFin payment workflow.
-- A claim is 'submitted' (pending), the owner 'approved's it (then it's to be paid), and once
-- paid it is 'paid'. Adds the paid state + payment fields; owners already have update rights.
alter table trip_expenses drop constraint if exists trip_expenses_status_check;
alter table trip_expenses add constraint trip_expenses_status_check
  check (status in ('submitted','approved','rejected','paid'));
alter table trip_expenses add column if not exists paid_at     timestamptz;
alter table trip_expenses add column if not exists paid_amount numeric;
alter table trip_expenses add column if not exists payment_ref text;
