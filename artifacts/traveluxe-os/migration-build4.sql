-- ============================================================
-- Build 4 — Suppliers + Car Rental Cost Breakdown + Notified Tracking
-- ============================================================
-- Run this entire file once in the Supabase SQL editor.
-- Idempotent: safe to re-run.

-- ─── 1. Supplier Directory ──────────────────────────────────────────────────
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

-- updated_at auto-bump
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

-- ─── 2. Link bookings to suppliers ──────────────────────────────────────────
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_bookings_supplier ON public.bookings (supplier_id);

-- Convenience column the supplier-detail KPIs read from. We populate it from
-- the car-rental cost breakdown via a trigger so the supplier page can show
-- "total supplier cost" without recomputing from JSONB on every request.
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS supplier_cost numeric(10, 2);

-- ─── 3. Car Rental cost breakdown ───────────────────────────────────────────
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS base_daily_rate numeric(10, 2),
  ADD COLUMN IF NOT EXISTS rental_days     integer,
  ADD COLUMN IF NOT EXISTS fuel_cost       numeric(10, 2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS driver_cost     numeric(10, 2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS extra_charges   jsonb DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.bookings.extra_charges IS
  'JSON array of {description, amount} line items. Editable post-completion.';

-- Auto-maintain supplier_cost from the car-rental breakdown
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
                     + COALESCE(NEW.driver_cost, 0)
                     + extras_total;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS bookings_recalc_supplier_cost ON public.bookings;
CREATE TRIGGER bookings_recalc_supplier_cost
  BEFORE INSERT OR UPDATE OF base_daily_rate, rental_days, fuel_cost, driver_cost, extra_charges
  ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.bookings_recalc_supplier_cost();

-- ─── 4. Notified tracking (for Client/Driver notified badges) ──────────────
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS client_notified_at timestamptz,
  ADD COLUMN IF NOT EXISTS driver_notified_at timestamptz;

-- ─── Done ───────────────────────────────────────────────────────────────────
-- Verify with:
--   SELECT count(*) FROM suppliers;
--   SELECT column_name FROM information_schema.columns
--     WHERE table_name='bookings'
--       AND column_name IN
--       ('supplier_id','supplier_cost','base_daily_rate','rental_days',
--        'fuel_cost','driver_cost','extra_charges',
--        'client_notified_at','driver_notified_at');
