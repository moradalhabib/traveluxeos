-- ============================================================
-- Migration 4 — Booking amendments audit log
-- Apply BEFORE redeploy. Append-only audit trail.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.booking_amendments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  booking_id UUID NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  field_name TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  change_type TEXT NOT NULL DEFAULT 'edit'
    CHECK (change_type IN (
      'edit', 'driver_declined', 'double_booking_override',
      'status_change', 'payment_change', 'driver_assigned',
      'driver_confirmed', 'completion'
    )),
  reason TEXT,
  changed_by UUID REFERENCES public.users(id),
  changed_by_name TEXT,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS booking_amendments_booking_idx
  ON public.booking_amendments(booking_id, changed_at DESC);

ALTER TABLE public.booking_amendments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated read amendments" ON public.booking_amendments;
CREATE POLICY "Authenticated read amendments" ON public.booking_amendments
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Operators insert amendments" ON public.booking_amendments;
CREATE POLICY "Operators insert amendments" ON public.booking_amendments
  FOR INSERT
  WITH CHECK (public.get_user_role(auth.uid()) IN ('admin', 'super_admin', 'operator'));

NOTIFY pgrst, 'reload schema';
