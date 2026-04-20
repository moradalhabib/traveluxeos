-- ─────────────────────────────────────────────────────────────────────
-- Create test admin user: test@traveluxelondon.com / replitdev2026
-- Safe to re-run (uses ON CONFLICT)
-- ─────────────────────────────────────────────────────────────────────

-- Ensure pgcrypto is available (should already be)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
DECLARE
  new_user_id UUID;
  existing_id UUID;
BEGIN
  -- Re-use existing auth row if present, else create
  SELECT id INTO existing_id FROM auth.users WHERE email = 'test@traveluxelondon.com';

  IF existing_id IS NULL THEN
    new_user_id := gen_random_uuid();

    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) VALUES (
      '00000000-0000-0000-0000-000000000000',
      new_user_id,
      'authenticated',
      'authenticated',
      'test@traveluxelondon.com',
      crypt('replitdev2026', gen_salt('bf')),
      NOW(), NOW(), NOW(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"name":"Test Admin"}'::jsonb,
      '', '', '', ''
    );

    INSERT INTO auth.identities (
      id, user_id, identity_data, provider, provider_id,
      last_sign_in_at, created_at, updated_at
    ) VALUES (
      gen_random_uuid(),
      new_user_id,
      jsonb_build_object('sub', new_user_id::text, 'email', 'test@traveluxelondon.com'),
      'email',
      new_user_id::text,
      NOW(), NOW(), NOW()
    );
  ELSE
    new_user_id := existing_id;
    -- Reset the password so you can log in even if it existed
    UPDATE auth.users
       SET encrypted_password = crypt('replitdev2026', gen_salt('bf')),
           email_confirmed_at = COALESCE(email_confirmed_at, NOW()),
           updated_at = NOW()
     WHERE id = new_user_id;
  END IF;

  -- Mirror into public.users as admin
  INSERT INTO public.users (id, name, email, role, active)
  VALUES (new_user_id, 'Test Admin', 'test@traveluxelondon.com', 'admin', true)
  ON CONFLICT (id) DO UPDATE
    SET role = 'admin', active = true, updated_at = NOW();

  -- Ensure notification prefs row exists
  INSERT INTO public.notification_prefs (user_id)
  VALUES (new_user_id)
  ON CONFLICT (user_id) DO NOTHING;
END $$;

-- Verify
SELECT u.id, u.email, u.role, u.active
FROM public.users u
WHERE u.email = 'test@traveluxelondon.com';
