-- ============================================================
-- TRAVELUXE OS — Role Permissions Overhaul + Profit Tab
-- Run in Supabase SQL Editor AFTER security-hardening.sql
-- ============================================================
--
-- New role model:
--   super_admin       → full access (incl. Profit tab)
--   admin             → everything EXCEPT Admin Panel, Finance, Commissions
--   operator          → everything EXCEPT Admin Panel user mgmt + Profit tab
--   viewer            → READ-ONLY on clients, bookings, jobs (no financials)
--   residence_manager → kept for backward compatibility (apartments only)
--
-- ============================================================

-- ── 1. Add 'viewer' to the role CHECK constraint ─────────────
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE public.users
  ADD CONSTRAINT users_role_check
  CHECK (role IN ('admin', 'operator', 'super_admin', 'residence_manager', 'viewer'));

-- ── 2. Helper functions ──────────────────────────────────────

-- True only for super_admin (Profit tab gate)
CREATE OR REPLACE FUNCTION public.is_super_admin(user_id UUID)
RETURNS BOOLEAN AS $$
  SELECT COALESCE(
    (SELECT active = true AND role = 'super_admin' FROM public.users WHERE id = user_id),
    false
  );
$$ LANGUAGE SQL SECURITY DEFINER;

-- True if user can write (anyone except viewer / inactive)
CREATE OR REPLACE FUNCTION public.can_write(user_id UUID)
RETURNS BOOLEAN AS $$
  SELECT COALESCE(
    (SELECT active = true AND role <> 'viewer' FROM public.users WHERE id = user_id),
    false
  );
$$ LANGUAGE SQL SECURITY DEFINER;

-- True if user can view Finance section (super_admin + operator)
CREATE OR REPLACE FUNCTION public.can_view_finance(user_id UUID)
RETURNS BOOLEAN AS $$
  SELECT COALESCE(
    (SELECT active = true AND role IN ('super_admin', 'operator') FROM public.users WHERE id = user_id),
    false
  );
$$ LANGUAGE SQL SECURITY DEFINER;

-- True if user can view Commissions section (super_admin + operator, NOT admin)
CREATE OR REPLACE FUNCTION public.can_view_commissions(user_id UUID)
RETURNS BOOLEAN AS $$
  SELECT COALESCE(
    (SELECT active = true AND role IN ('super_admin', 'operator') FROM public.users WHERE id = user_id),
    false
  );
$$ LANGUAGE SQL SECURITY DEFINER;

-- True if user can view Admin Panel (super_admin + operator, NOT admin)
CREATE OR REPLACE FUNCTION public.can_view_admin_panel(user_id UUID)
RETURNS BOOLEAN AS $$
  SELECT COALESCE(
    (SELECT active = true AND role IN ('super_admin', 'operator') FROM public.users WHERE id = user_id),
    false
  );
$$ LANGUAGE SQL SECURITY DEFINER;

-- ── 3. Re-write RLS policies to enforce viewer = read-only ───
-- Pattern: SELECT for viewers on bookings/clients only; ALL for others.

-- BOOKINGS — viewer can SELECT, others have full access
DROP POLICY IF EXISTS "Active operators can manage bookings" ON public.bookings;
DROP POLICY IF EXISTS "Bookings select" ON public.bookings;
DROP POLICY IF EXISTS "Bookings write" ON public.bookings;

CREATE POLICY "Bookings select" ON public.bookings
  FOR SELECT USING (public.is_active_operator(auth.uid()) = true);

CREATE POLICY "Bookings insert" ON public.bookings
  FOR INSERT WITH CHECK (public.can_write(auth.uid()) = true);

CREATE POLICY "Bookings update" ON public.bookings
  FOR UPDATE USING (public.can_write(auth.uid()) = true);

CREATE POLICY "Bookings delete" ON public.bookings
  FOR DELETE USING (public.can_write(auth.uid()) = true);

-- CLIENTS — viewer can SELECT, others have full access
DROP POLICY IF EXISTS "Active operators can manage clients" ON public.clients;
DROP POLICY IF EXISTS "Clients select" ON public.clients;
DROP POLICY IF EXISTS "Clients write" ON public.clients;

CREATE POLICY "Clients select" ON public.clients
  FOR SELECT USING (public.is_active_operator(auth.uid()) = true);

CREATE POLICY "Clients insert" ON public.clients
  FOR INSERT WITH CHECK (public.can_write(auth.uid()) = true);

CREATE POLICY "Clients update" ON public.clients
  FOR UPDATE USING (public.can_write(auth.uid()) = true);

CREATE POLICY "Clients delete" ON public.clients
  FOR DELETE USING (public.can_write(auth.uid()) = true);

-- DRIVERS — viewer can SELECT (needed for Jobs board to show driver names via join);
-- writes blocked for viewer.
DROP POLICY IF EXISTS "Active operators can manage drivers" ON public.drivers;
DROP POLICY IF EXISTS "Drivers select" ON public.drivers;
DROP POLICY IF EXISTS "Drivers write" ON public.drivers;

CREATE POLICY "Drivers select" ON public.drivers
  FOR SELECT USING (public.is_active_operator(auth.uid()) = true);

CREATE POLICY "Drivers insert" ON public.drivers
  FOR INSERT WITH CHECK (public.can_write(auth.uid()) = true);

CREATE POLICY "Drivers update" ON public.drivers
  FOR UPDATE USING (public.can_write(auth.uid()) = true);

CREATE POLICY "Drivers delete" ON public.drivers
  FOR DELETE USING (public.can_write(auth.uid()) = true);

