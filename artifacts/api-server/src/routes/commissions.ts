import { Router } from "express";
import { supabase, auditLog, getUserFromToken } from "../lib/supabase";

const router = Router();

router.get("/", async (_req, res) => {
  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - 7);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [
    { data: weekBookings },
    { data: monthBookings },
    { data: outstandingBookings },
    { data: pendingPayoutBookings },
    { data: arrangementFeeBookings },
    { data: settlements },
    { data: payouts },
    { data: allDrivers },
  ] = await Promise.all([
    // Driver commissions this week
    supabase
      .from("bookings")
      .select("tvl_commission, commission_amount, service_type")
      .gte("date_time", weekStart.toISOString())
      .neq("status", "Cancelled"),
    // Driver commissions this month
    supabase
      .from("bookings")
      .select("tvl_commission, commission_amount, service_type")
      .gte("date_time", monthStart.toISOString())
      .neq("status", "Cancelled"),
    // Cash jobs: driver owes TVL
    supabase
      .from("bookings")
      .select("id, tvl_ref, date_time, price, additional_charges, tvl_commission, driver_receives, payment_method, commission_status, payout_status, driver_id, service_type, clients(name)")
      .eq("payment_method", "Cash")
      .eq("commission_status", "Outstanding")
      .neq("status", "Cancelled"),
    // Bank/Card jobs: TVL owes driver
    supabase
      .from("bookings")
      .select("id, tvl_ref, date_time, price, additional_charges, tvl_commission, driver_receives, payment_method, commission_status, payout_status, driver_id, service_type, clients(name)")
      .in("payment_method", ["Bank Transfer", "Card"])
      .eq("payout_status", "Pending")
      .neq("status", "Cancelled"),
    // Hotel/Apartment arrangement fees outstanding
    supabase
      .from("bookings")
      .select("id, tvl_ref, date_time, price, commission_amount, commission_notes, arrangement_fee_status, service_type, clients(name)")
      .in("service_type", ["Hotel", "Apartment"])
      .gt("commission_amount", 0)
      .neq("status", "Cancelled"),
    supabase
      .from("commission_settlements")
      .select("*, drivers(name)")
      .order("settled_at", { ascending: false })
      .limit(50),
    supabase
      .from("driver_payouts")
      .select("*, drivers(name)")
      .order("paid_at", { ascending: false })
      .limit(50),
    supabase.from("drivers").select("id, name").eq("status", "Active"),
  ]);

  // Week/month totals include both driver commissions and arrangement fees
  const totalWeek = (weekBookings ?? []).reduce((s: number, b: any) => {
    const driverComm = b.tvl_commission ?? 0;
    const arrangement = ["Hotel", "Apartment"].includes(b.service_type) ? (b.commission_amount ?? 0) : 0;
    return s + driverComm + arrangement;
  }, 0);

  const totalMonth = (monthBookings ?? []).reduce((s: number, b: any) => {
    const driverComm = b.tvl_commission ?? 0;
    const arrangement = ["Hotel", "Apartment"].includes(b.service_type) ? (b.commission_amount ?? 0) : 0;
    return s + driverComm + arrangement;
  }, 0);

  const totalOutstanding = (outstandingBookings ?? []).reduce((s: number, b: any) => s + (b.tvl_commission ?? 0), 0);
  const totalPendingPayouts = (pendingPayoutBookings ?? []).reduce((s: number, b: any) => s + (b.driver_receives ?? 0), 0);
  const totalArrangementOutstanding = (arrangementFeeBookings ?? [])
    .filter((b: any) => (b.arrangement_fee_status ?? "Outstanding") === "Outstanding")
    .reduce((s: number, b: any) => s + (b.commission_amount ?? 0), 0);

  // Per-driver breakdown
  const driverMap: Record<string, { outstanding: number; pending_payout: number; outstanding_jobs: any[]; payout_jobs: any[] }> = {};

  (allDrivers ?? []).forEach((d: any) => {
    driverMap[d.id] = { outstanding: 0, pending_payout: 0, outstanding_jobs: [], payout_jobs: [] };
  });

  (outstandingBookings ?? []).forEach((b: any) => {
    if (!b.driver_id) return;
    if (!driverMap[b.driver_id]) driverMap[b.driver_id] = { outstanding: 0, pending_payout: 0, outstanding_jobs: [], payout_jobs: [] };
    driverMap[b.driver_id].outstanding += b.tvl_commission ?? 0;
    driverMap[b.driver_id].outstanding_jobs.push({
      booking_id: b.id,
      tvl_ref: b.tvl_ref,
      date: b.date_time,
      client_name: b.clients?.name ?? null,
      service_type: b.service_type,
      total_fare: (b.price ?? 0) + (b.additional_charges ?? 0),
      tvl_commission: b.tvl_commission ?? 0,
      driver_receives: b.driver_receives ?? 0,
      payment_method: b.payment_method,
      commission_status: b.commission_status,
      payout_status: b.payout_status,
    });
  });

  (pendingPayoutBookings ?? []).forEach((b: any) => {
    if (!b.driver_id) return;
    if (!driverMap[b.driver_id]) driverMap[b.driver_id] = { outstanding: 0, pending_payout: 0, outstanding_jobs: [], payout_jobs: [] };
    driverMap[b.driver_id].pending_payout += b.driver_receives ?? 0;
    driverMap[b.driver_id].payout_jobs.push({
      booking_id: b.id,
      tvl_ref: b.tvl_ref,
      date: b.date_time,
      client_name: b.clients?.name ?? null,
      service_type: b.service_type,
      total_fare: (b.price ?? 0) + (b.additional_charges ?? 0),
      tvl_commission: b.tvl_commission ?? 0,
      driver_receives: b.driver_receives ?? 0,
      payment_method: b.payment_method,
      commission_status: b.commission_status,
      payout_status: b.payout_status,
    });
  });

  const { data: driverDetails } = await supabase
    .from("drivers")
    .select("id, name")
    .in("id", Object.keys(driverMap));

  const driverNameMap: Record<string, string> = {};
  (driverDetails ?? []).forEach((d: any) => { driverNameMap[d.id] = d.name; });

  const driver_breakdown = Object.entries(driverMap)
    .filter(([, v]) => v.outstanding > 0 || v.pending_payout > 0 || v.outstanding_jobs.length > 0 || v.payout_jobs.length > 0)
    .map(([driver_id, v]) => ({
      driver_id,
      driver_name: driverNameMap[driver_id] ?? "Unknown",
      outstanding_amount: v.outstanding,
      pending_payout: v.pending_payout,
      jobs: [...v.outstanding_jobs, ...v.payout_jobs],
    }));

  // Arrangement fees breakdown (Hotel + Apartment)
  const arrangement_fees = (arrangementFeeBookings ?? []).map((b: any) => ({
    booking_id: b.id,
    tvl_ref: b.tvl_ref,
    date: b.date_time,
    client_name: b.clients?.name ?? null,
    service_type: b.service_type,
    commission_amount: b.commission_amount ?? 0,
    commission_notes: b.commission_notes ?? null,
    arrangement_fee_status: b.arrangement_fee_status ?? "Outstanding",
    booking_price: b.price ?? 0,
  }));

  const enrichedSettlements = (settlements ?? []).map((s: any) => ({
    ...s,
    driver_name: s.drivers?.name ?? null,
    drivers: undefined,
  }));

  const enrichedPayouts = (payouts ?? []).map((p: any) => ({
    ...p,
    driver_name: p.drivers?.name ?? null,
    drivers: undefined,
  }));

  return res.json({
    total_earned_week: totalWeek,
    total_earned_month: totalMonth,
    total_outstanding: totalOutstanding,
    total_pending_payouts: totalPendingPayouts,
    total_arrangement_outstanding: totalArrangementOutstanding,
    driver_breakdown,
    arrangement_fees,
    settlements: enrichedSettlements,
    payouts: enrichedPayouts,
  });
});

