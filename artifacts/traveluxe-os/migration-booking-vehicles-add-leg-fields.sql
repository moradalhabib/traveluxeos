-- migration-booking-vehicles-add-leg-fields.sql
--
-- Targeted fix: production booking_vehicles is missing the per-leg
-- pickup / dropoff / date_time columns that the API selects (and that the
-- jobs page + driver schedule conflict check rely on). Without them the
-- app logs "column booking_vehicles.pickup does not exist" whenever a
-- multi-vehicle booking is read.
--
-- Idempotent — safe to re-run. Run in the Supabase SQL editor against the
-- Production project. No data loss; columns are nullable so existing rows
-- inherit the parent booking's pickup/dropoff/time as the code already does
-- (`v.pickup ?? parent.pickup`).

ALTER TABLE public.booking_vehicles
  ADD COLUMN IF NOT EXISTS pickup    TEXT,
  ADD COLUMN IF NOT EXISTS dropoff   TEXT,
  ADD COLUMN IF NOT EXISTS date_time TIMESTAMPTZ;

-- Verification: should list pickup, dropoff, date_time among the columns.
SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND table_name   = 'booking_vehicles'
   AND column_name IN ('pickup','dropoff','date_time')
 ORDER BY column_name;
