-- T005: Unpaid-invoice operator reminder throttle column.
--
-- The hourly scheduler emails moradlondon1 (operator) when an invoice has
-- been Generated/Sent for >48h after the booking was completed, with a 24h
-- throttle so we don't spam the inbox every tick.
--
-- Idempotent — safe to re-run.

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS unpaid_reminder_sent_at TIMESTAMPTZ;

COMMENT ON COLUMN invoices.unpaid_reminder_sent_at
  IS 'Last time the unpaid-invoice operator reminder email was sent (24h throttle).';

CREATE INDEX IF NOT EXISTS invoices_unpaid_reminder_idx
  ON invoices (status, unpaid_reminder_sent_at)
  WHERE status IN ('Generated','Sent');
