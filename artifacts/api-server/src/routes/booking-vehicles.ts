import { Router } from "express";
import { supabase, auditLog, getUserFromToken } from "../lib/supabase";

const router = Router();

const SELECT_FIELDS =
  "id, booking_id, driver_id, vehicle_type, vehicle_product_id, client_share, cost_to_company, tvl_commission, driver_receives, commission_status, payout_status, notes, pickup, dropoff, date_time, created_at, updated_at, drivers(name, staff_no, vehicle_model, plate)";

// Per-leg pickup times can differ from the parent booking. The
// PUT /bookings/:id endpoint only checks the parent booking's date_time
// against the driver's other live jobs, so a per-leg time that overlaps a
// different job for the same driver would otherwise slip through silently.
// This helper mirrors the parent booking's ±90 min conflict window but
// also considers other booking_vehicles rows (per-leg pickup times) for
// the same driver, so the operator gets a warning when assigning a driver
// whose schedule clashes with this leg's effective pickup time.
async function findDriverConflictsForLeg(opts: {
  driverId: string;
  effectiveIso: string;
  durationMin: number;
  excludeVehicleRowId?: string | null;
}): Promise<{ conflicts: any[]; message: string } | null> {
  const target = new Date(opts.effectiveIso);
  if (isNaN(target.getTime())) return null;
  const buffer = Math.max(opts.durationMin || 90, 90) * 60_000;
  const winStart = new Date(target.getTime() - buffer).toISOString();
  const winEnd = new Date(target.getTime() + buffer).toISOString();

  // Primary-driver clashes (other bookings.driver_id == this driver).
  const { data: bookingClashes } = await supabase
    .from("bookings")
    .select("id, tvl_ref, date_time, pickup, dropoff, status, clients(name)")
    .eq("driver_id", opts.driverId)
    .neq("status", "Cancelled")
    .neq("status", "Completed")
    .gte("date_time", winStart)
    .lte("date_time", winEnd);

  // Per-leg clashes with an explicit per-leg date_time set.
  let vq = supabase
    .from("booking_vehicles")
    .select("id, booking_id, date_time, pickup, dropoff, bookings(tvl_ref, status, pickup, dropoff, clients(name))")
    .eq("driver_id", opts.driverId)
    .gte("date_time", winStart)
    .lte("date_time", winEnd);
  if (opts.excludeVehicleRowId) vq = vq.neq("id", opts.excludeVehicleRowId);
  const { data: legClashesExplicit } = await vq;

  // Per-leg rows that inherit (date_time IS NULL): include only when the
  // parent booking's own date_time falls in the window.
  let vqInherit = supabase
    .from("booking_vehicles")
    .select("id, booking_id, pickup, dropoff, bookings(tvl_ref, date_time, status, pickup, dropoff, clients(name))")
    .eq("driver_id", opts.driverId)
    .is("date_time", null);
  if (opts.excludeVehicleRowId) vqInherit = vqInherit.neq("id", opts.excludeVehicleRowId);
  const { data: legClashesInherit } = await vqInherit;

  const conflicts: any[] = [];
  for (const c of (bookingClashes ?? []) as any[]) {
    conflicts.push({
      id: c.id,
      kind: "primary",
      tvl_ref: c.tvl_ref,
      date_time: c.date_time,
      pickup: c.pickup,
      dropoff: c.dropoff,
      status: c.status,
      client_name: c.clients?.name ?? null,
    });
  }
  for (const v of (legClashesExplicit ?? []) as any[]) {
    const parent: any = v.bookings;
    if (!parent) continue;
    if (parent.status === "Cancelled" || parent.status === "Completed") continue;
    conflicts.push({
      id: v.booking_id,
      booking_vehicle_id: v.id,
      kind: "extra",
      tvl_ref: parent.tvl_ref ?? null,
      date_time: v.date_time,
      pickup: v.pickup ?? parent.pickup ?? null,
      dropoff: v.dropoff ?? parent.dropoff ?? null,
      status: parent.status ?? null,
      client_name: parent.clients?.name ?? null,
    });
  }
  for (const v of (legClashesInherit ?? []) as any[]) {
    const parent: any = v.bookings;
    if (!parent?.date_time) continue;
    const t = new Date(parent.date_time).getTime();
    if (t < target.getTime() - buffer || t > target.getTime() + buffer) continue;
    if (parent.status === "Cancelled" || parent.status === "Completed") continue;
    conflicts.push({
      id: v.booking_id,
      booking_vehicle_id: v.id,
      kind: "extra",
      tvl_ref: parent.tvl_ref ?? null,
      date_time: parent.date_time,
      pickup: v.pickup ?? parent.pickup ?? null,
      dropoff: v.dropoff ?? parent.dropoff ?? null,
      status: parent.status ?? null,
      client_name: parent.clients?.name ?? null,
    });
  }

  if (conflicts.length === 0) return null;
  return {
    conflicts,
    message: `Driver already has ${conflicts.length} job${conflicts.length === 1 ? "" : "s"} within 90 min of this pickup time.`,
  };
}

