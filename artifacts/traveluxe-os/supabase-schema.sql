-- Traveluxe OS — Supabase Schema
-- Run this in Supabase SQL editor to set up all tables

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users table (mirrors Supabase auth.users with role metadata)
CREATE TABLE IF NOT EXISTS public.users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'operator' CHECK (role IN ('admin', 'operator')),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Clients table
CREATE TABLE IF NOT EXISTS public.clients (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  whatsapp TEXT NOT NULL UNIQUE,
  email TEXT,
  nationality TEXT,
  language_preference TEXT DEFAULT 'English' CHECK (language_preference IN ('English', 'Arabic', 'Other')),
  vip_tier TEXT NOT NULL DEFAULT 'Standard' CHECK (vip_tier IN ('Standard', 'VIP', 'VVIP')),
  notes TEXT,
  inactive BOOLEAN NOT NULL DEFAULT false,
  merged_into UUID REFERENCES public.clients(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES public.users(id)
);

-- Drivers table
CREATE TABLE IF NOT EXISTS public.drivers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  whatsapp TEXT NOT NULL,
  vehicle_type TEXT NOT NULL CHECK (vehicle_type IN ('Saloon', 'Estate', 'MPV', 'Minibus', 'Luxury')),
  vehicle_model TEXT,
  plate TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Inactive')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Quotes table
CREATE TABLE IF NOT EXISTS public.quotes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID REFERENCES public.clients(id),
  client_name TEXT,
  service_type TEXT NOT NULL CHECK (service_type IN ('Airport Transfer', 'Tour')),
  direction TEXT CHECK (direction IN ('Arrival', 'Departure')),
  pickup TEXT,
  dropoff TEXT,
  destination TEXT,
  date_time TIMESTAMPTZ,
  passengers INTEGER DEFAULT 1,
  vehicle_type TEXT,
  duration NUMERIC,
  price NUMERIC NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Sent', 'Accepted', 'Declined', 'Expired')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES public.users(id)
);

-- Booking reference counter
CREATE SEQUENCE IF NOT EXISTS booking_ref_seq START 1;
CREATE SEQUENCE IF NOT EXISTS invoice_ref_seq START 1;

-- Bookings table
CREATE TABLE IF NOT EXISTS public.bookings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tvl_ref TEXT NOT NULL UNIQUE DEFAULT 'TVL-' || LPAD(nextval('booking_ref_seq')::TEXT, 4, '0'),
  client_id UUID REFERENCES public.clients(id),
  quote_id UUID REFERENCES public.quotes(id),
  service_type TEXT NOT NULL CHECK (service_type IN ('Airport Transfer', 'Tour')),
  direction TEXT CHECK (direction IN ('Arrival', 'Departure')),
  pickup TEXT,
  dropoff TEXT,
  destination TEXT,
  flight_number TEXT,
  date_time TIMESTAMPTZ,
  passengers INTEGER DEFAULT 1,
  luggage INTEGER DEFAULT 0,
  vehicle_type TEXT,
  nameboard TEXT,
  special_requests TEXT,
  additional_charges NUMERIC DEFAULT 0,
  price NUMERIC NOT NULL DEFAULT 0,
  tvl_commission NUMERIC DEFAULT 0,
  driver_receives NUMERIC GENERATED ALWAYS AS (price + COALESCE(additional_charges, 0) - COALESCE(tvl_commission, 0)) STORED,
  commission_type TEXT CHECK (commission_type IN ('Driver owes TVL', 'TVL owes driver')),
  payment_status TEXT DEFAULT 'Unpaid' CHECK (payment_status IN ('Paid', 'Unpaid', 'Partial')),
  payment_method TEXT CHECK (payment_method IN ('Cash', 'Bank Transfer', 'Card')),
  commission_status TEXT DEFAULT 'Outstanding' CHECK (commission_status IN ('Outstanding', 'Settled')),
  payout_status TEXT DEFAULT 'Pending' CHECK (payout_status IN ('Pending', 'Paid')),
  source TEXT CHECK (source IN ('WhatsApp', 'Snapchat', 'Referral', 'Returning Client', 'Other')),
  status TEXT NOT NULL DEFAULT 'Confirmed' CHECK (status IN ('Pending', 'Confirmed', 'Active', 'Completed', 'Cancelled', 'Quote')),
  operator_id UUID REFERENCES public.users(id),
  driver_id UUID REFERENCES public.drivers(id),
  return_booking_id UUID REFERENCES public.bookings(id),
  is_amended BOOLEAN DEFAULT false,
  notes TEXT,
  cancellation_reason TEXT,
  cancellation_fee NUMERIC DEFAULT 0,
  duration NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES public.users(id)
);

