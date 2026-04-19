import { Router } from "express";
import { supabase, auditLog, getUserFromToken } from "../lib/supabase";

const router = Router();

// Default payment terms: 30 days from invoice generation
const PAYMENT_TERMS_DAYS = 30;

/**
 * GET /invoices
 * Returns all invoices, automatically flipping Generated/Sent invoices to
 * Overdue if their due date (generated_at + 30 days) has passed.
 */
router.get("/", async (_req, res) => {
  const { data, error } = await supabase
    .from("invoices")
    .select("*")
    .order("generated_at", { ascending: false });

  if (error) return res.status(500).json({ error: error.message });

  const invoices = data ?? [];
  const nowMs = Date.now();

  // Find invoices that should flip to Overdue
  const overdueIds: string[] = invoices
    .filter(inv => {
      if (inv.status !== "Generated" && inv.status !== "Sent") return false;
      if (!inv.generated_at) return false;
      const dueMs = new Date(inv.generated_at).getTime() + PAYMENT_TERMS_DAYS * 86_400_000;
      return nowMs > dueMs;
    })
    .map(inv => inv.id);

  if (overdueIds.length > 0) {
    await supabase
      .from("invoices")
      .update({ status: "Overdue" })
      .in("id", overdueIds);

    // Reflect the update in the response
    invoices.forEach(inv => {
      if (overdueIds.includes(inv.id)) inv.status = "Overdue";
    });
  }

  return res.json(invoices);
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
