-- ─────────────────────────────────────────────────────────────────────────────
-- Slice 1 · Notifications Foundation
-- Additive migration. Safe to re-run. Does NOT touch existing tables/data.
-- Run in Supabase SQL editor.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── notifications table ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.notifications (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  type         TEXT NOT NULL,
  title        TEXT NOT NULL,
  message      TEXT NOT NULL,
  link         TEXT,
  entity_type  TEXT,
  entity_id    UUID,
  severity     TEXT NOT NULL DEFAULT 'info',  -- info | success | warning | urgent
  read         BOOLEAN NOT NULL DEFAULT FALSE,
  read_at      TIMESTAMPTZ,
  dismissed    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- dedupe key: prevents duplicate alerts for the same trigger
  -- e.g. "no_driver_3h:<booking_id>:2026-04-20T13" — varies by 30-min bucket
  dedupe_key   TEXT
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON public.notifications (user_id, read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_recent
  ON public.notifications (user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_notifications_dedupe
  ON public.notifications (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL;

-- ── RLS ────────────────────────────────────────────────────────────────────
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notifications_select_own ON public.notifications;
CREATE POLICY notifications_select_own ON public.notifications
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS notifications_update_own ON public.notifications;
CREATE POLICY notifications_update_own ON public.notifications
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- INSERT/DELETE done by service role only (server-side). No client policies.

-- ── Real-time publication ──────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'notifications'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications';
  END IF;
END $$;

-- ── Per-user preferences ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.notification_prefs (
  user_id                       UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  booking_new                   BOOLEAN NOT NULL DEFAULT TRUE,
  booking_status                BOOLEAN NOT NULL DEFAULT TRUE,
  booking_amended               BOOLEAN NOT NULL DEFAULT TRUE,
  booking_cancelled             BOOLEAN NOT NULL DEFAULT TRUE,
  no_driver_3h                  BOOLEAN NOT NULL DEFAULT TRUE,
  no_driver_24h                 BOOLEAN NOT NULL DEFAULT TRUE,
  flight_delay                  BOOLEAN NOT NULL DEFAULT TRUE,
  follow_up_due                 BOOLEAN NOT NULL DEFAULT TRUE,
  task_overdue                  BOOLEAN NOT NULL DEFAULT TRUE,
  weekly_commission             BOOLEAN NOT NULL DEFAULT TRUE,
  unpaid_invoice                BOOLEAN NOT NULL DEFAULT TRUE,
  -- Always-on (not user-toggleable, but stored for completeness):
  -- job_assigned, direct_message, announcement, task_assigned
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.notification_prefs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notif_prefs_select_own ON public.notification_prefs;
CREATE POLICY notif_prefs_select_own ON public.notification_prefs
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS notif_prefs_upsert_own ON public.notification_prefs;
CREATE POLICY notif_prefs_upsert_own ON public.notification_prefs
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Backfill: ensure every existing active user has a prefs row (defaults)
INSERT INTO public.notification_prefs (user_id)
SELECT id FROM public.users WHERE active IS TRUE
ON CONFLICT (user_id) DO NOTHING;
