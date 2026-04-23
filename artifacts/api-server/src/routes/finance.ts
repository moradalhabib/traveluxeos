import { Router } from "express";
import { supabase, getUserFromToken } from "../lib/supabase";

const router = Router();

// Guard: Finance is open to super_admin + admin + operator. /profit stays super_admin-only via requireSuperAdmin.
// Profit endpoint has an EXTRA super_admin-only check below.
router.use(async (req, res, next) => {
  const user = await getUserFromToken(req.headers.authorization);
  if (!user || !["super_admin", "admin", "operator"].includes(user.role)) {
    return res.status(403).json({ error: "Finance access denied." });
  }
  (req as any).authedUser = user;
  return next();
});

// Profit endpoint guard — super_admin only
function requireSuperAdmin(req: any, res: any, next: any) {
  const user = req.authedUser;
  if (!user || user.role !== "super_admin") {
    return res.status(403).json({ error: "Access denied: Profit data is restricted to Super Admins only." });
  }
  return next();
}

// New TVL ops launched 20-Apr-2026; everything before that is legacy Odoo
// data and must not appear in headline finance figures.
const STATS_CUTOFF_ISO = "2026-04-20T00:00:00Z";

router.get("/summary", async (req, res) => {
  const { date_from, date_to, service_type, operator_id } = req.query;

  // Always clamp the lower bound to the stats cutoff. If the operator picks
  // an earlier date_from we still won't return pre-cutoff revenue.
  const effectiveFrom = date_from && new Date(String(date_from)) > new Date(STATS_CUTOFF_ISO)
    ? String(date_from)
    : STATS_CUTOFF_ISO;

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
    .neq("status", "Cancelled")
    .gte("date_time", effectiveFrom);

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

  // Pull every additional-vehicle row tied to this booking set so multi-car
  // jobs report the FULL client-paid revenue + commissions instead of just
  // the primary leg. Cancelled-booking rows are already excluded above.
  const bookingIds = bookings.map(b => b.id);
  let extraVehicles: any[] = [];
  if (bookingIds.length > 0) {
    const { data: bv } = await supabase
      .from("booking_vehicles")
      .select("booking_id, client_share, tvl_commission, driver_receives")
      .in("booking_id", bookingIds);
    extraVehicles = bv ?? [];
  }
  const extras_revenue = extraVehicles.reduce((s, v) => s + (Number(v.client_share) || 0), 0);
  const extras_commission = extraVehicles.reduce((s, v) => s + (Number(v.tvl_commission) || 0), 0);
  const extras_payouts = extraVehicles.reduce((s, v) => s + (Number(v.driver_receives) || 0), 0);

  const total_revenue =
    bookings.reduce((s, b) => s + (b.price ?? 0) + (b.additional_charges ?? 0), 0) + extras_revenue;
  const total_commission =
    bookings.reduce((s, b) => s + (b.tvl_commission ?? 0), 0) + extras_commission;
  const total_driver_payouts =
    bookings.reduce((s, b) => s + (b.driver_receives ?? 0), 0) + extras_payouts;

  // Outstanding client payments
  const outstanding_payments = bookings
    .filter(b => b.payment_status === "Unpaid" || b.payment_status === "Partial")
    .sort((a, b) => new Date(a.date_time ?? 0).getTime() - new Date(b.date_time ?? 0).getTime());

  // Cancellation fees — gated by the same era cutoff so legacy Odoo
  // cancellations don't reappear in TVL-stack finance totals.
  const { data: cancelledBookings } = await supabase
    .from("bookings")
    .select("cancellation_fee")
    .eq("status", "Cancelled")
    .gt("cancellation_fee", 0)
    .gte("date_time", effectiveFrom);
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
    // Group bookings without an operator under the "Imported (Odoo)" bucket so
    // the Operator Performance panel reflects that they came from a legacy
    // import rather than an unknown TVL operator.
    const opKey = b.operator_id ?? "__imported__";
    const opName = b.operator_id ? (b.operator_name ?? "Unknown") : "Imported (Odoo)";
    if (!operatorMap[opKey]) operatorMap[opKey] = { name: opName, count: 0, revenue: 0 };
    operatorMap[opKey].count++;
    operatorMap[opKey].revenue += (b.price ?? 0) + (b.additional_charges ?? 0);
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

// ── PROFIT endpoint — Super Admin ONLY ───────────────────────────────────────
// Returns: per-service-type commission totals + completed/invoiced booking breakdown
router.get("/profit", requireSuperAdmin, async (req, res) => {
  const { date_from, date_to } = req.query;

  // Defense-in-depth: call SECURITY DEFINER RPC that re-checks super_admin at the DB level.
  // Even if the route guard were bypassed, the function raises and Postgres blocks the data.
  const { data, error } = await supabase.rpc("get_profit_breakdown", {
    p_from: date_from ? String(date_from) : null,
    p_to:   date_to   ? String(date_to)   : null,
  });
  if (error) {
    // The function raises 'Access denied' for non-super_admin
    const isAccessDenied = /access denied/i.test(error.message ?? "");
    return res.status(isAccessDenied ? 403 : 500).json({ error: error.message });
  }

  // Map service_type → bucket label requested by spec.
  // "As Directed" was previously falling through to the generic "Other"
  // bucket because it has no keyword match — operators flagged it as the
  // top-revenue service that wasn't appearing on the Profit tab. Adding an
  // explicit branch surfaces it as its own bucket.
  const bucketFor = (svc: string | null | undefined): string => {
    const s = (svc ?? "").toLowerCase();
    if (s.includes("airport"))     return "Airport Transfer";
    if (s.includes("apartment") || s.includes("accommodation")) return "Apartment";
    if (s.includes("rental") || s.includes("car rental"))       return "Car Rental";
    if (s.includes("as directed") || s === "as directed" || s.includes("directed")) return "As Directed";
    if (s.includes("tour"))        return "Tour";
    return svc || "Other";
  };

  const breakdown = (data ?? []).map((b: any) => ({
    booking_id:     b.booking_id,
    tvl_ref:        b.tvl_ref,
    date_time:      b.date_time,
    service_type:   b.service_type,
    bucket:         bucketFor(b.service_type),
    client_name:    b.client_name ?? "—",
    price:          Number(b.price ?? 0),
    tvl_commission: Number(b.tvl_commission ?? 0),
    payment_status: b.payment_status,
  }));

  // Aggregate per bucket
  const summary: Record<string, number> = {
    "Airport Transfer": 0,
    "Tour": 0,
    "As Directed": 0,
    "Car Rental": 0,
    "Apartment": 0,
  };
  let other = 0;
  for (const r of breakdown) {
    if (summary[r.bucket] !== undefined) summary[r.bucket] += r.tvl_commission;
    else other += r.tvl_commission;
  }
  if (other > 0) summary["Other"] = other;

  const total_profit = breakdown.reduce((s: number, r: { tvl_commission: number }) => s + r.tvl_commission, 0);

  return res.json({
    summary,
    total_profit,
    breakdown,
    booking_count: breakdown.length,
  });
});

export default router;
