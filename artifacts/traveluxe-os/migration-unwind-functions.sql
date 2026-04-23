-- ─────────────────────────────────────────────────────────────────────────
-- Atomic unwind functions for commission settlements + driver payouts.
--
-- Background
--   commissions.ts ships an "unwind" path for both settlements and payouts
--   (admin / super_admin only). Previous JS implementation did three writes
--   sequentially:
--     1) flip every booking.commission_status from 'Settled' → 'Outstanding'
--     2) flip every booking_vehicles.commission_status the same way
--     3) DELETE the settlement / payout ledger row
--   A concurrent re-settle (or row-level RLS retry) between steps could
--   leave bookings tagged against TWO ledger rows, double-counting the
--   driver's commission. Same race exists for payouts with
--   `payout_status = 'Paid'`.
--
-- Fix
--   Wrap each unwind in a SECURITY DEFINER function so all three writes
--   commit in one transaction. EXECUTE is granted to service_role only —
--   the Express route admin-gates the caller before invoking the RPC,
--   so this is defence-in-depth.
--
-- Returns
--   A single row with reverted_bookings, reverted_vehicles, total_amount,
--   driver_id — used by the route to write a human audit-log summary.
--
-- Errors
--   Raises 'NOT_FOUND' (SQLSTATE P0002) when the ledger row doesn't exist
--   so the route can return 404 instead of a generic 500.
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.unwind_commission_settlement(p_settlement_id uuid)
returns table (
  reverted_bookings  integer,
  reverted_vehicles  integer,
  total_amount       numeric,
  driver_id          uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_driver_id uuid;
  v_total     numeric;
  v_bk_count  integer := 0;
  v_vh_count  integer := 0;
begin
  select cs.driver_id, coalesce(cs.total_amount, 0)
    into v_driver_id, v_total
    from commission_settlements cs
   where cs.id = p_settlement_id;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  -- Revert bookings tagged against this settlement.
  with upd as (
    update bookings
       set commission_status = 'Outstanding',
           commission_settlement_id = null,
           updated_at = now()
     where commission_settlement_id = p_settlement_id
    returning 1
  )
  select count(*) into v_bk_count from upd;

  -- Revert per-leg vehicle rows tagged against this settlement.
  with upd as (
    update booking_vehicles
       set commission_status = 'Outstanding',
           commission_settlement_id = null,
           updated_at = now()
     where commission_settlement_id = p_settlement_id
    returning 1
  )
  select count(*) into v_vh_count from upd;

  delete from commission_settlements where id = p_settlement_id;

  return query select v_bk_count, v_vh_count, v_total, v_driver_id;
end;
$$;

create or replace function public.unwind_driver_payout(p_payout_id uuid)
returns table (
  reverted_bookings  integer,
  reverted_vehicles  integer,
  total_amount       numeric,
  driver_id          uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_driver_id uuid;
  v_total     numeric;
  v_bk_count  integer := 0;
  v_vh_count  integer := 0;
begin
  select dp.driver_id, coalesce(dp.total_amount, 0)
    into v_driver_id, v_total
    from driver_payouts dp
   where dp.id = p_payout_id;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  -- Revert bookings tagged against this payout.
  with upd as (
    update bookings
       set payout_status = 'Pending',
           driver_payout_id = null,
           updated_at = now()
     where driver_payout_id = p_payout_id
    returning 1
  )
  select count(*) into v_bk_count from upd;

  -- Revert per-leg vehicle rows tagged against this payout.
  with upd as (
    update booking_vehicles
       set payout_status = 'Pending',
           driver_payout_id = null,
           updated_at = now()
     where driver_payout_id = p_payout_id
    returning 1
  )
  select count(*) into v_vh_count from upd;

  delete from driver_payouts where id = p_payout_id;

  return query select v_bk_count, v_vh_count, v_total, v_driver_id;
end;
$$;

-- Lock down: only service_role can invoke. The Express layer already
-- admin-gates the caller; this is defence-in-depth so a leaked anon token
-- cannot reverse a settled commission ledger row.
revoke execute on function public.unwind_commission_settlement(uuid) from public, anon, authenticated;
revoke execute on function public.unwind_driver_payout(uuid)         from public, anon, authenticated;
grant  execute on function public.unwind_commission_settlement(uuid) to service_role;
grant  execute on function public.unwind_driver_payout(uuid)         to service_role;
