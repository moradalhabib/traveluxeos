import { Router } from "express";
import { supabase, auditLog, getUserFromToken } from "../lib/supabase";
import { logActivity } from "../lib/activity";

const router = Router();

// Extract numeric portion of a TVL staff number (e.g. "TVL 03" → 3, "TVL12" → 12).
// Returns Number.POSITIVE_INFINITY when missing so unassigned drivers always
// sort to the BOTTOM of the list (per operator spec).
function staffNoOrder(staff: string | null | undefined): number {
  if (!staff) return Number.POSITIVE_INFINITY;
  const m = String(staff).match(/(\d+)/);
  if (!m) return Number.POSITIVE_INFINITY;
  return parseInt(m[1], 10);
}

router.get("/", async (req, res) => {
  const { status } = req.query;
  let query = supabase.from("drivers").select("*, driver_ratings(rating), bookings(id, status)");

  if (status) query = query.eq("status", String(status));

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  const result = (data ?? []).map((d: any) => {
    const ratings = d.driver_ratings ?? [];
    const avg_rating = ratings.length > 0 ? ratings.reduce((s: number, r: any) => s + r.rating, 0) / ratings.length : 0;
    const bookings = (d.bookings ?? []).filter((b: any) => b.status !== "Cancelled");
    return {
      ...d,
      driver_ratings: undefined,
      bookings: undefined,
      avg_rating: Math.round(avg_rating * 10) / 10,
      total_jobs: bookings.length,
    };
  });

  // TVL 01, TVL 02, TVL 03 ... unassigned (null/blank staff_no) at the bottom,
  // alphabetised within the unassigned tail.
  result.sort((a: any, b: any) => {
    const oa = staffNoOrder(a.staff_no);
    const ob = staffNoOrder(b.staff_no);
    if (oa !== ob) return oa - ob;
    return String(a.name ?? "").localeCompare(String(b.name ?? ""));
  });

  return res.json(result);
});

// Reset all TVL staff numbers — operator-initiated wipe of legacy Odoo
// numbers. ONLY clears the `staff_no` column. Bookings, commissions, ratings,
// and job history are completely untouched (they reference drivers by id).
router.post("/reset-staff-numbers", async (req, res) => {
  const user = await getUserFromToken(req.headers.authorization);
  if (!user || user.role !== "super_admin") {
    return res.status(403).json({ error: "Only Super Admin can reset TVL numbers." });
  }
  const { count: before } = await supabase
    .from("drivers")
    .select("id", { count: "exact", head: true })
    .not("staff_no", "is", null);

  const { error } = await supabase
    .from("drivers")
    .update({ staff_no: null })
    .not("id", "is", null);

  if (error) return res.status(500).json({ error: error.message });

  await auditLog(
    "reset_tvl_staff_numbers",
    "drivers",
    "all",
    user.id,
    `Cleared TVL staff numbers on ${before ?? 0} driver(s).`
  );
  await logActivity({
    action_type: "drivers_tvl_reset",
    description: `Reset TVL staff numbers on ${before ?? 0} driver(s) — bookings & commissions untouched.`,
    entity_type: "drivers",
    entity_id: null,
    entity_label: `${before ?? 0} cleared`,
    operator_id: user.id,
    operator_name: user.name ?? null,
  });

  return res.json({ ok: true, cleared: before ?? 0 });
});

// Whitelist of mutable driver columns. Anything not in this set is ignored
// so callers can't write columns we don't manage from the UI.
const DRIVER_COLUMNS = new Set([
  "name", "staff_no", "whatsapp", "email",
  "vehicle_model", "vehicle_year", "vehicle_type", "plate",
  "status", "notes", "own_vehicle",
]);

function pickDriverFields(body: Record<string, any>) {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(body || {})) {
    if (!DRIVER_COLUMNS.has(k)) continue;
    if (v === "" || v === undefined) continue;
    out[k] = v;
  }
  return out;
}

