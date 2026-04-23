-- Atomic unwind functions for commission settlements and driver payouts.
-- Replaces the two-step JS rollback in artifacts/api-server/src/routes/commissions.ts
-- so a concurrent re-settle / re-pay between the status-revert and the
-- ledger DELETE cannot leave bookings tagged against two ledger rows.
--
-- Apply manually in the Supabase SQL editor (Traveluxe uses raw SQL,
-- no migration runner). Idempotent — safe to re-run.

create or replace function public.unwind_commission_settlement(
  p_settlement_id uuid
)
returns table (
  reverted_bookings int,
  reverted_vehicles int,
  driver_id uuid,
  total_amount numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking_ids uuid[];
  v_vehicle_ids uuid[];
  v_driver_id uuid;
  v_total numeric;
  v_bk_count int := 0;
  v_vh_count int := 0;
begin
  -- Defence in depth: even though execute is granted to service_role only,
  -- guard against a future grant by re-checking the caller's role inside
  -- the function. Service-role calls have auth.uid() = null and pass.
  if auth.uid() is not null and not exists (
    select 1 from public.users
     where id = auth.uid() and role in ('admin','super_admin')
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select s.booking_ids, s.booking_vehicle_ids, s.driver_id, s.total_amount
    into v_booking_ids, v_vehicle_ids, v_driver_id, v_total
    from public.commission_settlements s
   where s.id = p_settlement_id
     for update;

  if not found then
    raise exception 'settlement_not_found' using errcode = 'P0002';
  end if;

  if v_booking_ids is not null and array_length(v_booking_ids, 1) > 0 then
    update public.bookings
       set commission_status = 'Outstanding'
     where id = any(v_booking_ids);
    get diagnostics v_bk_count = row_count;
  end if;

  if v_vehicle_ids is not null and array_length(v_vehicle_ids, 1) > 0 then
    update public.booking_vehicles
       set commission_status = 'Outstanding'
     where id = any(v_vehicle_ids);
    get diagnostics v_vh_count = row_count;
  end if;

  delete from public.commission_settlements where id = p_settlement_id;

  return query select v_bk_count, v_vh_count, v_driver_id, v_total;
end;
$$;

create or replace function public.unwind_driver_payout(
  p_payout_id uuid
)
returns table (
  reverted_bookings int,
  reverted_vehicles int,
  driver_id uuid,
  total_amount numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking_ids uuid[];
  v_vehicle_ids uuid[];
  v_driver_id uuid;
  v_total numeric;
  v_bk_count int := 0;
  v_vh_count int := 0;
begin
  if auth.uid() is not null and not exists (
    select 1 from public.users
     where id = auth.uid() and role in ('admin','super_admin')
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select p.booking_ids, p.booking_vehicle_ids, p.driver_id, p.total_amount
    into v_booking_ids, v_vehicle_ids, v_driver_id, v_total
    from public.driver_payouts p
   where p.id = p_payout_id
     for update;

  if not found then
    raise exception 'payout_not_found' using errcode = 'P0002';
  end if;

  if v_booking_ids is not null and array_length(v_booking_ids, 1) > 0 then
    update public.bookings
       set payout_status = 'Pending'
     where id = any(v_booking_ids);
    get diagnostics v_bk_count = row_count;
  end if;

  if v_vehicle_ids is not null and array_length(v_vehicle_ids, 1) > 0 then
    update public.booking_vehicles
       set payout_status = 'Pending'
     where id = any(v_vehicle_ids);
    get diagnostics v_vh_count = row_count;
  end if;

  delete from public.driver_payouts where id = p_payout_id;

  return query select v_bk_count, v_vh_count, v_driver_id, v_total;
end;
$$;

-- Restrict execute to the API service role only. The Express layer admin-gates
-- /commissions/settlements/:id and /commissions/payouts/:id, then calls the
-- function via the service-role Supabase client. Granting to "authenticated"
-- would let any signed-in user (driver, residence_manager, …) call the RPC
-- directly from the browser and corrupt commission ledgers.
revoke execute on function public.unwind_commission_settlement(uuid) from public, authenticated;
revoke execute on function public.unwind_driver_payout(uuid) from public, authenticated;
grant execute on function public.unwind_commission_settlement(uuid) to service_role;
grant execute on function public.unwind_driver_payout(uuid) to service_role;
