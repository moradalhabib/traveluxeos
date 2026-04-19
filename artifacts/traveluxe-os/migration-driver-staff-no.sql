-- ─────────────────────────────────────────────────────────────────────────────
-- Driver staff number (TVL 01, TVL 02, …)
-- Adds a unique staff_no to every driver, auto-generated on insert when blank.
-- Backfills existing drivers in alphabetical order by name.
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Add column (nullable for now so we can backfill)
ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS staff_no TEXT;

-- 2. Backfill any existing drivers that are missing a staff_no
DO $$
DECLARE
  d RECORD;
  next_num INT;
BEGIN
  -- Find the highest existing TVL number so we don't collide
  SELECT COALESCE(MAX(NULLIF(regexp_replace(staff_no, '\D', '', 'g'), '')::INT), 0)
    INTO next_num
    FROM public.drivers
    WHERE staff_no ~ '^TVL\s*\d+$';

  FOR d IN
    SELECT id FROM public.drivers
    WHERE staff_no IS NULL OR staff_no = ''
    ORDER BY created_at, name
  LOOP
    next_num := next_num + 1;
    UPDATE public.drivers
       SET staff_no = 'TVL ' || lpad(next_num::TEXT, 2, '0')
     WHERE id = d.id;
  END LOOP;
END $$;

-- 3. Enforce uniqueness now that all rows are populated
CREATE UNIQUE INDEX IF NOT EXISTS drivers_staff_no_unique
  ON public.drivers (staff_no);

-- 4. Auto-assign on insert when not provided
CREATE OR REPLACE FUNCTION public.assign_driver_staff_no()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  next_num INT;
BEGIN
  IF NEW.staff_no IS NULL OR NEW.staff_no = '' THEN
    SELECT COALESCE(MAX(NULLIF(regexp_replace(staff_no, '\D', '', 'g'), '')::INT), 0) + 1
      INTO next_num
      FROM public.drivers
      WHERE staff_no ~ '^TVL\s*\d+$';
    NEW.staff_no := 'TVL ' || lpad(next_num::TEXT, 2, '0');
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_assign_driver_staff_no ON public.drivers;
CREATE TRIGGER trg_assign_driver_staff_no
  BEFORE INSERT ON public.drivers
  FOR EACH ROW
  EXECUTE FUNCTION public.assign_driver_staff_no();
