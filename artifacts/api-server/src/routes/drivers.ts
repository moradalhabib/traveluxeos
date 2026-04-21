import { Router } from "express";
import { supabase, auditLog, getUserFromToken } from "../lib/supabase";

const router = Router();

router.get("/", async (req, res) => {
  const { status } = req.query;
  let query = supabase.from("drivers").select("*, driver_ratings(rating), bookings(id, status)").order("name");

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

  return res.json(result);
});

// Whitelist of mutable driver columns. Anything not in this set is ignored
// so callers can't write columns we don't manage from the UI.
const DRIVER_COLUMNS = new Set([
  "name", "staff_no", "whatsapp", "email",
  "vehicle_model", "vehicle_year", "vehicle_type", "plate",
  "status", "notes",
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

  const { data, error } = await supabase
    .from("drivers")
    .update(payload)
    .eq("id", req.params.id)
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  await auditLog("update_driver", "driver", req.params.id, user?.id ?? null, `Updated driver ${data.name}`);
  return res.json({ ...data, avg_rating: 0, total_jobs: 0 });
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

export default router;
