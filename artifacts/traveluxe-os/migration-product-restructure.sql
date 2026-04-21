-- ============================================================
-- Traveluxe OS — Product Restructure + Booking Form Upgrade
-- Run this in Supabase SQL Editor (Database → SQL Editor → New query)
-- ============================================================
-- Safe to re-run.  Additive only — does NOT touch existing data.
-- Covers everything that has not yet been applied:
--   1. follow_ups table          (in case not yet applied)
--   2. vehicle_airport_pricing   (per-airport vehicle prices)
--   3. bookings: airport_code, vehicle_product_id, tour_product_id,
--                meet_greet_product_id, hours,
--                supplier_cost, client_price (Hotel/Apartment markup)
--   4. Seed standard airports for every existing Vehicle product
-- ============================================================


-- ─── 1.  follow_ups table  ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.follow_ups (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id      UUID NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  client_id       UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  driver_id       UUID,
  due_date        DATE,
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','done','booked_return','no_response')),
  notes           TEXT,
  completed_by    UUID,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_follow_ups_booking_id ON public.follow_ups (booking_id);
CREATE INDEX IF NOT EXISTS idx_follow_ups_status     ON public.follow_ups (status);
CREATE INDEX IF NOT EXISTS idx_follow_ups_due_date   ON public.follow_ups (due_date);

ALTER TABLE public.follow_ups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated users can manage follow_ups" ON public.follow_ups;
CREATE POLICY "Authenticated users can manage follow_ups"
  ON public.follow_ups
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);


-- ─── 2.  vehicle_airport_pricing table  ────────────────────
CREATE TABLE IF NOT EXISTS public.vehicle_airport_pricing (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id    UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  airport_code  TEXT NOT NULL CHECK (airport_code IN ('LHR','LGW','STN','LTN','LCY','OTHER')),
  airport_name  TEXT NOT NULL,
  price         NUMERIC(10,2) NOT NULL DEFAULT 0,
  hourly_rate   NUMERIC(10,2),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (product_id, airport_code)
);
CREATE INDEX IF NOT EXISTS idx_vap_product ON public.vehicle_airport_pricing (product_id);
CREATE INDEX IF NOT EXISTS idx_vap_airport ON public.vehicle_airport_pricing (airport_code);

ALTER TABLE public.vehicle_airport_pricing ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "vap_read"  ON public.vehicle_airport_pricing;
DROP POLICY IF EXISTS "vap_write" ON public.vehicle_airport_pricing;

-- Anyone signed in can READ pricing (booking form needs this).
CREATE POLICY "vap_read"  ON public.vehicle_airport_pricing
  FOR SELECT TO authenticated USING (true);

-- Only admin / super_admin can WRITE pricing.
-- (Assumes a `profiles` table with a `role` column — same pattern other
--  admin-protected tables use in this DB.)
CREATE POLICY "vap_write" ON public.vehicle_airport_pricing
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
       WHERE p.id = auth.uid()
         AND p.role IN ('admin','super_admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
       WHERE p.id = auth.uid()
         AND p.role IN ('admin','super_admin')
    )
  );


-- ─── 3.  bookings — new product-link & markup columns  ─────
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS airport_code          TEXT,
  ADD COLUMN IF NOT EXISTS vehicle_product_id    UUID REFERENCES public.products(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS tour_product_id       UUID REFERENCES public.products(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS meet_greet_product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS hours                 NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS supplier_cost         NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS client_price          NUMERIC(10,2);

COMMENT ON COLUMN public.bookings.airport_code          IS 'LHR / LGW / STN / LTN / LCY / OTHER — used by Airport Transfer pricing.';
COMMENT ON COLUMN public.bookings.vehicle_product_id    IS 'FK to products.id — the vehicle assigned (Airport Transfer / As Directed).';
COMMENT ON COLUMN public.bookings.tour_product_id       IS 'FK to products.id — the tour destination (Tour bookings).';
COMMENT ON COLUMN public.bookings.meet_greet_product_id IS 'FK to products.id — the Meet & Greet tier add-on.';
COMMENT ON COLUMN public.bookings.hours                 IS 'Number of hours (As Directed bookings).';
COMMENT ON COLUMN public.bookings.supplier_cost         IS 'Supplier cost £ — Hotel / Apartment markup model.';
COMMENT ON COLUMN public.bookings.client_price          IS 'Client price £ — Hotel / Apartment markup model. Margin = client_price − supplier_cost.';

CREATE INDEX IF NOT EXISTS idx_bookings_vehicle_product ON public.bookings (vehicle_product_id);
CREATE INDEX IF NOT EXISTS idx_bookings_tour_product    ON public.bookings (tour_product_id);
CREATE INDEX IF NOT EXISTS idx_bookings_airport_code    ON public.bookings (airport_code);


-- ─── 4.  Seed airport-pricing rows for existing Vehicle products  ──
-- For every Vehicle product, insert a row for each of the 6 airport codes
-- using the product's existing unit_price as a sensible starting price.
-- Operators can then edit individual airport prices in the catalogue.
INSERT INTO public.vehicle_airport_pricing (product_id, airport_code, airport_name, price, hourly_rate)
SELECT p.id, a.code, a.name, p.unit_price,
       CASE WHEN a.code = 'OTHER' THEN p.unit_price ELSE NULL END
FROM public.products p
CROSS JOIN (VALUES
  ('LHR',  'Heathrow'),
  ('LGW',  'Gatwick'),
  ('STN',  'Stansted'),
  ('LTN',  'Luton'),
  ('LCY',  'London City'),
  ('OTHER','Other / As Directed')
) AS a(code, name)
WHERE p.category = 'Vehicle' AND p.active = true
ON CONFLICT (product_id, airport_code) DO NOTHING;


-- ─── 5.  Backfill bookings.client_price for existing Hotel / Apartment rows  ──
-- (so the Finance dashboard immediately sees a consistent picture).
-- Only updates rows where supplier/client cols are still NULL.
UPDATE public.bookings
   SET client_price = price
 WHERE service_type IN ('Hotel','Apartment')
   AND client_price IS NULL
   AND price IS NOT NULL;


-- ─── 6.  Realtime publication for notifications & follow_ups  ──────
-- (Needed so the bell badge & follow-ups page update live.)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND tablename = 'notifications'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications';
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND tablename = 'follow_ups'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.follow_ups';
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- ============================================================
-- DONE.  After running, verify in the Table Editor:
--   • follow_ups                     exists
--   • vehicle_airport_pricing        exists, has 1 row per (vehicle × airport)
--   • bookings has new columns:      airport_code, vehicle_product_id,
--                                    tour_product_id, meet_greet_product_id,
--                                    hours, supplier_cost, client_price
-- ============================================================
