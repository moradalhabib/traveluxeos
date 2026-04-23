import { Router } from "express";
import { supabase, auditLog, getUserFromToken, getDbClient } from "../lib/supabase";
import { logActivity } from "../lib/activity";

const router = Router();

// List clients
router.get("/", async (req, res) => {
  const { search, vip_tier, inactive } = req.query;
  let query = supabase
    .from("clients")
    .select("*, bookings(id, price, additional_charges, date_time, status)")
    .is("merged_into", null)
    .order("name");

  if (vip_tier) query = query.eq("vip_tier", vip_tier);
  if (inactive !== undefined) query = query.eq("inactive", inactive === "true");

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  let clients = data ?? [];

  if (search) {
    const s = String(search).toLowerCase();
    clients = clients.filter(c =>
      c.name?.toLowerCase().includes(s) ||
      c.whatsapp?.toLowerCase().includes(s) ||
      c.email?.toLowerCase().includes(s) ||
      c.nationality?.toLowerCase().includes(s)
    );
  }

  const result = clients.map((c: any) => {
    const bookings = (c.bookings ?? []).filter((b: any) => b.status !== "Cancelled");
    const total_spent = bookings.reduce((sum: number, b: any) => sum + (b.price || 0) + (b.additional_charges || 0), 0);
    const sorted = [...bookings].sort((a: any, b: any) => new Date(b.date_time).getTime() - new Date(a.date_time).getTime());
    return {
      ...c,
      bookings: undefined,
      total_bookings: bookings.length,
      total_spent,
      last_booking_date: sorted[0]?.date_time ?? null,
    };
  });

  return res.json(result);
});

// Check duplicate
router.get("/check-duplicate", async (req, res) => {
  const { whatsapp, email } = req.query;

  if (whatsapp) {
    const { data } = await supabase
      .from("clients")
      .select("*, bookings(id, price, additional_charges, date_time, service_type, status)")
      .eq("whatsapp", String(whatsapp))
      .is("merged_into", null)
      .single();

    if (data) {
      const bookings = (data.bookings ?? []).filter((b: any) => b.status !== "Cancelled");
      return res.json({
        found: true,
        match_type: "whatsapp",
        client: {
          ...data,
          bookings: undefined,
          total_bookings: bookings.length,
          total_spent: bookings.reduce((sum: number, b: any) => sum + (b.price || 0) + (b.additional_charges || 0), 0),
          last_booking_date: bookings.sort((a: any, b: any) => new Date(b.date_time).getTime() - new Date(a.date_time).getTime())[0]?.date_time ?? null,
        },
      });
    }
  }

  if (email) {
    const { data } = await supabase
      .from("clients")
      .select("*")
      .eq("email", String(email))
      .is("merged_into", null)
      .single();

    if (data) {
      return res.json({ found: true, match_type: "email", client: { ...data, total_bookings: 0, total_spent: 0 } });
    }
  }

  return res.json({ found: false });
});

// Merge clients
router.post("/merge", async (req, res) => {
  const user = await getUserFromToken(req.headers.authorization);
  const { primary_id, secondary_id } = req.body;

  if (!primary_id || !secondary_id) {
    return res.status(400).json({ error: "primary_id and secondary_id are required" });
  }

  // Move all bookings from secondary to primary
  await supabase.from("bookings").update({ client_id: primary_id }).eq("client_id", secondary_id);

  // Archive secondary
  await supabase.from("clients").update({ merged_into: primary_id }).eq("id", secondary_id);

  await auditLog("merge_clients", "client", primary_id, user?.id ?? null,
    `Merged client ${secondary_id} into ${primary_id}`);

  const { data } = await supabase.from("clients").select("*").eq("id", primary_id).single();
  return res.json(data);
});

// Create client
router.post("/", async (req, res) => {
  const authHeader = req.headers.authorization;
  const user = await getUserFromToken(authHeader);
  const db = getDbClient(authHeader);
  const body = req.body;

  const { data, error } = await db
    .from("clients")
    .insert({ ...body, created_by: user?.id ?? null })
    .select()
    .single();

  if (error) {
    console.error("[clients POST] Supabase error:", error.message, error.details, error.hint);
    return res.status(400).json({ error: error.message, details: error.details, hint: error.hint });
  }

  await auditLog("create_client", "client", data.id, user?.id ?? null, `Created client ${data.name}`);
  await logActivity({
    action_type: "client_created",
    description: `Client ${data.name} created`,
    entity_type: "client",
    entity_id: data.id,
    entity_label: data.name ?? null,
    operator_id: user?.id ?? null,
    operator_name: user?.name ?? null,
  });
  return res.status(201).json({ ...data, total_bookings: 0, total_spent: 0 });
});

