-- Feature 5 — Supplier Balance Tracker
--
-- Adds supplier-payment tracking columns directly on bookings (one row per
-- booking, no separate ledger table). Each booking already has supplier_id
-- and supplier_cost — we add WHEN the supplier was paid out and an optional
-- payment reference (cheque #, transfer ref, "cash", etc.).
--
-- A booking is "outstanding" when:
--   supplier_id IS NOT NULL
--   AND supplier_cost > 0
--   AND supplier_paid_at IS NULL
--
-- Idempotent: safe to re-run.

BEGIN;

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS supplier_paid_at    timestamptz,
  ADD COLUMN IF NOT EXISTS supplier_payment_ref text;

CREATE INDEX IF NOT EXISTS bookings_supplier_balance_idx
  ON bookings (supplier_id, supplier_paid_at)
  WHERE supplier_id IS NOT NULL AND supplier_cost > 0;

COMMIT;
