import { Router } from "express";
import { supabase } from "../lib/supabase";

const router = Router();

router.get("/summary", async (req, res) => {
  const { date_from, date_to, service_type, operator_id } = req.query;

  let query = supabase
    .from("bookings")
    .select(`
      id, tvl_ref, client_id, service_type, date_time, price,
      additional_charges, tvl_commission, driver_receives,
      payment_method, payment_status, cancellation_fee, status,
      commission_status, payout_status,
      operator_id, driver_id,
      clients(name),
      drivers(id, name),
      users!bookings_operator_id_fkey(name)
    `)
    .neq("status", "Cancelled");

  if (date_from) query = query.gte("date_time", String(date_from));
  if (date_to) query = query.lte("date_time", String(date_to));
  if (service_type) query = query.eq("service_type", String(service_type));
  if (operator_id) query = query.eq("operator_id", String(operator_id));

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  const bookings = (data ?? []).map((b: any) => ({
    ...b,
    client_name: b.clients?.name ?? null,
    driver_name: b.drivers?.name ?? null,
    operator_name: b.users?.name ?? null,
    clients: undefined,
    drivers: undefined,
    users: undefined,
  }));

  const total_revenue = bookings.reduce((s, b) => s + (b.price ?? 0) + (b.additional_charges ?? 0), 0);
  const total_commission = bookings.reduce((s, b) => s + (b.tvl_commission ?? 0), 0);
  const total_driver_payouts = bookings.reduce((s, b) => s + (b.driver_receives ?? 0), 0);

  // Outstanding client payments
  const outstanding_payments = bookings
    .filter(b => b.payment_status === "Unpaid" || b.payment_status === "Partial")
    .sort((a, b) => new Date(a.date_time ?? 0).getTime() - new Date(b.date_time ?? 0).getTime());

  // Cancellation fees
  const { data: cancelledBookings } = await supabase
    .from("bookings")
    .select("cancellation_fee")
    .eq("status", "Cancelled")
    .gt("cancellation_fee", 0);
  const cancellation_fees = (cancelledBookings ?? []).reduce((s: number, b: any) => s + (b.cancellation_fee ?? 0), 0);

  // Revenue breakdown by service type
  const serviceMap: Record<string, { count: number; revenue: number; commission: number }> = {};
  bookings.forEach(b => {
    const svc = b.service_type || "Unknown";
    if (!serviceMap[svc]) serviceMap[svc] = { count: 0, revenue: 0, commission: 0 };
    serviceMap[svc].count++;
    serviceMap[svc].revenue += (b.price ?? 0) + (b.additional_charges ?? 0);
    serviceMap[svc].commission += b.tvl_commission ?? 0;
  });
  const service_breakdown = Object.entries(serviceMap)
    .map(([service_type, v]) => ({ service_type, ...v }))
    .sort((a, b) => b.revenue - a.revenue);

  // Per-driver commission breakdown
  const driverMap: Record<string, {
    driver_id: string;
    driver_name: string;
    jobs: number;
    commission_owed: number;       // TVL commission owed from cash jobs
    commission_outstanding: number; // Only outstanding ones
    driver_payout: number;          // Driver's net payout
    payout_pending: number;         // Pending payouts
  }> = {};

  bookings.forEach(b => {
    if (!b.driver_id) return;
    if (!driverMap[b.driver_id]) {
      driverMap[b.driver_id] = {
        driver_id: b.driver_id,
        driver_name: b.driver_name ?? "Unknown Driver",
        jobs: 0,
        commission_owed: 0,
        commission_outstanding: 0,
        driver_payout: 0,
        payout_pending: 0,
      };
    }
    const d = driverMap[b.driver_id];
    d.jobs++;
    d.commission_owed += b.tvl_commission ?? 0;
    if (b.commission_status === "Outstanding") {
      d.commission_outstanding += b.tvl_commission ?? 0;
    }
    d.driver_payout += b.driver_receives ?? 0;
    if (b.payout_status === "Pending") {
      d.payout_pending += b.driver_receives ?? 0;
    }
  });

  const driver_commission_breakdown = Object.values(driverMap)
    .sort((a, b) => b.commission_outstanding - a.commission_outstanding);

  // Operator performance
  const operatorMap: Record<string, { name: string; count: number; revenue: number }> = {};
  bookings.forEach(b => {
    if (!b.operator_id) return;
    if (!operatorMap[b.operator_id]) operatorMap[b.operator_id] = { name: b.operator_name ?? "Unknown", count: 0, revenue: 0 };
    operatorMap[b.operator_id].count++;
    operatorMap[b.operator_id].revenue += (b.price ?? 0) + (b.additional_charges ?? 0);
  });
  const operator_performance = Object.entries(operatorMap)
    .map(([id, v]) => ({ operator_id: id, operator_name: v.name, total_bookings: v.count, total_revenue: v.revenue }))
    .sort((a, b) => b.total_revenue - a.total_revenue);

  return res.json({
    total_revenue,
    total_commission,
    total_driver_payouts,
    outstanding_payments,
    cancellation_fees,
    service_breakdown,
    driver_commission_breakdown,
    operator_performance,
    bookings_detail: bookings,
  });
});

export default router;
