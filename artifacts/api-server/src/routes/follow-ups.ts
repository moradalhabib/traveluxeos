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
      no_response_count, completed_by, completed_at, created_at,
      cancelled_by, cancelled_at, cancellation_reason
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

  // Arrival-date sort needs the joined booking row, so it's done post-hydrate.
  // The DB-side fallback (created_at desc) was misleading — the label said
  // "Arrival" but rows were ordered by row creation. This now sorts by the
  // booking's actual date_time (soonest arrival first; rows with no booking
  // sink to the bottom).
  if (sort === "arrival_date") {
    results.sort((a: any, b: any) => {
      const ta = a.booking?.date_time ? new Date(a.booking.date_time).getTime() : Infinity;
      const tb = b.booking?.date_time ? new Date(b.booking.date_time).getTime() : Infinity;
      return ta - tb;
    });
  }

  // Hydrate operator + cancelled-by actor info in a single users lookup.
  // We need just `name` for the booking operator label, but the cancelled
  // banner on /follow-ups also wants an email tooltip — so the lookup pulls
  // both columns and the page picks what it needs.
  //
  // Privacy gate: routes/users.ts has two distinct deactivation flows —
  // `deactivate` keeps the real email but flips active=false, while `remove`
  // also overwrites email with a safe placeholder + name="[removed]". We
  // therefore null out `cancelled_by_email` for any actor with active=false
  // so a merely-deactivated operator's address is never leaked through the
  // attribution line. The display name is still safe to show (it's either
  // their real name or "[removed]").
  const userIds = [
    ...new Set(
      results
        .flatMap((f: any) => [f.booking?.operator_id, f.cancelled_by])
        .filter(Boolean),
    ),
  ];
  let userMap: Record<string, { name: string | null; email: string | null; active: boolean }> = {};
  if (userIds.length > 0) {
    const { data: us } = await supabase
      .from("users")
      .select("id, name, email, active")
      .in("id", userIds);
    userMap = Object.fromEntries(
      (us ?? []).map((u: any) => [
        u.id,
        { name: u.name ?? null, email: u.email ?? null, active: u.active !== false },
      ]),
    );
  }

  results = results.map((f: any) => {
    const actor = f.cancelled_by ? userMap[f.cancelled_by] : null;
    return {
      ...f,
      operator_name: userMap[f.booking?.operator_id]?.name ?? null,
      cancelled_by_name: actor?.name ?? null,
      cancelled_by_email: actor && actor.active ? actor.email : null,
      days_since_arrival: f.booking?.date_time
        ? Math.floor((Date.now() - new Date(f.booking.date_time).getTime()) / 86400000)
        : null,
    };
  });

  return res.json(results);
});

