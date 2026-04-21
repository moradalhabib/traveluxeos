import { Router } from "express";
import { supabase, auditLog, getUserFromToken } from "../lib/supabase";
import { logActivity } from "../lib/activity";

const router = Router();

const OVERDUE_DAYS = 30;
const dayMs = 86400000;
function ageInDays(iso: string | null | undefined): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.floor((Date.now() - t) / dayMs);
}

// Guard: Commissions is restricted to super_admin + operator. Admin/viewer/RM blocked.
router.use(async (req, res, next) => {
  const user = await getUserFromToken(req.headers.authorization);
  if (!user || !["super_admin", "operator"].includes(user.role)) {
    return res.status(403).json({ error: "Commissions access denied." });
  }
  return next();
});

router.get("/", async (_req, res) => {
  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - 7);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  // Show settled / paid history within the last 90 days so the operator can
  // see "what's been paid" alongside what's still outstanding.
  const historyCutoff = new Date(now);
  historyCutoff.setDate(now.getDate() - 90);

  const [
    { data: weekBookings },
    { data: monthBookings },
    { data: outstandingBookings },
    { data: pendingPayoutBookings },
    { data: settledHistoryBookings },
    { data: paidHistoryBookings },
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
    // Cash jobs already settled (history, last 90d) — for driver detail view
    supabase
      .from("bookings")
      .select("id, tvl_ref, date_time, price, additional_charges, tvl_commission, driver_receives, payment_method, commission_status, payout_status, driver_id, service_type, clients(name)")
      .eq("payment_method", "Cash")
      .eq("commission_status", "Settled")
      .gte("date_time", historyCutoff.toISOString())
      .neq("status", "Cancelled"),
    // Bank/Card jobs already paid out (history, last 90d) — for driver detail view
    supabase
      .from("bookings")
      .select("id, tvl_ref, date_time, price, additional_charges, tvl_commission, driver_receives, payment_method, commission_status, payout_status, driver_id, service_type, clients(name)")
      .in("payment_method", ["Bank Transfer", "Card"])
      .eq("payout_status", "Paid")
      .gte("date_time", historyCutoff.toISOString())
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
    supabase.from("drivers").select("id, name, staff_no, whatsapp").eq("status", "Active"),
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
  const driverMap: Record<string, {
    outstanding: number;
    pending_payout: number;
    outstanding_jobs: any[];
    payout_jobs: any[];
    settled_jobs: any[];
    paid_jobs: any[];
  }> = {};

  const blank = () => ({ outstanding: 0, pending_payout: 0, outstanding_jobs: [], payout_jobs: [], settled_jobs: [], paid_jobs: [] });

  (allDrivers ?? []).forEach((d: any) => {
    driverMap[d.id] = blank();
  });

  const toJob = (b: any) => ({
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

  (outstandingBookings ?? []).forEach((b: any) => {
    if (!b.driver_id) return;
    if (!driverMap[b.driver_id]) driverMap[b.driver_id] = blank();
    driverMap[b.driver_id].outstanding += b.tvl_commission ?? 0;
    driverMap[b.driver_id].outstanding_jobs.push(toJob(b));
  });

  (pendingPayoutBookings ?? []).forEach((b: any) => {
    if (!b.driver_id) return;
    if (!driverMap[b.driver_id]) driverMap[b.driver_id] = blank();
    driverMap[b.driver_id].pending_payout += b.driver_receives ?? 0;
    driverMap[b.driver_id].payout_jobs.push(toJob(b));
  });

  (settledHistoryBookings ?? []).forEach((b: any) => {
    if (!b.driver_id) return;
    if (!driverMap[b.driver_id]) driverMap[b.driver_id] = blank();
    driverMap[b.driver_id].settled_jobs.push(toJob(b));
  });

  (paidHistoryBookings ?? []).forEach((b: any) => {
    if (!b.driver_id) return;
    if (!driverMap[b.driver_id]) driverMap[b.driver_id] = blank();
    driverMap[b.driver_id].paid_jobs.push(toJob(b));
  });

  const { data: driverDetails } = await supabase
    .from("drivers")
    .select("id, name, staff_no, whatsapp")
    .in("id", Object.keys(driverMap));

  const driverNameMap: Record<string, string> = {};
  const driverStaffMap: Record<string, string | null> = {};
  const driverWhatsappMap: Record<string, string | null> = {};
  (driverDetails ?? []).forEach((d: any) => {
    driverNameMap[d.id] = d.name;
    driverStaffMap[d.id] = d.staff_no ?? null;
    driverWhatsappMap[d.id] = d.whatsapp ?? null;
  });

  const driver_breakdown = Object.entries(driverMap)
    .filter(([, v]) =>
      v.outstanding > 0 || v.pending_payout > 0 ||
      v.outstanding_jobs.length > 0 || v.payout_jobs.length > 0 ||
      v.settled_jobs.length > 0 || v.paid_jobs.length > 0
    )
    .map(([driver_id, v]) => {
      // Oldest pending CASH commission age — used to flag overdue (>=30d)
      const cashPendingDates = v.outstanding_jobs
        .map((j: any) => j.date)
        .filter(Boolean) as string[];
      const oldestAge = cashPendingDates.length
        ? Math.max(...cashPendingDates.map((d) => ageInDays(d)))
        : 0;
      return {
        driver_id,
        driver_name: driverNameMap[driver_id] ?? "Unknown",
        driver_staff_no: driverStaffMap[driver_id] ?? null,
        driver_whatsapp: driverWhatsappMap[driver_id] ?? null,
        outstanding_amount: v.outstanding,
        pending_payout: v.pending_payout,
        oldest_pending_age_days: oldestAge,
        has_overdue: oldestAge >= OVERDUE_DAYS && v.outstanding > 0,
        jobs: [...v.outstanding_jobs, ...v.payout_jobs],
        settled_jobs: v.settled_jobs,
        paid_jobs: v.paid_jobs,
      };
    });

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

  const drivers_with_pending = driver_breakdown.filter(
    (d) => d.outstanding_amount > 0,
  ).length;
  const drivers_with_overdue = driver_breakdown.filter(
    (d) => d.has_overdue,
  ).length;

  return res.json({
    total_earned_week: totalWeek,
    total_earned_month: totalMonth,
    total_outstanding: totalOutstanding,
    total_pending_payouts: totalPendingPayouts,
    total_arrangement_outstanding: totalArrangementOutstanding,
    drivers_with_pending,
    drivers_with_overdue,
    driver_breakdown,
    arrangement_fees,
    settlements: enrichedSettlements,
    payouts: enrichedPayouts,
  });
});

// ─── Settlement history (Outstanding + Payouts unioned) ────────────────────
router.get("/settlements/history", async (_req, res) => {
  const [{ data: settlements }, { data: payouts }] = await Promise.all([
    supabase
      .from("commission_settlements")
      .select("id, driver_id, settled_at, week_start, week_end, booking_ids, total_amount, notes, settled_by, drivers(name, staff_no)")
      .order("settled_at", { ascending: false })
      .limit(500),
    supabase
      .from("driver_payouts")
      .select("id, driver_id, paid_at, week_start, week_end, booking_ids, total_amount, notes, paid_by, drivers(name, staff_no)")
      .order("paid_at", { ascending: false })
      .limit(500),
  ]);

  // Resolve booking_ids -> tvl_refs in one pass
  const allBookingIds = new Set<string>();
  (settlements ?? []).forEach((s: any) => (s.booking_ids ?? []).forEach((id: string) => allBookingIds.add(id)));
  (payouts ?? []).forEach((p: any) => (p.booking_ids ?? []).forEach((id: string) => allBookingIds.add(id)));

  const bookingRefMap: Record<string, string> = {};
  if (allBookingIds.size > 0) {
    const { data: bookings } = await supabase
      .from("bookings")
      .select("id, tvl_ref")
      .in("id", Array.from(allBookingIds));
    (bookings ?? []).forEach((b: any) => { bookingRefMap[b.id] = b.tvl_ref ?? b.id; });
  }

  // Operator name lookup
  const operatorIds = new Set<string>();
  (settlements ?? []).forEach((s: any) => s.settled_by && operatorIds.add(s.settled_by));
  (payouts ?? []).forEach((p: any) => p.paid_by && operatorIds.add(p.paid_by));
  const operatorNameMap: Record<string, string> = {};
  if (operatorIds.size > 0) {
    const { data: users } = await supabase
      .from("users")
      .select("id, name")
      .in("id", Array.from(operatorIds));
    (users ?? []).forEach((u: any) => { operatorNameMap[u.id] = u.name ?? null; });
  }

  // Recompute total for settlements (commission_settlements may not store total_amount)
  const enriched = [
    ...(settlements ?? []).map((s: any) => {
      const refs = (s.booking_ids ?? []).map((id: string) => bookingRefMap[id] ?? id);
      return {
        kind: "settlement" as const,
        id: s.id,
        driver_id: s.driver_id,
        driver_name: s.drivers?.name ?? null,
        driver_staff_no: s.drivers?.staff_no ?? null,
        settled_at: s.settled_at,
        week_start: s.week_start,
        week_end: s.week_end,
        booking_ids: s.booking_ids ?? [],
        booking_refs: refs,
        amount: Number(s.total_amount ?? 0),
        notes: s.notes ?? null,
        operator_id: s.settled_by ?? null,
        operator_name: s.settled_by ? operatorNameMap[s.settled_by] ?? null : null,
      };
    }),
    ...(payouts ?? []).map((p: any) => {
      const refs = (p.booking_ids ?? []).map((id: string) => bookingRefMap[id] ?? id);
      return {
        kind: "payout" as const,
        id: p.id,
        driver_id: p.driver_id,
        driver_name: p.drivers?.name ?? null,
        driver_staff_no: p.drivers?.staff_no ?? null,
        settled_at: p.paid_at,
        week_start: p.week_start,
        week_end: p.week_end,
        booking_ids: p.booking_ids ?? [],
        booking_refs: refs,
        amount: Number(p.total_amount ?? 0),
        notes: p.notes ?? null,
        operator_id: p.paid_by ?? null,
        operator_name: p.paid_by ? operatorNameMap[p.paid_by] ?? null : null,
      };
    }),
  ].sort((a, b) =>
    new Date(b.settled_at ?? 0).getTime() - new Date(a.settled_at ?? 0).getTime(),
  );

  return res.json({ history: enriched });
});

router.post("/settlements", async (req, res) => {
  const user = await getUserFromToken(req.headers.authorization);
  const { driver_id, week_start, week_end, booking_ids, notes } = req.body;

  if (!driver_id) return res.status(400).json({ error: "driver_id is required" });
  if (!Array.isArray(booking_ids) || booking_ids.length === 0) {
    return res.status(400).json({ error: "booking_ids must be a non-empty array" });
  }

  // Server-side authorization: only allow settling jobs that
  // (a) belong to this driver, (b) are Cash, (c) are still Outstanding,
  // (d) are not Cancelled. This blocks tampering with client-supplied IDs.
  const { data: eligible, error: eligibleErr } = await supabase
    .from("bookings")
    .select("id, tvl_commission")
    .in("id", booking_ids)
    .eq("driver_id", driver_id)
    .eq("payment_method", "Cash")
    .eq("commission_status", "Outstanding")
    .neq("status", "Cancelled");

  if (eligibleErr) return res.status(500).json({ error: eligibleErr.message });

  const eligibleIds = (eligible ?? []).map((b: any) => b.id);
  if (eligibleIds.length !== booking_ids.length) {
    return res.status(409).json({
      error: "Some bookings could not be settled (wrong driver, already settled, cancelled, or not cash). Reload and try again.",
      eligible_count: eligibleIds.length,
      requested_count: booking_ids.length,
    });
  }

  // Step 1: update bookings first. If this fails or partially fails, we abort
  // before writing the ledger row, leaving the system in a consistent state.
  const { data: updatedBookings, error: updateErr } = await supabase
    .from("bookings")
    .update({ commission_status: "Settled" })
    .in("id", eligibleIds)
    .select("id");

  if (updateErr) return res.status(500).json({ error: `Failed to update bookings: ${updateErr.message}` });
  if ((updatedBookings ?? []).length !== eligibleIds.length) {
    return res.status(500).json({ error: "Booking update count mismatch — aborted to preserve ledger integrity" });
  }

  const totalSettled = (eligible ?? []).reduce(
    (s: number, b: any) => s + (Number(b.tvl_commission) || 0),
    0,
  );

  // Step 2: write the settlement ledger row. If this fails, attempt to roll back
  // the booking status updates so we don't leave them as Settled with no record.
  const { data, error } = await supabase
    .from("commission_settlements")
    .insert({ driver_id, week_start, week_end, booking_ids: eligibleIds, total_amount: totalSettled, notes: notes ?? null, settled_by: user?.id ?? null })
    .select("*, drivers(name)")
    .single();

  if (error) {
    await supabase.from("bookings").update({ commission_status: "Outstanding" }).in("id", eligibleIds);
    return res.status(500).json({ error: `Failed to record settlement, bookings reverted: ${error.message}` });
  }

  await auditLog("commission_settled", "driver", driver_id, user?.id ?? null,
    `Commission settled for ${week_start} to ${week_end} (${eligibleIds.length} jobs)`);

  await logActivity({
    action_type: "settlement_created",
    description: `Settlement £${totalSettled.toFixed(0)} for ${eligibleIds.length} job(s) — ${data.drivers?.name ?? "driver"}`,
    entity_type: "commission_settlement",
    entity_id: data.id,
    entity_label: data.drivers?.name ?? null,
    operator_id: user?.id ?? null,
    operator_name: user?.name ?? null,
  });

  return res.status(201).json({ ...data, total_amount: totalSettled, driver_name: data.drivers?.name ?? null, drivers: undefined });
});

router.post("/payouts", async (req, res) => {
  const user = await getUserFromToken(req.headers.authorization);
  const { driver_id, week_start, week_end, booking_ids, notes } = req.body;

  if (!driver_id) return res.status(400).json({ error: "driver_id is required" });
  if (!Array.isArray(booking_ids) || booking_ids.length === 0) {
    return res.status(400).json({ error: "booking_ids must be a non-empty array" });
  }

  // Server-side authorization: only allow paying out jobs that
  // (a) belong to this driver, (b) are Bank Transfer or Card, (c) payout still Pending,
  // (d) not Cancelled. Blocks client tampering.
  const { data: eligible, error: eligibleErr } = await supabase
    .from("bookings")
    .select("id, driver_receives")
    .in("id", booking_ids)
    .eq("driver_id", driver_id)
    .in("payment_method", ["Bank Transfer", "Card"])
    .eq("payout_status", "Pending")
    .neq("status", "Cancelled");

  if (eligibleErr) return res.status(500).json({ error: eligibleErr.message });

  const eligibleIds = (eligible ?? []).map((b: any) => b.id);
  if (eligibleIds.length !== booking_ids.length) {
    return res.status(409).json({
      error: "Some bookings could not be paid out (wrong driver, already paid, cancelled, or not bank/card). Reload and try again.",
      eligible_count: eligibleIds.length,
      requested_count: booking_ids.length,
    });
  }

  const total = (eligible ?? []).reduce((s: number, b: any) => s + (b.driver_receives ?? 0), 0);

  // Step 1: update bookings first.
  const { data: updatedBookings, error: updateErr } = await supabase
    .from("bookings")
    .update({ payout_status: "Paid" })
    .in("id", eligibleIds)
    .select("id");

  if (updateErr) return res.status(500).json({ error: `Failed to update bookings: ${updateErr.message}` });
  if ((updatedBookings ?? []).length !== eligibleIds.length) {
    return res.status(500).json({ error: "Booking update count mismatch — aborted to preserve ledger integrity" });
  }

  // Step 2: write payout ledger row, with rollback on failure.
  const { data, error } = await supabase
    .from("driver_payouts")
    .insert({ driver_id, week_start, week_end, booking_ids: eligibleIds, total_amount: total, notes, paid_by: user?.id ?? null })
    .select("*, drivers(name)")
    .single();

  if (error) {
    await supabase.from("bookings").update({ payout_status: "Pending" }).in("id", eligibleIds);
    return res.status(500).json({ error: `Failed to record payout, bookings reverted: ${error.message}` });
  }

  await auditLog("payout_made", "driver", driver_id, user?.id ?? null,
    `Payout £${total} made for ${week_start} to ${week_end} (${eligibleIds.length} jobs)`);

  await logActivity({
    action_type: "payout_created",
    description: `Payout £${total.toFixed(0)} for ${eligibleIds.length} job(s) — ${data.drivers?.name ?? "driver"}`,
    entity_type: "driver_payout",
    entity_id: data.id,
    entity_label: data.drivers?.name ?? null,
    operator_id: user?.id ?? null,
    operator_name: user?.name ?? null,
  });

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
