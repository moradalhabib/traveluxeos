-- ============================================================
-- Migration C — Fix RLS on commission_settlements + driver_payouts
-- Apply BEFORE redeploy.
-- Dashboard → SQL Editor → New Query → paste → Run.
-- Verify: should show "Success. No rows returned".
-- After running, "Mark as Settled" must succeed (HTTP 200) instead of HTTP 500.
-- ============================================================

-- commission_settlements: allow admin + super_admin to insert/update/delete.
DROP POLICY IF EXISTS "Admins can manage settlements" ON public.commission_settlements;
CREATE POLICY "Admins can manage settlements"
  ON public.commission_settlements
  FOR ALL
  USING (public.get_user_role(auth.uid()) IN ('admin', 'super_admin'))
  WITH CHECK (public.get_user_role(auth.uid()) IN ('admin', 'super_admin'));

-- driver_payouts: same treatment so payout flow doesn't hit the same bug.
DROP POLICY IF EXISTS "Admins can manage payouts" ON public.driver_payouts;
CREATE POLICY "Admins can manage payouts"
  ON public.driver_payouts
  FOR ALL
  USING (public.get_user_role(auth.uid()) IN ('admin', 'super_admin'))
  WITH CHECK (public.get_user_role(auth.uid()) IN ('admin', 'super_admin'));

NOTIFY pgrst, 'reload schema';
