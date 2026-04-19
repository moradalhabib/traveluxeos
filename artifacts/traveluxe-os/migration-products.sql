-- migration-products.sql
-- Run this in your Supabase SQL Editor

-- ── Products catalogue ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  category text NOT NULL DEFAULT 'Add-on',
  description text,
  unit_price numeric(10,2) NOT NULL DEFAULT 0,
  active boolean DEFAULT true,
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "products_read" ON products FOR SELECT TO authenticated USING (true);
CREATE POLICY "products_write" ON products FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ── Booking order lines ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS booking_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  name text NOT NULL,
  unit_price numeric(10,2) NOT NULL DEFAULT 0,
  quantity integer NOT NULL DEFAULT 1,
  total numeric(10,2) GENERATED ALWAYS AS (unit_price * quantity) STORED,
  notes text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE booking_products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "booking_products_read" ON booking_products FOR SELECT TO authenticated USING (true);
CREATE POLICY "booking_products_write" ON booking_products FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_booking_products_booking ON booking_products(booking_id);

-- ── Seed: Vehicles ──────────────────────────────────────────────────────────
INSERT INTO products (name, category, description, unit_price, sort_order) VALUES
  ('Mercedes Benz E Class', 'Vehicle', 'Business class executive saloon — seats 3 pax + luggage', 120.00, 10),
  ('Mercedes Benz S Class', 'Vehicle', 'First class flagship saloon — fully loaded', 180.00, 20),
  ('Mercedes Benz V Class', 'Vehicle', 'Luxury MPV — seats up to 7 pax', 150.00, 30),
  ('Range Rover Sport', 'Vehicle', 'Premium SUV — comfort and presence', 200.00, 40),
  ('Range Rover Vogue', 'Vehicle', 'Flagship SUV — ultimate luxury', 220.00, 50),
  ('BMW 7 Series', 'Vehicle', 'Executive luxury saloon', 170.00, 60),
  ('Audi A8', 'Vehicle', 'Executive saloon — refined and discreet', 160.00, 70),
  ('Mercedes Sprinter', 'Vehicle', 'Executive minibus — seats up to 14 pax', 250.00, 80)
ON CONFLICT DO NOTHING;

-- ── Seed: Meet & Greet Tiers ────────────────────────────────────────────────
INSERT INTO products (name, category, description, unit_price, sort_order) VALUES
  (
    'Meet & Greet Silver',
    'Meet & Greet',
    'Driver meets client in arrivals hall with personalised nameboard. Assistance with luggage to the vehicle.',
    20.00,
    10
  ),
  (
    'Meet & Greet Gold',
    'Meet & Greet',
    'Priority lane escort from arrivals gate. Personalised nameboard, bottled water, fresh flowers, light refreshments in vehicle. Dedicated driver assistance throughout.',
    75.00,
    20
  ),
  (
    'Meet & Greet Diamond',
    'Meet & Greet',
    'Full VIP concierge service. Fast-track immigration assistance, dedicated porter for all luggage, personalised welcome card, chilled champagne and premium refreshments in vehicle. White-glove treatment from gate to destination.',
    150.00,
    30
  )
ON CONFLICT DO NOTHING;

-- ── Seed: Tours ─────────────────────────────────────────────────────────────
INSERT INTO products (name, category, description, unit_price, sort_order) VALUES
  ('Bicester Village Tour', 'Tour', 'Private shopping tour to Bicester Village designer outlet — collection and return to central London', 350.00, 10),
  ('Windsor Castle Tour', 'Tour', 'Private guided tour of Windsor Castle, St George''s Chapel and Windsor town', 280.00, 20),
  ('Stonehenge & Bath Day Tour', 'Tour', 'Full-day private tour visiting Stonehenge and the Roman Baths in Bath', 420.00, 30),
  ('London City Tour', 'Tour', 'Private sightseeing tour of London''s key landmarks — Buckingham Palace, Tower Bridge, Westminster', 250.00, 40),
  ('Oxford University Tour', 'Tour', 'Private tour of Oxford''s historic colleges, Bodleian Library and covered market', 300.00, 50),
  ('Cotswolds Village Tour', 'Tour', 'Scenic private tour through the Cotswolds — Bourton-on-the-Water, Burford, Bibury', 380.00, 60),
  ('Stratford-upon-Avon Tour', 'Tour', 'Shakespeare''s birthplace — private guided day tour', 320.00, 70)
ON CONFLICT DO NOTHING;

-- ── Seed: Add-ons ───────────────────────────────────────────────────────────
INSERT INTO products (name, category, description, unit_price, sort_order) VALUES
  ('Child Seat (Infant)', 'Add-on', 'Rear-facing infant car seat — suitable for newborn to 12 months', 15.00, 10),
  ('Child Seat (Toddler)', 'Add-on', 'Forward-facing toddler seat — suitable for 1–4 years', 15.00, 20),
  ('Booster Seat', 'Add-on', 'High-back booster — suitable for 4–12 years', 10.00, 30),
  ('Porter Service', 'Add-on', 'Dedicated porter to handle all luggage at terminal or hotel', 25.00, 40),
  ('Champagne on Arrival', 'Add-on', 'Chilled Champagne served on arrival or in vehicle', 65.00, 50),
  ('Flowers & Bouquet', 'Add-on', 'Seasonal flowers or bouquet arranged for client arrival', 40.00, 60),
  ('Welcome Pack', 'Add-on', 'Premium welcome gift — flowers, card, chocolates, personalised note', 75.00, 70),
  ('Late Night Surcharge', 'Add-on', 'Applies to pickups between 22:00 and 06:00', 20.00, 80),
  ('Extra Stop', 'Add-on', 'Additional stop during transfer or tour', 15.00, 90),
  ('Waiting Time (per 30 min)', 'Add-on', 'Driver waiting time charged per 30-minute block', 30.00, 100)
ON CONFLICT DO NOTHING;

-- ── Seed: Accommodation ─────────────────────────────────────────────────────
INSERT INTO products (name, category, description, unit_price, sort_order) VALUES
  ('Fridge Pre-stock', 'Accommodation', 'Luxury grocery and drinks pre-stocked to client preferences before arrival', 0.00, 10),
  ('Concierge Package', 'Accommodation', '24/7 dedicated concierge support for the duration of stay', 0.00, 20),
  ('Airport Collection Add-on', 'Accommodation', 'Dedicated driver collection from airport included in accommodation booking', 0.00, 30)
ON CONFLICT DO NOTHING;
