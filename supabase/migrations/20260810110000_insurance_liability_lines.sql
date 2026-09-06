-- ============ FleetWorks — carrier & public liability on quote requests ============
-- The quote form originally covered motor only. A transport business needs
-- three lines, and they are rated on completely different things:
--   Motor                     — the vehicle: class, age, GVW, IDV, NCB
--   Carrier's Legal Liability — the VALUE OF GOODS moved in a year, not the truck
--   Public Liability          — the indemnity limit wanted per event
-- Asking for goods value and liability limit up front is what lets a broker
-- return a real number instead of ringing back for the two figures that
-- actually price these covers.
--
-- All three columns are nullable and no existing row changes meaning: requests
-- captured before this migration were motor-only, which is what a null `lines`
-- now reads as.

alter table insurance_quotes add column if not exists lines              text[];
alter table insurance_quotes add column if not exists annual_goods_value numeric;
alter table insurance_quotes add column if not exists liability_limit    numeric;

comment on column insurance_quotes.lines is
  'Cover lines requested: Motor (HCV), Carrier''s Legal Liability, Public Liability. Null on pre-2026-08-10 rows, which were motor-only.';

-- Verify after running:
--   select column_name, data_type from information_schema.columns
--   where table_name = 'insurance_quotes'
--     and column_name in ('lines','annual_goods_value','liability_limit');
