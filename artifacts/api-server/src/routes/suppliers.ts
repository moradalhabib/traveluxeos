import { Router } from "express";
import { supabase, auditLog, getUserFromToken } from "../lib/supabase";

const router = Router();

// Whitelisted columns for the suppliers table. Mirrors migration-build4.sql.
// commission_rate was removed in migration-remove-supplier-commission.sql —
// suppliers charge flat per-vehicle rates (held in supplier_products), not
// a percentage commission, and the lingering column was breaking saves.
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

// ─── GET /suppliers/:id — single supplier with recent bookings + products ──
router.get("/:id", async (req, res) => {
  const { id } = req.params;
  const { data: supplier, error } = await supabase
    .from("suppliers")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!supplier) return res.status(404).json({ error: "Supplier not found" });

  // Bookings select with balance-tracker columns (added in
  // migration-supplier-balance.sql). If the migration has not been applied
  // yet, PostgREST returns 42703 (undefined column) — fall back to the
  // legacy column set so the supplier detail page never goes blank.
  // client_name is NOT a column on bookings — it lives on clients. Embed it
  // via the FK relationship so the supplier-balance UI can label rows.
  const BOOKINGS_COLS_FULL =
    "id, tvl_ref, service_type, status, date_time, price, supplier_cost, supplier_commission, client_id, supplier_paid_at, supplier_payment_ref, clients(name)";
  const BOOKINGS_COLS_LEGACY =
    "id, tvl_ref, service_type, status, date_time, price, supplier_cost, supplier_commission, client_id, clients(name)";

  let bookingsRes = await supabase
    .from("bookings")
    .select(BOOKINGS_COLS_FULL)
    .eq("supplier_id", id)
    .order("date_time", { ascending: false })
    .limit(500);

  // PostgREST surfaces missing columns as either
  //   "column ... does not exist"  (PGRST/Postgres 42703)
  // or
  //   "Could not find the 'supplier_paid_at' column ... in the schema cache" (PGRST204)
  // Match both and retry with the legacy column set so the supplier detail
  // page never goes blank when the migration hasn't been applied yet.
  if (
    bookingsRes.error &&
    (/column .* does not exist/i.test(bookingsRes.error.message) ||
      /could not find the .* column/i.test(bookingsRes.error.message) ||
      /supplier_paid_at|supplier_payment_ref/i.test(bookingsRes.error.message))
  ) {
    console.warn(
      `[suppliers] balance columns missing, falling back to legacy select: ${bookingsRes.error.message}`,
    );
    // The legacy select is missing supplier_paid_at / supplier_payment_ref
    // (those columns don't exist yet on this DB), so the inferred response
    // type is narrower than the FULL one. The callers below treat the row as
    // `any`, so the missing fields just stay `undefined`. Widen via cast so
    // TS doesn't flag the reassignment.
    bookingsRes = (await supabase
      .from("bookings")
      .select(BOOKINGS_COLS_LEGACY)
      .eq("supplier_id", id)
      .order("date_time", { ascending: false })
      .limit(500)) as unknown as typeof bookingsRes;
  }
  if (bookingsRes.error) {
    return res.status(500).json({ error: `bookings: ${bookingsRes.error.message}` });
  }
  // Flatten the embedded client name onto the booking row for the UI.
  const bookings = (bookingsRes.data ?? []).map((b: any) => ({
    ...b,
    client_name: b.clients?.name ?? null,
    clients: undefined,
  }));

  const { data: products, error: productsErr } = await supabase
    .from("supplier_products")
    .select("*")
    .eq("supplier_id", id)
    .order("is_active", { ascending: false })
    .order("kind", { ascending: true })
    .order("name", { ascending: true });
  if (productsErr) {
    return res.status(500).json({ error: `products: ${productsErr.message}` });
  }

  const total_revenue = (bookings ?? []).reduce(
    (sum: number, b: any) => sum + Number(b.price ?? 0),
    0,
  );
  const total_supplier_cost = (bookings ?? []).reduce(
    (sum: number, b: any) => sum + Number(b.supplier_cost ?? 0),
    0,
  );
  const total_commission = (bookings ?? []).reduce(
    (sum: number, b: any) => sum + Number(b.supplier_commission ?? 0),
    0,
  );

  return res.json({
    ...supplier,
    bookings: bookings ?? [],
    products: products ?? [],
    total_bookings: bookings?.length ?? 0,
    total_revenue,
    total_supplier_cost,
    total_commission,
    total_margin: total_revenue - total_supplier_cost,
  });
});

// ─── Supplier products (cars / drivers / other) ────────────────────────────
const PRODUCT_COLUMNS = new Set([
  "name", "kind", "daily_rate", "hourly_rate", "plate", "notes", "is_active",
]);

function pickProduct(body: any): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(body)) {
    if (!PRODUCT_COLUMNS.has(k)) continue;
    if (v === "" || v === undefined) { out[k] = null; continue; }
    if (k === "daily_rate" || k === "hourly_rate") {
      const n = Number(v);
      out[k] = Number.isFinite(n) ? n : null;
    } else {
      out[k] = v;
    }
  }
  return out;
}

