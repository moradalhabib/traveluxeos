-- ============================================================
-- migration-fix-driver-receives.sql
--
-- Problem: driver_receives was a GENERATED ALWAYS AS column:
--   price + additional_charges - tvl_commission
-- This ignored supplier_cost entirely, so any booking with a
-- supplier showed an inflated driver payout (e.g. £480 instead
-- of £180 when £180 supplier_cost was also on the booking).
--
-- Fix:
--   1. Drop the generated column.
--   2. Re-add as a regular NUMERIC column.
--   3. Attach a BEFORE INSERT/UPDATE trigger that:
--        a. Uses driver_cost (the operator's manually-entered
--           driver rate) when it is set and > 0.
--        b. Falls back to the original formula for simple
--           bookings with no explicit driver rate.
--   4. Back-fill all existing rows with the correct value.
-- ============================================================

-- 1. Drop the generated column
ALTER TABLE public.bookings DROP COLUMN IF EXISTS driver_receives;

-- 2. Re-add as a plain numeric column
ALTER TABLE public.bookings
  ADD COLUMN driver_receives NUMERIC(10, 2);

-- 3. Trigger function
CREATE OR REPLACE FUNCTION public.bookings_recalc_driver_receives()
RETURNS TRIGGER AS $$
BEGIN
  -- When an explicit driver rate has been entered by the operator,
  -- honour it — this is what TVL actually agrees to pay the driver
  -- regardless of the booking price or supplier arrangements.
  IF COALESCE(NEW.driver_cost, 0) > 0 THEN
    NEW.driver_receives := NEW.driver_cost;
  ELSE
    -- Original behaviour for simple transport bookings that have
    -- no supplier: driver gets everything except TVL commission.
    NEW.driver_receives :=
        COALESCE(NEW.price, 0)
      + COALESCE(NEW.additional_charges, 0)
      - COALESCE(NEW.tvl_commission, 0);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 4. Attach trigger
DROP TRIGGER IF EXISTS bookings_recalc_driver_receives ON public.bookings;
CREATE TRIGGER bookings_recalc_driver_receives
  BEFORE INSERT OR UPDATE OF price, tvl_commission, driver_cost, additional_charges
  ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.bookings_recalc_driver_receives();

-- 5. Back-fill existing rows
UPDATE public.bookings
SET driver_receives =
  CASE
    WHEN COALESCE(driver_cost, 0) > 0 THEN driver_cost
    ELSE COALESCE(price, 0) + COALESCE(additional_charges, 0) - COALESCE(tvl_commission, 0)
  END;
