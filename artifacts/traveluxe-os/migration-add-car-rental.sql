-- Build 4.x — Add 'Car Rental' to the allowed service_type values.
-- The bookings/quotes CHECK constraints were tightened earlier and accidentally
-- dropped 'Car Rental', so creating a Car Rental booking currently fails with:
--   new row for relation "bookings" violates check constraint "bookings_service_type_check"
-- Run in the Supabase SQL editor.

ALTER TABLE public.bookings
  DROP CONSTRAINT IF EXISTS bookings_service_type_check;
ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_service_type_check
  CHECK (service_type IN (
    'Airport Transfer',
    'Tour',
    'Tours',
    'As Directed',
    'Apartment',
    'Hotel',
    'Car Rental'
  ));

ALTER TABLE public.quotes
  DROP CONSTRAINT IF EXISTS quotes_service_type_check;
ALTER TABLE public.quotes
  ADD CONSTRAINT quotes_service_type_check
  CHECK (service_type IN (
    'Airport Transfer',
    'Tour',
    'Tours',
    'As Directed',
    'Apartment',
    'Hotel',
    'Car Rental'
  ));
