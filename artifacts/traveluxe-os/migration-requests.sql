-- ─────────────────────────────────────────────────────────────────────
-- SLICE 2: Wipe Quotes entirely → introduce Requests
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────

-- 1. Drop the FK + column from bookings (quote_id is going away)
ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_quote_id_fkey;
ALTER TABLE public.bookings DROP COLUMN IF EXISTS quote_id;

-- 2. Drop the quotes table entirely (and any dependents)
DROP TABLE IF EXISTS public.quotes CASCADE;

-- 3. Create the new requests table
CREATE TABLE IF NOT EXISTS public.requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  client_name TEXT,
  service_type TEXT NOT NULL CHECK (service_type IN (
    'Airport Transfer','Tour','Car Rental','Apartment','Hotel','Other'
  )),
  priority TEXT NOT NULL DEFAULT 'Medium' CHECK (priority IN (
    'Low','Medium','High','Urgent'
  )),
  requested_date_time TIMESTAMPTZ,
  follow_up_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'New' CHECK (status IN (
    'New','Following Up','Ready to Book','Converted','Declined','Expired'
  )),
  notes TEXT,
  estimated_price NUMERIC(10,2),
  converted_booking_id UUID REFERENCES public.bookings(id) ON DELETE SET NULL,
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_requests_follow_up_date ON public.requests(follow_up_date);
CREATE INDEX IF NOT EXISTS idx_requests_status ON public.requests(status);
CREATE INDEX IF NOT EXISTS idx_requests_client_id ON public.requests(client_id);
CREATE INDEX IF NOT EXISTS idx_requests_priority ON public.requests(priority);

-- 4. updated_at trigger
CREATE OR REPLACE FUNCTION public.touch_requests_updated_at()
RETURNS TRIGGER AS $req$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$req$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_requests_touch ON public.requests;
CREATE TRIGGER trg_requests_touch
BEFORE UPDATE ON public.requests
FOR EACH ROW EXECUTE FUNCTION public.touch_requests_updated_at();

-- 5. RLS — staff (operator/admin/super_admin) can read + write all requests
ALTER TABLE public.requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS requests_staff_select ON public.requests;
CREATE POLICY requests_staff_select ON public.requests
  FOR SELECT USING (
    public.get_user_role(auth.uid()) IN ('operator','admin','super_admin')
  );

DROP POLICY IF EXISTS requests_staff_insert ON public.requests;
CREATE POLICY requests_staff_insert ON public.requests
  FOR INSERT WITH CHECK (
    public.get_user_role(auth.uid()) IN ('operator','admin','super_admin')
  );

DROP POLICY IF EXISTS requests_staff_update ON public.requests;
CREATE POLICY requests_staff_update ON public.requests
  FOR UPDATE USING (
    public.get_user_role(auth.uid()) IN ('operator','admin','super_admin')
  );

DROP POLICY IF EXISTS requests_staff_delete ON public.requests;
CREATE POLICY requests_staff_delete ON public.requests
  FOR DELETE USING (
    public.get_user_role(auth.uid()) IN ('admin','super_admin')
  );

-- Verify
SELECT 'requests' AS table_name,
       (SELECT COUNT(*) FROM public.requests) AS row_count;
