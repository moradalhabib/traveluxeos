import { Router } from "express";
import { supabase, auditLog, getUserFromToken } from "../lib/supabase";

const router = Router();

router.get("/", async (req, res) => {
  const { booking_id, driver_id, client_id, status } = req.query;
  let query = supabase
    .from("issues")
    .select("*, drivers(name), clients(name), bookings(tvl_ref), users:logged_by(name)")
    .order("logged_at", { ascending: false });

  if (booking_id) query = query.eq("booking_id", String(booking_id));
  if (driver_id) query = query.eq("driver_id", String(driver_id));
  if (client_id) query = query.eq("client_id", String(client_id));
  if (status) query = query.eq("status", String(status));

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  const result = (data ?? []).map((row: any) => ({
    ...row,
    driver_name: row.drivers?.name ?? null,
    client_name: row.clients?.name ?? null,
    tvl_ref: row.bookings?.tvl_ref ?? null,
    logged_by_name: row.users?.name ?? null,
    drivers: undefined,
    clients: undefined,
    bookings: undefined,
    users: undefined,
  }));

  return res.json(result);
});

router.post("/", async (req, res) => {
  const user = await getUserFromToken(req.headers.authorization);
  const { booking_id, driver_id, client_id, description, status } = req.body || {};

  if (!description || typeof description !== "string" || description.trim().length === 0) {
    return res.status(400).json({ error: "description is required" });
  }
  if (description.length > 500) {
    return res.status(400).json({ error: "description must be 500 characters or fewer" });
  }

  const payload: Record<string, any> = {
    description: description.trim(),
    status: status || "Open",
    logged_by: user?.id ?? null,
  };
  if (booking_id) payload.booking_id = booking_id;
  if (driver_id) payload.driver_id = driver_id;
  if (client_id) payload.client_id = client_id;

  const { data, error } = await supabase
    .from("issues")
    .insert(payload)
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });

  await auditLog(
    "create_issue",
    "issue",
    data.id,
    user?.id ?? null,
    `Logged issue: ${payload.description.substring(0, 80)}`
  );

  return res.status(201).json(data);
});

router.patch("/:id", async (req, res) => {
  const user = await getUserFromToken(req.headers.authorization);
  const { status, resolution_notes, description } = req.body || {};

  const payload: Record<string, any> = {};
  if (status !== undefined) {
    if (!["Open", "Ongoing", "Resolved"].includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }
    payload.status = status;
    if (status === "Resolved") {
      payload.resolved_at = new Date().toISOString();
    }
  }
  if (resolution_notes !== undefined) payload.resolution_notes = resolution_notes;
  if (description !== undefined) payload.description = description;

  const { data, error } = await supabase
    .from("issues")
    .update(payload)
    .eq("id", req.params.id)
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });

  await auditLog(
    "update_issue",
    "issue",
    req.params.id,
    user?.id ?? null,
    `Updated issue ${status ? `to ${status}` : ""}`.trim()
  );

  return res.json(data);
});

export default router;
