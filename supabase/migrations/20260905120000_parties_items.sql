-- ============ FleetWorks — parties and items (the myBillBook shape) ============
-- Invoicing needs two masters behind it, or every invoice is retyped: who you
-- bill, and what you bill them for. This is that pair, modelled on how Indian
-- billing software already works so it matches what owners expect.
--
-- ONE TABLE FOR BOTH SIDES, FLAGGED. A workshop you buy from can also be a
-- party you bill, and the same GSTIN must not exist twice with two balances.
-- So parties carry is_customer / is_supplier rather than living in separate
-- tables — the same choice myBillBook and Tally make, for the same reason.
--
-- THIS DOES NOT REPLACE THE VENDOR STRINGS ON PARTS AND WORK ORDERS. Those keep
-- working; renderVendors still derives its list from them. Migrating that is a
-- separate job, and breaking the parts ledger to introduce a master would be a
-- bad trade.

create table if not exists parties (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  name          text not null,

  -- Which direction this party trades in. Both is normal and allowed.
  is_customer   boolean not null default true,
  is_supplier   boolean not null default false,

  gstin         text,
  -- Two-digit GST state code. Derived from the GSTIN when there is one, and
  -- asked for when there is not, because the CGST/SGST-versus-IGST split on
  -- every invoice turns on it and an unregistered consignor still has a state.
  state_code    text,
  billing_address text,
  shipping_address text,
  phone         text,
  email         text,

  -- Party-wise credit control, the way an owner actually runs the relationship.
  credit_limit  numeric(14,2),
  credit_days   int,
  -- What they owed when they were entered, so the ledger does not pretend the
  -- relationship started today.
  opening_balance numeric(14,2) not null default 0,

  -- Most parties are billed the same way every time; the invoice form offers
  -- this and stays overridable.
  default_tax_treatment text
                check (default_tax_treatment in ('rcm','forward_5','forward_12','forward_18','exempt')),
  notes         text,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- A GSTIN identifies one business; two rows for it in one org is a duplicate,
  -- not a second customer. Partial, so unregistered parties are unconstrained.
  constraint parties_gstin_once unique nulls not distinct (org_id, gstin)
);
create index if not exists idx_parties_org on parties(org_id, name);

-- What gets billed. For a transport operator these are mostly services —
-- freight, detention, loading — but a fleet that sells parts or does workshop
-- work bills goods too, so both are allowed.
create table if not exists items (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  name          text not null,
  kind          text not null default 'service' check (kind in ('service','goods')),
  -- SAC for services, HSN for goods. One column: they occupy the same field on
  -- an invoice and are never both present for one line.
  hsn_sac       text,
  unit          text default 'Nos',            -- Nos, Trip, MT, KM, Hour
  rate          numeric(14,2),
  gst_rate      numeric(5,2) default 0,        -- 0, 5, 12, 18, 28
  description   text,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  unique (org_id, name)
);
create index if not exists idx_items_org on items(org_id, name);

-- Invoices can now point at the master rather than only carrying loose text.
-- Nullable and ON DELETE SET NULL on purpose: an invoice already issued must
-- survive the customer record being tidied up, and it keeps its own copy of the
-- name, GSTIN and amounts regardless.
alter table invoices     add column if not exists party_id uuid references parties(id) on delete set null;
alter table invoice_lines add column if not exists item_id uuid references items(id) on delete set null;
create index if not exists idx_invoices_party on invoices(party_id);

alter table parties enable row level security;
alter table items   enable row level security;

drop policy if exists parties_member_all on parties;
create policy parties_member_all on parties for all to authenticated
  using (is_org_member(org_id)) with check (is_org_member(org_id));

drop policy if exists items_member_all on items;
create policy items_member_all on items for all to authenticated
  using (is_org_member(org_id)) with check (is_org_member(org_id));

grant select, insert, update, delete on parties to authenticated;
grant select, insert, update, delete on items to authenticated;

drop trigger if exists trg_parties_updated on parties;
create trigger trg_parties_updated before update on parties
  for each row execute function set_invoice_updated_at();

-- Verify after running:
--   select name, gstin, state_code, is_customer, is_supplier from parties;
--   select name, kind, hsn_sac, unit, rate, gst_rate from items;
