-- migration-booking-vehicles.sql
--
-- Multi-vehicle bookings (Option B): adds a child table that lets a single
-- booking carry N additional cars (each with its own driver, vehicle,
-- client share, supplier cost, and commission).
--
-- The PRIMARY car for the booking still lives on bookings.driver_id /
-- bookings.tvl_commission / bookings.driver_receives. The new
-- booking_vehicles rows are ADDITIONAL legs (2nd car, 3rd car, etc.) so
-- existing single-car bookings continue to work without any backfill.
--
-- Run this in the Supabase SQL editor (Production project).

CREATE TABLE IF NOT EXISTS public.booking_vehicles (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id           UUID NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  driver_id            UUID REFERENCES public.drivers(id)  ON DELETE SET NULL,
  vehicle_type         TEXT,
  vehicle_product_id   UUID REFERENCES public.products(id) ON DELETE SET NULL,
  client_share         NUMERIC(10,2) NOT NULL DEFAULT 0,
  cost_to_company      NUMERIC(10,2) NOT NULL DEFAULT 0,
  tvl_commission       NUMERIC(10,2) NOT NULL DEFAULT 0,
  driver_receives      NUMERIC(10,2) NOT NULL DEFAULT 0,
  commission_status    TEXT NOT NULL DEFAULT 'Outstanding'
                         CHECK (commission_status IN ('Outstanding','Settled')),
  payout_status        TEXT NOT NULL DEFAULT 'Pending'
                         CHECK (payout_status IN ('Pending','Paid')),
  notes                TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS booking_vehicles_booking_idx
  ON public.booking_vehicles(booking_id);

CREATE INDEX IF NOT EXISTS booking_vehicles_driver_idx
  ON public.booking_vehicles(driver_id, commission_status, payout_status);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.booking_vehicles_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS booking_vehicles_set_updated_at ON public.booking_vehicles;
CREATE TRIGGER booking_vehicles_set_updated_at
BEFORE UPDATE ON public.booking_vehicles
FOR EACH ROW EXECUTE FUNCTION public.booking_vehicles_touch_updated_at();

-- RLS
ALTER TABLE public.booking_vehicles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Booking vehicles select" ON public.booking_vehicles;
CREATE POLICY "Booking vehicles select" ON public.booking_vehicles
  FOR SELECT USING (public.is_active_operator(auth.uid()) = true);

DROP POLICY IF EXISTS "Booking vehicles insert" ON public.booking_vehicles;
CREATE POLICY "Booking vehicles insert" ON public.booking_vehicles
  FOR INSERT WITH CHECK (public.can_write(auth.uid()) = true);

DROP POLICY IF EXISTS "Booking vehicles update" ON public.booking_vehicles;
CREATE POLICY "Booking vehicles update" ON public.booking_vehicles
  FOR UPDATE USING (public.can_write(auth.uid()) = true);

DROP POLICY IF EXISTS "Booking vehicles delete" ON public.booking_vehicles;
CREATE POLICY "Booking vehicles delete" ON public.booking_vehicles
  FOR DELETE USING (public.can_write(auth.uid()) = true);

-- Add booking_vehicle_ids columns to the settlement + payout ledgers so
-- we can record which extra-vehicle legs were included in each settlement.
ALTER TABLE public.commission_settlements
  ADD COLUMN IF NOT EXISTS booking_vehicle_ids UUID[] NOT NULL DEFAULT ARRAY[]::UUID[];

ALTER TABLE public.driver_payouts
  ADD COLUMN IF NOT EXISTS booking_vehicle_ids UUID[] NOT NULL DEFAULT ARRAY[]::UUID[];

-- Verification
SELECT 'booking_vehicles table ready' AS status,
       (SELECT count(*) FROM public.booking_vehicles) AS row_count;
