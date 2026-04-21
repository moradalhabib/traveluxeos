-- ============================================================
-- Migration 1 — Driver: Own Vehicle flag + Suspended status
-- Apply BEFORE redeploy. Safe / additive.
-- ============================================================

ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS own_vehicle BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE public.drivers DROP CONSTRAINT IF EXISTS drivers_status_check;
ALTER TABLE public.drivers
  ADD CONSTRAINT drivers_status_check
  CHECK (status IN ('Active', 'Inactive', 'Suspended'));

NOTIFY pgrst, 'reload schema';
