-- ============================================================
-- TRAVELUXE OS — Run this once in your Supabase SQL Editor
-- Dashboard → SQL Editor → New Query → paste → Run
-- ============================================================

-- 1. Allow super_admin as a valid role
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE public.users
  ADD CONSTRAINT users_role_check
  CHECK (role IN ('admin', 'operator', 'super_admin'));

-- 2. Allow any custom vehicle name in drivers table
ALTER TABLE public.drivers DROP CONSTRAINT IF EXISTS drivers_vehicle_type_check;

-- 3. Give super_admin SELECT rights on export tables (via policy)
-- Drop old policies and recreate with super_admin included

-- clients
DROP POLICY IF EXISTS "Admins can manage all clients" ON public.clients;
CREATE POLICY "Admins can manage all clients"
  ON public.clients FOR ALL
  USING (public.get_user_role(auth.uid()) IN ('admin', 'super_admin'));

DROP POLICY IF EXISTS "Super admins can read clients" ON public.clients;
CREATE POLICY "Super admins can read clients"
  ON public.clients FOR SELECT
  USING (public.get_user_role(auth.uid()) IN ('admin', 'super_admin'));

-- bookings — super_admin read only
DROP POLICY IF EXISTS "Super admins read bookings" ON public.bookings;
CREATE POLICY "Super admins read bookings"
  ON public.bookings FOR SELECT
  USING (public.get_user_role(auth.uid()) IN ('admin', 'super_admin'));

-- drivers — super_admin read only
DROP POLICY IF EXISTS "Super admins read drivers" ON public.drivers;
CREATE POLICY "Super admins read drivers"
  ON public.drivers FOR SELECT
  USING (public.get_user_role(auth.uid()) IN ('admin', 'super_admin'));

-- commissions — super_admin read only
DROP POLICY IF EXISTS "Super admins read commissions" ON public.commissions;
CREATE POLICY "Super admins read commissions"
  ON public.commissions FOR SELECT
  USING (public.get_user_role(auth.uid()) IN ('admin', 'super_admin'));

-- 4. To promote a user to super_admin, run:
-- UPDATE public.users SET role = 'super_admin' WHERE email = 'their@email.com';

-- ============================================================
-- Done. super_admin users can now: import, export, and backup.
-- They cannot access bookings, clients, drivers, or finance UI.
-- ============================================================
