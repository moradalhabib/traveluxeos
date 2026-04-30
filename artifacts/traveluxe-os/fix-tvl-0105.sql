-- Data fix for TVL-0105
-- ----------------------------------------------------------------------------
-- Background:
--   This Airport Transfer was originally raised against an internal TVL
--   driver record by mistake. The job is actually being delivered by
--   RMS Europe Cars (third-party supplier provides the vehicle and
--   driver), and the supplier confirmed the booking on 30 April 2026 at
--   18:44 London time (BST = UTC+1, so 17:44 UTC).
--
-- What this script does:
--   1) Resolves the supplier UUID for "RMS Europe Cars" by name (case-
--      insensitive). Fails fast if the supplier row is missing — we do
--      not want to silently leave the booking with a NULL supplier_id.
--   2) Updates TVL-0105:
--        - clears driver_id (no TVL driver on this job)
--        - sets supplier_id to RMS Europe Cars
--        - sets as_directed_supplier_driver = TRUE so the DB recalc
--          trigger rolls the full cost into the supplier KPI and the
--          frontend supplier-driven detection rule fires immediately
--          (supplier set + no driver + vehicle service).
--        - records the supplier confirmation as
--          driver_acceptance_status = 'Driver Confirmed' (we re-use the
--          existing column with the new "Supplier Confirmation" labels)
--          and stamps driver_accepted_at = 2026-04-30 17:44:00 UTC.
--   3) Writes an audit_log row so the change is traceable from the
--      booking history feed.
--
-- Safe to run multiple times — the UPDATE is idempotent and the audit
-- insert is a single deliberate row.
-- ----------------------------------------------------------------------------

BEGIN;

DO $$
DECLARE
  v_supplier_id uuid;
  v_booking_id  uuid;
BEGIN
  SELECT id INTO v_supplier_id
  FROM suppliers
  WHERE lower(name) = lower('RMS Europe Cars')
  LIMIT 1;

  IF v_supplier_id IS NULL THEN
    RAISE EXCEPTION
      'Supplier "RMS Europe Cars" not found. Aborting fix for TVL-0105.';
  END IF;

  SELECT id INTO v_booking_id
  FROM bookings
  WHERE tvl_ref = 'TVL-0105'
  LIMIT 1;

  IF v_booking_id IS NULL THEN
    RAISE EXCEPTION 'Booking TVL-0105 not found. Aborting.';
  END IF;

  UPDATE bookings
  SET
    driver_id                   = NULL,
    supplier_id                 = v_supplier_id,
    as_directed_supplier_driver = TRUE,
    driver_acceptance_status    = 'Driver Confirmed',
    driver_accepted_at          = TIMESTAMPTZ '2026-04-30 17:44:00+00',
    is_amended                  = TRUE,
    updated_at                  = NOW()
  WHERE id = v_booking_id;

  INSERT INTO audit_log (action, entity_type, entity_id, operator_id, detail)
  VALUES (
    'booking.supplier_driven_fix',
    'booking',
    v_booking_id,
    NULL,
    'TVL-0105 reassigned from internal TVL driver to supplier RMS Europe Cars '
      || '(supplier-driven). Supplier confirmation recorded for 30 Apr 2026 18:44 BST.'
  );
END $$;

COMMIT;
