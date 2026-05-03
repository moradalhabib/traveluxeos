-- ============================================================================
-- Public API surface for Traveluxe OS — api_keys + driver auth.
-- Run in Supabase SQL Editor. Idempotent (IF NOT EXISTS guards everywhere).
-- ============================================================================

-- ── api_keys ────────────────────────────────────────────────────────────────
-- Long-lived scoped credentials issued from Admin → API. The full key is
-- shown ONCE on creation; only the SHA-256 hash is persisted.
CREATE TABLE IF NOT EXISTS public.api_keys (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  key_hash      TEXT NOT NULL UNIQUE,
  key_prefix    TEXT NOT NULL,
  scopes        TEXT[] NOT NULL DEFAULT '{}',
  created_by    UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at  TIMESTAMPTZ,
  last_used_ip  TEXT,
  revoked_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS api_keys_active_idx
  ON public.api_keys (key_hash) WHERE revoked_at IS NULL;

ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;

-- Deny-all for anon + authenticated. Only the service-role client (used by
-- the api-server) reads/writes this table; service-role bypasses RLS.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename='api_keys' AND policyname='api_keys_deny_all'
  ) THEN
    CREATE POLICY api_keys_deny_all ON public.api_keys FOR ALL USING (false) WITH CHECK (false);
  END IF;
END $$;

-- ── drivers.pin_hash ────────────────────────────────────────────────────────
-- 4-6 digit PIN set by an admin in the Drivers UI. Allows the Drivers app to
-- log in via POST /v1/driver/login (whatsapp + pin → session token).
ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS pin_hash TEXT;

-- ── driver_sessions ─────────────────────────────────────────────────────────
-- Opaque tokens issued by /v1/driver/login. The Drivers app sends them as
-- X-Driver-Token on subsequent requests. 30-day default lifetime.
CREATE TABLE IF NOT EXISTS public.driver_sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id     UUID NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  token_hash    TEXT NOT NULL UNIQUE,
  api_key_id    UUID REFERENCES public.api_keys(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL,
  last_used_at  TIMESTAMPTZ,
  user_agent    TEXT,
  revoked_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS driver_sessions_driver_idx ON public.driver_sessions (driver_id);
CREATE INDEX IF NOT EXISTS driver_sessions_active_idx
  ON public.driver_sessions (token_hash) WHERE revoked_at IS NULL;

ALTER TABLE public.driver_sessions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename='driver_sessions' AND policyname='driver_sessions_deny_all'
  ) THEN
    CREATE POLICY driver_sessions_deny_all ON public.driver_sessions FOR ALL USING (false) WITH CHECK (false);
  END IF;
END $$;

-- ── requests.source ─────────────────────────────────────────────────────────
-- Distinguishes "where did this lead come from?". Already-existing requests
-- default to NULL (= legacy / created in the OS UI). API-created requests
-- get the api_key name (e.g. 'Client App — Production').
ALTER TABLE public.requests
  ADD COLUMN IF NOT EXISTS source TEXT;

ALTER TABLE public.requests
  ADD COLUMN IF NOT EXISTS source_api_key_id UUID REFERENCES public.api_keys(id) ON DELETE SET NULL;
