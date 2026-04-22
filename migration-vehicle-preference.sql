-- Feature 3: Vehicle Preference
-- Adds an optional free-text "vehicle_preference" column on bookings so the
-- operator can capture client-stated preferences ("Range Rover", "V-Class",
-- "Rolls Royce", etc.) independent of the structured vehicle_type / supplier
-- product. Surfaced on the booking detail page and the driver job sheet.
--
-- Idempotent — safe to re-run.

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS vehicle_preference TEXT;

COMMENT ON COLUMN bookings.vehicle_preference IS
  'Operator-captured client vehicle preference (free text). Display-only — does not affect dispatch logic.';