-- Driver ratings
CREATE TABLE IF NOT EXISTS public.driver_ratings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  driver_id UUID NOT NULL REFERENCES public.drivers(id),
  booking_id UUID NOT NULL REFERENCES public.bookings(id),
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  note TEXT,
  rated_by UUID REFERENCES public.users(id),
  rated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Commission settlements (cash jobs — driver pays TVL)
CREATE TABLE IF NOT EXISTS public.commission_settlements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  driver_id UUID NOT NULL REFERENCES public.drivers(id),
  week_start DATE NOT NULL,
  week_end DATE NOT NULL,
  total_amount NUMERIC NOT NULL DEFAULT 0,
  booking_ids UUID[] NOT NULL DEFAULT '{}',
  settled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  settled_by UUID REFERENCES public.users(id),
  notes TEXT
);

-- Driver payouts (bank transfer jobs — TVL pays driver)
CREATE TABLE IF NOT EXISTS public.driver_payouts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  driver_id UUID NOT NULL REFERENCES public.drivers(id),
  week_start DATE NOT NULL,
  week_end DATE NOT NULL,
  total_amount NUMERIC NOT NULL DEFAULT 0,
  booking_ids UUID[] NOT NULL DEFAULT '{}',
  paid_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_by UUID REFERENCES public.users(id),
  notes TEXT
);

-- Invoices
CREATE TABLE IF NOT EXISTS public.invoices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  booking_id UUID NOT NULL UNIQUE REFERENCES public.bookings(id),
  invoice_number TEXT NOT NULL UNIQUE DEFAULT 'INV-' || LPAD(nextval('invoice_ref_seq')::TEXT, 4, '0'),
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  generated_by UUID REFERENCES public.users(id),
  status TEXT DEFAULT 'Generated' CHECK (status IN ('Generated', 'Sent'))
);

-- Flight status cache
CREATE TABLE IF NOT EXISTS public.flight_status_cache (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  flight_number TEXT NOT NULL,
  date DATE NOT NULL,
  status TEXT,
  origin TEXT,
  destination TEXT,
  scheduled_time TIMESTAMPTZ,
  estimated_time TIMESTAMPTZ,
  delay_minutes INTEGER DEFAULT 0,
  terminal TEXT,
  last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(flight_number, date)
);

-- Messages
CREATE TABLE IF NOT EXISTS public.messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  channel TEXT,
  sender_id UUID REFERENCES public.users(id),
  recipient_id UUID REFERENCES public.users(id),
  content TEXT NOT NULL,
  read BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Tasks
CREATE TABLE IF NOT EXISTS public.tasks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title TEXT NOT NULL,
  assigned_to UUID REFERENCES public.users(id),
  due_date DATE,
  priority TEXT DEFAULT 'Medium' CHECK (priority IN ('Low', 'Medium', 'Urgent')),
  completed BOOLEAN DEFAULT false,
  created_by UUID REFERENCES public.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Audit log
CREATE TABLE IF NOT EXISTS public.audit_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  operator_id UUID REFERENCES public.users(id),
  detail TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_bookings_date_time ON public.bookings(date_time);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON public.bookings(status);
CREATE INDEX IF NOT EXISTS idx_bookings_client_id ON public.bookings(client_id);
CREATE INDEX IF NOT EXISTS idx_bookings_driver_id ON public.bookings(driver_id);
CREATE INDEX IF NOT EXISTS idx_bookings_service_type ON public.bookings(service_type);
CREATE INDEX IF NOT EXISTS idx_clients_whatsapp ON public.clients(whatsapp);
CREATE INDEX IF NOT EXISTS idx_clients_name ON public.clients(name);
CREATE INDEX IF NOT EXISTS idx_messages_channel ON public.messages(channel);
CREATE INDEX IF NOT EXISTS idx_messages_sender ON public.messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_flight_status_cache_flight ON public.flight_status_cache(flight_number, date);

-- Enable Row Level Security
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.drivers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commission_settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_payouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.flight_status_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