async function getParentBookingTiming(bookingId: string): Promise<{ date_time: string | null; duration: number }> {
  const { data } = await supabase
    .from("bookings")
    .select("date_time, duration")
    .eq("id", bookingId)
    .single();
  return {
    date_time: data?.date_time ?? null,
    duration: Number(data?.duration ?? 90) || 90,
  };
}

function shape(row: any) {
  if (!row) return row;
  return {
    ...row,
    driver_name: row.drivers?.name ?? null,
    driver_staff_no: row.drivers?.staff_no ?? null,
    driver_vehicle: row.drivers?.vehicle_model ?? null,
    driver_plate: row.drivers?.plate ?? null,
    drivers: undefined,
  };
}

router.get("/", async (req, res) => {
  const { booking_id, driver_id } = req.query;

  let query = supabase
    .from("booking_vehicles")
    .select(SELECT_FIELDS)
    .order("created_at", { ascending: true });

  if (booking_id) query = query.eq("booking_id", String(booking_id));
  if (driver_id) query = query.eq("driver_id", String(driver_id));

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  return res.json((data ?? []).map(shape));
});

router.post("/", async (req, res) => {
  const user = await getUserFromToken(req.headers.authorization);
  const force = String(req.query.force ?? "").toLowerCase() === "true";
  const {
    booking_id,
    driver_id,
    vehicle_type,
    vehicle_product_id,
    client_share,
    cost_to_company,
    tvl_commission,
    driver_receives,
    commission_status,
    payout_status,
    notes,
    pickup,
    dropoff,
    date_time,
  } = req.body || {};

  if (!booking_id) return res.status(400).json({ error: "booking_id is required" });

  // ── Driver-conflict pre-check ───────────────────────────────────────────
  // If a driver is being assigned to this leg, check that the leg's
  // effective pickup time (per-leg date_time, falling back to the parent
  // booking's date_time) doesn't overlap another live job for that
  // driver — including other per-leg roster rows. Surface a 409 with the
  // conflict payload so the UI can prompt the operator to override.
  if (driver_id) {
    const parent = await getParentBookingTiming(booking_id);
    const effectiveIso = (date_time && String(date_time)) || parent.date_time;
    if (effectiveIso) {
      const conflict = await findDriverConflictsForLeg({
        driverId: String(driver_id),
        effectiveIso,
        durationMin: parent.duration,
      });
      if (conflict && !force) {
        return res.status(409).json({ driver_conflict: conflict });
      }
    }
  }

  const payload: Record<string, any> = {
    booking_id,
    driver_id: driver_id || null,
    vehicle_type: vehicle_type || null,
    vehicle_product_id: vehicle_product_id || null,
    client_share: client_share != null ? Number(client_share) : 0,
    cost_to_company: cost_to_company != null ? Number(cost_to_company) : 0,
    tvl_commission: tvl_commission != null ? Number(tvl_commission) : 0,
    driver_receives: driver_receives != null ? Number(driver_receives) : 0,
    commission_status: commission_status || "Outstanding",
    payout_status: payout_status || "Pending",
    notes: notes || null,
    // Per-leg overrides — empty/whitespace means "inherit from parent booking".
    pickup: pickup && String(pickup).trim() ? String(pickup).trim() : null,
    dropoff: dropoff && String(dropoff).trim() ? String(dropoff).trim() : null,
    date_time: date_time || null,
  };

  const { data, error } = await supabase
    .from("booking_vehicles")
    .insert(payload)
    .select(SELECT_FIELDS)
    .single();

  if (error) return res.status(400).json({ error: error.message });

  await auditLog(
    "create_booking_vehicle",
    "booking",
    booking_id,
    user?.id ?? null,
    `Added vehicle to booking (driver: ${data?.driver_id ?? "unassigned"}, share: £${payload.client_share})`
  );

  return res.status(201).json(shape(data));
});

