import { Router } from "express";
import { supabase, auditLog, getUserFromToken } from "../lib/supabase";

const router = Router();

// Whitelisted columns for the suppliers table. Mirrors migration-build4.sql.
// commission_rate was removed in migration-remove-supplier-commission.sql —
// suppliers charge flat per-vehicle rates (held in supplier_products), not
// a percentage commission, and the lingering column was breaking saves.
//
// service_types (text[]) + primary_service_type (text) were introduced in
// migration-supplier-service-types.sql. The legacy `category` column is kept
// and a DB trigger syncs it from primary_service_type, so any code path that
// still reads `category` continues to work even after this migration.
const SUPPLIER_COLUMNS = new Set([
  "name", "category", "service_types", "primary_service_type",
  "contact_name", "whatsapp", "phone", "email",
  "address", "city", "country", "website", "notes", "rating", "is_active",
]);

// PostgREST signals "column doesn't exist" two different ways depending on
// schema cache state. The supplier route has the same dual pattern in the
// bookings select below — match both and fall back to a legacy write/select.
function isMissingColumn(err: { message?: string } | null | undefined, col: string) {
  if (!err?.message) return false;
  return (
    /column .* does not exist/i.test(err.message) ||
    /could not find the .* column/i.test(err.message) ||
    err.message.toLowerCase().includes(col.toLowerCase())
  );
}

// Strip the new array/primary fields from a payload so writes succeed against
// a pre-migration database. Mutates a fresh copy and returns it.
function stripServiceTypeColumns(payload: Record<string, any>) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { service_types, primary_service_type, ...rest } = payload;
  return rest;
}

