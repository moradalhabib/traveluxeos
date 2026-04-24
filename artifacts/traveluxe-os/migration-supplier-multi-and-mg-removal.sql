-- ============================================================================
-- Multi-supplier-products + remove first-party Meet & Greet category
-- April 2026. Airport Transfer only.
-- ----------------------------------------------------------------------------
-- 1. Drop the legacy single-product columns on bookings.
-- 2. Add `supplier_items` jsonb (array of { product_id, qty, name, rate }).
--    Snapshot fields are kept on the row so historical bookings display
--    correctly even if the supplier_products catalogue is later edited.
-- 3. Delete first-party Meet & Greet products from the products catalogue;
--    the same services are now ONLY booked via the Third-Party Supplier
--    section (supplier_products table). Safe to delete because no bookings
--    have been made yet.
-- ============================================================================

alter table public.bookings
  drop column if exists meet_greet_product_id,
  drop column if exists supplier_product_id;

alter table public.bookings
  add column if not exists supplier_items jsonb not null default '[]'::jsonb;

-- Comment for psql introspection.
comment on column public.bookings.supplier_items is
  'Array of { product_id uuid, qty int, name text, daily_rate numeric, hourly_rate numeric } picked from supplier_products. Snapshot — see migration-supplier-multi-and-mg-removal.sql';

delete from public.products where category = 'Meet & Greet';
