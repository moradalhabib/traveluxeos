-- ============================================================
-- migration-profit-include-suppliers.sql
--
-- Updates get_profit_breakdown so the Finance > Profit tab reflects
-- BOTH driver-side TVL commission AND supplier markup commission, and
-- so it counts every non-cancelled booking in the period — not only
-- those manually flagged Completed / Invoiced.
--
-- Why both changes ship together:
--   1. The user explicitly asked for suppliers to be reflected in
--      Finance totals end-to-end. The Profit tab is the only finance
--      surface that was still drivers-only at the data source.
--   2. The old strict status filter showed £0 for periods where work
--      had clearly happened (and TVL commission existed) but operators
--      hadn't yet promoted the booking past Confirmed. Operators read
--      that £0 as a bug. Counting all non-cancelled bookings makes
--      the figure match what the rest of the page already shows.
--
-- Function still SECURITY DEFINER + super_admin guarded — same access
-- controls, only the SELECT widens.
-- ============================================================

DROP FUNCTION IF EXISTS public.get_profit_breakdown(TIMESTAMPTZ, TIMESTAMPTZ);

CREATE OR REPLACE FUNCTION public.get_profit_breakdown(
  p_from TIMESTAMPTZ DEFAULT NULL,
  p_to   TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (
  booking_id          UUID,
  tvl_ref             TEXT,
  date_time           TIMESTAMPTZ,
  service_type        TEXT,
  client_name         TEXT,
  price               NUMERIC,
  tvl_commission      NUMERIC,
  supplier_commission NUMERIC,
  supplier_id         UUID,
  supplier_name       TEXT,
  payment_status      TEXT,
  status              TEXT
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
    COALESCE(b.tvl_commission, 0)::NUMERIC      AS tvl_commission,
    COALESCE(b.supplier_commission, 0)::NUMERIC AS supplier_commission,
    b.supplier_id,
    s.name                                       AS supplier_name,
    b.payment_status,
    b.status
  FROM public.bookings b
  LEFT JOIN public.clients   c ON c.id = b.client_id
  LEFT JOIN public.suppliers s ON s.id = b.supplier_id
  WHERE b.status <> 'Cancelled'
    AND (
          COALESCE(b.tvl_commission, 0)      > 0
       OR COALESCE(b.supplier_commission, 0) > 0
        )
    AND (p_from IS NULL OR b.date_time >= p_from)
    AND (p_to   IS NULL OR b.date_time <= p_to)
  ORDER BY b.date_time DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION public.get_profit_breakdown(TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_profit_breakdown(TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;

-- ============================================================
-- Done.
-- ============================================================
