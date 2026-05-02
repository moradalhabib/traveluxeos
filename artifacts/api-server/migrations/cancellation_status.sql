-- ============================================================================
-- Cancellation status for requests + follow-ups, with a required reason.
--
-- Operators asked for an explicit "Cancelled" lifecycle that captures *why*
-- the lead was lost, distinct from "Declined" (we said no) or "Expired"
-- (we never followed up in time). Same shape on both tables so a single
-- audit log column works across the workspace.
--
-- Safe to run multiple times — every statement is guarded with IF NOT
-- EXISTS / DO NOTHING / ON CONFLICT.
-- ============================================================================

-- ── REQUESTS ────────────────────────────────────────────────────────────────
ALTER TABLE public.requests
  ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;

ALTER TABLE public.requests
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;

ALTER TABLE public.requests
  ADD COLUMN IF NOT EXISTS cancelled_by UUID;

-- Drop the old check constraint if it pinned status to the original 6 values
-- so we can add "Cancelled". Constraint name follows Postgres' default
-- conventions used elsewhere in the schema.
DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  SELECT con.conname INTO constraint_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  WHERE rel.relname = 'requests'
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) ILIKE '%status%'
    AND pg_get_constraintdef(con.oid) ILIKE '%New%';
  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.requests DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

ALTER TABLE public.requests
  ADD CONSTRAINT requests_status_check
  CHECK (status IN ('New','Following Up','Ready to Book','Converted','Declined','Expired','Cancelled'));

-- ── FOLLOW_UPS ──────────────────────────────────────────────────────────────
ALTER TABLE public.follow_ups
  ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;

ALTER TABLE public.follow_ups
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;

ALTER TABLE public.follow_ups
  ADD COLUMN IF NOT EXISTS cancelled_by UUID;

-- Same constraint dance for follow_ups.status if the platform pinned it
-- to the original enum-via-check shape.
DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  SELECT con.conname INTO constraint_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  WHERE rel.relname = 'follow_ups'
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) ILIKE '%status%'
    AND pg_get_constraintdef(con.oid) ILIKE '%pending%';
  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.follow_ups DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

ALTER TABLE public.follow_ups
  ADD CONSTRAINT follow_ups_status_check
  CHECK (status IN ('pending','done','no_response','snooze','booked_return','cancelled'));

-- Helpful indexes for the new "Cancelled" filter view.
CREATE INDEX IF NOT EXISTS requests_status_cancelled_idx
  ON public.requests (status)
  WHERE status = 'Cancelled';

CREATE INDEX IF NOT EXISTS follow_ups_status_cancelled_idx
  ON public.follow_ups (status)
  WHERE status = 'cancelled';