// Lock guard: once a row has been settled (cash) or paid out (bank/card),
// the financials are part of the historical ledger and must not be edited
// or deleted from the booking screen. Operators must reopen the row from
// the Commissions page first. This is defence-in-depth — the UI also
// blocks the action — to ensure no client can bypass the lock.
async function assertNotLocked(id: string): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  const { data, error } = await supabase
    .from("booking_vehicles")
    .select("commission_status, payout_status")
    .eq("id", id)
    .single();
  if (error || !data) {
    return { ok: false, status: 404, message: "Vehicle row not found" };
  }
  if (data.commission_status === "Settled" || data.payout_status === "Paid") {
    return {
      ok: false,
      status: 409,
      message:
        data.commission_status === "Settled"
          ? "This vehicle's commission is already settled. Reopen it on the Commissions page first."
          : "This vehicle is already paid out. Reopen it on the Commissions page first.",
    };
  }
  return { ok: true };
}

router.patch("/:id", async (req, res) => {
  const user = await getUserFromToken(req.headers.authorization);
  const force = String(req.query.force ?? "").toLowerCase() === "true";

  // Block edits to settled/paid rows. Allow operations that ONLY change
  // commission_status or payout_status (the Commissions page uses these
  // to settle/reopen rows, and the booking screen uses them to unlock
  // a settled row) — those go through this same endpoint.
  const bodyKeys = Object.keys(req.body || {});
  const isStatusOnly = bodyKeys.length > 0 && bodyKeys.every(k => k === "commission_status" || k === "payout_status");

  // Snapshot the prior status BEFORE the update so we can detect an
  // unlock (Settled → Outstanding / Paid → Pending) and audit it
  // specifically.
  const { data: prior } = await supabase
    .from("booking_vehicles")
    .select("commission_status, payout_status, driver_id, date_time, booking_id")
    .eq("id", req.params.id)
    .single();

  if (!isStatusOnly) {
    if (!prior) return res.status(404).json({ error: "Vehicle row not found" });
    if (prior.commission_status === "Settled" || prior.payout_status === "Paid") {
      return res.status(409).json({
        error:
          prior.commission_status === "Settled"
            ? "This vehicle's commission is already settled. Reopen it on the Commissions page first."
            : "This vehicle is already paid out. Reopen it on the Commissions page first.",
      });
    }
  }

  // Authorization: a status-only PATCH that *unlocks* a row (Settled →
  // Outstanding and/or Paid → Pending) reopens a financial ledger entry
  // and is restricted to admin/super_admin. The Commissions page's
  // forward transitions (Outstanding → Settled, Pending → Paid) remain
  // open to operators. We check this server-side so the UI's role gate
  // can't be bypassed by a crafted request.
  if (isStatusOnly && prior) {
    const wouldUnlockCommission =
      prior.commission_status === "Settled" && req.body.commission_status === "Outstanding";
    const wouldUnlockPayout =
      prior.payout_status === "Paid" && req.body.payout_status === "Pending";
    if (wouldUnlockCommission || wouldUnlockPayout) {
      const role = user?.role;
      if (role !== "admin" && role !== "super_admin") {
        return res.status(403).json({
          error: "Only admins can unlock a settled or paid vehicle row.",
        });
      }
    }
  }

  // ── Driver-conflict pre-check ───────────────────────────────────────────
  // Skip for status-only PATCHes (settle/unlock flows). Otherwise, if the
  // resulting row would have a driver assigned and an effective pickup
  // time, check that time against the driver's other live jobs (primary
  // bookings AND other per-leg roster rows). Surface a 409 unless the
  // operator overrides via ?force=true.
  if (!isStatusOnly && prior) {
    const nextDriverId = "driver_id" in (req.body || {})
      ? (req.body.driver_id || null)
      : prior.driver_id;
    const nextDateTime = "date_time" in (req.body || {})
      ? (req.body.date_time || null)
      : prior.date_time;

    if (nextDriverId) {
      const parent = await getParentBookingTiming(prior.booking_id);
      const effectiveIso = nextDateTime || parent.date_time;
      // Only re-check when the driver, the per-leg time, OR the parent
      // booking time is involved in this update — otherwise we'd warn on
      // every notes/cost edit. We check whenever a driver is set, since
      // the leg's effective time may have inherited a parent that has
      // since changed.
      if (effectiveIso) {
        const conflict = await findDriverConflictsForLeg({
          driverId: String(nextDriverId),
          effectiveIso,
          durationMin: parent.duration,
          excludeVehicleRowId: req.params.id,
        });
        if (conflict && !force) {
          return res.status(409).json({ driver_conflict: conflict });
        }
      }
    }
  }

  const allowed = [
    "driver_id",
    "vehicle_type",
    "vehicle_product_id",
    "client_share",
    "cost_to_company",
    "tvl_commission",
    "driver_receives",
    "commission_status",
    "payout_status",
    "notes",
    "pickup",
    "dropoff",
    "date_time",
  ];

  const payload: Record<string, any> = {};
  for (const k of allowed) {
    if (k in (req.body || {})) {
      const v = req.body[k];
      if (["client_share", "cost_to_company", "tvl_commission", "driver_receives"].includes(k)) {
        payload[k] = v == null || v === "" ? 0 : Number(v);
      } else if (k === "driver_id" || k === "vehicle_product_id") {
        payload[k] = v || null;
      } else if (k === "pickup" || k === "dropoff") {
        // Treat empty / whitespace as "clear override" (inherit from parent).
        payload[k] = v && String(v).trim() ? String(v).trim() : null;
      } else if (k === "date_time") {
        payload[k] = v || null;
      } else {
        payload[k] = v ?? null;
      }
    }
  }

  if (Object.keys(payload).length === 0) {
    return res.status(400).json({ error: "No updatable fields provided" });
  }

  const { data, error } = await supabase
    .from("booking_vehicles")
    .update(payload)
    .eq("id", req.params.id)
    .select(SELECT_FIELDS)
    .single();

  if (error) return res.status(400).json({ error: error.message });

  // Detect an unlock: a status-only PATCH that moves Settled → Outstanding
  // and/or Paid → Pending. Log it under a distinct action so it shows up
  // clearly in the audit trail, separate from regular edits.
  const wasSettled = prior?.commission_status === "Settled";
  const wasPaid = prior?.payout_status === "Paid";
  const nowOutstanding = payload.commission_status === "Outstanding";
  const nowPending = payload.payout_status === "Pending";
  const isUnlock =
    isStatusOnly &&
    ((wasSettled && nowOutstanding) || (wasPaid && nowPending));

  if (isUnlock) {
    const parts: string[] = [];
    if (wasSettled && nowOutstanding) parts.push("commission Settled → Outstanding");
    if (wasPaid && nowPending) parts.push("payout Paid → Pending");
    await auditLog(
      "unlock_booking_vehicle",
      "booking",
      data?.booking_id ?? req.params.id,
      user?.id ?? null,
      `Unlocked vehicle ${req.params.id} (${parts.join(", ")})`
    );
  } else {
    await auditLog(
      "update_booking_vehicle",
      "booking",
      data?.booking_id ?? req.params.id,
      user?.id ?? null,
      `Updated vehicle ${req.params.id}`
    );
  }

  return res.json(shape(data));
});

router.delete("/:id", async (req, res) => {
  const user = await getUserFromToken(req.headers.authorization);

  // Block deletes on settled/paid rows — same reasoning as PATCH.
  const lock = await assertNotLocked(req.params.id);
  if (!lock.ok) return res.status(lock.status).json({ error: lock.message });

  const { data: existing } = await supabase
    .from("booking_vehicles")
    .select("booking_id")
    .eq("id", req.params.id)
    .single();

  const { error } = await supabase
    .from("booking_vehicles")
    .delete()
    .eq("id", req.params.id);

  if (error) return res.status(400).json({ error: error.message });

  await auditLog(
    "delete_booking_vehicle",
    "booking",
    existing?.booking_id ?? req.params.id,
    user?.id ?? null,
    `Removed vehicle ${req.params.id}`
  );

  return res.status(204).send();
});

export default router;
