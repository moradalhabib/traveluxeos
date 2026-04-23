import { Router } from "express";
import { supabase, auditLog, getUserFromToken } from "../lib/supabase";

const router = Router();

const SELECT_FIELDS =
  "id, booking_id, driver_id, vehicle_type, vehicle_product_id, client_share, cost_to_company, tvl_commission, driver_receives, commission_status, payout_status, notes, created_at, updated_at, drivers(name, staff_no, vehicle_model, plate)";

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
  } = req.body || {};

  if (!booking_id) return res.status(400).json({ error: "booking_id is required" });

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

  // Block edits to settled/paid rows. Allow operations that ONLY change
  // commission_status or payout_status (the Commissions page uses these
  // to settle/reopen rows) — those go through this same endpoint.
  const bodyKeys = Object.keys(req.body || {});
  const isStatusOnly = bodyKeys.length > 0 && bodyKeys.every(k => k === "commission_status" || k === "payout_status");
  if (!isStatusOnly) {
    const lock = await assertNotLocked(req.params.id);
    if (!lock.ok) return res.status(lock.status).json({ error: lock.message });
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
  ];

  const payload: Record<string, any> = {};
  for (const k of allowed) {
    if (k in (req.body || {})) {
      const v = req.body[k];
      if (["client_share", "cost_to_company", "tvl_commission", "driver_receives"].includes(k)) {
        payload[k] = v == null || v === "" ? 0 : Number(v);
      } else if (k === "driver_id" || k === "vehicle_product_id") {
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

  await auditLog(
    "update_booking_vehicle",
    "booking",
    data?.booking_id ?? req.params.id,
    user?.id ?? null,
    `Updated vehicle ${req.params.id}`
  );

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
