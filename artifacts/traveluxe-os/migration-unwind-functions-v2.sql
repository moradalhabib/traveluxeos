-- migration-unwind-functions-v2.sql
--
-- Fix: the original unwind functions referenced bookings.commission_settlement_id
-- and bookings.driver_payout_id — backref columns that were never created.
-- (Settle / Payout track the link via commission_settlements.booking_ids[] /
--  commission_settlements.booking_vehicle_ids[] array columns, not a backref
--  on the booking itself.) Calling unwind in production therefore failed with
--  `column "commission_settlement_id" does not exist`.
--
-- This migration rewrites both functions to read the booking_ids /
-- booking_vehicle_ids arrays from the ledger row and revert exactly those
-- bookings + vehicles to Outstanding/Pending in one transaction. No schema
-- change required. Idempotent (CREATE OR REPLACE). Run in the Supabase SQL
-- editor against the Production project.

create or replace function public.unwind_commission_settlement(p_settlement_id uuid)
returns table (
  reverted_bookings  integer,
  reverted_vehicles  integer,
  total_amount       numeric,
  driver_id          uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_driver_id uuid;
  v_total     numeric;
  v_b_ids     uuid[];
  v_v_ids     uuid[];
  v_bk_count  integer := 0;
  v_vh_count  integer := 0;
begin
  select cs.driver_id,
         coalesce(cs.total_amount, 0),
         coalesce(cs.booking_ids, ARRAY[]::uuid[]),
         coalesce(cs.booking_vehicle_ids, ARRAY[]::uuid[])
    into v_driver_id, v_total, v_b_ids, v_v_ids
    from commission_settlements cs
   where cs.id = p_settlement_id;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  if array_length(v_b_ids, 1) is not null then
    with upd as (
      update bookings
         set commission_status = 'Outstanding',
             updated_at        = now()
       where id = any (v_b_ids)
      returning 1
    )
    select count(*) into v_bk_count from upd;
  end if;

  if array_length(v_v_ids, 1) is not null then
    with upd as (
      update booking_vehicles
         set commission_status = 'Outstanding',
             updated_at        = now()
       where id = any (v_v_ids)
      returning 1
    )
    select count(*) into v_vh_count from upd;
  end if;

  delete from commission_settlements where id = p_settlement_id;

  return query select v_bk_count, v_vh_count, v_total, v_driver_id;
end;
$$;

create or replace function public.unwind_driver_payout(p_payout_id uuid)
returns table (
  reverted_bookings  integer,
  reverted_vehicles  integer,
  total_amount       numeric,
  driver_id          uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_driver_id uuid;
  v_total     numeric;
  v_b_ids     uuid[];
  v_v_ids     uuid[];
  v_bk_count  integer := 0;
  v_vh_count  integer := 0;
begin
  select dp.driver_id,
         coalesce(dp.total_amount, 0),
         coalesce(dp.booking_ids, ARRAY[]::uuid[]),
         coalesce(dp.booking_vehicle_ids, ARRAY[]::uuid[])
    into v_driver_id, v_total, v_b_ids, v_v_ids
    from driver_payouts dp
   where dp.id = p_payout_id;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  if array_length(v_b_ids, 1) is not null then
    with upd as (
      update bookings
         set payout_status = 'Pending',
             updated_at    = now()
       where id = any (v_b_ids)
      returning 1
    )
    select count(*) into v_bk_count from upd;
  end if;

  if array_length(v_v_ids, 1) is not null then
    with upd as (
      update booking_vehicles
         set payout_status = 'Pending',
             updated_at    = now()
       where id = any (v_v_ids)
      returning 1
    )
    select count(*) into v_vh_count from upd;
  end if;

  delete from driver_payouts where id = p_payout_id;

  return query select v_bk_count, v_vh_count, v_total, v_driver_id;
end;
$$;

revoke execute on function public.unwind_commission_settlement(uuid) from public, anon, authenticated;
revoke execute on function public.unwind_driver_payout(uuid)         from public, anon, authenticated;
grant  execute on function public.unwind_commission_settlement(uuid) to service_role;
grant  execute on function public.unwind_driver_payout(uuid)         to service_role;

select 'unwind functions v2 installed' as status;
