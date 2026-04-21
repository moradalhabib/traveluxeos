-- ============================================================
-- Migration D — Driver profile: add vehicle_year, retire vehicle_type usage
-- Apply BEFORE redeploy. Safe / additive (no DROP COLUMN).
-- Verify: should show "Success. No rows returned".
-- After running, the new driver edit form will store year in vehicle_year
-- and existing drivers whose vehicle_type was a 4-digit year (2020–2029)
-- will be migrated automatically.
-- ============================================================

-- 1. New dedicated column for vehicle year.
ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS vehicle_year INTEGER;

-- 2. Backfill: any driver whose old vehicle_type is a 4-digit year copies over.
UPDATE public.drivers
   SET vehicle_year = vehicle_type::INTEGER
 WHERE vehicle_year IS NULL
   AND vehicle_type ~ '^(19|20)\d{2}$';

-- 3. Make vehicle_type nullable so the form can stop writing to it.
ALTER TABLE public.drivers
  ALTER COLUMN vehicle_type DROP NOT NULL;

-- (Column intentionally NOT dropped — kept for historic reads. Safe to drop
--  later with: ALTER TABLE public.drivers DROP COLUMN vehicle_type;)

NOTIFY pgrst, 'reload schema';
