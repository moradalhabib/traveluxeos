-- ============================================================
-- TRAVELUXE OS — Security Hardening Migration
-- Run in Supabase SQL Editor AFTER migration-vehicle-superadmin.sql
-- ============================================================

-- ── 1. Active user check function ─────────────────────────────
-- Returns true only if the user exists AND is active
CREATE OR REPLACE FUNCTION public.is_active_operator(user_id UUID)
RETURNS BOOLEAN AS $$
  SELECT COALESCE(active, false) FROM public.users WHERE id = user_id;
$$ LANGUAGE SQL SECURITY DEFINER;

-- ── 2. Harden all RLS policies to require active status ───────
-- Any user who has been deactivated is immediately locked out at
-- the database level — even if they still have a valid JWT.

-- Clients
DROP POLICY IF EXISTS "Authenticated users can manage clients" ON public.clients;
CREATE POLICY "Active operators can manage clients" ON public.clients
  FOR ALL USING (public.is_active_operator(auth.uid()) = true);

-- Drivers
DROP POLICY IF EXISTS "Authenticated users can manage drivers" ON public.drivers;
CREATE POLICY "Active operators can manage drivers" ON public.drivers
  FOR ALL USING (public.is_active_operator(auth.uid()) = true);

-- Quotes
DROP POLICY IF EXISTS "Authenticated users can manage quotes" ON public.quotes;
CREATE POLICY "Active operators can manage quotes" ON public.quotes
  FOR ALL USING (public.is_active_operator(auth.uid()) = true);

-- Bookings
DROP POLICY IF EXISTS "Authenticated users can manage bookings" ON public.bookings;
CREATE POLICY "Active operators can manage bookings" ON public.bookings
  FOR ALL USING (public.is_active_operator(auth.uid()) = true);

-- Driver ratings
DROP POLICY IF EXISTS "Authenticated users can manage ratings" ON public.driver_ratings;
CREATE POLICY "Active operators can manage ratings" ON public.driver_ratings
  FOR ALL USING (public.is_active_operator(auth.uid()) = true);

-- Commission settlements (read)
DROP POLICY IF EXISTS "Authenticated users can view settlements" ON public.commission_settlements;
CREATE POLICY "Active operators can view settlements" ON public.commission_settlements
  FOR SELECT USING (public.is_active_operator(auth.uid()) = true);

-- Driver payouts (read)
DROP POLICY IF EXISTS "Authenticated users can view payouts" ON public.driver_payouts;
CREATE POLICY "Active operators can view payouts" ON public.driver_payouts
  FOR SELECT USING (public.is_active_operator(auth.uid()) = true);

-- Invoices
DROP POLICY IF EXISTS "Authenticated users can manage invoices" ON public.invoices;
CREATE POLICY "Active operators can manage invoices" ON public.invoices
  FOR ALL USING (public.is_active_operator(auth.uid()) = true);

-- Flight cache
DROP POLICY IF EXISTS "Authenticated users can manage flight status" ON public.flight_status_cache;
CREATE POLICY "Active operators can manage flight status" ON public.flight_status_cache
  FOR ALL USING (public.is_active_operator(auth.uid()) = true);

-- Messages
DROP POLICY IF EXISTS "Users can view their messages" ON public.messages;
CREATE POLICY "Active operators can view messages" ON public.messages
  FOR SELECT USING (
    public.is_active_operator(auth.uid()) = true AND (
      channel IS NOT NULL OR
      sender_id = auth.uid() OR
      recipient_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can send messages" ON public.messages;
CREATE POLICY "Active operators can send messages" ON public.messages
  FOR INSERT WITH CHECK (
    public.is_active_operator(auth.uid()) = true AND
    auth.uid() = sender_id
  );

-- Tasks
DROP POLICY IF EXISTS "Authenticated users can manage tasks" ON public.tasks;
CREATE POLICY "Active operators can manage tasks" ON public.tasks
  FOR ALL USING (public.is_active_operator(auth.uid()) = true);

-- Audit log (read only)
DROP POLICY IF EXISTS "Admins can view audit log" ON public.audit_log;
CREATE POLICY "Active admins can view audit log" ON public.audit_log
  FOR SELECT USING (
    public.is_active_operator(auth.uid()) = true AND
    public.get_user_role(auth.uid()) IN ('admin', 'super_admin')
  );

-- Commissions (if table exists)
DROP POLICY IF EXISTS "Active users can view commissions" ON public.commissions;
CREATE POLICY "Active operators can manage commissions" ON public.commissions
  FOR ALL USING (public.is_active_operator(auth.uid()) = true);

-- ── 3. Disable public signup (run this to prevent self-registration) ──
-- In Supabase Dashboard → Authentication → Providers → Email
-- Uncheck "Enable Email provider" signup, or run:
-- UPDATE auth.config SET enable_signup = false;
-- NOTE: Only admins should create user accounts via the Dashboard
-- (Authentication → Users → Invite user)

-- ── 4. Promote a user to super_admin ──────────────────────────
-- UPDATE public.users SET role = 'super_admin' WHERE email = 'dataonly@traveluxelondon.com';

-- ── 5. Deactivate a user immediately ──────────────────────────
-- UPDATE public.users SET active = false WHERE email = 'user@example.com';

-- ── 6. View all users and their access status ─────────────────
-- SELECT name, email, role, active, created_at FROM public.users ORDER BY created_at;

-- ============================================================
-- Done. Security hardening applied.
-- ============================================================