// Get client with history
router.get("/:id", async (req, res) => {
  const { id } = req.params;

  const { data: client, error } = await supabase
    .from("clients")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !client) return res.status(404).json({ error: "Client not found" });

  const { data: bookings } = await supabase
    .from("bookings")
    .select("*, drivers(name, vehicle_type, vehicle_model, vehicle_year)")
    .eq("client_id", id)
    .order("date_time", { ascending: false });

  const validBookings = (bookings ?? []).filter((b: any) => b.status !== "Cancelled");
  const total_spent = validBookings.reduce((sum: number, b: any) => sum + (b.price || 0) + (b.additional_charges || 0), 0);

  const enrichedBookings = (bookings ?? []).map((b: any) => ({
    ...b,
    driver_name: b.drivers?.name ?? null,
    driver_vehicle: b.drivers
      ? [b.drivers.vehicle_year, b.drivers.vehicle_model ?? b.drivers.vehicle_type].filter(Boolean).join(" ").trim() || null
      : null,
    drivers: undefined,
  }));

  return res.json({
    ...client,
    total_bookings: validBookings.length,
    total_spent,
    last_booking_date: validBookings[0]?.date_time ?? null,
    bookings: enrichedBookings,
  });
});

// Update client
router.put("/:id", async (req, res) => {
  const user = await getUserFromToken(req.headers.authorization);
  const { id } = req.params;

  const ALLOWED = new Set([
    "name","whatsapp","email","nationality","language_preference","vip_tier","notes","inactive",
    "preferred_driver_id","favourite_vehicle_type","service_preferences","dietary_notes","usual_pickup_locations"
  ]);
  const body: Record<string, any> = {};
  for (const [k, v] of Object.entries(req.body)) {
    if (ALLOWED.has(k)) body[k] = v;
  }

  const { data, error } = await supabase
    .from("clients")
    .update(body)
    .eq("id", id)
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });

  await auditLog("update_client", "client", id, user?.id ?? null, `Updated client ${data.name}`);
  await logActivity({
    action_type: "client_updated",
    description: `Client ${data.name} updated`,
    entity_type: "client",
    entity_id: id,
    entity_label: data.name ?? null,
    operator_id: user?.id ?? null,
    operator_name: user?.name ?? null,
  });
  return res.json({ ...data, total_bookings: 0, total_spent: 0 });
});

// DELETE /clients/:id — admin-only hard delete with full cascade.
// Deletes the client and EVERY booking linked to them, plus each booking's
// dependent rows (invoices, follow_ups, booking_products, amendments,
// driver_ratings, issues, requests, booking_email_log, return-link
// pointers). Stats endpoints (follow-ups, dashboard, analytics) re-derive
// from these tables so once they're gone the counts update everywhere.
router.delete("/:id", async (req, res) => {
  const user = await getUserFromToken(req.headers.authorization);
  if (!user || (user.role !== "admin" && user.role !== "super_admin")) {
    return res.status(403).json({ error: "Only Admin or Super Admin can delete clients" });
  }
  const { id } = req.params;

  const { data: clientRow } = await supabase
    .from("clients")
    .select("id, name")
    .eq("id", id)
    .single();
  if (!clientRow) return res.status(404).json({ error: "Client not found" });

  // Fetch every booking for this client (any status — fully purge).
  const { data: bookingRows } = await supabase
    .from("bookings")
    .select("id, tvl_ref")
    .eq("client_id", id);
  const bookingIds = (bookingRows ?? []).map(b => b.id);

  if (bookingIds.length > 0) {
    // Clear self-referential return-booking pointers across the table.
    await supabase.from("bookings").update({ return_booking_id: null }).in("return_booking_id", bookingIds);

    const childTables = [
      "follow_ups",
      "booking_email_log",
      "booking_products",
      "booking_amendments",
      "driver_ratings",
      "issues",
      "invoices",
      "requests",
    ];
    for (const t of childTables) {
      const { error } = await supabase.from(t).delete().in("booking_id", bookingIds);
      if (error && !/does not exist|relation .* does not exist/i.test(error.message)) {
        console.warn(`[delete-client] ${t} cleanup warning:`, error.message);
      }
    }

    const { error: bkErr } = await supabase.from("bookings").delete().in("id", bookingIds);
    if (bkErr) return res.status(400).json({ error: `Failed to delete client bookings: ${bkErr.message}` });
  }

  // Direct client-scoped child rows (follow-ups can be created without a booking).
  await supabase.from("follow_ups").delete().eq("client_id", id);

  const { error } = await supabase.from("clients").delete().eq("id", id);
  if (error) return res.status(400).json({ error: error.message });

  const summary = `Client ${clientRow.name ?? id} permanently deleted by ${user.name ?? user.email ?? user.id} (${user.role}). ` +
    `Cascade removed ${bookingIds.length} booking(s) and all linked invoices, follow-ups & related rows.`;
  await auditLog("delete_client", "client", id, user.id, summary);
  return res.json({ success: true, cascaded_bookings: bookingIds.length });
});

export default router;