router.post("/", async (req, res) => {
  const user = await getUserFromToken(req.headers.authorization);
  const payload = pickDriverFields(req.body);
  const { data, error } = await supabase.from("drivers").insert(payload).select().single();
  if (error) return res.status(400).json({ error: error.message });
  await auditLog("create_driver", "driver", data.id, user?.id ?? null, `Created driver ${data.name}`);
  await logActivity({
    action_type: "driver_created",
    description: `Driver ${data.name} created`,
    entity_type: "driver",
    entity_id: data.id,
    entity_label: data.name ?? null,
    operator_id: user?.id ?? null,
    operator_name: user?.name ?? null,
  });
  return res.status(201).json({ ...data, avg_rating: 0, total_jobs: 0 });
});

router.get("/:id", async (req, res) => {
  const { data: driver, error } = await supabase
    .from("drivers")
    .select("*")
    .eq("id", req.params.id)
    .single();

  if (error || !driver) return res.status(404).json({ error: "Driver not found" });

  const [
    { data: bookings },
    { data: ratings },
    { data: commissionData },
  ] = await Promise.all([
    supabase.from("bookings")
      .select("*, clients(name)")
      .eq("driver_id", req.params.id)
      .order("date_time", { ascending: false }),
    supabase.from("driver_ratings")
      .select("*, users(name)")
      .eq("driver_id", req.params.id)
      .order("rated_at", { ascending: false }),
    supabase.from("bookings")
      .select("id, tvl_ref, date_time, price, additional_charges, tvl_commission, driver_receives, payment_method, commission_status, payout_status, clients(name)")
      .eq("driver_id", req.params.id)
      .order("date_time", { ascending: false }),
  ]);

  const enrichedBookings = (bookings ?? []).map((b: any) => ({
    ...b,
    client_name: b.clients?.name ?? null,
    clients: undefined,
  }));

  const enrichedRatings = (ratings ?? []).map((r: any) => ({
    ...r,
    rated_by_name: r.users?.name ?? null,
    users: undefined,
  }));

  const validRatings = enrichedRatings.filter(r => r.rating);
  const avg_rating = validRatings.length > 0
    ? validRatings.reduce((s, r) => s + r.rating, 0) / validRatings.length
    : 0;

  const commissionLedger = (commissionData ?? []).map((b: any) => ({
    booking_id: b.id,
    tvl_ref: b.tvl_ref,
    date: b.date_time,
    client_name: b.clients?.name ?? null,
    total_fare: (b.price ?? 0) + (b.additional_charges ?? 0),
    tvl_commission: b.tvl_commission ?? 0,
    driver_receives: b.driver_receives ?? 0,
    payment_method: b.payment_method,
    commission_status: b.commission_status,
    payout_status: b.payout_status,
  }));

  return res.json({
    ...driver,
    avg_rating: Math.round(avg_rating * 10) / 10,
    total_jobs: (bookings ?? []).filter((b: any) => b.status !== "Cancelled").length,
    bookings: enrichedBookings,
    ratings: enrichedRatings,
    commission_ledger: commissionLedger,
  });
});

