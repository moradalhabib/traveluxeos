-- ============================================================
-- Build 4 add-on — As Directed / Car Rental "supplier provides driver?" toggle
-- ============================================================
-- Run this once in the Supabase SQL editor (after the previous Build 4 migrations).
-- Idempotent: safe to re-run.

-- 1. Toggle: did the supplier provide the driver too?
--    false = TVL uses its own driver (driver_cost paid to our driver)
--    true  = supplier provides car + driver  (driver_cost paid to supplier)
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS as_directed_supplier_driver boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.bookings.as_directed_supplier_driver IS
  'When true, the supplier provided the driver too — driver_cost rolls into supplier_cost on the supplier KPI.';

-- 2. Replace the supplier_cost recalc trigger so it ONLY counts driver_cost
--    against the supplier when the supplier actually provided the driver.
CREATE OR REPLACE FUNCTION public.bookings_recalc_supplier_cost()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  extras_total numeric := 0;
BEGIN
  IF NEW.extra_charges IS NOT NULL THEN
    SELECT COALESCE(SUM((e->>'amount')::numeric), 0)
      INTO extras_total
      FROM jsonb_array_elements(NEW.extra_charges) AS e;
  END IF;

  NEW.supplier_cost := COALESCE(NEW.base_daily_rate, 0) * COALESCE(NEW.rental_days, 0)
                     + COALESCE(NEW.fuel_cost, 0)
                     + CASE
                         WHEN COALESCE(NEW.as_directed_supplier_driver, false)
                         THEN COALESCE(NEW.driver_cost, 0)
                         ELSE 0
                       END
                     + extras_total;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS bookings_recalc_supplier_cost ON public.bookings;
CREATE TRIGGER bookings_recalc_supplier_cost
  BEFORE INSERT OR UPDATE OF
    base_daily_rate, rental_days, fuel_cost, driver_cost, extra_charges,
    as_directed_supplier_driver
  ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.bookings_recalc_supplier_cost();

-- 3. Backfill: re-run the trigger logic on every row that has any cost data
--    so supplier_cost matches the new rule (driver_cost only counted when flagged).
UPDATE public.bookings
   SET base_daily_rate = base_daily_rate
 WHERE supplier_id IS NOT NULL
    OR base_daily_rate IS NOT NULL
    OR rental_days IS NOT NULL
    OR fuel_cost IS NOT NULL
    OR driver_cost IS NOT NULL
    OR (extra_charges IS NOT NULL AND jsonb_array_length(extra_charges) > 0)
    OR service_type IN ('Car Rental','As Directed');

-- 4. Verify
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name='bookings' AND column_name='as_directed_supplier_driver';
