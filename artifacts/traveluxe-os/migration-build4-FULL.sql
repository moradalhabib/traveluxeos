-- ============================================================================
-- Traveluxe OS — Build 4 FULL migration
-- ============================================================================
-- Run this entire file ONCE in the Supabase SQL editor.
-- Idempotent: safe to re-run if anything fails partway through.
--
-- Adds, in order:
--   1. suppliers table + RLS + updated_at trigger
--   2. bookings.supplier_id, bookings.supplier_cost
--   3. Car-rental cost breakdown columns (base_daily_rate, rental_days,
--      fuel_cost, driver_cost, extra_charges JSONB)
--   4. client_notified_at / driver_notified_at columns (for the
--      notification badges on job cards)
--   5. as_directed_supplier_driver toggle + supplier_cost recalc trigger
--      (driver_cost only rolls into supplier_cost when supplier
--      provided the driver too)
--   6. supplier commission_rate + bookings.supplier_commission +
--      auto-calc trigger
--   7. supplier_products catalogue (cars/drivers/other) +
--      bookings.supplier_product_id link
-- ============================================================================


-- ─── 1. Supplier Directory ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.suppliers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  category      text NOT NULL DEFAULT 'Other',
  contact_name  text,
  whatsapp      text,
  phone         text,
  email         text,
  address       text,
  city          text,
  country       text,
  website       text,
  notes         text,
  rating        numeric(2, 1),
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_suppliers_active   ON public.suppliers (is_active);
CREATE INDEX IF NOT EXISTS idx_suppliers_name     ON public.suppliers (name);
CREATE INDEX IF NOT EXISTS idx_suppliers_category ON public.suppliers (category);

ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "suppliers_read"  ON public.suppliers;
DROP POLICY IF EXISTS "suppliers_write" ON public.suppliers;

CREATE POLICY "suppliers_read"  ON public.suppliers
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "suppliers_write" ON public.suppliers
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.suppliers_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS suppliers_updated_at ON public.suppliers;
CREATE TRIGGER suppliers_updated_at
  BEFORE UPDATE ON public.suppliers
  FOR EACH ROW EXECUTE FUNCTION public.suppliers_set_updated_at();


-- ─── 2. Link bookings to suppliers ────────────────────────────────────────
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS supplier_id   uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS supplier_cost numeric(10, 2);

CREATE INDEX IF NOT EXISTS idx_bookings_supplier ON public.bookings (supplier_id);


-- ─── 3. Car Rental cost breakdown ─────────────────────────────────────────
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS base_daily_rate numeric(10, 2),
  ADD COLUMN IF NOT EXISTS rental_days     integer,
  ADD COLUMN IF NOT EXISTS fuel_cost       numeric(10, 2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS driver_cost     numeric(10, 2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS extra_charges   jsonb DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.bookings.extra_charges IS
  'JSON array of {description, amount} line items. Editable post-completion.';


-- ─── 4. Notified tracking (client/driver notified badges) ─────────────────
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS client_notified_at timestamptz,
  ADD COLUMN IF NOT EXISTS driver_notified_at timestamptz;


-- ─── 5. As-Directed: did supplier provide the driver too? ─────────────────
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS as_directed_supplier_driver boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.bookings.as_directed_supplier_driver IS
  'When true, supplier provided the driver too — driver_cost rolls into supplier_cost.';

-- supplier_cost recalc trigger (driver_cost only counted when flagged)
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

-- Backfill existing rows so supplier_cost matches the new rule
UPDATE public.bookings
   SET base_daily_rate = base_daily_rate
 WHERE supplier_id IS NOT NULL
    OR base_daily_rate IS NOT NULL
    OR rental_days IS NOT NULL
    OR fuel_cost IS NOT NULL
    OR driver_cost IS NOT NULL
    OR (extra_charges IS NOT NULL AND jsonb_array_length(extra_charges) > 0)
    OR service_type IN ('Car Rental','As Directed');


-- ─── 6. Supplier commission tracking ──────────────────────────────────────
ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS commission_rate numeric(5, 2) DEFAULT 0;

COMMENT ON COLUMN public.suppliers.commission_rate IS
  'Default % commission for this supplier. Used to auto-calc supplier_commission on bookings.';

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS supplier_commission numeric(10, 2) DEFAULT 0;

COMMENT ON COLUMN public.bookings.supplier_commission IS
  'Commission paid to / earned from supplier. Defaults to price * supplier.commission_rate / 100.';

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

-- Backfill existing bookings (one-time)
UPDATE public.bookings b
   SET supplier_commission = ROUND(COALESCE(b.price, 0) * COALESCE(s.commission_rate, 0) / 100.0, 2)
  FROM public.suppliers s
 WHERE b.supplier_id = s.id;


-- ─── 7. Supplier products catalogue ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.supplier_products (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id  uuid NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
  name         text NOT NULL,
  kind         text NOT NULL DEFAULT 'Car'
                 CHECK (kind IN ('Car','Driver','Other')),
  daily_rate   numeric(10,2),
  hourly_rate  numeric(10,2),
  plate        text,
  notes        text,
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_supplier_products_supplier
  ON public.supplier_products(supplier_id);
CREATE INDEX IF NOT EXISTS idx_supplier_products_active
  ON public.supplier_products(is_active) WHERE is_active = true;

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS supplier_product_id uuid
    REFERENCES public.supplier_products(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_bookings_supplier_product
  ON public.bookings(supplier_product_id);

ALTER TABLE public.supplier_products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS supplier_products_all ON public.supplier_products;
CREATE POLICY supplier_products_all ON public.supplier_products
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);


-- ─── Done ─────────────────────────────────────────────────────────────────
DO $$ BEGIN
  RAISE NOTICE 'Build 4 migration complete ✓';
END $$;

-- Verify with:
--   SELECT count(*) FROM suppliers;
--   SELECT count(*) FROM supplier_products;
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name='bookings'
--      AND column_name IN (
--        'supplier_id','supplier_cost','base_daily_rate','rental_days',
--        'fuel_cost','driver_cost','extra_charges',
--        'client_notified_at','driver_notified_at',
--        'as_directed_supplier_driver','supplier_commission','supplier_product_id'
--      );