-- Helper function to get user role
CREATE OR REPLACE FUNCTION public.get_user_role(user_id UUID)
RETURNS TEXT AS $$
  SELECT role FROM public.users WHERE id = user_id;
$$ LANGUAGE SQL SECURITY DEFINER;

-- RLS Policies — All authenticated users can access operational tables
-- Users table: users can see themselves; admins see all
CREATE POLICY "Users can view own profile" ON public.users
  FOR SELECT USING (auth.uid() = id OR public.get_user_role(auth.uid()) = 'admin');

CREATE POLICY "Admins can manage users" ON public.users
  FOR ALL USING (public.get_user_role(auth.uid()) = 'admin');

-- Clients: all authenticated users can read/write
CREATE POLICY "Authenticated users can manage clients" ON public.clients
  FOR ALL USING (auth.uid() IS NOT NULL);

-- Drivers: all authenticated users can read/write
CREATE POLICY "Authenticated users can manage drivers" ON public.drivers
  FOR ALL USING (auth.uid() IS NOT NULL);

-- Quotes: all authenticated users
CREATE POLICY "Authenticated users can manage quotes" ON public.quotes
  FOR ALL USING (auth.uid() IS NOT NULL);

-- Bookings: all authenticated users
CREATE POLICY "Authenticated users can manage bookings" ON public.bookings
  FOR ALL USING (auth.uid() IS NOT NULL);

-- Driver ratings: all authenticated users
CREATE POLICY "Authenticated users can manage ratings" ON public.driver_ratings
  FOR ALL USING (auth.uid() IS NOT NULL);

-- Commission settlements: admins only for write, all for read
CREATE POLICY "Authenticated users can view settlements" ON public.commission_settlements
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins can manage settlements" ON public.commission_settlements
  FOR INSERT WITH CHECK (public.get_user_role(auth.uid()) = 'admin');

-- Driver payouts: admins only for write, all for read
CREATE POLICY "Authenticated users can view payouts" ON public.driver_payouts
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins can manage payouts" ON public.driver_payouts
  FOR INSERT WITH CHECK (public.get_user_role(auth.uid()) = 'admin');

-- Invoices: all authenticated users
CREATE POLICY "Authenticated users can manage invoices" ON public.invoices
  FOR ALL USING (auth.uid() IS NOT NULL);

-- Flight status cache: all authenticated users
CREATE POLICY "Authenticated users can manage flight status" ON public.flight_status_cache
  FOR ALL USING (auth.uid() IS NOT NULL);

-- Messages: users see their own messages or group channels
CREATE POLICY "Users can view their messages" ON public.messages
  FOR SELECT USING (
    auth.uid() IS NOT NULL AND (
      channel IS NOT NULL OR
      sender_id = auth.uid() OR
      recipient_id = auth.uid()
    )
  );

CREATE POLICY "Users can send messages" ON public.messages
  FOR INSERT WITH CHECK (auth.uid() = sender_id);

-- Tasks: all authenticated users
CREATE POLICY "Authenticated users can manage tasks" ON public.tasks
  FOR ALL USING (auth.uid() IS NOT NULL);

-- Audit log: admins read only
CREATE POLICY "Admins can view audit log" ON public.audit_log
  FOR SELECT USING (public.get_user_role(auth.uid()) = 'admin');

CREATE POLICY "Authenticated users can write audit log" ON public.audit_log
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- Enable realtime on key tables
-- Run in Supabase dashboard or via SQL:
-- ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
-- ALTER PUBLICATION supabase_realtime ADD TABLE public.bookings;
-- ALTER PUBLICATION supabase_realtime ADD TABLE public.flight_status_cache;

-- Trigger to update bookings.updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER bookings_updated_at
  BEFORE UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Trigger to auto-set commission_type based on payment_method
CREATE OR REPLACE FUNCTION set_commission_type()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.payment_method = 'Cash' THEN
    NEW.commission_type = 'Driver owes TVL';
  ELSIF NEW.payment_method = 'Bank Transfer' THEN
    NEW.commission_type = 'TVL owes driver';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER bookings_commission_type
  BEFORE INSERT OR UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION set_commission_type();

-- Auto-flag clients inactive after 12 months (manual trigger for now)
-- Operators can also manually flag clients as inactive

-- Function to handle user creation in public.users on auth.users creation
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.users (id, name, email, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'role', 'operator')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
