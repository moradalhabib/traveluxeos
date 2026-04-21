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

// ─── Vehicle airport pricing ─────────────────────────────────────
// Get all airport-pricing rows for a Vehicle product (LHR/LGW/STN/LTN/LCY/OTHER).
router.get("/:id/airport-pricing", async (req, res) => {
  const { data, error } = await supabase
    .from("vehicle_airport_pricing")
    .select("*")
    .eq("product_id", req.params.id)
    .order("airport_code");
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data ?? []);
});

// Upsert one airport-pricing row.
router.put("/:id/airport-pricing/:code", async (req, res) => {
  const user = await getUserFromToken(req.headers.authorization);
  if (!user || (user.role !== "super_admin" && user.role !== "admin")) {
    return res.status(403).json({ error: "Forbidden" });
  }
  const { airport_name, price, hourly_rate } = req.body;
  const { data, error } = await supabase
    .from("vehicle_airport_pricing")
    .upsert({
      product_id:   req.params.id,
      airport_code: req.params.code,
      airport_name: airport_name ?? req.params.code,
      price:        price ?? 0,
      hourly_rate:  hourly_rate ?? null,
      updated_at:   new Date().toISOString(),
    }, { onConflict: "product_id,airport_code" })
    .select()
    .single();
  if (error) return res.status(400).json({ error: error.message });
  return res.json(data);
});

// Lookup the price for a (vehicle, airport) pair — used by the booking form
// to auto-fill the Airport Transfer price.
router.get("/lookup/airport-price", async (req, res) => {
  const productId = String(req.query.product_id ?? "");
  const code      = String(req.query.airport_code ?? "");
  if (!productId || !code) return res.json({ price: null, hourly_rate: null });
  const { data, error } = await supabase
    .from("vehicle_airport_pricing")
    .select("price, hourly_rate, airport_name")
    .eq("product_id", productId)
    .eq("airport_code", code)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data ?? { price: null, hourly_rate: null });
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
