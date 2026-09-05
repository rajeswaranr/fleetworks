-- ============ FleetWorks — freight invoices (sales side) ============
-- NAMED sales_invoices, NOT invoices. public.invoices already exists and means
-- something else entirely: FleetWorks invoicing a fleet owner for a marketplace
-- service booking, created only by a security-definer trigger, with insert and
-- delete revoked from authenticated. This table is the opposite direction — the
-- owner invoicing THEIR customers for freight. Two different documents, two
-- different payers; sharing a table would have quietly mixed the marketplace's
-- billing into an owner's sales ledger.
-- The other direction of the bill book. gstbills captures what the fleet PAYS
-- and the input credit it earns; this is what the fleet BILLS its customers for
-- moving their goods, which is where its revenue actually comes from and the
-- only part FleetFin has so far had to infer from trips.
--
-- STORED, NOT DERIVED. An invoice is a legal document that was issued on a
-- date, to a party, for an amount, under a tax treatment chosen at the time.
-- Recomputing it later from trips would quietly rewrite history the moment a
-- rate changed, so every figure that was printed is kept.
--
-- ROUND-HALF-UP AT THE LINE, IN PAISE. Money is numeric(14,2), never float, and
-- the tax split is computed and stored rather than recalculated for display —
-- two screens must never disagree about what a customer owes.

create table if not exists sales_invoices (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  invoice_no    text not null,
  invoice_date  date not null default current_date,

  -- Who is being billed. GSTIN is optional because plenty of consignors are
  -- unregistered; when it is absent, place_of_supply carries the state instead,
  -- since the CGST/SGST-versus-IGST split turns on it.
  customer_name text not null,
  customer_gstin text,
  customer_address text,
  place_of_supply text,                 -- two-digit GST state code

  -- What it was for. Optional: a fleet may bill a month of work rather than one
  -- trip, and forcing a link would push people to invent trips.
  vehicle_id    uuid references vehicles(id) on delete set null,
  trip_id       uuid references trips(id) on delete set null,
  -- The consignment note number. For a goods transport agency this is the
  -- document the whole service hangs on, and owners already write one.
  lr_no         text,

  -- Goods transport is commonly billed under reverse charge, where the
  -- RECIPIENT pays the GST and the invoice carries none. Getting this wrong in
  -- either direction is a real tax problem, so it is an explicit choice on the
  -- document and never inferred.
  tax_treatment text not null default 'rcm'
                check (tax_treatment in ('rcm','forward_5','forward_12','forward_18','exempt')),

  taxable_total numeric(14,2) not null default 0,
  cgst          numeric(14,2) not null default 0,
  sgst          numeric(14,2) not null default 0,
  igst          numeric(14,2) not null default 0,
  total         numeric(14,2) not null default 0,

  status        text not null default 'draft'
                check (status in ('draft','issued','paid','cancelled')),
  issued_at     timestamptz,
  paid_at       timestamptz,
  paid_amount   numeric(14,2),
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- An invoice number must be unique within the business that issued it. This
  -- is the constraint that stops two trucks' paperwork colliding.
  unique (org_id, invoice_no)
);
create index if not exists idx_sales_invoices_org_date on sales_invoices(org_id, invoice_date desc);
create index if not exists idx_sales_invoices_status on sales_invoices(org_id, status);

create table if not exists sales_invoice_lines (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  invoice_id    uuid not null references sales_invoices(id) on delete cascade,
  line_no       int,
  description   text not null,
  -- 9965xx is the services accounting code for goods transport. Kept per line
  -- because one invoice can carry freight plus detention or loading charges,
  -- which are not the same code.
  sac_code      text default '996511',
  qty           numeric default 1,
  rate          numeric(14,2),
  amount        numeric(14,2) not null,
  created_at    timestamptz not null default now()
);
create index if not exists idx_sales_invoice_lines on sales_invoice_lines(invoice_id, line_no);

alter table sales_invoices      enable row level security;
alter table sales_invoice_lines enable row level security;

drop policy if exists sales_invoices_member_all on sales_invoices;
create policy sales_invoices_member_all on sales_invoices for all to authenticated
  using (is_org_member(org_id)) with check (is_org_member(org_id));

drop policy if exists sales_invoice_lines_member_all on sales_invoice_lines;
create policy sales_invoice_lines_member_all on sales_invoice_lines for all to authenticated
  using (is_org_member(org_id)) with check (is_org_member(org_id));

grant select, insert, update, delete on sales_invoices to authenticated;
grant select, insert, update, delete on sales_invoice_lines to authenticated;

create or replace function set_invoice_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end; $$;

drop trigger if exists trg_invoice_updated on sales_invoices;
create trigger trg_invoice_updated before update on sales_invoices
  for each row execute function set_invoice_updated_at();

-- Verify after running:
--   select invoice_no, customer_name, tax_treatment, total, status from sales_invoices;
