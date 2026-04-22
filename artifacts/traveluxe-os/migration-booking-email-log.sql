-- ─────────────────────────────────────────────────────────────────────────────
-- migration-booking-email-log.sql
--
-- Tracks every transactional email Traveluxe OS sends about a booking.
-- Used for:
--   • De-duplication (stop the same Confirmed/Paid email firing twice)
--   • UI badge state (Sent / Failed / Not Sent / No Email on File)
--   • Operator retry of failed sends
--   • Audit history per booking
--
-- Apply once in the Supabase SQL editor. Idempotent — safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.booking_email_log (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id   uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  -- 'booking_confirmation' | 'payment_receipt' | 'invoice_resend' | 'manual_invoice'
  kind         text NOT NULL,
  -- 'sent' | 'failed' | 'skipped_no_email'
  status       text NOT NULL,
  to_email     text,
  message_id   text,
  error        text,
  triggered_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  -- 'auto'   = scheduler / status-change auto-trigger
  -- 'manual' = operator pressed Send Invoice / Retry button
  trigger_source text NOT NULL DEFAULT 'auto',
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_booking_email_log_booking
  ON public.booking_email_log(booking_id, kind, status);

CREATE INDEX IF NOT EXISTS idx_booking_email_log_recent
  ON public.booking_email_log(created_at DESC);

ALTER TABLE public.booking_email_log ENABLE ROW LEVEL SECURITY;

-- Service role only (server inserts via SUPABASE_SERVICE_ROLE_KEY).
-- The web app reads this via the API; never directly.
DROP POLICY IF EXISTS booking_email_log_service_role_all
  ON public.booking_email_log;
CREATE POLICY booking_email_log_service_role_all
  ON public.booking_email_log
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
