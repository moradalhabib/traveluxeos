-- ============================================================
-- Migration 3 — Issue tracking table
-- Apply BEFORE redeploy.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.issues (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  booking_id UUID REFERENCES public.bookings(id) ON DELETE SET NULL,
  driver_id  UUID REFERENCES public.drivers(id)  ON DELETE SET NULL,
  client_id  UUID REFERENCES public.clients(id)  ON DELETE SET NULL,
  description TEXT NOT NULL CHECK (char_length(description) BETWEEN 1 AND 500),
  status TEXT NOT NULL DEFAULT 'Open'
    CHECK (status IN ('Open', 'Ongoing', 'Resolved')),
  resolution_notes TEXT,
  logged_by UUID REFERENCES public.users(id),
  logged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS issues_booking_idx ON public.issues(booking_id);
CREATE INDEX IF NOT EXISTS issues_driver_idx  ON public.issues(driver_id);
CREATE INDEX IF NOT EXISTS issues_client_idx  ON public.issues(client_id);
CREATE INDEX IF NOT EXISTS issues_status_idx  ON public.issues(status);
CREATE INDEX IF NOT EXISTS issues_logged_at_idx ON public.issues(logged_at DESC);

ALTER TABLE public.issues ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated read issues" ON public.issues;
CREATE POLICY "Authenticated read issues" ON public.issues
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Operators write issues" ON public.issues;
CREATE POLICY "Operators write issues" ON public.issues
  FOR ALL
  USING (public.get_user_role(auth.uid()) IN ('admin', 'super_admin', 'operator'))
  WITH CHECK (public.get_user_role(auth.uid()) IN ('admin', 'super_admin', 'operator'));

NOTIFY pgrst, 'reload schema';