router.put("/:id", async (req, res) => {
  const user = await getUserFromToken(req.headers.authorization);

  // Build a mutation payload from the whitelist. Allow null explicitly so
  // operators can clear vehicle_year, plate, notes from the edit form.
  const payload: Record<string, any> = {};
  for (const [k, v] of Object.entries(req.body || {})) {
    if (!DRIVER_COLUMNS.has(k)) continue;
    if (v === undefined) continue;
    payload[k] = v === "" ? null : v;
  }

  // Capture the previous staff_no so we can log a precise audit entry
  // when the TVL number changes.
  const prev = await supabase
    .from("drivers")
    .select("staff_no, name")
    .eq("id", req.params.id)
    .single();
  const prevStaffNo = prev.data?.staff_no ?? null;

  const { data, error } = await supabase
    .from("drivers")
    .update(payload)
    .eq("id", req.params.id)
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  await auditLog("update_driver", "driver", req.params.id, user?.id ?? null, `Updated driver ${data.name}`);

  // Dedicated TVL-number audit + activity entry when staff_no was changed.
  if (Object.prototype.hasOwnProperty.call(payload, "staff_no") && (data.staff_no ?? null) !== prevStaffNo) {
    const fromTxt = prevStaffNo ?? "(none)";
    const toTxt = data.staff_no ?? "(cleared)";
    await auditLog(
      "update_driver_staff_no",
      "driver",
      req.params.id,
      user?.id ?? null,
      `${data.name}: TVL number ${fromTxt} → ${toTxt}`
    );
    await logActivity({
      action_type: "driver_tvl_changed",
      description: `${data.name}: TVL number changed ${fromTxt} → ${toTxt}`,
      entity_type: "driver",
      entity_id: req.params.id,
      entity_label: data.name ?? null,
      operator_id: user?.id ?? null,
      operator_name: user?.name ?? null,
    });
  }

  await logActivity({
    action_type: "driver_updated",
    description: `Driver ${data.name} updated`,
    entity_type: "driver",
    entity_id: req.params.id,
    entity_label: data.name ?? null,
    operator_id: user?.id ?? null,
    operator_name: user?.name ?? null,
  });
  return res.json({ ...data, avg_rating: 0, total_jobs: 0 });
});

router.get("/:id/financial-summary", async (req, res) => {
  const driverId = req.params.id;

  const [{ data: bookings }, { data: settlements }] = await Promise.all([
    supabase
      .from("bookings")
      .select("price, additional_charges, tvl_commission, status, payment_method, commission_status")
      .eq("driver_id", driverId),
    supabase
      .from("commission_settlements")
      .select("total_amount")
      .eq("driver_id", driverId),
  ]);

  const activeBookings = (bookings ?? []).filter((b: any) => b.status !== "Cancelled");
  const completedBookings = activeBookings.filter((b: any) => b.status === "Completed");

  const total_gross_revenue = activeBookings.reduce(
    (s: number, b: any) => s + (Number(b.price) || 0) + (Number(b.additional_charges) || 0),
    0
  );
  const total_commission_generated = activeBookings.reduce(
    (s: number, b: any) => s + (Number(b.tvl_commission) || 0),
    0
  );
  const total_commission_settled = (settlements ?? []).reduce(
    (s: number, x: any) => s + (Number(x.total_amount) || 0),
    0
  );
  const total_commission_pending = Math.max(
    0,
    total_commission_generated - total_commission_settled
  );
  const settlement_count = (settlements ?? []).length;
  const job_count = activeBookings.length;
  const avg_commission_per_job = job_count > 0 ? total_commission_generated / job_count : 0;

  return res.json({
    total_gross_revenue: Math.round(total_gross_revenue * 100) / 100,
    total_commission_generated: Math.round(total_commission_generated * 100) / 100,
    total_commission_settled: Math.round(total_commission_settled * 100) / 100,
    total_commission_pending: Math.round(total_commission_pending * 100) / 100,
    settlement_count,
    avg_commission_per_job: Math.round(avg_commission_per_job * 100) / 100,
    job_count,
    completed_count: completedBookings.length,
  });
});

