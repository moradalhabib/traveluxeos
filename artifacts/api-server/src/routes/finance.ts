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
      supplier_id, supplier_commission, supplier_commission_collected_at, supplier_cost,
      clients(name),
      drivers(id, name),
      suppliers(id, name),
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
    supplier_name: b.suppliers?.name ?? null,
    operator_name: b.users?.name ?? null,
    clients: undefined,
    drivers: undefined,
    suppliers: undefined,
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
  // Driver-side TVL commission only — kept as a separate field so the UI can
  // still call out "from driver jobs" if it wants the breakdown.
  const total_driver_commission =
    bookings.reduce((s, b) => s + (b.tvl_commission ?? 0), 0) + extras_commission;
  // Supplier-side markup TVL earns from suppliers (e.g. £20 markup on a £480
  // hotel cost we resell at £500). Filtered to the same period as everything
  // else on the page; bookings without a supplier_id contribute 0.
  const total_supplier_commission_in_period = bookings
    .filter((b: any) => b.supplier_id)
    .reduce((s: number, b: any) => s + (Number(b.supplier_commission) || 0), 0);
  // Headline "TVL Commission" — drivers + suppliers combined so the Finance
  // KPI matches what the dashboard shows. Old field name kept for callers
  // that read s.total_commission expecting the combined figure.
  const total_commission = total_driver_commission + total_supplier_commission_in_period;
  const total_driver_payouts =
    bookings.reduce((s, b) => s + (b.driver_receives ?? 0), 0) + extras_payouts;
  // What TVL owes suppliers for services they provided (their gross cost,
  // separate from the markup commission TVL earns). Must appear in Pending
  // Payouts alongside driver payouts — omitting it understated the total.
  const total_supplier_payouts =
    bookings
      .filter((b: any) => b.supplier_id && (b.supplier_cost ?? 0) > 0)
      .reduce((s: number, b: any) => s + Number(b.supplier_cost ?? 0), 0);

  // Outstanding client payments
  const outstanding_payments = bookings
    .filter(b => b.payment_status === "Unpaid" || b.payment_status === "Partial")
    .sort((a, b) => new Date(a.date_time ?? 0).getTime() - new Date(b.date_time ?? 0).getTime());

  // Supplier receivables (suppliers owe TVL the markup commission). Scoped
  // to the SAME period as everything else on this page so the headline
  // "Outstanding Commissions" KPI is consistent with the per-driver
  // outstanding totals (which are also period-scoped via the parent query).
  // The /commissions Suppliers tab still shows the all-time view through
  // its own dedicated endpoint.
  let supplierReceivablesQ = supabase
    .from("bookings")
    .select("supplier_id, supplier_commission, supplier_commission_collected_at, date_time, service_type, operator_id")
    .not("supplier_id", "is", null)
    .gt("supplier_commission", 0)
    .neq("status", "Cancelled")
    .gte("date_time", effectiveFrom);
  if (date_to)      supplierReceivablesQ = supplierReceivablesQ.lte("date_time",   String(date_to));
  // Mirror the same service_type / operator_id predicates used on the main
  // bookings query — otherwise the page applies a filter and the supplier
  // outstanding total stays bigger than the visible booking set, which the
  // operator reads as a double-count bug.
  if (service_type) supplierReceivablesQ = supplierReceivablesQ.eq("service_type", String(service_type));
  if (operator_id)  supplierReceivablesQ = supplierReceivablesQ.eq("operator_id",  String(operator_id));
  const { data: supplierReceivableRows } = await supplierReceivablesQ;
  const supplierOutstandingRows = (supplierReceivableRows ?? [])
    .filter((r: any) => !r.supplier_commission_collected_at);
  const total_supplier_receivables_outstanding = supplierOutstandingRows
    .reduce((s: number, r: any) => s + Number(r.supplier_commission ?? 0), 0);
  const total_supplier_receivables_collected = (supplierReceivableRows ?? [])
    .filter((r: any) => !!r.supplier_commission_collected_at)
    .reduce((s: number, r: any) => s + Number(r.supplier_commission ?? 0), 0);
  // Number of distinct suppliers with at least one outstanding line in the
  // period. Used by the dashboard-style subtitle on the Outstanding card.
  const suppliers_with_pending = new Set(
    supplierOutstandingRows.map((r: any) => r.supplier_id),
  ).size;

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

  // Per-supplier markup breakdown — drives the new "Suppliers" tab on the
  // Finance page. Mirrors the per-driver shape so the UI can render the same
  // card pattern. "outstanding" = supplier_commission rows in the period
  // that have NOT been collected yet.
  const supplierMap: Record<string, {
    supplier_id: string;
    supplier_name: string;
    jobs: number;
    commission_owed: number;        // Markup TVL earned from this supplier in period
    commission_outstanding: number; // Of which still uncollected
  }> = {};
  bookings.forEach((b: any) => {
    if (!b.supplier_id) return;
    const amount = Number(b.supplier_commission) || 0;
    if (amount <= 0) return;
    if (!supplierMap[b.supplier_id]) {
      supplierMap[b.supplier_id] = {
        supplier_id: b.supplier_id,
        supplier_name: b.supplier_name ?? "Unknown supplier",
        jobs: 0,
        commission_owed: 0,
        commission_outstanding: 0,
      };
    }
    const sup = supplierMap[b.supplier_id];
    sup.jobs++;
    sup.commission_owed += amount;
    if (!b.supplier_commission_collected_at) {
      sup.commission_outstanding += amount;
    }
  });
  const supplier_commission_breakdown = Object.values(supplierMap)
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
    total_commission,                      // Drivers + suppliers (combined)
    total_driver_commission,               // Drivers only — for breakdown if UI wants it
    total_supplier_commission_in_period,   // Suppliers only — same scope as the bookings query
    total_driver_payouts,
    total_supplier_payouts,                // What TVL owes suppliers for services rendered
    outstanding_payments,
    cancellation_fees,
    service_breakdown,
    driver_commission_breakdown,
    supplier_commission_breakdown,         // Per-supplier rows for the new Suppliers tab
    operator_performance,
    total_supplier_receivables_outstanding, // Now period-scoped
    total_supplier_receivables_collected,
    suppliers_with_pending,                // Distinct supplier count for subtitle
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

  // Migration guard: detect whether the new RPC (with supplier_commission +
  // loosened status filter) is live. If the column is missing on every row,
  // the page must NOT claim "+ supplier markup" or it would understate.
  const includes_supplier_markup = Array.isArray(data)
    && data.length > 0
    && Object.prototype.hasOwnProperty.call(data[0], "supplier_commission");

  const breakdown = (data ?? []).map((b: any) => {
    const tvl     = Number(b.tvl_commission ?? 0);
    const sup     = Number(b.supplier_commission ?? 0);
    return {
      booking_id:          b.booking_id,
      tvl_ref:             b.tvl_ref,
      date_time:           b.date_time,
      service_type:        b.service_type,
      bucket:              bucketFor(b.service_type),
      client_name:         b.client_name ?? "—",
      price:               Number(b.price ?? 0),
      tvl_commission:      tvl,
      supplier_commission: sup,
      total_commission:    tvl + sup,
      supplier_id:         b.supplier_id ?? null,
      supplier_name:       b.supplier_name ?? null,
      payment_status:      b.payment_status,
      status:              b.status,
    };
  });

  // Aggregate per bucket — combined profit = driver-side TVL commission + supplier markup
  const summary: Record<string, number> = {
    "Airport Transfer": 0,
    "Tour": 0,
    "As Directed": 0,
    "Car Rental": 0,
    "Apartment": 0,
  };
  let other = 0;
  for (const r of breakdown) {
    if (summary[r.bucket] !== undefined) summary[r.bucket] += r.total_commission;
    else other += r.total_commission;
  }
  if (other > 0) summary["Other"] = other;

  const total_driver_profit   = breakdown.reduce((s: number, r: { tvl_commission: number })      => s + r.tvl_commission,      0);
  const total_supplier_profit = breakdown.reduce((s: number, r: { supplier_commission: number }) => s + r.supplier_commission, 0);
  const total_profit          = total_driver_profit + total_supplier_profit;

  return res.json({
    summary,
    total_profit,
    total_driver_profit,
    total_supplier_profit,
    breakdown,
    booking_count: breakdown.length,
    includes_supplier_markup,
  });
});

export default router;
