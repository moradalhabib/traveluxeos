import { Router } from "express";
import { supabase, auditLog, getUserFromToken } from "../lib/supabase";

const router = Router();

router.get("/", async (_req, res) => {
  const { data, error } = await supabase
    .from("invoices")
    .select("*")
    .order("generated_at", { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  return res.json(data ?? []);
});

router.patch("/:id/status", async (req, res) => {
  const user = await getUserFromToken(req.headers.authorization);
  if (!user) return res.status(401).json({ error: "Unauthorised" });

  const { status } = req.body;
  const allowed = ["Generated", "Sent", "Paid", "Overdue", "Cancelled"];
  if (!allowed.includes(status)) {
    return res.status(400).json({ error: `Invalid status. Must be one of: ${allowed.join(", ")}` });
  }

  const updates: Record<string, any> = { status };
  if (status === "Paid") updates.paid_at = new Date().toISOString();

  const { data, error } = await supabase
    .from("invoices")
    .update(updates)
    .eq("id", req.params.id)
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });

  await auditLog("update_invoice_status", "invoice", data.id, user.id,
    `Invoice ${data.invoice_number} marked as ${status}`);

  return res.json(data);
});

router.post("/generate", async (req, res) => {
  const user = await getUserFromToken(req.headers.authorization);
  const { booking_id } = req.body;

  if (!booking_id) return res.status(400).json({ error: "booking_id is required" });

  // Check if invoice already exists
  const { data: existing } = await supabase
    .from("invoices")
    .select("*")
    .eq("booking_id", booking_id)
    .single();

  if (existing) {
    return res.json(existing);
  }

  const { data, error } = await supabase
    .from("invoices")
    .insert({ booking_id, generated_by: user?.id ?? null, status: "Generated" })
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });

  await auditLog("generate_invoice", "invoice", data.id, user?.id ?? null,
    `Invoice ${data.invoice_number} generated for booking ${booking_id}`);

  return res.status(201).json(data);
});

export default router;
