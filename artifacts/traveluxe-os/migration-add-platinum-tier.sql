-- Build 4.x — Add 'Platinum' as the top VIP tier above VVIP.
-- Order: Standard < VIP < VVIP < Platinum.
-- Run in the Supabase SQL editor.

ALTER TABLE public.clients
  DROP CONSTRAINT IF EXISTS clients_vip_tier_check;
ALTER TABLE public.clients
  ADD CONSTRAINT clients_vip_tier_check
  CHECK (vip_tier IN ('Standard', 'VIP', 'VVIP', 'Platinum'));
