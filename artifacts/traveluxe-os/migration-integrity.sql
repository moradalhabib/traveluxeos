-- ============================================================
-- Migration: Data Integrity & Commission Completeness
-- Run in Supabase SQL Editor AFTER all previous migrations
-- ============================================================

-- 1. Expand service_type CHECK to all 5 canonical types
ALTER TABLE public.bookings
  DROP CONSTRAINT IF EXISTS bookings_service_type_check;
ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_service_type_check
    CHECK (service_type IN ('Airport Transfer', 'Tour', 'Tours', 'As Directed', 'Apartment', 'Hotel'));

-- Same for quotes table
ALTER TABLE public.quotes
  DROP CONSTRAINT IF EXISTS quotes_service_type_check;
ALTER TABLE public.quotes
  ADD CONSTRAINT quotes_service_type_check
    CHECK (service_type IN ('Airport Transfer', 'Tour', 'Tours', 'As Directed', 'Apartment', 'Hotel'));

-- 2. Expand user role CHECK to include all roles
ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE public.users
  ADD CONSTRAINT users_role_check
    CHECK (role IN ('admin', 'operator', 'super_admin', 'residence_manager'));

-- 3. Expand invoice status CHECK to include full workflow
ALTER TABLE public.invoices
  DROP CONSTRAINT IF EXISTS invoices_status_check;
ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_status_check
    CHECK (status IN ('Generated', 'Sent', 'Paid', 'Overdue'));

-- 4. Add paid_at / overdue_at timestamps to invoices for audit trail
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS overdue_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS status_changed_by UUID REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS status_changed_at TIMESTAMPTZ;

-- 5. Ensure commission_amount and commission_notes exist on bookings
--    (added by migration-hotel.sql but safe to re-run)
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS commission_amount DECIMAL(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS commission_notes TEXT;

-- 6. Add commission_collected column for hotel/apartment arrangement fees
--    Tracks whether TVL has received the arrangement fee from the provider
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS arrangement_fee_status TEXT
    DEFAULT 'Outstanding'
    CHECK (arrangement_fee_status IN ('Outstanding', 'Collected'));

-- 7. Performance indexes for commission queries
CREATE INDEX IF NOT EXISTS idx_bookings_commission_status
  ON public.bookings(commission_status)
  WHERE commission_status = 'Outstanding';

CREATE INDEX IF NOT EXISTS idx_bookings_payout_status
  ON public.bookings(payout_status)
  WHERE payout_status = 'Pending';

CREATE INDEX IF NOT EXISTS idx_bookings_arrangement_fee
  ON public.bookings(arrangement_fee_status, service_type)
  WHERE commission_amount > 0;

CREATE INDEX IF NOT EXISTS idx_bookings_service_type
  ON public.bookings(service_type);

CREATE INDEX IF NOT EXISTS idx_bookings_payment_method
  ON public.bookings(payment_method);

CREATE INDEX IF NOT EXISTS idx_invoices_status
  ON public.invoices(status);

CREATE INDEX IF NOT EXISTS idx_audit_log_entity
  ON public.audit_log(entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_audit_log_created
  ON public.audit_log(created_at DESC);

-- 8. Normalise existing bookings: backfill arrangement_fee_status
--    Any Hotel/Apartment booking with commission_amount > 0 defaults to Outstanding
UPDATE public.bookings
SET arrangement_fee_status = 'Outstanding'
WHERE service_type IN ('Hotel', 'Apartment')
  AND commission_amount > 0
  AND arrangement_fee_status IS NULL;

-- 9. Ensure updated_at exists and trigger is in place
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

CREATE OR REPLACE FUNCTION update_bookings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_bookings_updated_at ON public.bookings;
CREATE TRIGGER trg_bookings_updated_at
  BEFORE UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION update_bookings_updated_at();

-- 10. Audit log trigger on invoices (record every status change)
CREATE OR REPLACE FUNCTION log_invoice_status_change()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO public.audit_log (action, entity_type, entity_id, detail, created_at)
    VALUES (
      'invoice_status_changed',
      'invoice',
      NEW.id::TEXT,
      'Status changed from ' || COALESCE(OLD.status, 'NULL') || ' to ' || NEW.status,
      NOW()
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_invoice_audit ON public.invoices;
CREATE TRIGGER trg_invoice_audit
  AFTER UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION log_invoice_status_change();

-- ============================================================
-- Summary of what this migration fixes:
-- - service_type CHECK now accepts all 5 canonical types
-- - role CHECK now accepts super_admin
-- - invoice status CHECK now accepts Paid + Overdue
-- - Hotel/Apartment arrangement fees tracked via arrangement_fee_status
-- - Indexes added for all commission, payout and invoice queries
-- - Invoice status changes auto-logged via DB trigger
-- ============================================================
