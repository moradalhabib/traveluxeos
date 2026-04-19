-- migration-service-types.sql
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS service_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  description text,
  base_price_guidance text,
  add_ons jsonb DEFAULT '[]'::jsonb,
  active boolean DEFAULT true,
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE service_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_types_read" ON service_types FOR SELECT TO authenticated USING (true);
CREATE POLICY "service_types_write" ON service_types FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Seed all default service types
INSERT INTO service_types (name, description, base_price_guidance, add_ons, sort_order) VALUES
(
  'Airport Transfer',
  'Private vehicle transfer to or from a London airport (LHR, LGW, STN, LTN, LCY, BRS). Driver meets client at arrivals with a nameboard.',
  'From £95 depending on vehicle class and distance',
  '[
    {"name":"Meet & Greet","description":"Driver waits in arrivals with nameboard","price":20},
    {"name":"Child Seat","description":"Infant / toddler / booster seat","price":15},
    {"name":"Extra Luggage","description":"Oversized or additional luggage","price":10},
    {"name":"Flight Monitoring","description":"Driver tracks live flight status","price":0},
    {"name":"Porter Service","description":"Luggage assistance at terminal","price":25},
    {"name":"Late Night Surcharge","description":"Pickups between 22:00–06:00","price":20}
  ]',
  1
),
(
  'Tour',
  'Guided private tour with a professional driver-guide to iconic UK destinations.',
  'From £350 per half day',
  '[
    {"name":"Entrance Tickets","description":"Museum, attraction or venue tickets","price":0},
    {"name":"Refreshments","description":"Water, snacks en route","price":0},
    {"name":"Extended Hours","description":"Per additional hour beyond agreed","price":75},
    {"name":"Commentary Audio Guide","description":"Multilingual in-vehicle audio guide","price":30}
  ]',
  2
),
(
  'City Tour',
  'Flexible private city sightseeing tour at the client''s pace. No fixed route — fully customisable.',
  'From £250 for 3 hours',
  '[
    {"name":"Commentary","description":"Driver narrates key landmarks","price":0},
    {"name":"Photo Stops","description":"Planned stops at key photo spots","price":0},
    {"name":"Restaurant Reservation","description":"Reservation at partner restaurant","price":0},
    {"name":"Extra Hour","description":"Per additional hour","price":65}
  ]',
  3
),
(
  'Chauffeur Tour',
  'Bespoke chauffeur-driven experience — countryside, heritage sites, or custom itineraries.',
  'From £450 per day',
  '[
    {"name":"Picnic Hamper","description":"Gourmet picnic prepared on request","price":85},
    {"name":"Champagne","description":"Chilled Champagne en route","price":65},
    {"name":"Customised Route","description":"Personalised itinerary planning","price":0},
    {"name":"Overnight Stay","description":"Driver accommodation for overnight trips","price":150}
  ]',
  4
),
(
  'As Directed',
  'Dedicated driver placed at client disposal for a set number of hours — no fixed route.',
  'From £65/hr (4-hour minimum)',
  '[
    {"name":"Additional Hours","description":"Per extra hour beyond agreed","price":65},
    {"name":"Out-of-London","description":"Travel outside M25 — mileage applies","price":0},
    {"name":"Waiting Time","description":"Billed per 30 mins of waiting","price":30},
    {"name":"Multiple Stops","description":"Shopping, meetings, errands","price":0}
  ]',
  5
),
(
  'Event Transfer',
  'Transfers to and from events — galas, Ascot, Wimbledon, concerts, corporate events.',
  'From £120 one-way',
  '[
    {"name":"Red Carpet Service","description":"VIP arrival experience","price":50},
    {"name":"Waiting Time","description":"Driver on standby during event","price":45},
    {"name":"Late Night Surcharge","description":"Post-event pickups after 22:00","price":30},
    {"name":"Return Journey","description":"Guaranteed return transfer","price":0}
  ]',
  6
),
(
  'Apartment / Accommodation',
  'Coordination and management of luxury serviced apartment bookings for VIP clients.',
  'Price on request',
  '[
    {"name":"Welcome Pack","description":"Flowers, card, client welcome items","price":75},
    {"name":"Grocery Pre-stock","description":"Fridge stocked to client preferences","price":0},
    {"name":"Airport Collection","description":"Driver meets client on arrival","price":0},
    {"name":"Concierge Access","description":"24/7 concierge support during stay","price":0},
    {"name":"Housekeeping","description":"Additional cleaning visits","price":0}
  ]',
  7
)
ON CONFLICT (name) DO NOTHING;
