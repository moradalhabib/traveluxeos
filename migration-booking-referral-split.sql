-- Feature 4 — Commission Split (referral partner) on bookings
--
-- Adds three optional columns so the operator can record a referral partner
-- per booking. tvl_net_after_referral is computed in the UI on the fly from
-- price - supplier_cost - driver_cost - fuel_cost - referral_cut, so we don't
-- store a derived column that could drift.
--
-- Type discipline:
--   referral_partner_name      free text (NULL = no referral)
--   referral_commission_type   'percent' | 'amount' (CHECK)
--   referral_commission_value  numeric (percent OR £, depending on type)
--
-- Does NOT change the existing TVL Margin calculation — this is informational
-- only, surfaced as a sub-line under the Margin row.
--
-- Idempotent: safe to re-run.

BEGIN;

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS referral_partner_name      text,
  ADD COLUMN IF NOT EXISTS referral_commission_type   text,
  ADD COLUMN IF NOT EXISTS referral_commission_value  numeric;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE table_name = 'bookings' AND constraint_name = 'bookings_referral_commission_type_check'
  ) THEN
    ALTER TABLE bookings
      ADD CONSTRAINT bookings_referral_commission_type_check
      CHECK (referral_commission_type IS NULL OR referral_commission_type IN ('percent','amount'));
  END IF;
END $$;

COMMIT;
