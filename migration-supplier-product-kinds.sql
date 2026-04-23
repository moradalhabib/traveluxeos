-- Expand supplier_products.kind to cover airport-internal services.
-- Originally restricted to ('Car','Driver','Other'), which prevented
-- Airport Transfer suppliers (e.g. LHR VIP Services) from listing what
-- they actually sell — Meet & Greet, Fast-Track, Lounge access, Porter.
--
-- Apply manually in the Supabase SQL editor (Traveluxe uses raw SQL,
-- no migration runner). Idempotent — safe to re-run.

-- Drop the old CHECK constraint by name. Postgres auto-names CHECK
-- constraints as <table>_<column>_check unless overridden. The name was
-- set implicitly when the table was created in migration-build4-FULL.sql.
alter table public.supplier_products
  drop constraint if exists supplier_products_kind_check;

-- Add the expanded constraint. Existing 'Car'/'Driver'/'Other' rows
-- remain valid; new airport service kinds are now accepted.
alter table public.supplier_products
  add constraint supplier_products_kind_check
  check (kind in (
    'Car',
    'Driver',
    'Meet & Greet',
    'Fast-Track',
    'Lounge',
    'Porter',
    'Other'
  ));
