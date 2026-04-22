-- ─────────────────────────────────────────────────────────────────────────────
-- migration-airport-transfer-extras.sql
-- Adds support for the new Airport Transfer pricing flow:
--   1. transfer_extras JSONB column on bookings — snapshot of selected
--      additional services (Meet & Greet tiers, etc.) so price stays
--      historically accurate even if catalogue prices change later.
--      Shape: [{ "id": "<product_uuid>", "name": "Meet & Greet Gold", "price": 75 }, ...]
--   2. updated_at column on vehicle_airport_pricing — the existing PUT
--      route writes this column on every upsert; without it the upsert
--      fails so admin price edits silently break.
--
-- Run in Supabase SQL editor.
-- Safe to re-run (uses IF NOT EXISTS guards).
-- ─────────────────────────────────────────────────────────────────────────────

-- 1) Bookings: snapshot of selected Airport Transfer add-ons
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS transfer_extras jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.bookings.transfer_extras IS
  'Array snapshot of Airport Transfer add-ons selected at booking time: [{id,name,price}]. Snapshot so historical totals stay correct.';

-- 2) Vehicle airport pricing: updated_at for upsert auditing
ALTER TABLE public.vehicle_airport_pricing
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Trigger to auto-bump updated_at on row updates (safe re-create)
CREATE OR REPLACE FUNCTION public.tg_vehicle_airport_pricing_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS vehicle_airport_pricing_touch ON public.vehicle_airport_pricing;
CREATE TRIGGER vehicle_airport_pricing_touch
  BEFORE UPDATE ON public.vehicle_airport_pricing
  FOR EACH ROW EXECUTE FUNCTION public.tg_vehicle_airport_pricing_touch();

-- Sanity check
DO $$ BEGIN
  RAISE NOTICE 'airport-transfer-extras migration complete';
END $$;
