-- migration-app-settings.sql
--
-- Adds a simple key/value app_settings table so configurable values
-- (admin email for the daily briefing, future toggles, etc.) can be
-- edited from the UI without touching code or env vars.
--
-- Apply manually in Supabase → SQL editor.

CREATE TABLE IF NOT EXISTS public.app_settings (
  key         TEXT PRIMARY KEY,
  value       TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  UUID REFERENCES public.users(id)
);

-- Seed the daily-briefing recipient. Edit later from the Settings UI
-- or by re-running this with a different value.
INSERT INTO public.app_settings (key, value)
VALUES ('admin_email', 'info@traveluxelondon.com')
ON CONFLICT (key) DO NOTHING;

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS app_settings_read   ON public.app_settings;
DROP POLICY IF EXISTS app_settings_write  ON public.app_settings;

-- Any authenticated staff member may read settings (we avoid leaking
-- secrets here — only operational config lives in this table).
CREATE POLICY app_settings_read ON public.app_settings
  FOR SELECT TO authenticated USING (true);

-- Only admin / super_admin may modify settings.
CREATE POLICY app_settings_write ON public.app_settings
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid()
      AND u.role IN ('admin', 'super_admin')
      AND u.active = true
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid()
      AND u.role IN ('admin', 'super_admin')
      AND u.active = true
  ));