router.get("/:id/performance", async (req, res) => {
  const driverId = req.params.id;

  const { data: bookings } = await supabase
    .from("bookings")
    .select("status, service_type, date_time, clients(name)")
    .eq("driver_id", driverId);

  const all = (bookings ?? []) as any[];
  const completed = all.filter((b) => b.status === "Completed");

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const completedThisMonth = completed.filter(
    (b) => b.date_time && new Date(b.date_time) >= monthStart
  );

  function topKey<T>(arr: T[], get: (x: T) => string | null | undefined): string | null {
    const counts = new Map<string, number>();
    for (const item of arr) {
      const k = get(item);
      if (!k) continue;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    let best: string | null = null;
    let max = 0;
    for (const [k, v] of counts) {
      if (v > max) { max = v; best = k; }
    }
    return best;
  }

  const most_frequent_service_type = topKey(completed, (b) => b.service_type);
  const most_frequent_client = topKey(completed, (b: any) => b.clients?.name);

  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const dayCounts = new Array(7).fill(0);
  for (const b of completed) {
    if (!b.date_time) continue;
    dayCounts[new Date(b.date_time).getDay()]++;
  }
  let busiestDayIdx = -1;
  let busiestDayCount = 0;
  dayCounts.forEach((c: number, i: number) => {
    if (c > busiestDayCount) { busiestDayCount = c; busiestDayIdx = i; }
  });
  const busiest_day_of_week = busiestDayIdx >= 0 ? dayNames[busiestDayIdx] : null;

  // Average jobs per month based on the driver's job history span.
  const dates = completed
    .map((b) => (b.date_time ? new Date(b.date_time).getTime() : null))
    .filter((t): t is number => t !== null)
    .sort((a, b) => a - b);

  let avg_jobs_per_month = 0;
  if (dates.length > 0) {
    const earliest = new Date(dates[0]);
    const now = new Date();
    const months =
      (now.getFullYear() - earliest.getFullYear()) * 12 +
      (now.getMonth() - earliest.getMonth()) + 1;
    avg_jobs_per_month = months > 0 ? completed.length / months : completed.length;
  }

  return res.json({
    total_jobs_completed: completed.length,
    jobs_this_month: completedThisMonth.length,
    most_frequent_service_type,
    most_frequent_client,
    busiest_day_of_week,
    avg_jobs_per_month: Math.round(avg_jobs_per_month * 10) / 10,
  });
});

router.post("/:id/rate", async (req, res) => {
  const user = await getUserFromToken(req.headers.authorization);
  const { booking_id, rating, note } = req.body;

  const { data, error } = await supabase
    .from("driver_ratings")
    .insert({ driver_id: req.params.id, booking_id, rating, note, rated_by: user?.id ?? null })
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });

  await auditLog("rate_driver", "driver", req.params.id, user?.id ?? null,
    `Driver rated ${rating}/5 for booking ${booking_id}`);

  return res.status(201).json(data);
});

// DELETE /drivers/:id — admin-only hard delete used by bulk-select.
// Refuses if the driver is linked to any non-cancelled bookings so we
// never orphan operational records. Audit-logged.
router.delete("/:id", async (req, res) => {
  const user = await getUserFromToken(req.headers.authorization);
  if (!user || (user.role !== "admin" && user.role !== "super_admin")) {
    return res.status(403).json({ error: "Forbidden" });
  }
  const { id } = req.params;

  // Unlink the driver from any bookings (preserve booking history — the
  // operational record stays, the driver field just becomes unassigned).
  // This is safer than refusing the delete and leaves the booking trail
  // intact for invoicing/audit.
  await supabase.from("bookings").update({ driver_id: null }).eq("driver_id", id);

  // Driver ratings have FK → driver; clear them first.
  await supabase.from("driver_ratings").delete().eq("driver_id", id);

  const { data: deleted, error } = await supabase
    .from("drivers")
    .delete()
    .eq("id", id)
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });

  await auditLog("delete_driver", "driver", id, user.id,
    `Deleted driver ${deleted?.name ?? id}`);
  await logActivity({
    type: "driver_delete",
    summary: `Driver ${deleted?.name ?? id} deleted`,
    entity_type: "driver",
    entity_id: id,
    entity_label: deleted?.name ?? null,
    operator_id: user.id,
    operator_name: user.name ?? null,
  });
  return res.json({ success: true, ...deleted });
});

export default router;
