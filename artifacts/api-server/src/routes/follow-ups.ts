import { Router } from "express";
import { supabase, getUserFromToken, auditLog } from "../lib/supabase";

const router = Router();

// POST /follow-ups — create a follow-up record
router.post("/", async (req, res) => {
  const user = await getUserFromToken(req.headers.authorization);
  if (!user) return res.status(401).json({ error: "Unauthorized" });

  const { booking_id, client_id, driver_id, due_date, status, notes } = req.body;
  if (!booking_id) return res.status(400).json({ error: "booking_id required" });

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

// PATCH /follow-ups/:id — update status / notes
router.patch("/:id", async (req, res) => {
  const user = await getUserFromToken(req.headers.authorization);
  if (!user) return res.status(401).json({ error: "Unauthorized" });

  const { id } = req.params;
  const { status, notes } = req.body;

  const updates: Record<string, any> = {};
  if (status) updates.status = status;
  if (notes !== undefined) updates.notes = notes;
  if (["done", "booked_return", "no_response"].includes(status)) {
    updates.completed_by = user.id;
    updates.completed_at = new Date().toISOString();
  }

  const { data, error } = await supabase
    .from("follow_ups")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });

  await auditLog("update_followup", "follow_up", id, user.id,
    `Follow-up ${id} marked as ${status ?? "updated"}`);

  return res.json(data);
});

export default router;
