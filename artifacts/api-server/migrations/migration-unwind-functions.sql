-- Run this once in your Supabase SQL Editor (Dashboard → SQL Editor)
-- Creates unwind_commission_settlement() and unwind_driver_payout() as
-- atomic Postgres functions so the "revert statuses + delete ledger row"
-- path cannot be interleaved with a concurrent re-settle.
--
-- Each function:
--   1. Locks the ledger row (SELECT ... FOR UPDATE NOWAIT) so two concurrent
--      callers cannot both proceed past this point for the same record.
--   2. Reverts commission_status / payout_status on the affected bookings
--      and booking_vehicles inside the SAME transaction.
--   3. Deletes the ledger row.
--
-- SECURITY DEFINER + explicit GRANT/REVOKE mean only the service_role
-- (used by the API server) can execute the functions; direct PostgREST /
-- anon / authenticated callers cannot invoke them.

-- ── unwind_commission_settlement ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION unwind_commission_settlement(p_settlement_id uuid)
RETURNS TABLE(
  reverted_bookings  int,
  reverted_vehicles  int,
  total_amount       numeric,
  driver_id          uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_booking_ids       uuid[];
  v_vehicle_ids       uuid[];
  v_total_amount      numeric;
  v_driver_id         uuid;
  v_reverted_bookings int := 0;
  v_reverted_vehicles int := 0;
BEGIN
  -- Lock the ledger row first. NOWAIT means a second concurrent unwind
  -- for the same id will immediately raise lock_not_available (55P03)
  -- rather than queuing silently behind the first caller.
  SELECT
    s.booking_ids,
    COALESCE(s.booking_vehicle_ids, ARRAY[]::uuid[]),
    s.total_amount,
    s.driver_id
  INTO
    v_booking_ids,
    v_vehicle_ids,
    v_total_amount,
    v_driver_id
  FROM commission_settlements s
  WHERE s.id = p_settlement_id
  FOR UPDATE NOWAIT;

  IF NOT FOUND THEN
    -- Surface as P0002 (no_data_found) so the route maps it to 404.
    RAISE EXCEPTION 'not_found: settlement % does not exist', p_settlement_id
      USING ERRCODE = 'P0002';
  END IF;

  -- Revert primary bookings: Settled → Outstanding.
  -- The WHERE commission_status = 'Settled' guard ensures we do not
  -- accidentally revert a booking that was re-settled concurrently under
  -- a different ledger row.
  IF array_length(v_booking_ids, 1) IS NOT NULL AND array_length(v_booking_ids, 1) > 0 THEN
    UPDATE bookings
    SET commission_status = 'Outstanding'
    WHERE id = ANY(v_booking_ids)
      AND commission_status = 'Settled';
    GET DIAGNOSTICS v_reverted_bookings = ROW_COUNT;
  END IF;

  -- Revert extra-vehicle legs: Settled → Outstanding.
  IF array_length(v_vehicle_ids, 1) IS NOT NULL AND array_length(v_vehicle_ids, 1) > 0 THEN
    UPDATE booking_vehicles
    SET commission_status = 'Outstanding'
    WHERE id = ANY(v_vehicle_ids)
      AND commission_status = 'Settled';
    GET DIAGNOSTICS v_reverted_vehicles = ROW_COUNT;
  END IF;

  -- Delete the ledger row atomically with the status reversals above.
  DELETE FROM commission_settlements WHERE id = p_settlement_id;

  RETURN QUERY
    SELECT v_reverted_bookings, v_reverted_vehicles, v_total_amount, v_driver_id;
END;
$$;

-- Restrict to service_role only; revoke from PUBLIC first.
REVOKE EXECUTE ON FUNCTION unwind_commission_settlement(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION unwind_commission_settlement(uuid) TO service_role;


-- ── unwind_driver_payout ──────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION unwind_driver_payout(p_payout_id uuid)
RETURNS TABLE(
  reverted_bookings  int,
  reverted_vehicles  int,
  total_amount       numeric,
  driver_id          uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_booking_ids       uuid[];
  v_vehicle_ids       uuid[];
  v_total_amount      numeric;
  v_driver_id         uuid;
  v_reverted_bookings int := 0;
  v_reverted_vehicles int := 0;
BEGIN
  -- Lock the payout row. Same NOWAIT rationale as unwind_commission_settlement.
  SELECT
    p.booking_ids,
    COALESCE(p.booking_vehicle_ids, ARRAY[]::uuid[]),
    p.total_amount,
    p.driver_id
  INTO
    v_booking_ids,
    v_vehicle_ids,
    v_total_amount,
    v_driver_id
  FROM driver_payouts p
  WHERE p.id = p_payout_id
  FOR UPDATE NOWAIT;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: payout % does not exist', p_payout_id
      USING ERRCODE = 'P0002';
  END IF;

  -- Revert primary bookings: Paid → Pending.
  IF array_length(v_booking_ids, 1) IS NOT NULL AND array_length(v_booking_ids, 1) > 0 THEN
    UPDATE bookings
    SET payout_status = 'Pending'
    WHERE id = ANY(v_booking_ids)
      AND payout_status = 'Paid';
    GET DIAGNOSTICS v_reverted_bookings = ROW_COUNT;
  END IF;

  -- Revert extra-vehicle legs: Paid → Pending.
  IF array_length(v_vehicle_ids, 1) IS NOT NULL AND array_length(v_vehicle_ids, 1) > 0 THEN
    UPDATE booking_vehicles
    SET payout_status = 'Pending'
    WHERE id = ANY(v_vehicle_ids)
      AND payout_status = 'Paid';
    GET DIAGNOSTICS v_reverted_vehicles = ROW_COUNT;
  END IF;

  -- Delete the payout ledger row atomically with the status reversals.
  DELETE FROM driver_payouts WHERE id = p_payout_id;

  RETURN QUERY
    SELECT v_reverted_bookings, v_reverted_vehicles, v_total_amount, v_driver_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION unwind_driver_payout(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION unwind_driver_payout(uuid) TO service_role;
