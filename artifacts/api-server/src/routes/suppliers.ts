import { Router } from "express";
import { supabase, auditLog, getUserFromToken } from "../lib/supabase";

const router = Router();

// Whitelisted columns for the suppliers table. Mirrors migration-build4.sql.
const SUPPLIER_COLUMNS = new Set([
  "name", "category", "contact_name", "whatsapp", "phone", "email",
  "address", "city", "country", "website", "notes", "rating", "is_active",
]);

// ─── GET /suppliers — list with optional category + search filters ─────────
router.get("/", async (req, res) => {
  const { category, search, active } = req.query as Record<string, string>;

  let q = supabase
    .from("suppliers")
    .select("*, bookings:bookings(id)")
    .order("name", { ascending: true });

  if (category && category !== "all") q = q.eq("category", category);
  if (active === "true") q = q.eq("is_active", true);
  if (active === "false") q = q.eq("is_active", false);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  let suppliers = (data ?? []).map((s: any) => ({
    ...s,
    bookings_count: Array.isArray(s.bookings) ? s.bookings.length : 0,
    bookings: undefined,
  }));

  if (search) {
    const s = search.toLowerCase();
    suppliers = suppliers.filter((sp: any) =>
      sp.name?.toLowerCase().includes(s) ||
      sp.contact_name?.toLowerCase().includes(s) ||
      sp.whatsapp?.toLowerCase().includes(s) ||
      sp.email?.toLowerCase().includes(s) ||
      sp.city?.toLowerCase().includes(s)
    );
  }

  return res.json(suppliers);
});

// ─── GET /suppliers/:id — single supplier with recent bookings ─────────────
router.get("/:id", async (req, res) => {
  const { id } = req.params;
  const { data: supplier, error } = await supabase
    .from("suppliers")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!supplier) return res.status(404).json({ error: "Supplier not found" });

  const { data: bookings } = await supabase
    .from("bookings")
    .select("id, tvl_ref, service_type, status, date_time, price, supplier_cost, client_name")
    .eq("supplier_id", id)
    .order("date_time", { ascending: false })
    .limit(50);

  const total_revenue = (bookings ?? []).reduce(
    (sum: number, b: any) => sum + (b.price ?? 0),
    0,
  );
  const total_supplier_cost = (bookings ?? []).reduce(
    (sum: number, b: any) => sum + (b.supplier_cost ?? 0),
    0,
  );

  return res.json({
    ...supplier,
    bookings: bookings ?? [],
    total_bookings: bookings?.length ?? 0,
    total_revenue,
    total_supplier_cost,
    total_margin: total_revenue - total_supplier_cost,
  });
});

// ─── POST /suppliers ────────────────────────────────────────────────────────
router.post("/", async (req, res) => {
  const user = await getUserFromToken(req.headers.authorization);
  if (!user) return res.status(401).json({ error: "Unauthorized" });

  const body: Record<string, any> = {};
  for (const [k, v] of Object.entries(req.body)) {
    if (SUPPLIER_COLUMNS.has(k) && v !== "" && v !== undefined) body[k] = v;
  }
  if (!body.name) return res.status(400).json({ error: "Supplier name is required" });
  if (!body.category) body.category = "Other";

  const { data, error } = await supabase
    .from("suppliers")
    .insert(body)
    .select()
    .single();
  if (error) return res.status(400).json({ error: error.message });

  await auditLog("create_supplier", "supplier", data.id, user.id,
    `Created supplier ${data.name} (${data.category})`);

  return res.json(data);
});

// ─── PATCH /suppliers/:id ───────────────────────────────────────────────────
router.patch("/:id", async (req, res) => {
  const user = await getUserFromToken(req.headers.authorization);
  if (!user) return res.status(401).json({ error: "Unauthorized" });
  const { id } = req.params;

  const updates: Record<string, any> = {};
  for (const [k, v] of Object.entries(req.body)) {
    if (SUPPLIER_COLUMNS.has(k)) updates[k] = v === "" ? null : v;
  }

  const { data, error } = await supabase
    .from("suppliers")
    .update(updates)
    .eq("id", id)
    .select()
    .single();
  if (error) return res.status(400).json({ error: error.message });

  await auditLog("update_supplier", "supplier", id, user.id,
    `Updated supplier ${data.name}`);
  return res.json(data);
});

// ─── DELETE /suppliers/:id ──────────────────────────────────────────────────
// Soft delete: flip is_active to false so existing booking links are preserved.
router.delete("/:id", async (req, res) => {
  const user = await getUserFromToken(req.headers.authorization);
  if (!user) return res.status(401).json({ error: "Unauthorized" });
  const { id } = req.params;

  const { data, error } = await supabase
    .from("suppliers")
    .update({ is_active: false })
    .eq("id", id)
    .select()
    .single();
  if (error) return res.status(400).json({ error: error.message });

  await auditLog("deactivate_supplier", "supplier", id, user.id,
    `Deactivated supplier ${data?.name ?? id}`);
  return res.json({ ok: true });
});

export default router;
