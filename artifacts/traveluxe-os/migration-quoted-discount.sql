-- ============================================================================
-- Quoted Price + Discount fields on bookings
-- April 2026. All service types.
-- ----------------------------------------------------------------------------
-- Adds three optional columns so the client invoice can show the original
-- quote, the discount applied, the reason, and the final amount due. None
-- of these affect any internal cost / commission flow — they are purely
-- client-facing.
--
--   quoted_price     numeric  — original quote shown to client (e.g. 550)
--   discount_amount  numeric  — goodwill / adjustment subtracted (e.g. 50)
--   discount_reason  text     — short explanation ("buggy unavailable")
--
-- When set, the form auto-fills price (Client Price) = quoted - discount,
-- but the operator can still override it manually if needed.
-- ============================================================================

alter table public.bookings
  add column if not exists quoted_price    numeric,
  add column if not exists discount_amount numeric,
  add column if not exists discount_reason text;

comment on column public.bookings.quoted_price    is 'Original price quoted to the client before any discount. Shown on invoice as the subtotal line. Optional.';
comment on column public.bookings.discount_amount is 'Goodwill / adjustment subtracted from the quoted price. Shown on invoice as a separate line above Total Due. Optional.';
comment on column public.bookings.discount_reason is 'Short, client-facing explanation for the discount (e.g. "Buggy unavailable"). Optional.';
