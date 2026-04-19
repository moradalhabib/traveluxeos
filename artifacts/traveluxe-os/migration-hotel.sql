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

-- 4. Add Hotel service type
INSERT INTO service_types (id, name, description, base_price_guidance, sort_order, active)
VALUES (
  gen_random_uuid(),
  'Hotel',
  'Hotel bookings and accommodation management. Commission tracking for third-party providers.',
  'From £100 arrangement fee',
  6,
  true
) ON CONFLICT (name) DO NOTHING;
