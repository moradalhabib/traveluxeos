-- ============================================================
-- Traveluxe OS — Tours & Apartments Extension
-- Run in Supabase SQL Editor
-- ============================================================

-- 1. Add tour-specific columns
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS tour_name          TEXT,
  ADD COLUMN IF NOT EXISTS meeting_point      TEXT,
  ADD COLUMN IF NOT EXISTS guide_included     BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS itinerary          TEXT;

-- 2. Add accommodation-specific columns
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS property_name      TEXT,
  ADD COLUMN IF NOT EXISTS property_address   TEXT,
  ADD COLUMN IF NOT EXISTS check_in_date      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS check_out_date     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS nights             INTEGER,
  ADD COLUMN IF NOT EXISTS property_contact   TEXT;

-- 3. Widen service_type CHECK constraint if one exists
--    (Supabase typically uses no CHECK on TEXT fields — this is a safety drop)
DO $$
BEGIN
  -- drop old check constraint on service_type if it exists
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'bookings'
      AND constraint_type = 'CHECK'
      AND constraint_name LIKE '%service_type%'
  ) THEN
    ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_service_type_check;
  END IF;
END $$;

-- 4. Comments for CRM developers
COMMENT ON COLUMN public.bookings.tour_name        IS 'Tour name (e.g. Oxford Day Trip). Populated when service_type is Tour / City Tour / Chauffeur Tour.';
COMMENT ON COLUMN public.bookings.meeting_point    IS 'Client meeting point for tours.';
COMMENT ON COLUMN public.bookings.guide_included   IS 'Whether a dedicated guide is included in the tour package.';
COMMENT ON COLUMN public.bookings.itinerary        IS 'Detailed itinerary or programme for the tour.';
COMMENT ON COLUMN public.bookings.property_name    IS 'Property/apartment name (e.g. The Dorchester). Populated when service_type is Apartment / Accommodation.';
COMMENT ON COLUMN public.bookings.property_address IS 'Full address of the accommodation.';
COMMENT ON COLUMN public.bookings.check_in_date    IS 'Accommodation check-in date/time.';
COMMENT ON COLUMN public.bookings.check_out_date   IS 'Accommodation check-out date/time.';
COMMENT ON COLUMN public.bookings.nights           IS 'Number of nights (auto-calculated by app, stored for CRM sync).';
COMMENT ON COLUMN public.bookings.property_contact IS 'Property manager / concierge contact for the accommodation.';