router.post("/settlements", async (req, res) => {
  const user = await getUserFromToken(req.headers.authorization);
  const { driver_id, week_start, week_end, booking_ids, notes } = req.body;

  const { data, error } = await supabase
    .from("commission_settlements")
    .insert({ driver_id, week_start, week_end, booking_ids, notes, settled_by: user?.id ?? null })
    .select("*, drivers(name)")
    .single();

  if (error) return res.status(400).json({ error: error.message });

  if (booking_ids?.length > 0) {
    await supabase.from("bookings").update({ commission_status: "Settled" }).in("id", booking_ids);
  }

  await auditLog("commission_settled", "driver", driver_id, user?.id ?? null,
    `Commission settled for ${week_start} to ${week_end}`);

  return res.status(201).json({ ...data, driver_name: data.drivers?.name ?? null, drivers: undefined });
});

router.post("/payouts", async (req, res) => {
  const user = await getUserFromToken(req.headers.authorization);
  const { driver_id, week_start, week_end, booking_ids, notes } = req.body;

  const { data: pendingBookings } = await supabase
    .from("bookings")
    .select("driver_receives")
    .in("id", booking_ids ?? []);

  const total = (pendingBookings ?? []).reduce((s: number, b: any) => s + (b.driver_receives ?? 0), 0);

  const { data, error } = await supabase
    .from("driver_payouts")
    .insert({ driver_id, week_start, week_end, booking_ids, total_amount: total, notes, paid_by: user?.id ?? null })
    .select("*, drivers(name)")
    .single();

  if (error) return res.status(400).json({ error: error.message });

  if (booking_ids?.length > 0) {
    await supabase.from("bookings").update({ payout_status: "Paid" }).in("id", booking_ids);
  }

  await auditLog("payout_made", "driver", driver_id, user?.id ?? null,
    `Payout £${total} made for ${week_start} to ${week_end}`);

  return res.status(201).json({ ...data, driver_name: data.drivers?.name ?? null, drivers: undefined });
});

// Mark a hotel/apartment arrangement fee as collected
router.patch("/arrangement-fees/:bookingId", async (req, res) => {
  const user = await getUserFromToken(req.headers.authorization);
  const { bookingId } = req.params;
  const { status } = req.body;

  if (!["Outstanding", "Collected"].includes(status)) {
    return res.status(400).json({ error: "status must be Outstanding or Collected" });
  }

  const { error } = await supabase
    .from("bookings")
    .update({ arrangement_fee_status: status })
    .eq("id", bookingId)
    .in("service_type", ["Hotel", "Apartment"]);

  if (error) return res.status(400).json({ error: error.message });

  await auditLog("arrangement_fee_updated", "booking", bookingId, user?.id ?? null,
    `Arrangement fee status set to ${status}`);

  return res.json({ success: true });
});

export default router;