-- INVOICES — block viewer entirely (no financial data)
DROP POLICY IF EXISTS "Active operators can manage invoices" ON public.invoices;
DROP POLICY IF EXISTS "Invoices select" ON public.invoices;
DROP POLICY IF EXISTS "Invoices write" ON public.invoices;

CREATE POLICY "Invoices select" ON public.invoices
  FOR SELECT USING (public.can_write(auth.uid()) = true);

CREATE POLICY "Invoices insert" ON public.invoices
  FOR INSERT WITH CHECK (public.can_write(auth.uid()) = true);

CREATE POLICY "Invoices update" ON public.invoices
  FOR UPDATE USING (public.can_write(auth.uid()) = true);

CREATE POLICY "Invoices delete" ON public.invoices
  FOR DELETE USING (public.can_write(auth.uid()) = true);

-- COMMISSION SETTLEMENTS — viewers blocked; admin blocked from financial detail
DROP POLICY IF EXISTS "Active operators can view settlements" ON public.commission_settlements;
DROP POLICY IF EXISTS "Settlements select" ON public.commission_settlements;
CREATE POLICY "Settlements select" ON public.commission_settlements
  FOR SELECT USING (public.can_view_commissions(auth.uid()) = true);

-- DRIVER PAYOUTS — viewers blocked; admin blocked
DROP POLICY IF EXISTS "Active operators can view payouts" ON public.driver_payouts;
DROP POLICY IF EXISTS "Payouts select" ON public.driver_payouts;
CREATE POLICY "Payouts select" ON public.driver_payouts
  FOR SELECT USING (public.can_view_commissions(auth.uid()) = true);

-- COMMISSIONS table — only apply if it exists (this project uses
-- commission_settlements + driver_payouts; legacy 'commissions' may not exist)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='commissions') THEN
    EXECUTE 'DROP POLICY IF EXISTS "Active operators can manage commissions" ON public.commissions';
    EXECUTE 'DROP POLICY IF EXISTS "Commissions select" ON public.commissions';
    EXECUTE 'DROP POLICY IF EXISTS "Commissions write" ON public.commissions';
    EXECUTE 'CREATE POLICY "Commissions select" ON public.commissions FOR SELECT USING (public.can_view_commissions(auth.uid()) = true)';
    EXECUTE 'CREATE POLICY "Commissions write" ON public.commissions FOR ALL USING (public.can_view_commissions(auth.uid()) = true)';
  END IF;
END $$;

-- QUOTES — block viewer entirely
DROP POLICY IF EXISTS "Active operators can manage quotes" ON public.quotes;
CREATE POLICY "Quotes manage" ON public.quotes
  FOR ALL USING (public.can_write(auth.uid()) = true);

-- TASKS — block viewer
DROP POLICY IF EXISTS "Active operators can manage tasks" ON public.tasks;
CREATE POLICY "Tasks manage" ON public.tasks
  FOR ALL USING (public.can_write(auth.uid()) = true);

-- DRIVER RATINGS — block viewer
DROP POLICY IF EXISTS "Active operators can manage ratings" ON public.driver_ratings;
CREATE POLICY "Ratings manage" ON public.driver_ratings
  FOR ALL USING (public.can_write(auth.uid()) = true);

-- FOLLOW-UPS — block viewer
DROP POLICY IF EXISTS "Authenticated users can manage follow_ups" ON public.follow_ups;
DROP POLICY IF EXISTS "Follow-ups manage" ON public.follow_ups;
CREATE POLICY "Follow-ups manage" ON public.follow_ups
  FOR ALL USING (public.can_write(auth.uid()) = true);

-- AUDIT LOG — keep super_admin + admin (admin still needs to audit even if blocked from finance)
DROP POLICY IF EXISTS "Active admins can view audit log" ON public.audit_log;
CREATE POLICY "Audit log read" ON public.audit_log
  FOR SELECT USING (
    public.is_active_operator(auth.uid()) = true AND
    public.get_user_role(auth.uid()) IN ('admin', 'super_admin')
  );

-- ── 4. Profit data access (Profit tab is super_admin only) ────
-- A SECURITY DEFINER view/function approach: create a function that
-- returns profit rows ONLY for super_admins. Anyone else gets empty / error.

CREATE OR REPLACE FUNCTION public.get_profit_breakdown(
  p_from TIMESTAMPTZ DEFAULT NULL,
  p_to   TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (
  booking_id     UUID,
  tvl_ref        TEXT,
  date_time      TIMESTAMPTZ,
  service_type   TEXT,
  client_name    TEXT,
  price          NUMERIC,
  tvl_commission NUMERIC,
  payment_status TEXT
) AS $$
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Access denied: Profit data is restricted to Super Admins only';
  END IF;

  RETURN QUERY
  SELECT
    b.id,
    b.tvl_ref,
    b.date_time,
    b.service_type,
    c.name,
    b.price,
    b.tvl_commission,
    b.payment_status
  FROM public.bookings b
  LEFT JOIN public.clients c ON c.id = b.client_id
  WHERE b.status IN ('Completed','Invoiced')
    AND COALESCE(b.tvl_commission, 0) > 0
    AND (p_from IS NULL OR b.date_time >= p_from)
    AND (p_to   IS NULL OR b.date_time <= p_to)
  ORDER BY b.date_time DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION public.get_profit_breakdown(TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_profit_breakdown(TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;

-- ============================================================
-- Done. New role model + Profit data gate active.
-- To create a viewer:
--   UPDATE public.users SET role = 'viewer', active = true WHERE email = '...';
-- ============================================================
