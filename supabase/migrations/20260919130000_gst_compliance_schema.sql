-- GST Compliance Schema for FleetWorks
-- E-way bills, tax invoicing, and GST settlement

CREATE TABLE IF NOT EXISTS gst_configuration (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) UNIQUE,

  -- Organization GST Details
  gstin TEXT NOT NULL, -- 15-character GSTIN
  org_name TEXT NOT NULL,

  -- Tax Slab Configuration
  tax_slab_pct DECIMAL(5, 2) DEFAULT 5.0, -- 5%, 12%, 18%, or 28%

  -- SBIN Integration (for e-way bills)
  sbin_username TEXT,
  sbin_password_encrypted TEXT,
  sbin_api_key TEXT,

  -- Invoice Generation
  invoice_prefix TEXT DEFAULT 'FW', -- FW-001, FW-002, etc.
  invoice_series_start INTEGER DEFAULT 1,
  invoice_current_number INTEGER DEFAULT 1,

  -- Settings
  auto_generate_invoices BOOLEAN DEFAULT true,
  auto_generate_ewaybills BOOLEAN DEFAULT true,
  invoice_format TEXT DEFAULT 'pdf', -- pdf, email, both

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS gst_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),

  -- Invoice Details
  invoice_number TEXT NOT NULL UNIQUE,
  invoice_date DATE NOT NULL,
  invoice_period TEXT, -- "Sep-2026"

  -- Trip/Consignment
  trip_id UUID REFERENCES fuel_trips(id),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id),
  driver_id UUID REFERENCES drivers(id),

  -- Parties
  consignor_name TEXT NOT NULL,
  consignor_gstin TEXT NOT NULL,
  consignee_name TEXT NOT NULL,
  consignee_gstin TEXT NOT NULL,

  -- Commodities & Amount
  commodity_description TEXT NOT NULL,
  quantity_units INTEGER,
  unit_type TEXT, -- 'kg', 'liters', 'units', 'trips'
  unit_price DECIMAL(12, 2),

  -- Amount Breakdown
  taxable_amount DECIMAL(12, 2) NOT NULL,
  sgst_pct DECIMAL(5, 2) DEFAULT 2.5, -- Half of IGST
  cgst_pct DECIMAL(5, 2) DEFAULT 2.5,
  sgst_amount DECIMAL(12, 2),
  cgst_amount DECIMAL(12, 2),
  igst_pct DECIMAL(5, 2),
  igst_amount DECIMAL(12, 2),
  cess_pct DECIMAL(5, 2) DEFAULT 0,
  cess_amount DECIMAL(12, 2),

  total_gst_amount DECIMAL(12, 2),
  invoice_total DECIMAL(12, 2),

  -- E-way Bill Integration
  eway_bill_number TEXT,
  eway_bill_generated_at TIMESTAMPTZ,
  eway_bill_valid_till TIMESTAMPTZ,

  -- Payment & Settlement
  payment_status TEXT DEFAULT 'unpaid', -- unpaid, partial, paid
  paid_amount DECIMAL(12, 2) DEFAULT 0,
  payment_date TIMESTAMPTZ,
  payment_reference TEXT,

  -- GST Settlement
  is_settled BOOLEAN DEFAULT false,
  settled_in_month TEXT, -- "Sep-2026"

  -- Compliance
  irn TEXT, -- Invoice Reference Number (for e-invoicing)
  qr_code_url TEXT,

  status TEXT DEFAULT 'draft', -- draft, issued, cancelled
  cancellation_reason TEXT,
  cancelled_at TIMESTAMPTZ,

  notes TEXT,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS eway_bills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  gst_invoice_id UUID NOT NULL REFERENCES gst_invoices(id),

  -- E-way Bill Details (SBIN)
  eway_bill_number TEXT UNIQUE NOT NULL,
  eway_bill_date DATE NOT NULL,
  valid_till TIMESTAMPTZ NOT NULL,

  -- Transport Details
  vehicle_number TEXT NOT NULL,
  vehicle_type TEXT, -- 'truck', 'auto', etc.
  transporter_id TEXT,
  transporter_name TEXT,

  -- Route
  origin_state TEXT,
  destination_state TEXT,
  distance_km DECIMAL(10, 2),

  -- Status
  status TEXT DEFAULT 'generated', -- generated, in_transit, cancelled, expired
  generated_by_id UUID REFERENCES auth.users(id),
  generated_at TIMESTAMPTZ DEFAULT now(),

  -- Rejection Tracking
  rejection_reason TEXT,
  rejected_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS gst_settlement_summary (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),

  -- Settlement Period
  settlement_month TEXT NOT NULL, -- "Sep-2026"
  settlement_year INTEGER NOT NULL,

  -- Tax Summary
  total_invoices INTEGER,
  total_taxable_amount DECIMAL(15, 2),
  total_sgst DECIMAL(15, 2),
  total_cgst DECIMAL(15, 2),
  total_igst DECIMAL(15, 2),
  total_cess DECIMAL(15, 2),
  total_gst_collected DECIMAL(15, 2),

  -- ITC (Input Tax Credit)
  total_itc DECIMAL(15, 2),

  -- Settlement
  gst_payable DECIMAL(15, 2),
  gst_paid_amount DECIMAL(15, 2) DEFAULT 0,
  payment_reference TEXT,
  payment_date TIMESTAMPTZ,

  -- GSTR Filing
  gstr_1_filed BOOLEAN DEFAULT false,
  gstr_1_filed_date TIMESTAMPTZ,

  notes TEXT,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE(org_id, settlement_month, settlement_year)
);

