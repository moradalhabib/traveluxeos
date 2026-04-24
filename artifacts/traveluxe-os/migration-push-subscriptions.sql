-- Migration: push_subscriptions
-- Web Push subscription storage.
-- Each row represents one browser/device that has granted push permission.
-- Multiple devices per user are supported (one row per endpoint).
-- Run this in the Supabase SQL editor.

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint    TEXT NOT NULL UNIQUE,
  p256dh      TEXT NOT NULL,
  auth        TEXT NOT NULL,
  expires_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index: look up all subscriptions for a user efficiently
CREATE INDEX IF NOT EXISTS idx_push_subs_user_id ON push_subscriptions(user_id);

-- RLS: users can manage their own subscriptions; service role bypasses
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY push_subs_user_select ON push_subscriptions
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE POLICY push_subs_user_insert ON push_subscriptions
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

CREATE POLICY push_subs_user_delete ON push_subscriptions
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- Service role reads all (for scheduler to broadcast)
CREATE POLICY push_subs_service_select ON push_subscriptions
  FOR SELECT TO service_role USING (true);

CREATE POLICY push_subs_service_delete ON push_subscriptions
  FOR DELETE TO service_role USING (true);
