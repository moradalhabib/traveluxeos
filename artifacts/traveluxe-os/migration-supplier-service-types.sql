-- ─────────────────────────────────────────────────────────────────────────────
-- migration-supplier-service-types.sql
--
-- Suppliers used to have a single `category` (e.g. "Car Rental"). In reality
-- many suppliers cover multiple service types — RMS Europe Cars does both
-- Car Rental AND Airport Transfer. This migration introduces:
--
--   service_types         text[]   — every type this supplier covers
--   primary_service_type  text     — the headline type used for grouping
--                                    (commissions, finance, job sheets,
--                                    invoices)
--
-- The legacy `category` column is KEPT and kept in sync with
-- `primary_service_type` via a trigger so any code path that still reads
-- `category` continues to work safely until it is migrated.
--
-- Apply: paste into Supabase SQL editor and run.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Add the new columns. Both default to safe empty/null so the migration
--    is idempotent and re-runnable.
ALTER TABLE suppliers
  ADD COLUMN IF NOT EXISTS service_types        text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS primary_service_type text;

-- 2. Backfill: any supplier with a single category gets its array seeded
--    from that value, and primary_service_type set to the same value.
--    Skip rows that have already been migrated (service_types non-empty).
UPDATE suppliers
   SET service_types        = ARRAY[category],
       primary_service_type = category
 WHERE category IS NOT NULL
   AND (service_types IS NULL OR cardinality(service_types) = 0);

-- 3. Special case: RMS Europe Cars is the canonical multi-service supplier.
--    Match by name (case-insensitive trim) so the row gets the correct
--    multi-type setup regardless of stored capitalisation.
UPDATE suppliers
   SET service_types        = ARRAY['Car Rental','Airport Transfer'],
       primary_service_type = 'Car Rental'
 WHERE lower(trim(name)) IN ('rms europe cars','rms europe', 'rms');

-- 4. GIN index for fast ANY-match filtering by booking service type
--    (the supplier dropdown on the booking forms uses this).
CREATE INDEX IF NOT EXISTS idx_suppliers_service_types
  ON suppliers USING gin (service_types);

-- 5. Safety trigger: keep the legacy `category` column synced to
--    `primary_service_type` on every insert/update. This means anything
--    that still reads `suppliers.category` (UI surfaces not yet migrated,
--    older queries, ad-hoc SQL) continues to see a sensible value.
CREATE OR REPLACE FUNCTION sync_supplier_category_from_primary()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- If primary_service_type was set, mirror it to category.
  IF NEW.primary_service_type IS NOT NULL
     AND NEW.primary_service_type <> '' THEN
    NEW.category := NEW.primary_service_type;
  -- Conversely, if only category was provided (legacy write path), seed
  -- the new fields from it so the row is never half-migrated.
  ELSIF NEW.category IS NOT NULL AND NEW.category <> '' THEN
    NEW.primary_service_type := NEW.category;
    IF NEW.service_types IS NULL OR cardinality(NEW.service_types) = 0 THEN
      NEW.service_types := ARRAY[NEW.category];
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_supplier_category ON suppliers;
CREATE TRIGGER trg_sync_supplier_category
  BEFORE INSERT OR UPDATE ON suppliers
  FOR EACH ROW
  EXECUTE FUNCTION sync_supplier_category_from_primary();

-- 6. Sanity check — show the migrated rows. Comment out if running silently.
-- SELECT id, name, category, primary_service_type, service_types
--   FROM suppliers
--  ORDER BY name;
