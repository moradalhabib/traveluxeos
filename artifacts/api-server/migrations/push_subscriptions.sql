-- Run this once in your Supabase SQL Editor (Dashboard → SQL Editor)
-- Creates the push_subscriptions table for Web Push OS notifications.

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id          bigserial PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint    text NOT NULL UNIQUE,
  p256dh      text NOT NULL,
  auth        text NOT NULL,
  expires_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS push_subscriptions_user_id_idx
  ON push_subscriptions(user_id);

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Allow the service role (used by the API server) to manage all rows
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'push_subscriptions'
      AND policyname = 'service_role_all'
  ) THEN
    CREATE POLICY service_role_all ON push_subscriptions
      USING (true) WITH CHECK (true);
  END IF;
END $$;
