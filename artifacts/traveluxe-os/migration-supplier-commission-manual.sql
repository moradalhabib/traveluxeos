-- ============================================================
-- Make supplier_commission respect manual operator input.
-- Previously the trigger always overwrote it with price * rate.
-- Now: only auto-calc on INSERT when caller did not supply a value
-- (i.e. value equals the column default of 0 AND no manual marker).
-- For Airport Transfer / variable-markup workflows the operator
-- types the commission directly; we must not clobber it.
-- ============================================================

CREATE OR REPLACE FUNCTION public.bookings_recalc_supplier_commission()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  rate numeric := 0;
BEGIN
  -- On UPDATE: if the caller explicitly changed supplier_commission,
  -- keep their value untouched.
  IF TG_OP = 'UPDATE'
     AND NEW.supplier_commission IS DISTINCT FROM OLD.supplier_commission THEN
    RETURN NEW;
  END IF;

  -- On INSERT: if the caller provided a non-zero value, keep it.
  IF TG_OP = 'INSERT'
     AND NEW.supplier_commission IS NOT NULL
     AND NEW.supplier_commission <> 0 THEN
    RETURN NEW;
  END IF;

  -- Otherwise auto-calc from supplier rate.
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