// ─── GET /suppliers — list with optional category + search filters ─────────
router.get("/", async (req, res) => {
  const { category, service_type, search, active, include_inactive } =
    req.query as Record<string, string>;

  let q = supabase
    .from("suppliers")
    .select("*, bookings:bookings(id)")
    .order("name", { ascending: true });

  // service_type wins over category — it's the new array-aware filter that
  // also covers suppliers whose primary type is something else but who
  // ALSO cover the requested type (e.g. RMS Europe Cars in Airport Transfer).
  // Falls back to a legacy `category` eq if the new column doesn't exist yet.
  const filterValue = service_type && service_type !== "all"
    ? service_type
    : (category && category !== "all" ? category : null);

  if (active === "true") q = q.eq("is_active", true);
  else if (active === "false") q = q.eq("is_active", false);
  else if (include_inactive !== "1" && include_inactive !== "true") {
    q = q.eq("is_active", true);
  }

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  // Apply the type filter client-side so we get true ANY-match across the
  // new service_types[] column AND a graceful fallback to the legacy
  // `category` column for rows that haven't been migrated yet.
  let rows = data ?? [];
  if (filterValue) {
    rows = rows.filter((s: any) => {
      const arr: string[] = Array.isArray(s.service_types) && s.service_types.length > 0
        ? s.service_types
        : (s.category ? [s.category] : []);
      return arr.includes(filterValue);
    });
  }

  let suppliers = rows.map((s: any) => ({
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

// Normalise + validate the service-type fields on a write payload.
// Returns either { ok: true, payload } (with the keys cleaned and
// `category` mirrored from primary_service_type) or { ok: false, error }.
function applyServiceTypeFields(
  body: Record<string, any>,
  existing?: { service_types?: string[] | null; primary_service_type?: string | null; category?: string | null },
): { ok: true; payload: Record<string, any> } | { ok: false; error: string } {
  const out = { ...body };

  // Coerce service_types to a clean string[] if present in the request.
  if (Array.isArray(out.service_types)) {
    const cleaned = out.service_types
      .map((x: any) => (typeof x === "string" ? x.trim() : ""))
      .filter((x: string) => x.length > 0);
    // Dedupe while preserving order.
    out.service_types = Array.from(new Set(cleaned));
  } else if ("service_types" in out) {
    // Empty / null payload: drop it so we don't wipe the array unintentionally.
    delete out.service_types;
  }

  // Pick the effective primary, validating it's actually in the array.
  const arr: string[] | null = Array.isArray(out.service_types)
    ? out.service_types
    : (existing?.service_types && existing.service_types.length > 0
        ? existing.service_types
        : null);
  let primary: string | null = typeof out.primary_service_type === "string"
    ? out.primary_service_type.trim()
    : (existing?.primary_service_type ?? null);

  // If both array and primary are present, primary must belong to the array.
  if (arr && primary && !arr.includes(primary)) {
    primary = arr[0]; // auto-correct
  }
  // If we have an array but no primary, default to the first element.
  if (arr && arr.length > 0 && !primary) primary = arr[0];

  // Validation: at least one type must remain.
  // Only enforce when the caller is touching service_types OR the supplier
  // already had something. Leave legacy single-`category` writes alone.
  if (Array.isArray(out.service_types)) {
    if (out.service_types.length === 0) {
      return { ok: false, error: "Select at least one service type" };
    }
    out.primary_service_type = primary;
    // Mirror to legacy `category` so any older surface keeps working.
    out.category = primary;
  } else if (typeof out.primary_service_type === "string" && out.primary_service_type) {
    // Caller updated only the primary — also mirror to category.
    out.primary_service_type = primary;
    out.category = primary;
  }

  return { ok: true, payload: out };
}

// Insert/update with graceful fallback for pre-migration databases. If
// PostgREST returns "column not found" for service_types or
// primary_service_type, retry once with those keys stripped.
async function writeWithFallback(
  op: "insert" | "update",
  payload: Record<string, any>,
  id?: string,
) {
  const baseQuery = () => {
    const t = supabase.from("suppliers");
    return op === "insert"
      ? t.insert(payload).select().single()
      : t.update(payload).eq("id", id!).select().single();
  };
  let resp = await baseQuery();
  if (
    resp.error &&
    (isMissingColumn(resp.error, "service_types") ||
     isMissingColumn(resp.error, "primary_service_type"))
  ) {
    console.warn(
      `[suppliers] new columns missing on ${op}, retrying without service_types/primary_service_type: ${resp.error.message}`,
    );
    const stripped = stripServiceTypeColumns(payload);
    const t = supabase.from("suppliers");
    resp = (op === "insert"
      ? await t.insert(stripped).select().single()
      : await t.update(stripped).eq("id", id!).select().single()) as typeof resp;
  }
  return resp;
}

// Pretty-print a service-type set for the audit log.
function fmtTypes(types: string[] | null | undefined, primary: string | null | undefined) {
  if (!types || types.length === 0) return primary || "—";
  return types.map(t => (t === primary ? `${t}*` : t)).join(", ");
}

// ─── POST /suppliers ────────────────────────────────────────────────────────
router.post("/", async (req, res) => {
  const user = await getUserFromToken(req.headers.authorization);
  if (!user) return res.status(401).json({ error: "Unauthorized" });

  const body: Record<string, any> = {};
  for (const [k, v] of Object.entries(req.body)) {
    if (!SUPPLIER_COLUMNS.has(k)) continue;
    // Arrays must pass through even when "empty" so validation catches it.
    if (Array.isArray(v)) { body[k] = v; continue; }
    if (v === "" || v === undefined) continue;
    body[k] = v;
  }
  if (!body.name) return res.status(400).json({ error: "Supplier name is required" });

  // Default a single-type supplier to "Other" if no types/category supplied.
  if (!body.category && !Array.isArray(body.service_types)) body.category = "Other";

  const norm = applyServiceTypeFields(body);
  if (!norm.ok) return res.status(400).json({ error: norm.error });

  const { data, error } = await writeWithFallback("insert", norm.payload);
  if (error) return res.status(400).json({ error: error.message });

  await auditLog("create_supplier", "supplier", data.id, user.id,
    `Created supplier ${data.name} (${fmtTypes(data.service_types, data.primary_service_type ?? data.category)})`);

  return res.json(data);
});

// ─── PATCH /suppliers/:id ───────────────────────────────────────────────────
router.patch("/:id", async (req, res) => {
  const user = await getUserFromToken(req.headers.authorization);
  if (!user) return res.status(401).json({ error: "Unauthorized" });
  const { id } = req.params;

  // Pull the existing row so we can audit the diff and so applyServiceType
  // can validate against the current array if the caller only sent primary.
  const { data: existing, error: fetchErr } = await supabase
    .from("suppliers")
    .select("name, category, service_types, primary_service_type")
    .eq("id", id)
    .maybeSingle();
  if (fetchErr) return res.status(500).json({ error: fetchErr.message });
  if (!existing) return res.status(404).json({ error: "Supplier not found" });

  const updates: Record<string, any> = {};
  for (const [k, v] of Object.entries(req.body)) {
    if (!SUPPLIER_COLUMNS.has(k)) continue;
    if (Array.isArray(v)) { updates[k] = v; continue; }
    updates[k] = v === "" ? null : v;
  }

  const norm = applyServiceTypeFields(updates, existing as any);
  if (!norm.ok) return res.status(400).json({ error: norm.error });

  const { data, error } = await writeWithFallback("update", norm.payload, id);
  if (error) return res.status(400).json({ error: error.message });

  // Build a precise audit message — call out service-type changes
  // explicitly because they're the most consequential edit a supplier can
  // get and the new requirements call for full traceability.
  const oldTypes = (existing as any).service_types as string[] | null;
  const oldPrimary = (existing as any).primary_service_type ?? (existing as any).category;
  const newTypes = data.service_types as string[] | null;
  const newPrimary = data.primary_service_type ?? data.category;
  const typesChanged =
    fmtTypes(oldTypes, oldPrimary) !== fmtTypes(newTypes, newPrimary);
  const message = typesChanged
    ? `Updated supplier ${data.name} — service types: ${fmtTypes(oldTypes, oldPrimary)} → ${fmtTypes(newTypes, newPrimary)}`
    : `Updated supplier ${data.name}`;
  await auditLog("update_supplier", "supplier", id, user.id, message);
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

// POST /suppliers/bulk-delete — admin-only. Mirrors the single-row DELETE /:id
// logic: suppliers linked to bookings are soft-deleted (deactivated); others
// are hard-deleted. Batches the booking-count check in one query.
router.post("/bulk-delete", async (req, res) => {
  const user = await getUserFromToken(req.headers.authorization);
  if (!user || !["admin", "super_admin"].includes(user.role)) {
    return res.status(403).json({ error: "Forbidden" });
  }
  const { ids } = req.body ?? {};
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: "ids must be a non-empty array" });
  }
  const cleanIds = ids.map((id: any) => String(id)).filter(Boolean);

  // One query: find which of the selected suppliers have linked bookings.
  const { data: linked } = await supabase
    .from("bookings").select("supplier_id").in("supplier_id", cleanIds);
  const linkedSet = new Set((linked ?? []).map((r: any) => r.supplier_id).filter(Boolean));

  const toDeactivate = cleanIds.filter(id => linkedSet.has(id));
  const toDelete = cleanIds.filter(id => !linkedSet.has(id));
  let deleted = 0, deactivated = 0, failed = 0;

  if (toDeactivate.length > 0) {
    const { error } = await supabase
      .from("suppliers").update({ is_active: false }).in("id", toDeactivate);
    if (error) { failed += toDeactivate.length; }
    else {
      deactivated = toDeactivate.length;
      await auditLog("bulk_deactivate_suppliers", "supplier", toDeactivate[0], user.id,
        `Bulk deactivated ${toDeactivate.length} supplier(s) with linked bookings`);
    }
  }
  if (toDelete.length > 0) {
    const { error } = await supabase.from("suppliers").delete().in("id", toDelete);
    if (error) { failed += toDelete.length; }
    else {
      deleted = toDelete.length;
      await auditLog("bulk_delete_suppliers", "supplier", toDelete[0], user.id,
        `Bulk deleted ${toDelete.length} supplier(s) by ${user.name ?? user.email ?? user.id}`);
    }
  }
  return res.json({ deleted, deactivated, failed });
});

// ─── DELETE /suppliers/:id ──────────────────────────────────────────────────
// Default: hard delete. If the supplier is referenced by any booking, fall
// back to a soft delete (is_active = false) so historical bookings keep
// their reference. Pass ?soft=1 to force a soft delete (used by the
// per-supplier "Deactivate" button).
router.delete("/:id", async (req, res) => {
  const user = await getUserFromToken(req.headers.authorization);
  if (!user) return res.status(401).json({ error: "Unauthorized" });
  const { id } = req.params;
  const soft = req.query.soft === "1" || req.query.soft === "true";

  // Hard delete is destructive — restrict to admins. Soft delete keeps the
  // pre-existing access level (any authenticated user) so the per-supplier
  // Deactivate button continues to work for operators.
  if (!soft && !["super_admin", "admin"].includes(user.role)) {
    return res.status(403).json({ error: "Admin access required to delete" });
  }

  // Look up the supplier name once for the audit log message.
  const { data: existing } = await supabase
    .from("suppliers")
    .select("name")
    .eq("id", id)
    .single();
  const name = existing?.name ?? id;

  const doSoftDelete = async (reason?: string) => {
    const { error } = await supabase
      .from("suppliers")
      .update({ is_active: false })
      .eq("id", id);
    if (error) return res.status(400).json({ error: error.message });
    await auditLog("deactivate_supplier", "supplier", id, user.id,
      reason
        ? `Deactivated supplier ${name} (${reason})`
        : `Deactivated supplier ${name}`);
    return res.json({
      ok: true,
      deleted: false,
      deactivated: true,
      reason: reason ?? "soft_requested",
    });
  };

  if (soft) return doSoftDelete();

  // Hard delete path: only if no booking references this supplier.
  const { count, error: countErr } = await supabase
    .from("bookings")
    .select("id", { count: "exact", head: true })
    .eq("supplier_id", id);
  if (countErr) return res.status(500).json({ error: countErr.message });

  if ((count ?? 0) > 0) {
    return doSoftDelete("linked_bookings");
  }

  const { error: delErr } = await supabase
    .from("suppliers")
    .delete()
    .eq("id", id);
  if (delErr) return res.status(400).json({ error: delErr.message });

  await auditLog("delete_supplier", "supplier", id, user.id,
    `Deleted supplier ${name}`);
  return res.json({ ok: true, deleted: true, deactivated: false });
});

export default router;
