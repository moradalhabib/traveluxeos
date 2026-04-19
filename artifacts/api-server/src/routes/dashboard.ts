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
  ] = await Promise.all([
    supabase.from("bookings").select("price, additional_charges, status").gte("date_time", todayStart.toISOString()),
    supabase.from("bookings").select("price, additional_charges, status").gte("date_time", weekStart.toISOString()),
    supabase.from("bookings").select("price, additional_charges, status").gte("date_time", monthStart.toISOString()),
    supabase.from("bookings").select("id").eq("status", "Active"),
    supabase.from("bookings").select("id").in("status", ["Confirmed", "Driver Assigned"]).is("driver_id", null),
    supabase.from("bookings").select("id").in("payment_status", ["Unpaid", "Partial"]).neq("status", "Cancelled"),
    supabase.from("bookings").select("driver_id, tvl_commission, driver_receives, payment_method, commission_status, payout_status").eq("payment_method", "Cash").eq("commission_status", "Outstanding"),
    supabase.from("bookings").select("client_id, price, additional_charges").neq("status", "Cancelled"),
    supabase.from("bookings").select("driver_id").neq("status", "Cancelled"),
    supabase.from("bookings").select("id").gte("date_time", todayStart.toISOString()).not("status", "in", '("Cancelled","Completed")'),
    supabase.from("invoices").select("id").not("status", "in", '("Paid","Cancelled")'),
  ]);

  const calcRevenue = (bookings: { price: number; additional_charges: number; status: string }[] | null) =>
    (bookings ?? []).filter(b => !["Cancelled"].includes(b.status)).reduce((sum, b) => sum + (b.price || 0) + (b.additional_charges || 0), 0);

  const outstandingCommissions = (allDriverBreakdown ?? []).reduce((sum, b) => sum + (b.tvl_commission || 0), 0);

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

  return res.json({
    bookings_today: (todayBookings ?? []).length,
    bookings_this_week: (weekBookings ?? []).length,
    bookings_this_month: (monthBookings ?? []).length,
    upcoming_bookings: (upcomingBookings ?? []).length,
    revenue_today: calcRevenue(todayBookings as any),
    revenue_this_week: calcRevenue(weekBookings as any),
    revenue_this_month: calcRevenue(monthBookings as any),
    active_jobs: (activeJobs ?? []).length,
    jobs_without_driver: (noDriverJobs ?? []).length,
    pending_payments: (pendingPayments ?? []).length,
    outstanding_commissions: outstandingCommissions,
    pending_payouts: pendingPayouts,
    unpaid_invoices_count: (unpaidInvoices ?? []).length,
    top_clients: topClients,
    top_drivers: topDrivers,
    booking_sources: bookingSources,
  });
});

export default router;
