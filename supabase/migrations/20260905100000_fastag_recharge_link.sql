-- ============ FleetWorks — FASTag recharge link ============
-- A place for the owner to keep the page or app they actually recharge this
-- tag from, saved once per tag instead of hunted for every time.
--
-- WHY THIS AND NOT A BUILT-IN LIST OF BANK URLS. There are roughly 39 NETC
-- issuers and their recharge pages move. A shipped list would be wrong for
-- somebody on the day it shipped, and a link that silently goes stale is worse
-- than no link — it sends an owner with a truck at a plaza to a 404. The owner
-- pastes the one they use; it is right by construction and stays right.
--
-- THIS IS NOT PAYMENT. FleetWorks does not move money here and holds no
-- customer funds. Paying a FASTag bill from inside the app means joining BBPS
-- as an Agent Institution under a BBPOU, which is a commercial and regulatory
-- arrangement, not a schema change. Until that exists the honest flow is:
-- recharge where you already do, then log it — which already books the expense
-- and moves the balance in one step.

alter table fastag_accounts add column if not exists recharge_url text;

comment on column fastag_accounts.recharge_url is
  'Owner-supplied link to where they recharge this tag (issuer page or app deep link). Never a payment endpoint — FleetWorks does not process the recharge.';

-- The suggested recharge amount is computed in the client from db.expenses,
-- which is already loaded. A database function would have been schema with no
-- reader — the exact failure this table's own feature was just fixed for.

-- Verify after running:
--   select vehicle_id, tag_id, recharge_url from fastag_accounts;
