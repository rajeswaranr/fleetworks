-- Purchase Orders & Purchase Order Lines
-- A PO captures spare-part procurement against a vehicle (and optionally a
-- work order). When a PO is marked "received" the app creates a matching
-- expense row automatically so it shows up in both the vehicle expense ledger
-- and the accounts view. Line items are stored in purchase_order_lines; the
-- same data is also written to expenses.items (jsonb) when the expense is
-- created, so the existing billing/analytics views see the full breakdown.

-- ── purchase_orders ────────────────────────────────────────────────────────
create table if not exists purchase_orders (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references organizations(id) on delete cascade,
  vehicle_id       uuid references vehicles(id) on delete set null,
  work_order_id    uuid references work_orders(id) on delete set null,

  -- human-readable reference, auto-generated in the trigger below
  po_number        text not null,

  vendor_name      text not null,
  vendor_gstin     text,          -- buyer's vendor GSTIN (15-char, optional)
  vendor_contact   text,

  order_date       date not null default current_date,
  expected_delivery date,
  received_date    date,

  -- draft → approved → ordered → partial → received → cancelled
  status           text not null default 'draft'
                   check (status in ('draft','approved','ordered','partial','received','cancelled')),

  notes            text,

  -- totals stored for quick display; recomputed from lines on each save
  subtotal         numeric(12,2) not null default 0,
  total_gst        numeric(12,2) not null default 0,
  total_amount     numeric(12,2) not null default 0,   -- subtotal + total_gst

  -- FK to the expense created when received
  expense_id       uuid references expenses(id) on delete set null,

  created_by       uuid references auth.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- auto-generate po_number like "PO-2026-0001" per org
create sequence if not exists purchase_order_seq;

create or replace function fn_set_po_number()
returns trigger language plpgsql as $$
begin
  if new.po_number is null or new.po_number = '' then
    new.po_number := 'PO-' || to_char(now(), 'YYYY') || '-' ||
                     lpad(nextval('purchase_order_seq')::text, 4, '0');
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_po_number on purchase_orders;
create trigger trg_po_number
  before insert or update on purchase_orders
  for each row execute function fn_set_po_number();

-- ── purchase_order_lines ───────────────────────────────────────────────────
create table if not exists purchase_order_lines (
  id           uuid primary key default gen_random_uuid(),
  po_id        uuid not null references purchase_orders(id) on delete cascade,
  org_id       uuid not null references organizations(id) on delete cascade,

  part_name    text not null,
  part_number  text,          -- OEM / aftermarket part number
  serial_number text,         -- serial / batch number of the actual unit(s)
  make         text,          -- brand / manufacturer, e.g. "Bosch", "MRF"

  quantity     numeric(10,3) not null default 1 check (quantity > 0),
  unit         text not null default 'pcs',   -- pcs, set, litre, kg, metre …

  unit_price   numeric(12,2) not null default 0 check (unit_price >= 0),
  gst_rate     numeric(5,2) not null default 18 check (gst_rate >= 0 and gst_rate <= 100),

  -- derived; stored for display convenience; app recomputes on save
  gst_amount   numeric(12,2) generated always as
               (round(quantity * unit_price * gst_rate / 100, 2)) stored,
  line_total   numeric(12,2) generated always as
               (round(quantity * unit_price * (1 + gst_rate / 100), 2)) stored,

  created_at   timestamptz not null default now()
);

-- ── indexes ────────────────────────────────────────────────────────────────
create index if not exists idx_purchase_orders_org     on purchase_orders(org_id);
create index if not exists idx_purchase_orders_vehicle on purchase_orders(vehicle_id);
create index if not exists idx_po_lines_po             on purchase_order_lines(po_id);
create index if not exists idx_po_lines_org            on purchase_order_lines(org_id);

-- ── RLS ───────────────────────────────────────────────────────────────────
alter table purchase_orders      enable row level security;
alter table purchase_order_lines enable row level security;

-- owners and managers have full access; supervisors/drivers: no access
-- (POs are finance/procurement — team-portal users don't see them)
create policy po_org_admin on purchase_orders
  for all using (is_org_admin(org_id));

create policy pol_org_admin on purchase_order_lines
  for all using (is_org_admin(org_id));