CREATE TABLE IF NOT EXISTS gst_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),

  action TEXT NOT NULL, -- 'invoice_created', 'eway_bill_generated', 'payment_marked', 'settled'
  entity_type TEXT, -- 'gst_invoice', 'eway_bill'
  entity_id TEXT,

  performed_by_id UUID REFERENCES auth.users(id),

  details JSONB,

  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX idx_gst_invoices_org_date ON gst_invoices(org_id, invoice_date DESC);
CREATE INDEX idx_gst_invoices_status ON gst_invoices(status) WHERE status != 'cancelled';
CREATE INDEX idx_eway_bills_org_valid ON eway_bills(org_id, valid_till DESC);
CREATE INDEX idx_gst_settlement_month ON gst_settlement_summary(org_id, settlement_month DESC);
CREATE INDEX idx_gst_audit_logs_org ON gst_audit_logs(org_id, created_at DESC);

-- Row-Level Security
ALTER TABLE gst_configuration ENABLE ROW LEVEL SECURITY;
ALTER TABLE gst_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE eway_bills ENABLE ROW LEVEL SECURITY;
ALTER TABLE gst_settlement_summary ENABLE ROW LEVEL SECURITY;
ALTER TABLE gst_audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY gst_config_org_isolation ON gst_configuration
  FOR ALL USING (is_org_admin(org_id));

CREATE POLICY gst_invoices_org_isolation ON gst_invoices
  FOR ALL USING (is_org_admin(org_id));

CREATE POLICY eway_bills_org_isolation ON eway_bills
  FOR ALL USING (is_org_admin(org_id));

CREATE POLICY gst_settlement_org_isolation ON gst_settlement_summary
  FOR ALL USING (is_org_admin(org_id));

CREATE POLICY gst_audit_org_isolation ON gst_audit_logs
  FOR ALL USING (is_org_admin(org_id));

-- Helper function: Generate E-way Bill Number (SBIN Format)
CREATE OR REPLACE FUNCTION generate_eway_bill_number(p_org_id UUID)
RETURNS TEXT AS $$
DECLARE
  v_timestamp TEXT;
  v_sequence TEXT;
BEGIN
  v_timestamp := TO_CHAR(NOW(), 'YYYYMMDDHH24MISS');
  v_sequence := LPAD((EXTRACT(EPOCH FROM NOW() * 1000000)::BIGINT % 1000000)::TEXT, 6, '0');
  RETURN v_timestamp || v_sequence;
END;
$$ LANGUAGE plpgsql;

-- Helper function: Calculate GST Amount
CREATE OR REPLACE FUNCTION calculate_gst(
  p_taxable_amount DECIMAL,
  p_sgst_pct DECIMAL,
  p_cgst_pct DECIMAL,
  p_igst_pct DECIMAL
)
RETURNS TABLE (
  sgst DECIMAL,
  cgst DECIMAL,
  igst DECIMAL,
  total_gst DECIMAL
) AS $$
BEGIN
  RETURN QUERY SELECT
    ROUND((p_taxable_amount * p_sgst_pct) / 100, 2),
    ROUND((p_taxable_amount * p_cgst_pct) / 100, 2),
    ROUND((p_taxable_amount * p_igst_pct) / 100, 2),
    ROUND((p_taxable_amount * (p_sgst_pct + p_cgst_pct + p_igst_pct)) / 100, 2);
END;
$$ LANGUAGE plpgsql;
