-- Booking email automation: per-attempt audit/de-dup table.
--
-- Every transactional booking email (confirmation, receipt, manual resend)
-- writes a row here so we can:
--   * de-dup auto-fired emails (skip if a 'sent' row already exists for this
--     booking_id + kind),
--   * show a status badge in the UI,
--   * power a retry endpoint that finds the last 'failed' attempt,
--   * give the operator a real audit trail when something didn't arrive.
--
-- Idempotent — safe to re-run.

CREATE TABLE IF NOT EXISTS booking_email_log (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id      UUID        NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  kind            TEXT        NOT NULL
    CHECK (kind IN ('booking_confirmation','payment_receipt','invoice_resend','manual_invoice')),
  status          TEXT        NOT NULL
    CHECK (status IN ('sent','failed','skipped_no_email')),
  to_email        TEXT,
  error           TEXT,
  message_id      TEXT,
  triggered_by    UUID        REFERENCES users(id) ON DELETE SET NULL,
  trigger_source  TEXT        NOT NULL DEFAULT 'auto'
    CHECK (trigger_source IN ('auto','manual')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS booking_email_log_booking_kind_idx
  ON booking_email_log (booking_id, kind, status);

CREATE INDEX IF NOT EXISTS booking_email_log_booking_recent_idx
  ON booking_email_log (booking_id, created_at DESC);

ALTER TABLE booking_email_log ENABLE ROW LEVEL SECURITY;

-- Drop any prior over-broad policy so re-running this migration tightens
-- access. The original draft used USING (true) which exposed recipient
-- addresses and error messages (PII) to every authenticated session.
DROP POLICY IF EXISTS booking_email_log_read_authenticated ON booking_email_log;
DROP POLICY IF EXISTS "booking_email_log_read_staff"        ON booking_email_log;

-- Staff-only read: super_admin / admin / operator. Mirrors the bookings
-- policy pattern in migration-roles-and-profit.sql.
CREATE POLICY "booking_email_log_read_staff"
  ON booking_email_log
  FOR SELECT
  TO authenticated
  USING (
    (SELECT active = true AND role IN ('super_admin','admin','operator')
       FROM public.users
      WHERE id = auth.uid())
  );

-- All writes go through the API server using the service-role key, which
-- bypasses RLS — so we deliberately do NOT add INSERT/UPDATE/DELETE policies
-- for the authenticated role.
