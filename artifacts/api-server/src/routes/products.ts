import { Router } from "express";
import { supabase, getUserFromToken } from "../lib/supabase";

const router = Router();

router.get("/", async (_req, res) => {
  const { data, error } = await supabase
    .from("products")
    .select("*")
    .order("category")
    .order("sort_order");
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data ?? []);
});

router.post("/", async (req, res) => {
  const user = await getUserFromToken(req.headers.authorization);
  if (!user || (user.role !== "super_admin" && user.role !== "admin")) {
    return res.status(403).json({ error: "Forbidden" });
  }
  const { name, category, description, unit_price, active, sort_order } = req.body;
  const { data, error } = await supabase
    .from("products")
    .insert({ name, category, description, unit_price: unit_price ?? 0, active: active ?? true, sort_order: sort_order ?? 0 })
    .select()
    .single();
  if (error) return res.status(400).json({ error: error.message });
  return res.status(201).json(data);
});

router.put("/:id", async (req, res) => {
  const user = await getUserFromToken(req.headers.authorization);
  if (!user || (user.role !== "super_admin" && user.role !== "admin")) {
    return res.status(403).json({ error: "Forbidden" });
  }
  const { name, category, description, unit_price, active, sort_order } = req.body;
  const { data, error } = await supabase
    .from("products")
    .update({ name, category, description, unit_price, active, sort_order, updated_at: new Date().toISOString() })
    .eq("id", req.params.id)
    .select()
    .single();
  if (error) return res.status(400).json({ error: error.message });
  return res.json(data);
});

router.delete("/:id", async (req, res) => {
  const user = await getUserFromToken(req.headers.authorization);
  if (!user || user.role !== "super_admin") {
    return res.status(403).json({ error: "Only super_admin can delete products" });
  }
  const { error } = await supabase.from("products").delete().eq("id", req.params.id);
  if (error) return res.status(400).json({ error: error.message });
  return res.json({ ok: true });
});

// Get order lines for a booking
router.get("/booking/:bookingId", async (req, res) => {
  const { data, error } = await supabase
    .from("booking_products")
    .select("*, products(name, category)")
    .eq("booking_id", req.params.bookingId)
    .order("created_at");
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data ?? []);
});

// Add order line to booking
router.post("/booking/:bookingId", async (req, res) => {
  const { product_id, name, unit_price, quantity, notes } = req.body;
  const { data, error } = await supabase
    .from("booking_products")
    .insert({ booking_id: req.params.bookingId, product_id: product_id ?? null, name, unit_price, quantity: quantity ?? 1, notes: notes ?? null })
    .select()
    .single();
  if (error) return res.status(400).json({ error: error.message });
  return res.status(201).json(data);
});

// Remove order line
router.delete("/booking-line/:lineId", async (req, res) => {
  const { error } = await supabase.from("booking_products").delete().eq("id", req.params.lineId);
  if (error) return res.status(400).json({ error: error.message });
  return res.json({ ok: true });
});

export default router;
