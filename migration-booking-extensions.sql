-- ============================================================
-- Migration 2 — Booking: source list, driver acceptance, completion fields
-- Apply BEFORE redeploy. Safe / additive.
-- ============================================================

ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_source_check;
ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_source_check
  CHECK (
    source IS NULL OR source IN (
      'WhatsApp Direct', 'Snapchat', 'Returning Client',
      'Hotel Referral', 'Agent Referral', 'Other',
      -- legacy values retained so existing rows stay valid
      'WhatsApp', 'Referral'
    )
  );

ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS source_other TEXT;

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS driver_acceptance_status TEXT
    NOT NULL DEFAULT 'Assigned'
    CHECK (driver_acceptance_status IN ('Assigned', 'Driver Confirmed', 'Driver Declined'));

ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS driver_accepted_at TIMESTAMPTZ;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS driver_declined_at TIMESTAMPTZ;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS driver_decline_reason TEXT;

ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS client_satisfied BOOLEAN;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS driver_on_time BOOLEAN;
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS completion_notes TEXT
    CHECK (completion_notes IS NULL OR char_length(completion_notes) <= 500);
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

NOTIFY pgrst, 'reload schema';