// GET /suppliers/:id/products — list active+inactive for a supplier
router.get("/:id/products", async (req, res) => {
  const { id } = req.params;
  const { data, error } = await supabase
    .from("supplier_products")
    .select("*")
    .eq("supplier_id", id)
    .order("is_active", { ascending: false })
    .order("kind", { ascending: true })
    .order("name", { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data ?? []);
});

// POST /suppliers/:id/products — create
router.post("/:id/products", async (req, res) => {
  const user = await getUserFromToken(req.headers.authorization);
  if (!user) return res.status(401).json({ error: "Unauthorized" });
  const { id } = req.params;

  const payload = pickProduct(req.body);
  if (!payload.name) return res.status(400).json({ error: "Product name is required" });
  if (!payload.kind) payload.kind = "Car";

  const { data, error } = await supabase
    .from("supplier_products")
    .insert({ ...payload, supplier_id: id })
    .select()
    .single();
  if (error) return res.status(400).json({ error: error.message });
  await auditLog("create_supplier_product", "supplier_product", data.id, user.id,
    `Added ${data.kind} "${data.name}" to supplier ${id}`);
  return res.json(data);
});

// PATCH /suppliers/:id/products/:pid — update
router.patch("/:id/products/:pid", async (req, res) => {
  const user = await getUserFromToken(req.headers.authorization);
  if (!user) return res.status(401).json({ error: "Unauthorized" });
  const { id, pid } = req.params;

  const updates = pickProduct(req.body);
  const { data, error } = await supabase
    .from("supplier_products")
    .update(updates)
    .eq("id", pid)
    .eq("supplier_id", id)
    .select()
    .single();
  if (error) return res.status(400).json({ error: error.message });
  await auditLog("update_supplier_product", "supplier_product", pid, user.id,
    `Updated ${data.kind} "${data.name}"`);
  return res.json(data);
});

// DELETE /suppliers/:id/products/:pid — hard delete (cascades to bookings via SET NULL)
router.delete("/:id/products/:pid", async (req, res) => {
  const user = await getUserFromToken(req.headers.authorization);
  if (!user) return res.status(401).json({ error: "Unauthorized" });
  const { id, pid } = req.params;

  const { error } = await supabase
    .from("supplier_products")
    .delete()
    .eq("id", pid)
    .eq("supplier_id", id);
  if (error) return res.status(400).json({ error: error.message });
  await auditLog("delete_supplier_product", "supplier_product", pid, user.id,
    `Removed product ${pid} from supplier ${id}`);
  return res.json({ ok: true });
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

// ─── POST /suppliers/:id/balance/mark-paid ─────────────────────────────────
// Feature 5: bulk-mark a list of bookings as "supplier paid" for this supplier.
// Body: { booking_ids: string[], payment_ref?: string, paid_at?: ISOString }
// Returns { updated: number }. We constrain by supplier_id so an operator
// can't accidentally mark another supplier's bookings as paid via a stale tab.
router.post("/:id/balance/mark-paid", async (req, res) => {
  const user = await getUserFromToken(req.headers.authorization);
  if (!user) return res.status(401).json({ error: "Unauthorized" });
  const { id } = req.params;
  const ids = Array.isArray(req.body?.booking_ids) ? req.body.booking_ids.filter((x: any) => typeof x === "string" && x.length > 0) : [];
  if (ids.length === 0) return res.status(400).json({ error: "booking_ids is required" });
  const ref = typeof req.body?.payment_ref === "string" ? req.body.payment_ref.trim() : null;
  const paidAt = req.body?.paid_at && !isNaN(Date.parse(req.body.paid_at))
    ? new Date(req.body.paid_at).toISOString()
    : new Date().toISOString();

  const { data, error } = await supabase
    .from("bookings")
    .update({ supplier_paid_at: paidAt, supplier_payment_ref: ref })
    .in("id", ids)
    .eq("supplier_id", id)
    .select("id");
  if (error) return res.status(400).json({ error: error.message });

  await auditLog("supplier_balance_mark_paid", "supplier", id, user.id,
    `Marked ${data?.length ?? 0} booking(s) paid${ref ? ` (ref: ${ref})` : ""}`);
  return res.json({ updated: data?.length ?? 0 });
});

// ─── POST /suppliers/:id/balance/unmark-paid ───────────────────────────────
// Reverses a mark-paid action — clears supplier_paid_at + supplier_payment_ref.
router.post("/:id/balance/unmark-paid", async (req, res) => {
  const user = await getUserFromToken(req.headers.authorization);
  if (!user) return res.status(401).json({ error: "Unauthorized" });
  const { id } = req.params;
  const ids = Array.isArray(req.body?.booking_ids) ? req.body.booking_ids.filter((x: any) => typeof x === "string" && x.length > 0) : [];
  if (ids.length === 0) return res.status(400).json({ error: "booking_ids is required" });

  const { data, error } = await supabase
    .from("bookings")
    .update({ supplier_paid_at: null, supplier_payment_ref: null })
    .in("id", ids)
    .eq("supplier_id", id)
    .select("id");
  if (error) return res.status(400).json({ error: error.message });

  await auditLog("supplier_balance_unmark_paid", "supplier", id, user.id,
    `Reverted paid status on ${data?.length ?? 0} booking(s)`);
  return res.json({ updated: data?.length ?? 0 });
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