// ─── GET /follow-ups/stats ───────────────────────────────────────────────────
router.get("/stats", async (req, res) => {
  const user = await getUserFromToken(req.headers.authorization);
  if (!user) return res.status(401).json({ error: "Unauthorized" });

  const today = todayStr();
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - 7);
  // Stats only count work done on the new TVL stack (launched 20-Apr-2026) —
  // pre-cutoff completions from the legacy Odoo import shouldn't show as
  // "done this week".
  const STATS_CUTOFF_ISO = "2026-04-20T00:00:00Z";
  const cutoff = new Date(STATS_CUTOFF_ISO);
  const effectiveStart = weekStart < cutoff ? cutoff : weekStart;

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
      .gte("completed_at", effectiveStart.toISOString()),
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
  } else if (status === "cancelled") {
    // Cancelling a follow-up always requires a reason. Mirrors the request
    // cancel contract so the audit log + dashboard can break down lost
    // leads consistently across both tables.
    const reason = (req.body?.cancellation_reason ?? "").toString().trim();
    if (!reason) {
      return res.status(400).json({ error: "cancellation_reason is required when cancelling a follow-up" });
    }
    updates.status = "cancelled";
    updates.cancellation_reason = reason;
    updates.cancelled_at = new Date().toISOString();
    updates.cancelled_by = user.id;
    updates.completed_at = new Date().toISOString();
    updates.completed_by = user.id;
    if (notes !== undefined) updates.notes = notes;
  } else if (status === "pending" && (fu as any).status === "cancelled") {
    // Re-open a previously cancelled follow-up. Server appends an audit
    // line to notes so the chase trail is preserved; cancellation_reason
    // and cancelled_at stay put as an append-only record so the lost-lead
    // rollup still reflects the original loss. completed_at / completed_by
    // are cleared so dashboard counters treat it as live work again.
    const stamp = new Date().toLocaleString("en-GB", {
      timeZone: "Europe/London",
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
    const wasReason = ((fu as any).cancellation_reason ?? "").toString().trim() || "Unspecified";
    const auditLine = `Re-opened (${stamp}) — was cancelled for: ${wasReason}`;
    const existingNotes = ((fu as any).notes ?? "").toString().trim();
    updates.status = "pending";
    updates.completed_at = null;
    updates.completed_by = null;
    updates.notes = existingNotes ? `${existingNotes}\n\n${auditLine}` : auditLine;
    if (due_date !== undefined) updates.due_date = due_date;
  } else {
    // Symmetric guard with requests: cancelled is near-terminal — the only
    // legal way out is via the explicit Re-open action (cancelled→pending,
    // handled above). Reject Cancelled → done / booked_return / no_response
    // accidental transitions from the generic update path.
    if ((fu as any).status === "cancelled" && status && status !== "cancelled") {
      return res.status(400).json({
        error: "Cancelled follow-ups can only be re-opened to status 'pending'. Use the Re-open action.",
      });
    }
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

// ─── POST /follow-ups/bulk-cancel ───────────────────────────────────────────
// Bulk-cancel a list of follow-ups with one shared reason. Loops the same
// per-row cancel logic as PATCH /:id (status='cancelled' branch) so the
// stored shape is identical to a single cancel — including the per-row
// notes append (existing chase notes are preserved, not overwritten).
//
// Already-cancelled rows in the selection are silently skipped instead of
// failing the whole batch — operators acting on a stale selection should
// see "10 cancelled, 2 already cancelled" in the toast, not a hard error.
//
// Returns { cancelled: number, skipped: number, failed: number, ids: { ... } }
// so the client can surface a precise summary. The route is intentionally
// not wrapped in a single DB transaction — Supabase's HTTP client can't
// open a multi-statement transaction here, and the per-row update is
// itself atomic. A partial failure leaves the partially-cancelled rows
// in the cancelled state, which is the safest outcome (operator can
// re-try the remaining ids without losing work already done).
router.post("/bulk-cancel", async (req, res) => {
  const user = await getUserFromToken(req.headers.authorization);
  if (!user) return res.status(401).json({ error: "Unauthorized" });

  const { ids, cancellation_reason } = (req.body ?? {}) as {
    ids?: unknown;
    cancellation_reason?: unknown;
  };

  // Mirror the per-row guard so callers can't sneak past the reason
  // requirement by hitting the bulk path.
  const reason = (cancellation_reason ?? "").toString().trim();
  if (!reason) {
    return res.status(400).json({
      error: "cancellation_reason is required when cancelling follow-ups",
    });
  }

  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: "ids must be a non-empty array" });
  }
  const cleanIds = ids
    .map(v => (typeof v === "string" ? v.trim() : ""))
    .filter(Boolean);
  if (cleanIds.length === 0) {
    return res.status(400).json({ error: "ids must contain at least one id" });
  }

  // Fetch all rows up-front so we can decide skip-vs-cancel per row and
  // build the per-row appended notes string from the existing notes.
  const { data: rows, error: fetchErr } = await supabase
    .from("follow_ups")
    .select("id, status, notes")
    .in("id", cleanIds);
  if (fetchErr) return res.status(400).json({ error: fetchErr.message });

  const rowMap = new Map<string, any>((rows ?? []).map((r: any) => [r.id, r]));

  const cancelledIds: string[] = [];
  const skippedIds: string[] = [];
  const failedIds: string[] = [];
  const missingIds: string[] = [];

  // Use one timestamp + audit stamp for the whole batch so the appended
  // notes line is consistent across all rows in the operator's view.
  const nowIso = new Date().toISOString();
  const stamp = new Date().toLocaleString("en-GB", { timeZone: "Europe/London" });

  for (const id of cleanIds) {
    const fu = rowMap.get(id);
    if (!fu) {
      missingIds.push(id);
      continue;
    }
    if (fu.status === "cancelled") {
      // Already cancelled — silently skip so a stale selection doesn't
      // blow up the whole batch.
      skippedIds.push(id);
      continue;
    }

    // Append, never overwrite. The per-row Cancel action does this same
    // merge client-side; we replicate it here so the bulk path produces
    // an identical persisted shape.
    const existing = (fu.notes ?? "").toString().trim();
    const appended = `Cancelled (${stamp}): ${reason}`;
    const mergedNotes = existing ? `${existing}\n\n${appended}` : appended;

    const { error: updErr } = await supabase
      .from("follow_ups")
      .update({
        status: "cancelled",
        cancellation_reason: reason,
        cancelled_at: nowIso,
        cancelled_by: user.id,
        completed_at: nowIso,
        completed_by: user.id,
        notes: mergedNotes,
      })
      .eq("id", id);

    if (updErr) {
      failedIds.push(id);
      continue;
    }
    cancelledIds.push(id);
    await auditLog(
      "update_followup",
      "follow_up",
      id,
      user.id,
      `Follow-up ${id} → cancelled (bulk: ${reason})`,
    );
  }

  return res.json({
    cancelled: cancelledIds.length,
    skipped: skippedIds.length,
    failed: failedIds.length,
    missing: missingIds.length,
    ids: {
      cancelled: cancelledIds,
      skipped: skippedIds,
      failed: failedIds,
      missing: missingIds,
    },
  });
});

// DELETE /follow-ups/:id — admin-only, used by bulk-select. Audit-logged.
router.delete("/:id", async (req, res) => {
  const user = await getUserFromToken(req.headers.authorization);
  if (!user || (user.role !== "admin" && user.role !== "super_admin")) {
    return res.status(403).json({ error: "Forbidden" });
  }
  const { id } = req.params;

  const { error } = await supabase.from("follow_ups").delete().eq("id", id);
  if (error) return res.status(400).json({ error: error.message });

  await auditLog("delete_followup", "follow_up", id, user.id, `Deleted follow-up ${id}`);
  return res.json({ success: true });
});

export default router;
