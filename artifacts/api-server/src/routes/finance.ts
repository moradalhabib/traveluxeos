import { Router } from "express";
import { supabase } from "../lib/supabase";

const router = Router();

router.get("/summary", async (req, res) => {
  const { date_from, date_to, service_type, operator_id } = req.query;

  let query = supabase
    .from("bookings")
    .select("id, tvl_ref, client_id, service_type, date_time, price, additional_charges, tvl_commission, driver_receives, payment_method, payment_status, cancellation_fee, status, operator_id, clients(name), users!bookings_operator_id_fkey(name)")
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
    operator_name: b.users?.name ?? null,
    clients: undefined,
    users: undefined,
  }));

  const total_revenue = bookings.reduce((s, b) => s + (b.price ?? 0) + (b.additional_charges ?? 0), 0);
  const total_commission = bookings.reduce((s, b) => s + (b.tvl_commission ?? 0), 0);
  const total_driver_payouts = bookings.reduce((s, b) => s + (b.driver_receives ?? 0), 0);

  const outstanding_payments = bookings.filter(b => b.payment_status === "Unpaid" || b.payment_status === "Partial")
    .sort((a, b) => new Date(a.date_time ?? 0).getTime() - new Date(b.date_time ?? 0).getTime());

  const { data: cancelledBookings } = await supabase
    .from("bookings")
    .select("cancellation_fee")
    .eq("status", "Cancelled")
    .gt("cancellation_fee", 0);

  const cancellation_fees = (cancelledBookings ?? []).reduce((s: number, b: any) => s + (b.cancellation_fee ?? 0), 0);

  // Operator performance
  const operatorMap: Record<string, { name: string; count: number; revenue: number }> = {};
  bookings.forEach(b => {
    if (!b.operator_id) return;
    if (!operatorMap[b.operator_id]) operatorMap[b.operator_id] = { name: b.operator_name ?? "Unknown", count: 0, revenue: 0 };
    operatorMap[b.operator_id].count++;
    operatorMap[b.operator_id].revenue += (b.price ?? 0) + (b.additional_charges ?? 0);
  });

  const operator_performance = Object.entries(operatorMap).map(([id, v]) => ({
    operator_id: id,
    operator_name: v.name,
    total_bookings: v.count,
    total_revenue: v.revenue,
  })).sort((a, b) => b.total_revenue - a.total_revenue);

  return res.json({
    total_revenue,
    total_commission,
    total_driver_payouts,
    outstanding_payments,
    cancellation_fees,
    operator_performance,
    bookings_detail: bookings,
  });
});

export default router;
