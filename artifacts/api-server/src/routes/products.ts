import { Router } from "express";
import { supabase, getUserFromToken, auditLog } from "../lib/supabase";

const router = Router();

// Compact diff helper: returns a "k1: a → b, k2: c → d" string for the
// fields that actually changed. Keeps the audit detail human-readable
// while still capturing every before/after value the super_admin needs.
function diffSummary(before: Record<string, any> | null, after: Record<string, any>): string {
  if (!before) return "";
  const parts: string[] = [];
  for (const k of Object.keys(after)) {
    const a = before[k];
    const b = (after as any)[k];
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      parts.push(`${k}: ${JSON.stringify(a)} → ${JSON.stringify(b)}`);
    }
  }
  return parts.join(", ");
}

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

  // Audit: who created which catalogue entry, with the full new row as context.
  auditLog(
    "product_created",
    "product",
    data.id,
    user.id,
    `Created ${data.category ?? "product"} "${data.name}". after=${JSON.stringify(data)}`
  ).catch(() => {});

  return res.status(201).json(data);
});

router.put("/:id", async (req, res) => {
  const user = await getUserFromToken(req.headers.authorization);
  if (!user || (user.role !== "super_admin" && user.role !== "admin")) {
    return res.status(403).json({ error: "Forbidden" });
  }
  // Snapshot the previous row so we can diff field-by-field for the audit log.
  const { data: prev } = await supabase.from("products").select("*").eq("id", req.params.id).maybeSingle();

  const { name, category, description, unit_price, active, sort_order } = req.body;
  const { data, error } = await supabase
    .from("products")
    .update({ name, category, description, unit_price, active, sort_order, updated_at: new Date().toISOString() })
    .eq("id", req.params.id)
    .select()
    .single();
  if (error) return res.status(400).json({ error: error.message });

  const summary = diffSummary(prev, data);
  auditLog(
    "product_updated",
    "product",
    data.id,
    user.id,
    `Updated ${data.category ?? "product"} "${data.name}"${summary ? `. ${summary}` : " (no field changes)"}. before=${JSON.stringify(prev ?? null)} after=${JSON.stringify(data)}`
  ).catch(() => {});

  return res.json(data);
});

router.delete("/:id", async (req, res) => {
  const user = await getUserFromToken(req.headers.authorization);
  // Admins manage the catalogue (vehicles, tiers, services). Operators are
  // still locked out — they can only consume the catalogue in bookings.
  if (!user || (user.role !== "super_admin" && user.role !== "admin")) {
    return res.status(403).json({ error: "Only admin or super_admin can delete products" });
  }
  // Capture the row BEFORE deletion so the audit trail preserves what was
  // removed — the user explicitly required deletes to never be silent.
  const { data: prev } = await supabase.from("products").select("*").eq("id", req.params.id).maybeSingle();

  const { error } = await supabase.from("products").delete().eq("id", req.params.id);
  if (error) return res.status(400).json({ error: error.message });

  auditLog(
    "product_deleted",
    "product",
    req.params.id,
    user.id,
    `Deleted ${prev?.category ?? "product"} "${prev?.name ?? "(unknown)"}". before=${JSON.stringify(prev ?? null)}`
  ).catch(() => {});

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

  // Snapshot existing cell so we can audit the before/after price change.
  const { data: prev } = await supabase
    .from("vehicle_airport_pricing")
    .select("*")
    .eq("product_id", req.params.id)
    .eq("airport_code", req.params.code)
    .maybeSingle();

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

  // Resolve vehicle name once for a friendlier log line.
  const { data: vehicle } = await supabase.from("products").select("name").eq("id", req.params.id).maybeSingle();
  const vname = vehicle?.name ?? req.params.id;
  const summary = prev
    ? `${vname} @ ${req.params.code}: price ${prev.price ?? "—"} → ${data.price ?? "—"}, hourly ${prev.hourly_rate ?? "—"} → ${data.hourly_rate ?? "—"}`
    : `${vname} @ ${req.params.code}: created at price ${data.price ?? 0}`;
  auditLog(
    "airport_pricing_updated",
    "vehicle_airport_pricing",
    data.id ?? `${req.params.id}:${req.params.code}`,
    user.id,
    `${summary}. before=${JSON.stringify(prev ?? null)} after=${JSON.stringify(data)}`
  ).catch(() => {});

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
  const user = await getUserFromToken(req.headers.authorization);
  const { product_id, name, unit_price, quantity, notes } = req.body;
  const { data, error } = await supabase
    .from("booking_products")
    .insert({ booking_id: req.params.bookingId, product_id: product_id ?? null, name, unit_price, quantity: quantity ?? 1, notes: notes ?? null })
    .select()
    .single();
  if (error) return res.status(400).json({ error: error.message });

  auditLog(
    "booking_line_added",
    "booking",
    req.params.bookingId,
    user?.id ?? null,
    `Added line "${name}" × ${quantity ?? 1} @ ${unit_price ?? 0}. after=${JSON.stringify(data)}`
  ).catch(() => {});

  return res.status(201).json(data);
});

// Remove order line
router.delete("/booking-line/:lineId", async (req, res) => {
  const user = await getUserFromToken(req.headers.authorization);
  // Snapshot the line so the audit trail preserves what was removed,
  // including the parent booking it belonged to.
  const { data: prev } = await supabase
    .from("booking_products")
    .select("*")
    .eq("id", req.params.lineId)
    .maybeSingle();

  const { error } = await supabase.from("booking_products").delete().eq("id", req.params.lineId);
  if (error) return res.status(400).json({ error: error.message });

  auditLog(
    "booking_line_deleted",
    "booking",
    prev?.booking_id ?? req.params.lineId,
    user?.id ?? null,
    `Removed line "${prev?.name ?? "(unknown)"}" × ${prev?.quantity ?? 1} @ ${prev?.unit_price ?? 0}. before=${JSON.stringify(prev ?? null)}`
  ).catch(() => {});

  return res.json({ ok: true });
});

export default router;
