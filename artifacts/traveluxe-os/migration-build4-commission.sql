-- ============================================================
-- Build 4 add-on — Supplier commission tracking
-- ============================================================
-- Run this once in the Supabase SQL editor (after migration-build4.sql).
-- Idempotent: safe to re-run.

-- 1. Commission rate on the supplier (e.g. 10.00 = 10%)
ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS commission_rate numeric(5, 2) DEFAULT 0;

COMMENT ON COLUMN public.suppliers.commission_rate IS
  'Default % commission for this supplier. Used to auto-calc supplier_commission on bookings.';

-- 2. Per-booking commission amount (auto-calculated, but overridable)
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS supplier_commission numeric(10, 2) DEFAULT 0;

COMMENT ON COLUMN public.bookings.supplier_commission IS
  'Commission paid to / earned from the supplier on this booking. Defaults to price * supplier.commission_rate / 100 when supplier_id is set.';

-- 3. Auto-calc supplier_commission when supplier_id or price changes.
--    commission = price * supplier.commission_rate / 100
CREATE OR REPLACE FUNCTION public.bookings_recalc_supplier_commission()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  rate numeric := 0;
BEGIN
  IF NEW.supplier_id IS NOT NULL THEN
    SELECT COALESCE(commission_rate, 0)
      INTO rate
      FROM public.suppliers
     WHERE id = NEW.supplier_id;
    NEW.supplier_commission := ROUND(COALESCE(NEW.price, 0) * rate / 100.0, 2);
  ELSE
    NEW.supplier_commission := 0;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS bookings_recalc_supplier_commission ON public.bookings;
CREATE TRIGGER bookings_recalc_supplier_commission
  BEFORE INSERT OR UPDATE OF supplier_id, price
  ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.bookings_recalc_supplier_commission();

-- 4. Backfill existing bookings (one-time)
UPDATE public.bookings b
   SET supplier_commission = ROUND(COALESCE(b.price, 0) * COALESCE(s.commission_rate, 0) / 100.0, 2)
  FROM public.suppliers s
 WHERE b.supplier_id = s.id;

-- 5. Verify
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name='suppliers' AND column_name='commission_rate';
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name='bookings'  AND column_name='supplier_commission';
