-- migration-remove-supplier-commission.sql
--
-- Drops the unused `commission_rate` column from `suppliers`.
-- Suppliers charge flat per-vehicle rates (already in `supplier_products`),
-- not a percentage commission. The column was causing a Supabase schema-cache
-- error that blocked saving supplier profiles AND supplier products.
--
-- Run BEFORE deploying the new code. Apply manually in Supabase → SQL editor.
--
-- Verify after:
--   SELECT column_name FROM information_schema.columns
--    WHERE table_schema='public' AND table_name='suppliers';
-- should NOT list commission_rate. Then save a supplier profile in the app —
-- it should succeed without a "schema cache" error.

ALTER TABLE public.suppliers DROP COLUMN IF EXISTS commission_rate;

-- Force PostgREST (Supabase) to refresh its in-memory schema cache.
NOTIFY pgrst, 'reload schema';
