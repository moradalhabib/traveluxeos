-- ─────────────────────────────────────────────────────────────────────────────
-- Traveluxe OS — Go-Live Migration
-- Adds driver email, loosens audit_log read access for operators, and adds
-- a few helpful indexes. Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Driver contact email (used by automated job-assigned + job-started alerts)
ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS email TEXT;

CREATE INDEX IF NOT EXISTS idx_drivers_email ON public.drivers(email);

-- 2. Allow operators to READ the audit log (they previously could not see the
--    "History" panel on a booking). Writes still go via the API service role.
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "audit_log_operators_read" ON public.audit_log;
CREATE POLICY "audit_log_operators_read"
  ON public.audit_log
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid()
        AND u.active = true
        AND u.role IN ('operator','admin','super_admin','residence_manager')
    )
  );

-- 3. Daily-digest helper index (looks up today's bookings quickly)
CREATE INDEX IF NOT EXISTS idx_bookings_date_status
  ON public.bookings(date_time, status);

-- 4. Sanity check
SELECT
  (SELECT COUNT(*) FROM public.drivers)        AS drivers,
  (SELECT COUNT(*) FROM public.drivers WHERE email IS NOT NULL) AS drivers_with_email,
  (SELECT COUNT(*) FROM public.bookings)       AS bookings,
  (SELECT COUNT(*) FROM public.audit_log)      AS audit_entries;
