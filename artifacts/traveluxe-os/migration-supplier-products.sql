-- ─────────────────────────────────────────────────────────────────────────────
-- migration-supplier-products.sql
-- Adds a per-supplier product catalogue (cars, drivers, other services)
-- and links each booking to a specific supplier_product so we can track
-- exactly which car/driver was used and roll cost up the right way.
--
-- Run in Supabase SQL editor.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS supplier_products (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id  uuid NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
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

CREATE INDEX IF NOT EXISTS idx_supplier_products_supplier ON supplier_products(supplier_id);
CREATE INDEX IF NOT EXISTS idx_supplier_products_active
  ON supplier_products(is_active) WHERE is_active = true;

-- Link bookings to a chosen supplier product (the specific car / driver
-- from the supplier). Nullable so existing bookings stay valid.
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS supplier_product_id uuid
    REFERENCES supplier_products(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_bookings_supplier_product
  ON bookings(supplier_product_id);

-- RLS: any authenticated user may read/write (mirrors suppliers table)
ALTER TABLE supplier_products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS supplier_products_all ON supplier_products;
CREATE POLICY supplier_products_all ON supplier_products
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

-- Sanity check
DO $$ BEGIN
  RAISE NOTICE 'supplier_products migration complete';
END $$;
