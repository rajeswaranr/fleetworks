-- PO purchase invoice: payment tracking + vendor bill reference + comments
-- Run in Supabase SQL Editor if `npx supabase db push` times out.

ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS vendor_bill_no TEXT,
  ADD COLUMN IF NOT EXISTS po_comments    TEXT,
  ADD COLUMN IF NOT EXISTS bill_path      TEXT;   -- storage path for vendor invoice image

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'purchase_orders_payment_status_check'
  ) THEN
    ALTER TABLE purchase_orders
      ADD CONSTRAINT purchase_orders_payment_status_check
      CHECK (payment_status IN ('pending', 'paid', 'partial'));
  END IF;
END $$;

COMMENT ON COLUMN purchase_orders.payment_status IS 'pending | paid | partial';
COMMENT ON COLUMN purchase_orders.vendor_bill_no  IS 'Invoice/bill number from vendor';
COMMENT ON COLUMN purchase_orders.po_comments     IS 'Internal notes at time of receipt';
COMMENT ON COLUMN purchase_orders.bill_path       IS 'Supabase Storage path for vendor invoice scan';
