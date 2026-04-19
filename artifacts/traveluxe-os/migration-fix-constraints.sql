-- ============================================================
-- CRITICAL FIX: Booking constraint violations
-- Run this in your Supabase SQL Editor IMMEDIATELY
-- This fixes all CHECK constraint issues causing booking failures
-- ============================================================

-- 1. Drop ALL existing CHECK constraints on bookings that restrict values
ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_service_type_check;
ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_payment_method_check;
ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_source_check;
ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_status_check;
ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_payment_status_check;
ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_direction_check;
ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_commission_type_check;

-- 2. Re-add with full correct values
ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_service_type_check
    CHECK (service_type IN ('Airport Transfer', 'Tour', 'As Directed', 'Hotel', 'Apartment'));

ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_payment_method_check
    CHECK (payment_method IN ('Cash', 'Bank Transfer', 'Card', 'PayPal', 'Cash Weekly'));

ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_source_check
    CHECK (source IN ('WhatsApp', 'Snapchat', 'Referral', 'Returning Client', 'Other'));

ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_status_check
    CHECK (status IN ('Quote', 'Confirmed', 'Driver Assigned', 'Active', 'Completed', 'Invoiced', 'Cancelled', 'In Progress'));

ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_payment_status_check
    CHECK (payment_status IN ('Paid', 'Unpaid', 'Partial'));

ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_direction_check
    CHECK (direction IN ('Arrival', 'Departure'));

ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_commission_type_check
    CHECK (commission_type IN ('Driver owes TVL', 'TVL owes driver'));

-- 3. Add all missing columns (safe — IF NOT EXISTS)
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS tour_name          TEXT,
  ADD COLUMN IF NOT EXISTS meeting_point      TEXT,
  ADD COLUMN IF NOT EXISTS guide_included     BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS itinerary          TEXT,
  ADD COLUMN IF NOT EXISTS property_name      TEXT,
  ADD COLUMN IF NOT EXISTS property_address   TEXT,
  ADD COLUMN IF NOT EXISTS check_in_date      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS check_out_date     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS nights             INTEGER,
  ADD COLUMN IF NOT EXISTS property_contact   TEXT,
  ADD COLUMN IF NOT EXISTS hotel_name         TEXT,
  ADD COLUMN IF NOT EXISTS room_type          TEXT,
  ADD COLUMN IF NOT EXISTS hotel_booking_ref  TEXT,
  ADD COLUMN IF NOT EXISTS breakfast_included BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS num_guests         INTEGER,
  ADD COLUMN IF NOT EXISTS num_nights         INTEGER,
  ADD COLUMN IF NOT EXISTS commission_amount  DECIMAL(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS commission_notes   TEXT,
  ADD COLUMN IF NOT EXISTS notes              TEXT,
  ADD COLUMN IF NOT EXISTS duration           NUMERIC,
  ADD COLUMN IF NOT EXISTS updated_at         TIMESTAMPTZ DEFAULT now(),
  ADD COLUMN IF NOT EXISTS is_amended         BOOLEAN DEFAULT false;

-- 4. Fix quotes table service_type constraint too
ALTER TABLE public.quotes DROP CONSTRAINT IF EXISTS quotes_service_type_check;
ALTER TABLE public.quotes
  ADD CONSTRAINT quotes_service_type_check
    CHECK (service_type IN ('Airport Transfer', 'Tour', 'As Directed', 'Hotel', 'Apartment'));

-- 5. Update trigger for updated_at if not exists
CREATE OR REPLACE FUNCTION update_bookings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_bookings_updated_at ON bookings;
CREATE TRIGGER trg_bookings_updated_at
  BEFORE UPDATE ON bookings
  FOR EACH ROW EXECUTE FUNCTION update_bookings_updated_at();

-- Done. All booking types should now save correctly.
