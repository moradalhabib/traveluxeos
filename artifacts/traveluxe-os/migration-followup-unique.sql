-- Build 4.x — Prevent duplicate auto-created follow-ups per booking.
-- Run in the Supabase SQL editor.

-- 1. Dedupe any existing duplicates: keep the earliest row per booking_id.
WITH ranked AS (
  SELECT id,
         booking_id,
         ROW_NUMBER() OVER (PARTITION BY booking_id ORDER BY created_at ASC, id ASC) AS rn
  FROM follow_ups
  WHERE booking_id IS NOT NULL
)
DELETE FROM follow_ups f
USING ranked r
WHERE f.id = r.id
  AND r.rn > 1;

-- 2. Enforce one follow-up per booking going forward.
CREATE UNIQUE INDEX IF NOT EXISTS follow_ups_booking_id_unique
  ON follow_ups (booking_id)
  WHERE booking_id IS NOT NULL;
