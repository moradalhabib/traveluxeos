-- ============================================================
-- Migration: Hotel service type + booking columns
-- Run this in your Supabase SQL Editor
-- ============================================================

-- 1. Add hotel-specific columns to bookings table
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS hotel_name TEXT,
  ADD COLUMN IF NOT EXISTS room_type TEXT,
  ADD COLUMN IF NOT EXISTS hotel_booking_ref TEXT,
  ADD COLUMN IF NOT EXISTS breakfast_included BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS num_guests INTEGER,
  ADD COLUMN IF NOT EXISTS num_nights INTEGER,
  ADD COLUMN IF NOT EXISTS commission_amount DECIMAL(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS commission_notes TEXT;

-- 2. Remove old service types no longer used
DELETE FROM service_types WHERE name IN ('City Tour', 'Chauffeur Tour', 'Event Transfer');

-- 3. Rename "Apartment / Accommodation" → "Apartment"
UPDATE service_types SET name = 'Apartment' WHERE name = 'Apartment / Accommodation';
UPDATE bookings SET service_type = 'Apartment' WHERE service_type = 'Apartment / Accommodation';

-- 4. Add updated_at column to bookings (for notification polling)
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- Auto-update updated_at on any row change
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

-- Backfill existing rows
UPDATE bookings SET updated_at = COALESCE(created_at, now()) WHERE updated_at IS NULL;

-- 5. Add Hotel service type
INSERT INTO service_types (id, name, description, base_price_guidance, sort_order, active)
VALUES (
  gen_random_uuid(),
  'Hotel',
  'Hotel bookings and accommodation management. Commission tracking for third-party providers.',
  'From £100 arrangement fee',
  6,
  true
) ON CONFLICT (name) DO NOTHING;
