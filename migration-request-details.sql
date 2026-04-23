-- Add a flexible per-service-type details bag to requests so the operator
-- can capture pickup/dropoff/flight/check-in/etc at request time and have
-- the new-booking form prefill from them on conversion.
--
-- JSONB keeps the schema forward-compatible: every service-type stores its
-- own shape under one column, no need to add/drop columns when service
-- catalogue changes.
--
-- Apply manually in the Supabase SQL editor (Traveluxe uses raw SQL,
-- no migration runner). Idempotent — safe to re-run.

alter table public.requests
  add column if not exists details jsonb not null default '{}'::jsonb;
