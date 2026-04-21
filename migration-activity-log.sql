-- ============================================================
-- Migration 5 — Operator activity log
-- Apply BEFORE redeploy. Append-only.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.activity_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  action_type TEXT NOT NULL,
  description TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  entity_label TEXT,
  operator_id UUID REFERENCES public.users(id),
  operator_name TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS activity_log_occurred_at_idx
  ON public.activity_log(occurred_at DESC);
CREATE INDEX IF NOT EXISTS activity_log_action_idx
  ON public.activity_log(action_type);
CREATE INDEX IF NOT EXISTS activity_log_entity_idx
  ON public.activity_log(entity_type, entity_id);

ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read activity" ON public.activity_log;
CREATE POLICY "Admins read activity" ON public.activity_log
  FOR SELECT USING (public.get_user_role(auth.uid()) IN ('admin', 'super_admin'));

DROP POLICY IF EXISTS "Operators insert activity" ON public.activity_log;
CREATE POLICY "Operators insert activity" ON public.activity_log
  FOR INSERT
  WITH CHECK (public.get_user_role(auth.uid()) IN ('admin', 'super_admin', 'operator'));

NOTIFY pgrst, 'reload schema';
