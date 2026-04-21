import { Router } from "express";
import { supabase } from "../lib/supabase";

const router = Router();

router.get("/summary", async (_req, res) => {
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - 7);
  const monthStart = new Date(now);
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const [
    { data: todayBookings },
    { data: weekBookings },
    { data: monthBookings },
    { data: activeJobs },
    { data: noDriverJobs },
    { data: pendingPayments },
    { data: allDriverBreakdown },
    { data: allClients },
    { data: allDrivers },
    { data: upcomingBookings },
    { data: unpaidInvoices },
    { data: arrangementFeeBookings },
  ] = await Promise.all([
    supabase.from("bookings").select("price, additional_charges, status").gte("date_time", todayStart.toISOString()),
    supabase.from("bookings").select("price, additional_charges, status").gte("date_time", weekStart.toISOString()),
    supabase.from("bookings").select("price, additional_charges, status").gte("date_time", monthStart.toISOString()),
    supabase.from("bookings").select("id").eq("status", "Active"),
    supabase.from("bookings").select("id, tvl_ref").in("status", ["Pending", "Confirmed"]).is("driver_id", null),
    supabase.from("bookings").select("id, tvl_ref").in("payment_status", ["Unpaid", "Partial"]).neq("status", "Cancelled"),
    supabase.from("bookings").select("driver_id, tvl_commission, payment_method, commission_status").eq("payment_method", "Cash").eq("commission_status", "Outstanding"),
    supabase.from("bookings").select("client_id, price, additional_charges").neq("status", "Cancelled"),
    supabase.from("bookings").select("driver_id").neq("status", "Cancelled"),
    supabase.from("bookings").select("id").gte("date_time", todayStart.toISOString()).not("status", "in", '("Cancelled","Completed")'),
    supabase.from("invoices").select("id").not("status", "in", '("Paid","Cancelled")'),
    supabase.from("bookings").select("commission_amount, arrangement_fee_status").in("service_type", ["Hotel", "Apartment"]).gt("commission_amount", 0).neq("status", "Cancelled"),
  ]);

  const calcRevenue = (bookings: { price: number; additional_charges: number; status: string }[] | null) =>
    (bookings ?? []).filter(b => !["Cancelled"].includes(b.status)).reduce((sum, b) => sum + (b.price || 0) + (b.additional_charges || 0), 0);

  const driverCommissionOutstanding = (allDriverBreakdown ?? []).reduce((sum: number, b: any) => sum + (b.tvl_commission || 0), 0);
  const arrangementFeeOutstanding = (arrangementFeeBookings ?? [])
    .filter((b: any) => (b.arrangement_fee_status ?? "Outstanding") === "Outstanding")
    .reduce((sum: number, b: any) => sum + (b.commission_amount || 0), 0);
  const outstandingCommissions = driverCommissionOutstanding + arrangementFeeOutstanding;

  // ── Today's Jobs (next 5 upcoming today, by pickup time) ─────────────────
  const todayEnd = new Date(todayStart);
  todayEnd.setHours(23, 59, 59, 999);
  const { data: todaysJobsRaw } = await supabase
    .from("bookings")
    .select("id, tvl_ref, service_type, direction, pickup, dropoff, date_time, status, driver_id, client_id, vehicle_type")
    .gte("date_time", now.toISOString())
    .lte("date_time", todayEnd.toISOString())
    .neq("status", "Cancelled")
    .neq("status", "Completed")
    .order("date_time", { ascending: true })
    .limit(5);
  const todayJobClientIds = Array.from(new Set((todaysJobsRaw ?? []).map((b: any) => b.client_id).filter(Boolean)));
  const todayJobDriverIds = Array.from(new Set((todaysJobsRaw ?? []).map((b: any) => b.driver_id).filter(Boolean)));
  const [{ data: todayJobClients }, { data: todayJobDrivers }] = await Promise.all([
    supabase.from("clients").select("id, name, vip_tier").in("id", todayJobClientIds.length ? todayJobClientIds : ["00000000-0000-0000-0000-000000000000"]),
    supabase.from("drivers").select("id, name").in("id", todayJobDriverIds.length ? todayJobDriverIds : ["00000000-0000-0000-0000-000000000000"]),
  ]);
  const todayJobClientMap: Record<string, any> = {};
  (todayJobClients ?? []).forEach((c: any) => { todayJobClientMap[c.id] = c; });
  const todayJobDriverMap: Record<string, any> = {};
  (todayJobDrivers ?? []).forEach((d: any) => { todayJobDriverMap[d.id] = d; });
  const todaysJobs = (todaysJobsRaw ?? []).map((b: any) => ({
    id: b.id,
    tvl_ref: b.tvl_ref,
    service_type: b.service_type,
    direction: b.direction,
    pickup: b.pickup,
    dropoff: b.dropoff,
    date_time: b.date_time,
    status: b.status,
    vehicle_type: b.vehicle_type,
    client_name: todayJobClientMap[b.client_id]?.name ?? null,
    client_vip_tier: todayJobClientMap[b.client_id]?.vip_tier ?? null,
    driver_name: todayJobDriverMap[b.driver_id]?.name ?? null,
    driver_id: b.driver_id,
  }));

  const { data: pendingPayoutBookings } = await supabase
    .from("bookings")
    .select("driver_receives")
    .eq("payment_method", "Bank Transfer")
    .eq("payout_status", "Pending")
    .neq("status", "Cancelled");
  const pendingPayouts = (pendingPayoutBookings ?? []).reduce((sum, b) => sum + (b.driver_receives || 0), 0);

  // Top 5 clients by spend
  const clientSpendMap: Record<string, { id: string; total: number; count: number }> = {};
  (allClients ?? []).forEach((b: any) => {
    if (!b.client_id) return;
    if (!clientSpendMap[b.client_id]) clientSpendMap[b.client_id] = { id: b.client_id, total: 0, count: 0 };
    clientSpendMap[b.client_id].total += (b.price || 0) + (b.additional_charges || 0);
    clientSpendMap[b.client_id].count++;
  });
  const topClientIds = Object.values(clientSpendMap)
    .sort((a, b) => b.total - a.total)
    .slice(0, 5)
    .map(c => c.id);

  const { data: topClientsData } = await supabase
    .from("clients")
    .select("id, name")
    .in("id", topClientIds.length > 0 ? topClientIds : ["00000000-0000-0000-0000-000000000000"]);

  const topClients = (topClientsData ?? []).map(c => ({
    id: c.id,
    name: c.name,
    total_bookings: clientSpendMap[c.id]?.count ?? 0,
    total_spent: clientSpendMap[c.id]?.total ?? 0,
  })).sort((a, b) => b.total_spent - a.total_spent);

  // Top 5 drivers by job count
  const driverJobMap: Record<string, number> = {};
  (allDrivers ?? []).forEach((b: any) => {
    if (!b.driver_id) return;
    driverJobMap[b.driver_id] = (driverJobMap[b.driver_id] ?? 0) + 1;
  });
  const topDriverIds = Object.entries(driverJobMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id]) => id);

  const { data: topDriversData } = await supabase
    .from("drivers")
    .select("id, name")
    .in("id", topDriverIds.length > 0 ? topDriverIds : ["00000000-0000-0000-0000-000000000000"]);

  const { data: ratingsData } = await supabase
    .from("driver_ratings")
    .select("driver_id, rating")
    .in("driver_id", topDriverIds.length > 0 ? topDriverIds : ["00000000-0000-0000-0000-000000000000"]);

  const ratingMap: Record<string, { sum: number; count: number }> = {};
  (ratingsData ?? []).forEach((r: any) => {
    if (!ratingMap[r.driver_id]) ratingMap[r.driver_id] = { sum: 0, count: 0 };
    ratingMap[r.driver_id].sum += r.rating;
    ratingMap[r.driver_id].count++;
  });

  const topDrivers = (topDriversData ?? []).map(d => ({
    id: d.id,
    name: d.name,
    total_jobs: driverJobMap[d.id] ?? 0,
    avg_rating: ratingMap[d.id] ? ratingMap[d.id].sum / ratingMap[d.id].count : 0,
  })).sort((a, b) => b.total_jobs - a.total_jobs);

  // Booking source breakdown
  const { data: sourcesData } = await supabase
    .from("bookings")
    .select("source")
    .neq("status", "Cancelled");

  const sourceMap: Record<string, number> = {};
  (sourcesData ?? []).forEach((b: any) => {
    const src = b.source ?? "Other";
    sourceMap[src] = (sourceMap[src] ?? 0) + 1;
  });

  const bookingSources = Object.entries(sourceMap).map(([source, count]) => ({ source, count }));

  // ---------- FOLLOW-UPS ----------
  // Pending Requests: bookings still awaiting confirmation
  const { data: pendingRows } = await supabase
    .from("bookings")
    .select("id, tvl_ref, service_type, direction, pickup, dropoff, date_time, created_at, client_id")
    .eq("status", "Pending")
    .order("created_at", { ascending: false })
    .limit(50);

  // Awaiting Return Trip: completed Arrival airport transfers with no return booking yet
  const sixtyDaysAgo = new Date();
  sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
  const { data: arrivalRows } = await supabase
    .from("bookings")
    .select("id, tvl_ref, pickup, dropoff, date_time, client_id, return_booking_id, notes")
    .eq("service_type", "Airport Transfer")
    .eq("direction", "Arrival")
    .eq("status", "Completed")
    .is("return_booking_id", null)
    .gte("date_time", sixtyDaysAgo.toISOString())
    .order("date_time", { ascending: false })
    .limit(100);

  const awaitingReturnRaw = (arrivalRows ?? []).filter((b: any) =>
    !(b.notes ?? "").includes("[NO_RETURN]")
  );

  // Hydrate client details for both lists
  const followupClientIds = Array.from(new Set([
    ...(pendingRows ?? []).map((b: any) => b.client_id).filter(Boolean),
    ...awaitingReturnRaw.map((b: any) => b.client_id).filter(Boolean),
  ]));

  const { data: followupClients } = await supabase
    .from("clients")
    .select("id, name, whatsapp, email, vip_tier")
    .in("id", followupClientIds.length > 0 ? followupClientIds : ["00000000-0000-0000-0000-000000000000"]);

  const clientLookup: Record<string, any> = {};
  (followupClients ?? []).forEach((c: any) => { clientLookup[c.id] = c; });

  const daysSince = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);

  const pending_requests = (pendingRows ?? []).map((b: any) => ({
    id: b.id,
    tvl_ref: b.tvl_ref,
    service_type: b.service_type,
    direction: b.direction,
    pickup: b.pickup,
    dropoff: b.dropoff,
    date_time: b.date_time,
    days_waiting: daysSince(b.created_at),
    client: clientLookup[b.client_id] ? {
      id: b.client_id,
      name: clientLookup[b.client_id].name,
      whatsapp: clientLookup[b.client_id].whatsapp,
      vip_tier: clientLookup[b.client_id].vip_tier,
    } : null,
  }));

  const awaiting_return = awaitingReturnRaw.map((b: any) => ({
    id: b.id,
    tvl_ref: b.tvl_ref,
    pickup: b.pickup,
    dropoff: b.dropoff,
    arrival_date: b.date_time,
    days_since_arrival: daysSince(b.date_time),
    client: clientLookup[b.client_id] ? {
      id: b.client_id,
      name: clientLookup[b.client_id].name,
      whatsapp: clientLookup[b.client_id].whatsapp,
      vip_tier: clientLookup[b.client_id].vip_tier,
    } : null,
  }));

  // Exclude Odoo-imported items from headline KPIs (operator only cares about new TVL workflow)
  // Odoo bookings have tvl_ref starting with "S" (e.g. S00017). New ones use TVL- prefix.
  // Odoo invoices have invoice_number containing "/" (e.g. INV/2026/00001). New ones use INV-XXXX.
  const isOdooBookingRef = (ref?: string | null) => !!ref && /^S\d/i.test(ref);
  const noDriverJobsNew = (noDriverJobs ?? []).filter((b: any) => !isOdooBookingRef(b.tvl_ref));

  const { data: unpaidInvoiceNumbers } = await supabase
    .from("invoices")
    .select("invoice_number")
    .not("status", "in", '("Paid","Cancelled")');
  const unpaidInvoicesNew = (unpaidInvoiceNumbers ?? []).filter((i: any) => !(i.invoice_number ?? "").includes("/"));

  // ---------- ARRIVAL FOLLOW-UPS ----------
  // Arrivals that happened ~3 days ago and have no follow_up record yet
  const threeDaysAgo = new Date();
  threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
  const fiveDaysAgo = new Date();
  fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);

  const { data: arrivalFollowUpRows } = await supabase
    .from("bookings")
    .select("id, tvl_ref, pickup, dropoff, date_time, client_id, driver_id")
    .eq("service_type", "Airport Transfer")
    .eq("direction", "Arrival")
    .in("status", ["Completed", "Active"])
    .gte("date_time", fiveDaysAgo.toISOString())
    .lte("date_time", new Date().toISOString())
    .order("date_time", { ascending: false })
    .limit(100);

  let arrivalFollowUps: any[] = [];
  if (arrivalFollowUpRows && arrivalFollowUpRows.length > 0) {
    const arrivalBookingIds = arrivalFollowUpRows.map((b: any) => b.id);

    // Find which of these already have a follow_up record
    // (gracefully handles case where follow_ups table doesn't exist yet)
    const { data: existingFollowUps, error: fuError } = await supabase
      .from("follow_ups")
      .select("booking_id")
      .in("booking_id", arrivalBookingIds);

    // If the table doesn't exist yet, skip follow-ups section entirely
    if (fuError && fuError.message?.includes("does not exist")) {
      return res.json({
        bookings_today: (todayBookings ?? []).length,
        bookings_this_week: (weekBookings ?? []).length,
        bookings_this_month: (monthBookings ?? []).length,
        upcoming_bookings: (upcomingBookings ?? []).length,
        revenue_today: calcRevenue(todayBookings as any),
        revenue_this_week: calcRevenue(weekBookings as any),
        revenue_this_month: calcRevenue(monthBookings as any),
        active_jobs: (activeJobs ?? []).length,
        jobs_without_driver: noDriverJobsNew.length,
        jobs_without_driver_total_including_odoo: (noDriverJobs ?? []).length,
        jobs_without_driver_first_id: noDriverJobsNew[0]?.id ?? null,
        pending_payments: (pendingPayments ?? []).length,
        outstanding_commissions: outstandingCommissions,
        pending_payouts: pendingPayouts,
        unpaid_invoices_count: unpaidInvoicesNew.length,
        unpaid_invoices_count_total_including_odoo: (unpaidInvoices ?? []).length,
        top_clients: topClients,
        top_drivers: topDrivers,
        booking_sources: bookingSources,
        pending_requests,
        awaiting_return,
        arrival_followups: [],
        todays_jobs: todaysJobs,
      });
    }

    const followedUpIds = new Set((existingFollowUps ?? []).map((f: any) => f.booking_id));
    const needsFollowUp = arrivalFollowUpRows.filter((b: any) => !followedUpIds.has(b.id));

    if (needsFollowUp.length > 0) {
      const clientIds = [...new Set(needsFollowUp.map((b: any) => b.client_id).filter(Boolean))];
      const driverIds = [...new Set(needsFollowUp.map((b: any) => b.driver_id).filter(Boolean))];

      const [{ data: fuClients }, { data: fuDrivers }] = await Promise.all([
        supabase.from("clients").select("id, name, whatsapp, vip_tier")
          .in("id", clientIds.length > 0 ? clientIds : ["00000000-0000-0000-0000-000000000000"]),
        supabase.from("drivers").select("id, name")
          .in("id", driverIds.length > 0 ? driverIds : ["00000000-0000-0000-0000-000000000000"]),
      ]);

      const clientMap: Record<string, any> = {};
      (fuClients ?? []).forEach((c: any) => { clientMap[c.id] = c; });
      const driverMap: Record<string, any> = {};
      (fuDrivers ?? []).forEach((d: any) => { driverMap[d.id] = d; });

      arrivalFollowUps = needsFollowUp.map((b: any) => ({
        id: b.id,
        tvl_ref: b.tvl_ref,
        arrival_date: b.date_time,
        days_since_arrival: daysSince(b.date_time),
        pickup: b.pickup,
        dropoff: b.dropoff,
        client_id: b.client_id,
        driver_id: b.driver_id,
        client: clientMap[b.client_id] ?? null,
        driver: driverMap[b.driver_id] ?? null,
      }));
    }
  }

  // Auto-create pending follow_up rows for any awaiting-return / arrival-followup
  // bookings that don't already have one — keeps Dashboard prompts and the
  // /follow-ups page in sync (single source of truth).
  try {
    const candidates: Array<{ booking_id: string; client_id: string | null; driver_id: string | null; due_date: string; }> = [];
    const todayIso = new Date().toISOString().split("T")[0];
    const dueFromArrival = (arrivalIso: string) => {
      const d = new Date(arrivalIso); d.setDate(d.getDate() + 3);
      const calc = d.toISOString().split("T")[0];
      return calc < todayIso ? todayIso : calc;
    };
    awaitingReturnRaw.forEach((b: any) => {
      if (b?.id) candidates.push({
        booking_id: b.id,
        client_id: b.client_id ?? null,
        driver_id: null,
        due_date: dueFromArrival(b.date_time),
      });
    });
    arrivalFollowUps.forEach((b: any) => {
      if (b?.id && !candidates.find(c => c.booking_id === b.id)) candidates.push({
        booking_id: b.id,
        client_id: b.client_id ?? null,
        driver_id: b.driver_id ?? null,
        due_date: dueFromArrival(b.arrival_date),
      });
    });

    if (candidates.length > 0) {
      const ids = candidates.map(c => c.booking_id);
      const { data: existing } = await supabase
        .from("follow_ups")
        .select("booking_id")
        .in("booking_id", ids);
      const have = new Set((existing ?? []).map((r: any) => r.booking_id));
      const toInsert = candidates.filter(c => !have.has(c.booking_id));
      if (toInsert.length > 0) {
        await supabase.from("follow_ups").insert(
          toInsert.map(c => ({ ...c, status: "pending" }))
        );
      }
    }
  } catch { /* table not yet created — skip silently */ }

  // Follow-ups pending count
  let followUpsPending = 0;
  let followUpsOverdue = 0;
  try {
    const todayDateStr = new Date().toISOString().split("T")[0];
    const [{ count: fpCount }, { count: foCount }] = await Promise.all([
      supabase.from("follow_ups").select("id", { count: "exact", head: true }).eq("status", "pending"),
      supabase.from("follow_ups").select("id", { count: "exact", head: true }).eq("status", "pending").lt("due_date", todayDateStr),
    ]);
    followUpsPending = fpCount ?? 0;
    followUpsOverdue = foCount ?? 0;
  } catch { /* table not yet created */ }

  return res.json({
    bookings_today: (todayBookings ?? []).length,
    bookings_this_week: (weekBookings ?? []).length,
    bookings_this_month: (monthBookings ?? []).length,
    upcoming_bookings: (upcomingBookings ?? []).length,
    revenue_today: calcRevenue(todayBookings as any),
    revenue_this_week: calcRevenue(weekBookings as any),
    revenue_this_month: calcRevenue(monthBookings as any),
    active_jobs: (activeJobs ?? []).length,
    jobs_without_driver: noDriverJobsNew.length,
    jobs_without_driver_total_including_odoo: (noDriverJobs ?? []).length,
    jobs_without_driver_first_id: noDriverJobsNew[0]?.id ?? null,
    pending_payments: (pendingPayments ?? []).length,
    outstanding_commissions: outstandingCommissions,
    pending_payouts: pendingPayouts,
    unpaid_invoices_count: unpaidInvoicesNew.length,
    unpaid_invoices_count_total_including_odoo: (unpaidInvoices ?? []).length,
    top_clients: topClients,
    top_drivers: topDrivers,
    booking_sources: bookingSources,
    pending_requests,
    awaiting_return,
    arrival_followups: arrivalFollowUps,
    follow_ups_pending: followUpsPending,
    follow_ups_overdue: followUpsOverdue,
    todays_jobs: todaysJobs,
  });
});

export default router;
