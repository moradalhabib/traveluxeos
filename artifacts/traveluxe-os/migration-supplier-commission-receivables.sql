-- migration-supplier-commission-receivables.sql
--
-- Adds the "Suppliers owe TVL" side of the commissions ledger.
--
-- Background
--   Each booking can carry a third-party supplier (e.g. "LHR VIP Services")
--   plus a `supplier_commission` (the markup TVL charges the client on top
--   of the supplier's cost). That commission is money the supplier owes
--   TVL once the job is done. Until now we tracked the OTHER direction
--   only — what TVL owes the supplier (via `supplier_paid_at`).
--
--   These two columns close the loop:
--     - supplier_commission_collected_at   when TVL received the markup
--     - supplier_commission_payment_ref    bank ref / note for the receipt
--
--   A booking with `supplier_id IS NOT NULL`, `supplier_commission > 0`,
--   `status != 'Cancelled'`, and `supplier_commission_collected_at IS NULL`
--   counts as Outstanding (supplier owes TVL). Once collected_at is
--   stamped, it moves to the Collected ledger.
--
-- Idempotent (`ADD COLUMN IF NOT EXISTS`). Safe to re-run. No data loss.
-- Run in the Supabase SQL editor against the Production project.

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS supplier_commission_collected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS supplier_commission_payment_ref  TEXT;

-- Partial index speeds up the "outstanding" list (bookings where the
-- supplier still owes us commission). Keep it narrow — only rows that
-- actually have a supplier_commission tagged.
CREATE INDEX IF NOT EXISTS bookings_supplier_commission_outstanding_idx
  ON public.bookings (supplier_id, date_time DESC)
  WHERE supplier_commission_collected_at IS NULL
    AND supplier_id IS NOT NULL;

-- Verification
SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND table_name   = 'bookings'
   AND column_name IN ('supplier_commission_collected_at',
                       'supplier_commission_payment_ref')
 ORDER BY column_name;
