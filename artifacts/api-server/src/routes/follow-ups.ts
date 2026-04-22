import { Router } from "express";
import { supabase, getUserFromToken, auditLog } from "../lib/supabase";

const router = Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function todayStr() {
  return new Date().toISOString().split("T")[0];
}

function addDays(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().split("T")[0];
}

// ─── GET /follow-ups — list with filters ────────────────────────────────────
router.get("/", async (req, res) => {
  const user = await getUserFromToken(req.headers.authorization);
  if (!user) return res.status(401).json({ error: "Unauthorized" });

  const { status, date: dateFilter, search, sort } = req.query as Record<string, string>;

  // We deliberately avoid PostgREST FK-join syntax here. If a foreign-key
  // constraint isn't named exactly the way PostgREST expects, the whole
  // query returns an error and the operator sees an empty list while the
  // /stats counter (which doesn't join) still shows pending counts. We
  // fetch flat rows and hydrate booking/client/driver below.
  let q = supabase
    .from("follow_ups")
    .select(`
      id, booking_id, client_id, driver_id, due_date, status, notes,
      no_response_count, completed_by, completed_at, created_at
    `);

  // Status filter
  if (status && status !== "all") {
    q = (q as any).eq("status", status);
  } else if (!status) {
    // Default: exclude archived (no_response with 3+ attempts)
    // Just show pending + recent completed
  }

  // Date filter
  const today = todayStr();
  if (dateFilter === "today") {
    q = (q as any).eq("due_date", today);
  } else if (dateFilter === "overdue") {
    q = (q as any).lt("due_date", today).eq("status", "pending");
  } else if (dateFilter === "this_week") {
    q = (q as any).gte("due_date", today).lte("due_date", addDays(7));
  }

  // Sort in DB where possible. Fix 3 — Most Recent (created_at desc) is now
  // the default across every list page; explicit `due_date` keeps the old
  // behaviour for users who pick it from the dropdown.
  if (sort === "recent" || !sort) {
    q = (q as any).order("created_at", { ascending: false });
  } else if (sort === "due_date") {
    q = (q as any).order("due_date", { ascending: true, nullsFirst: false });
  } else if (sort === "arrival_date") {
    q = (q as any).order("created_at", { ascending: false });
  } else {
    q = (q as any).order("created_at", { ascending: false });
  }

  const { data, error } = await q;
  if (error) return res.status(400).json({ error: error.message });

  let results: any[] = data ?? [];

  // ── Hydrate booking / client / driver in batches ────────────────────────
  const bookingIds = [...new Set(results.map((f: any) => f.booking_id).filter(Boolean))];
  const clientIds  = [...new Set(results.map((f: any) => f.client_id).filter(Boolean))];
  const driverIds  = [...new Set(results.map((f: any) => f.driver_id).filter(Boolean))];

  const [bookingsRes, clientsRes, driversRes] = await Promise.all([
    bookingIds.length > 0
      ? supabase.from("bookings")
          .select("id, tvl_ref, date_time, direction, pickup, dropoff, service_type, operator_id")
          .in("id", bookingIds)
      : Promise.resolve({ data: [] as any[] }),
    clientIds.length > 0
      ? supabase.from("clients").select("id, name, whatsapp, vip_tier").in("id", clientIds)
      : Promise.resolve({ data: [] as any[] }),
    driverIds.length > 0
      ? supabase.from("drivers").select("id, name").in("id", driverIds)
      : Promise.resolve({ data: [] as any[] }),
  ]);

  const bookingMap = Object.fromEntries((bookingsRes.data ?? []).map((b: any) => [b.id, b]));
  const clientMap  = Object.fromEntries((clientsRes.data  ?? []).map((c: any) => [c.id, c]));
  const driverMap  = Object.fromEntries((driversRes.data  ?? []).map((d: any) => [d.id, d]));

  results = results.map((f: any) => ({
    ...f,
    booking: bookingMap[f.booking_id] ?? null,
    client:  clientMap[f.client_id]   ?? null,
    driver:  f.driver_id ? (driverMap[f.driver_id] ?? null) : null,
  }));

  // Client-side search (join columns require post-filter)
  if (search) {
    const s = search.toLowerCase();
    results = results.filter((f: any) =>
      f.client?.name?.toLowerCase().includes(s) ||
      f.booking?.tvl_ref?.toLowerCase().includes(s)
    );
  }

  // Client-name sort (post-filter)
  if (sort === "client_name") {
    results.sort((a: any, b: any) =>
      (a.client?.name ?? "").localeCompare(b.client?.name ?? "")
    );
  }

  // Hydrate operator names
  const operatorIds = [...new Set(results.map((f: any) => f.booking?.operator_id).filter(Boolean))];
  let operatorMap: Record<string, string> = {};
  if (operatorIds.length > 0) {
    const { data: ops } = await supabase
      .from("users")
      .select("id, name")
      .in("id", operatorIds);
    operatorMap = Object.fromEntries((ops ?? []).map((u: any) => [u.id, u.name]));
  }

  results = results.map((f: any) => ({
    ...f,
    operator_name: operatorMap[f.booking?.operator_id] ?? null,
    days_since_arrival: f.booking?.date_time
      ? Math.floor((Date.now() - new Date(f.booking.date_time).getTime()) / 86400000)
      : null,
  }));

  return res.json(results);
});

