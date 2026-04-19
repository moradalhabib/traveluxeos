-- Run this in your Supabase SQL editor to add service_types column to products
-- This allows each product (vehicle, add-on, etc.) to be linked to specific service types

ALTER TABLE products
ADD COLUMN IF NOT EXISTS service_types TEXT[] DEFAULT ARRAY['Airport Transfer','As Directed','Tour'];

-- Set sensible defaults per category
UPDATE products SET service_types = ARRAY['Airport Transfer','As Directed','Tour']
WHERE category = 'Vehicle';

UPDATE products SET service_types = ARRAY['Airport Transfer']
WHERE category = 'Meet & Greet';

UPDATE products SET service_types = ARRAY['Tour']
WHERE category = 'Tour';

UPDATE products SET service_types = ARRAY['Airport Transfer','As Directed','Tour','Hotel','Apartment']
WHERE category = 'Add-on';

UPDATE products SET service_types = ARRAY['Apartment']
WHERE category = 'Accommodation';
