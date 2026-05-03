import { Router } from "express";
import { supabase, getServiceRoleClient } from "../lib/supabase";

const router = Router();

// Operations launched on the new TVL stack on 20-Apr-2026. Anything before
// that date came from the legacy Odoo import and is not part of the live
// numbers operators want to see — gate every aggregation by this cutoff so
// stale historical revenue/booking counts don't leak into headline KPIs.
const STATS_CUTOFF_ISO = "2026-04-20T00:00:00Z";
const clampStart = (d: Date) => {
  const cutoff = new Date(STATS_CUTOFF_ISO);
  return d < cutoff ? cutoff : d;
};

router.get("/summary", async (_req, res) => {
  const now = new Date();
  const todayStart = clampStart(new Date(new Date(now).setHours(0, 0, 0, 0)));
  const weekStartRaw = new Date(now); weekStartRaw.setDate(now.getDate() - 7);
  const weekStart = clampStart(weekStartRaw);
  const monthStartRaw = new Date(now); monthStartRaw.setDate(1); monthStartRaw.setHours(0, 0, 0, 0);
  const monthStart = clampStart(monthStartRaw);

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
    { data: openInvoices },
    { data: recentActivity },
  ] = await Promise.all([
    supabase.from("bookings").select("price, additional_charges, status").gte("date_time", todayStart.toISOString()),
    supabase.from("bookings").select("price, additional_charges, status").gte("date_time", weekStart.toISOString()),
    supabase.from("bookings").select("price, additional_charges, status").gte("date_time", monthStart.toISOString()),
    supabase.from("bookings").select("id").eq("status", "Active"),
    supabase.from("bookings").select("id, tvl_ref").in("status", ["Pending", "Confirmed"]).is("driver_id", null),
    supabase.from("bookings").select("id, tvl_ref").in("payment_status", ["Unpaid", "Partial"]).neq("status", "Cancelled"),
    // "Drivers owe TVL" — realized money only: a Cash booking only puts cash
    // in the driver's hand once payment_status='Paid'. Future/unpaid Cash
    // bookings do NOT count yet. Also require driver_id IS NOT NULL so the
    // headline cannot exceed the per-driver list visible on /commissions.
    supabase.from("bookings").select("driver_id, tvl_commission, payment_method, commission_status, date_time").eq("payment_method", "Cash").eq("commission_status", "Outstanding").eq("payment_status", "Paid").not("driver_id", "is", null).neq("status", "Cancelled"),
    // Top Clients — show realized client revenue (payment_status='Paid') so it
    // is comparable to the Finance page's Total Revenue. Including unpaid
    // future bookings made the Top Clients total bigger than the Total
    // Revenue KPI and operators flagged it as a bug.
    supabase.from("bookings").select("client_id, price, additional_charges").eq("payment_status", "Paid").neq("status", "Cancelled").gte("date_time", STATS_CUTOFF_ISO),
    supabase.from("bookings").select("driver_id").neq("status", "Cancelled").gte("date_time", STATS_CUTOFF_ISO),
    supabase.from("bookings").select("id").gte("date_time", todayStart.toISOString()).not("status", "in", '("Cancelled","Completed")'),
    supabase.from("invoices").select("id").not("status", "in", '("Paid","Cancelled")'),
    supabase.from("bookings").select("commission_amount, arrangement_fee_status").in("service_type", ["Hotel", "Apartment"]).gt("commission_amount", 0).neq("status", "Cancelled"),
    // Open invoices with the fields we need to detect "overdue" without a
    // second pass — applies the same 30-day rule the GET /invoices route
    // uses, but read-only here so we don't trigger writes from a summary
    // endpoint. Imported Odoo invoices (number contains "/") are excluded
    // from the overdue calc since they were already settled in the legacy
    // system. Total amount is summed for a headline £-figure on the alert.
    supabase
      .from("invoices")
      .select("id, status, generated_at, total_amount, invoice_number")
      .not("status", "in", '("Paid","Cancelled")'),
    // Recent activity feed — last few audit lines for the dashboard widget.
    // Best-effort: a missing table just yields a null/empty result.
    supabase
      .from("activity_log")
      .select("id, action_type, description, entity_type, entity_id, entity_label, operator_name, occurred_at")
      .order("occurred_at", { ascending: false })
      .limit(8),
  ]);

  // Same 30-day rule as routes/invoices.ts so the dashboard alert and the
  // /invoices page agree on what counts as Overdue. Already-Overdue rows
  // count too. Imported Odoo invoices excluded.
  const PAYMENT_TERMS_DAYS_LOCAL = 30;
  const nowMsLocal = Date.now();
  const overdueRows = (openInvoices ?? []).filter((inv: any) => {
    if (inv.status === "Overdue") return !(inv.invoice_number && String(inv.invoice_number).includes("/"));
    if (inv.status !== "Generated" && inv.status !== "Sent") return false;
    if (!inv.generated_at) return false;
    if (inv.invoice_number && String(inv.invoice_number).includes("/")) return false;
    const dueMs = new Date(inv.generated_at).getTime() + PAYMENT_TERMS_DAYS_LOCAL * 86_400_000;
    return nowMsLocal > dueMs;
  });
  const overdue_invoices_count = overdueRows.length;
  const overdue_invoices_total = overdueRows.reduce(
    (s: number, inv: any) => s + Number(inv.total_amount ?? 0),
    0,
  );
  const recent_activity = (recentActivity ?? []).slice(0, 6);

  // Suppliers owe TVL — outstanding supplier commissions across the live
  // ledger. Same predicates as the /commissions/supplier-receivables route
  // so the headline number on the dashboard always agrees with the page.
  // Intentionally NOT date-filtered: a supplier-commission line is owed
  // until it's collected, regardless of when the booking happened.
  const { data: supplierOutstandingRows } = await supabase
    .from("bookings")
    .select("supplier_id, supplier_commission, date_time")
    .not("supplier_id", "is", null)
    .gt("supplier_commission", 0)
    .neq("status", "Cancelled")
    .is("supplier_commission_collected_at", null);

  const calcRevenue = (bookings: { price: number; additional_charges: number; status: string }[] | null) =>
    (bookings ?? []).filter(b => !["Cancelled"].includes(b.status)).reduce((sum, b) => sum + (b.price || 0) + (b.additional_charges || 0), 0);

  const driverCommissionOutstanding = (allDriverBreakdown ?? []).reduce((sum: number, b: any) => sum + (b.tvl_commission || 0), 0);

  // Drivers with pending cash + drivers with overdue (>=30d oldest)
  const driverPendingMap: Record<string, { total: number; oldest: number }> = {};
  const dayMsLocal = 86400000;
  (allDriverBreakdown ?? []).forEach((b: any) => {
    if (!b.driver_id) return;
    const cur = driverPendingMap[b.driver_id] ?? { total: 0, oldest: 0 };
    cur.total += b.tvl_commission || 0;
    if (b.date_time) {
      const age = Math.floor((Date.now() - new Date(b.date_time).getTime()) / dayMsLocal);
      if (age > cur.oldest) cur.oldest = age;
    }
    driverPendingMap[b.driver_id] = cur;
  });
  const drivers_with_pending = Object.values(driverPendingMap).filter(v => v.total > 0).length;
  const drivers_with_overdue = Object.values(driverPendingMap).filter(v => v.total > 0 && v.oldest >= 30).length;
  const arrangementFeeOutstanding = (arrangementFeeBookings ?? [])
    .filter((b: any) => (b.arrangement_fee_status ?? "Outstanding") === "Outstanding")
    .reduce((sum: number, b: any) => sum + (b.commission_amount || 0), 0);

  // Supplier-side aggregates (suppliers owe TVL). Mirror the per-driver
  // shape so the dashboard card can show "X drivers + Y suppliers owing"
  // without a second round trip.
  const supplierPendingMap: Record<string, { total: number; oldest: number }> = {};
  (supplierOutstandingRows ?? []).forEach((b: any) => {
    if (!b.supplier_id) return;
    const cur = supplierPendingMap[b.supplier_id] ?? { total: 0, oldest: 0 };
    cur.total += Number(b.supplier_commission || 0);
    if (b.date_time) {
      const age = Math.floor((Date.now() - new Date(b.date_time).getTime()) / dayMsLocal);
      if (age > cur.oldest) cur.oldest = age;
    }
    supplierPendingMap[b.supplier_id] = cur;
  });
  const supplierCommissionOutstanding = Object.values(supplierPendingMap)
    .reduce((sum, v) => sum + v.total, 0);
  const suppliers_with_pending = Object.values(supplierPendingMap).filter(v => v.total > 0).length;
  const suppliers_with_overdue = Object.values(supplierPendingMap).filter(v => v.total > 0 && v.oldest >= 30).length;

  // Headline figure now spans every party that owes TVL commission:
  // drivers (cash), arrangement-fee bookings, and third-party suppliers.
  const outstandingCommissions =
    driverCommissionOutstanding + arrangementFeeOutstanding + supplierCommissionOutstanding;

  // ── Today's Jobs (next 5 upcoming today, by pickup time) ─────────────────
  const todayEnd = new Date(todayStart);
  todayEnd.setHours(23, 59, 59, 999);
  const { data: todaysJobsRaw } = await supabase
    .from("bookings")
    .select("id, tvl_ref, service_type, direction, pickup, dropoff, date_time, status, driver_id, client_id, vehicle_type, flight_number, supplier_id, as_directed_supplier_driver, suppliers(name)")
    .gte("date_time", now.toISOString())
    .lte("date_time", todayEnd.toISOString())
    .neq("status", "Cancelled")
    .neq("status", "Completed")
    .order("date_time", { ascending: true })
    .limit(5);
  const todayJobClientIds = Array.from(new Set((todaysJobsRaw ?? []).map((b: any) => b.client_id).filter(Boolean)));
  const todayJobDriverIds = Array.from(new Set((todaysJobsRaw ?? []).map((b: any) => b.driver_id).filter(Boolean)));

  // Batch-fetch flight status cache for AT jobs that have a flight number (cache-only, no AeroDataBox).
  const todayAtJobs = (todaysJobsRaw ?? []).filter((b: any) => b.service_type === "Airport Transfer" && b.flight_number && b.date_time);
  const flightDates: { fn: string; date: string }[] = [];
  todayAtJobs.forEach((b: any) => {
    const date = new Date(b.date_time).toISOString().split("T")[0];
    if (!flightDates.find(x => x.fn === b.flight_number && x.date === date)) {
      flightDates.push({ fn: b.flight_number, date });
    }
  });
  const flightCacheByKey: Record<string, any> = {};
  if (flightDates.length > 0) {
    const serviceClient = getServiceRoleClient() ?? supabase;
    await Promise.all(flightDates.map(async ({ fn, date }) => {
      const { data } = await serviceClient
        .from("flight_status_cache")
        .select("*")
        .eq("flight_number", fn)
        .eq("date", date)
        .single();
      if (data) flightCacheByKey[`${fn}|${date}`] = data;
    }));
  }

  const [{ data: todayJobClients }, { data: todayJobDrivers }] = await Promise.all([
    supabase.from("clients").select("id, name, vip_tier").in("id", todayJobClientIds.length ? todayJobClientIds : ["00000000-0000-0000-0000-000000000000"]),
    supabase.from("drivers").select("id, name").in("id", todayJobDriverIds.length ? todayJobDriverIds : ["00000000-0000-0000-0000-000000000000"]),
  ]);
  const todayJobClientMap: Record<string, any> = {};
  (todayJobClients ?? []).forEach((c: any) => { todayJobClientMap[c.id] = c; });
  const todayJobDriverMap: Record<string, any> = {};
  (todayJobDrivers ?? []).forEach((d: any) => { todayJobDriverMap[d.id] = d; });
  const todaysJobs = (todaysJobsRaw ?? []).map((b: any) => {
    const flightDate = b.date_time ? new Date(b.date_time).toISOString().split("T")[0] : null;
    const cachedFlight = (b.flight_number && flightDate) ? (flightCacheByKey[`${b.flight_number}|${flightDate}`] ?? null) : null;
    return {
      id: b.id,
      tvl_ref: b.tvl_ref,
      service_type: b.service_type,
      direction: b.direction,
      pickup: b.pickup,
      dropoff: b.dropoff,
      date_time: b.date_time,
      status: b.status,
      vehicle_type: b.vehicle_type,
      flight_number: b.flight_number ?? null,
      flight_status: cachedFlight ? {
        status:         cachedFlight.status,
        delay_minutes:  cachedFlight.delay_minutes ?? 0,
        terminal:       cachedFlight.terminal ?? null,
        last_updated:   cachedFlight.last_updated,
      } : null,
      client_name: todayJobClientMap[b.client_id]?.name ?? null,
      client_vip_tier: todayJobClientMap[b.client_id]?.vip_tier ?? null,
      driver_name: todayJobDriverMap[b.driver_id]?.name ?? null,
      driver_id: b.driver_id,
      // Supplier-driven context (W1-W5): the dashboard's Today's Jobs and
      // Starting-Soon strips both need to show "Supplier · Vehicle" instead
      // of "No driver" when a third-party supplier is providing the car.
      // Without these fields the frontend can't run isSupplierDrivenJob().
      supplier_id: b.supplier_id ?? null,
      supplier_name: (b as any).suppliers?.name ?? null,
      as_directed_supplier_driver: !!b.as_directed_supplier_driver,
    };
  });

  // "TVL owes drivers" — realized money only: TVL only owes the driver once
  // the client has paid TVL (payment_status='Paid'). Future Confirmed-but-
  // Unpaid Bank/Card jobs are not yet a payable.
  const { data: pendingPayoutBookings } = await supabase
    .from("bookings")
    .select("driver_receives")
    .in("payment_method", ["Bank Transfer", "Card"])
    .eq("payout_status", "Pending")
    .eq("payment_status", "Paid")
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

  // Driver ratings have been removed from the product per repeated operator
  // requests — top drivers are ranked purely by job count now.
  const topDrivers = (topDriversData ?? []).map(d => ({
    id: d.id,
    name: d.name,
    total_jobs: driverJobMap[d.id] ?? 0,
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
        driver_commission_outstanding: driverCommissionOutstanding + arrangementFeeOutstanding,
        supplier_commission_outstanding: supplierCommissionOutstanding,
        drivers_with_pending,
        drivers_with_overdue,
        suppliers_with_pending,
        suppliers_with_overdue,
        pending_payouts: pendingPayouts,
        unpaid_invoices_count: unpaidInvoicesNew.length,
        unpaid_invoices_count_total_including_odoo: (unpaidInvoices ?? []).length,
        overdue_invoices_count,
        overdue_invoices_total,
        recent_activity,
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
    driver_commission_outstanding: driverCommissionOutstanding + arrangementFeeOutstanding,
    supplier_commission_outstanding: supplierCommissionOutstanding,
    drivers_with_pending,
    drivers_with_overdue,
    suppliers_with_pending,
    suppliers_with_overdue,
    pending_payouts: pendingPayouts,
    unpaid_invoices_count: unpaidInvoicesNew.length,
    unpaid_invoices_count_total_including_odoo: (unpaidInvoices ?? []).length,
    overdue_invoices_count,
    overdue_invoices_total,
    recent_activity,
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

// ─── Revenue forecast ─────────────────────────────────────────────────────
router.get("/forecast", async (_req, res) => {
  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const end30 = new Date(startOfToday);
  end30.setDate(end30.getDate() + 30);
  const end7 = new Date(startOfToday);
  end7.setDate(end7.getDate() + 7);

  const { data: rows, error } = await supabase
    .from("bookings")
    .select("date_time, price, additional_charges, status, service_type")
    .gte("date_time", startOfToday.toISOString())
    .lt("date_time", end30.toISOString())
    .in("status", ["Confirmed", "Scheduled", "Active"])
    .order("date_time", { ascending: true });

  if (error) return res.status(500).json({ error: error.message });

  const fareOf = (b: any) => (Number(b.price) || 0) + (Number(b.additional_charges) || 0);

  let revenue_next_7 = 0;
  let revenue_next_30 = 0;
  let count_next_7 = 0;
  let count_next_30 = 0;
  const byServiceType: Record<string, number> = {};
  // Frontend expects each by_day row to carry a `count` (not `jobs`) and a
  // `revenue`, so we use the same keys here. Initialising every day in the
  // 30-day window prevents NaN downstream when reducing/summing.
  const byDayMap: Record<string, { date: string; revenue: number; count: number }> = {};

  for (let i = 0; i < 30; i++) {
    const d = new Date(startOfToday);
    d.setDate(d.getDate() + i);
    const key = d.toISOString().split("T")[0];
    byDayMap[key] = { date: key, revenue: 0, count: 0 };
  }

  (rows ?? []).forEach((b: any) => {
    const fare = fareOf(b);
    revenue_next_30 += fare;
    count_next_30 += 1;
    const t = new Date(b.date_time).getTime();
    if (t < end7.getTime()) {
      revenue_next_7 += fare;
      count_next_7 += 1;
    }
    const st = b.service_type ?? "Other";
    byServiceType[st] = (byServiceType[st] ?? 0) + fare;
    const key = new Date(b.date_time).toISOString().split("T")[0];
    if (byDayMap[key]) {
      byDayMap[key].revenue += fare;
      byDayMap[key].count += 1;
    }
  });

  return res.json({
    // New canonical keys consumed by the Intel module's Revenue Forecast tile.
    next_7_days_revenue: revenue_next_7,
    next_30_days_revenue: revenue_next_30,
    next_7_days_count: count_next_7,
    next_30_days_count: count_next_30,
    // Legacy aliases — kept so any older client build keeps working.
    revenue_next_7,
    revenue_next_30,
    by_service_type: Object.entries(byServiceType)
      .map(([service_type, revenue]) => ({ service_type, revenue }))
      .sort((a, b) => b.revenue - a.revenue),
    by_day: Object.values(byDayMap),
  });
});

// ─── GET /dashboard/lost-leads ──────────────────────────────────────────────
// Rollup of cancelled requests + cancelled follow-ups, grouped by reason.
// Operators use this on the Analytics page to see *why* leads are being lost
// so we can fix the cause (e.g. "Price too high" → revisit pricing tier).
//
// Period options: this_month | last_30 | this_year | all
// NULL/blank reasons fall into an "Unspecified" bucket so the chart never
// hides volume.
router.get("/lost-leads", async (req, res) => {
  const period = String(req.query.period ?? "this_month");

  const now = new Date();
  let startIso: string | null = null;
  if (period === "this_month") {
    const s = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
    startIso = s.toISOString();
  } else if (period === "last_30") {
    const s = new Date(now);
    s.setDate(now.getDate() - 30);
    startIso = s.toISOString();
  } else if (period === "this_year") {
    const s = new Date(now.getFullYear(), 0, 1, 0, 0, 0);
    startIso = s.toISOString();
  } else if (period === "all") {
    // No lower bound, but still gate by the live-stack cutoff so legacy
    // Odoo cancellations don't pollute the chart.
    startIso = STATS_CUTOFF_ISO;
  } else {
    return res.status(400).json({ error: "Invalid period" });
  }

  const effectiveStart = new Date(startIso) < new Date(STATS_CUTOFF_ISO)
    ? STATS_CUTOFF_ISO
    : startIso;

  const [reqRes, fuRes] = await Promise.all([
    supabase
      .from("requests")
      .select("cancellation_reason")
      .eq("status", "Cancelled")
      .gte("cancelled_at", effectiveStart),
    supabase
      .from("follow_ups")
      .select("cancellation_reason")
      .eq("status", "cancelled")
      .gte("cancelled_at", effectiveStart),
  ]);

  if (reqRes.error) return res.status(500).json({ error: reqRes.error.message });
  if (fuRes.error)  return res.status(500).json({ error: fuRes.error.message });

  // Normalise: trim, collapse blanks → "Unspecified". Keeps the bucket
  // aligned with the cancel dialog's stock list when the reason matches
  // a known one verbatim.
  const norm = (raw: string | null | undefined): string => {
    const v = (raw ?? "").trim();
    return v.length > 0 ? v : "Unspecified";
  };

  const map = new Map<string, { request_count: number; follow_up_count: number }>();
  for (const r of reqRes.data ?? []) {
    const key = norm((r as any).cancellation_reason);
    const e = map.get(key) ?? { request_count: 0, follow_up_count: 0 };
    e.request_count += 1;
    map.set(key, e);
  }
  for (const f of fuRes.data ?? []) {
    const key = norm((f as any).cancellation_reason);
    const e = map.get(key) ?? { request_count: 0, follow_up_count: 0 };
    e.follow_up_count += 1;
    map.set(key, e);
  }

  const rows = Array.from(map.entries())
    .map(([reason, c]) => ({
      reason,
      request_count: c.request_count,
      follow_up_count: c.follow_up_count,
      total: c.request_count + c.follow_up_count,
    }))
    .sort((a, b) => b.total - a.total);

  const total_request   = rows.reduce((s, r) => s + r.request_count, 0);
  const total_follow_up = rows.reduce((s, r) => s + r.follow_up_count, 0);

  return res.json({
    period,
    since: effectiveStart,
    rows,
    total_request,
    total_follow_up,
    total_all: total_request + total_follow_up,
  });
});

export default router;