// ─── GET /follow-ups/stats ───────────────────────────────────────────────────
router.get("/stats", async (req, res) => {
  const user = await getUserFromToken(req.headers.authorization);
  if (!user) return res.status(401).json({ error: "Unauthorized" });

  const today = todayStr();
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - 7);

  const [
    { count: pendingCount },
    { count: overdueCount },
    { data: completedThisWeek },
  ] = await Promise.all([
    supabase.from("follow_ups").select("id", { count: "exact", head: true })
      .eq("status", "pending"),
    supabase.from("follow_ups").select("id", { count: "exact", head: true })
      .eq("status", "pending").lt("due_date", today),
    supabase.from("follow_ups").select("status")
      .in("status", ["done", "booked_return", "no_response"])
      .gte("completed_at", weekStart.toISOString()),
  ]);

  const totalCompleted = completedThisWeek?.length ?? 0;
  const returnBooked = completedThisWeek?.filter((f: any) => f.status === "booked_return").length ?? 0;
  const conversionRate = totalCompleted > 0 ? Math.round((returnBooked / totalCompleted) * 100) : 0;

  return res.json({
    pending: pendingCount ?? 0,
    overdue: overdueCount ?? 0,
    completed_this_week: totalCompleted,
    booked_return_this_week: returnBooked,
    conversion_rate: conversionRate,
  });
});

// ─── GET /follow-ups/client/:clientId — follow-up history for a client ───────
router.get("/client/:clientId", async (req, res) => {
  const user = await getUserFromToken(req.headers.authorization);
  if (!user) return res.status(401).json({ error: "Unauthorized" });

  const { clientId } = req.params;

  const { data, error } = await supabase
    .from("follow_ups")
    .select(`
      id, booking_id, client_id, driver_id, due_date, status, notes, no_response_count, completed_by, completed_at, created_at,
      booking:booking_id(id, tvl_ref, date_time, direction, service_type)
    `)
    .eq("client_id", clientId)
    .order("created_at", { ascending: false });

  if (error) return res.status(400).json({ error: error.message });

  const rows: any[] = data ?? [];

  // Hydrate operator names for completed_by
  const operatorIds = [...new Set(rows.map((f: any) => f.completed_by).filter(Boolean))];
  let operatorMap: Record<string, string> = {};
  if (operatorIds.length > 0) {
    const { data: ops } = await supabase.from("users").select("id, name").in("id", operatorIds);
    operatorMap = Object.fromEntries((ops ?? []).map((u: any) => [u.id, u.name]));
  }

  const total = rows.length;
  const returnBooked = rows.filter((f: any) => f.status === "booked_return").length;

  return res.json({
    history: rows.map((f: any) => ({
      ...f,
      completed_by_name: operatorMap[f.completed_by] ?? null,
    })),
    stats: { total, return_booked: returnBooked },
  });
});

