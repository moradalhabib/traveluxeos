-- ============================================================
-- Traveluxe OS — Tour alternate-vehicle pricing
-- Run in Supabase SQL Editor
-- ============================================================
-- Each tour has a STANDARD price (Mercedes V Class included).
-- Operators can offer alternate vehicles per tour with a price
-- uplift on top of the standard package price (e.g.
-- Range Rover Vogue = +£120). Stored as a JSONB array on the
-- product row to keep the catalogue self-contained.
--
-- Shape:  [ { "label": "Range Rover Vogue", "uplift": 120 }, ... ]
-- ============================================================

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS tour_alt_vehicles JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.products.tour_alt_vehicles IS
  'Tours only — array of { label: string, uplift: number } records. Standard package already includes Mercedes V Class; entries here are surcharges for alternate vehicles.';
