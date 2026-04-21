-- migration-booking-payment-tracking.sql
--
-- Adds payment-tracking columns to `bookings` so an operator can record:
--   * exact date payment was received (`payment_date`)
--   * partial-payment amounts (`paid_amount`)
--   * free-text notes about the payment (`payment_notes`)
--
-- This unlocks: outstanding-balance display, partial-payment receipts,
-- and accurate "commission to collect" filtering on the dashboard
-- (only counts paid / partially paid bookings).
--
-- Run BEFORE deploying the new code. Apply manually in Supabase → SQL editor.
--
-- Verify after: the three new columns appear on the bookings table, and
-- recording a partial payment from the booking detail page succeeds.

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS payment_date  DATE,
  ADD COLUMN IF NOT EXISTS paid_amount   NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS payment_notes TEXT;

NOTIFY pgrst, 'reload schema';