// ─── POST /follow-ups — create a follow-up record ───────────────────────────
router.post("/", async (req, res) => {
  const user = await getUserFromToken(req.headers.authorization);
  if (!user) return res.status(401).json({ error: "Unauthorized" });

  const { booking_id, client_id, driver_id, due_date, status, notes } = req.body;
  if (!booking_id) return res.status(400).json({ error: "booking_id required" });

  // Prevent duplicate follow-ups for the same booking
  const { data: existing } = await supabase
    .from("follow_ups")
    .select("id")
    .eq("booking_id", booking_id)
    .maybeSingle();
  if (existing) return res.json(existing);

  const { data, error } = await supabase
    .from("follow_ups")
    .insert({
      booking_id,
      client_id: client_id ?? null,
      driver_id: driver_id ?? null,
      due_date: due_date ?? null,
      status: status ?? "pending",
      notes: notes ?? null,
    })
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });

  await auditLog("create_followup", "follow_up", data.id, user.id,
    `Follow-up created for booking ${booking_id}`);

  return res.json(data);
});

// ─── PATCH /follow-ups/:id — update status / notes / snooze ─────────────────
router.patch("/:id", async (req, res) => {
  const user = await getUserFromToken(req.headers.authorization);
  if (!user) return res.status(401).json({ error: "Unauthorized" });

  const { id } = req.params;
  const { status, notes, due_date } = req.body;

  // Fetch current record for snooze logic
  const { data: fu, error: fetchErr } = await supabase
    .from("follow_ups")
    .select("*")
    .eq("id", id)
    .single();
  if (fetchErr || !fu) return res.status(404).json({ error: "Not found" });

  const updates: Record<string, any> = {};

  if (status === "no_response") {
    // No-response snooze logic
    const currentCount = (fu as any).no_response_count ?? 0;
    const newCount = currentCount + 1;

    if (newCount >= 3) {
      // Archive after 3 attempts
      updates.status = "no_response";
      updates.completed_by = user.id;
      updates.completed_at = new Date().toISOString();
      updates.notes = [(fu as any).notes, `[Archived: 3 no-response attempts]`].filter(Boolean).join("\n");
    } else {
      // Snooze 1 day
      updates.status = "pending";
      updates.due_date = addDays(1);
      updates.no_response_count = newCount;
    }
  } else if (status === "snooze") {
    // Manual snooze — due_date passed in body
    updates.status = "pending";
    updates.due_date = due_date ?? addDays(1);
  } else {
    if (status) updates.status = status;
    if (notes !== undefined) updates.notes = notes;
    if (due_date !== undefined) updates.due_date = due_date;
    if (["done", "booked_return"].includes(status)) {
      updates.completed_by = user.id;
      updates.completed_at = new Date().toISOString();
    }
  }

  // Try update with no_response_count; fall back without it if column missing
  const { data, error } = await supabase
    .from("follow_ups")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    if (error.message.includes("no_response_count")) {
      // Column not yet added — retry without it
      const { no_response_count: _drop, ...safeUpdates } = updates;
      const { data: d2, error: e2 } = await supabase
        .from("follow_ups")
        .update(safeUpdates)
        .eq("id", id)
        .select()
        .single();
      if (e2) return res.status(400).json({ error: e2.message });
      await auditLog("update_followup", "follow_up", id, user.id,
        `Follow-up ${id} → ${status ?? "updated"}`);
      return res.json(d2);
    }
    return res.status(400).json({ error: error.message });
  }

  await auditLog("update_followup", "follow_up", id, user.id,
    `Follow-up ${id} → ${status ?? "updated"}`);

  return res.json(data);
});

export default router;
