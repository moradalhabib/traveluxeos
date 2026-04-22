import { Router } from "express";
import { supabase, auditLog, getUserFromToken } from "../lib/supabase";
import { notifyByRoles, STAFF_ROLES } from "../services/notify";

const router = Router();

const VALID_STATUS = ["New","Following Up","Ready to Book","Converted","Declined","Expired"];
const VALID_PRIORITY = ["Low","Medium","High","Urgent"];
const VALID_SERVICE = ["Airport Transfer","Tour","Car Rental","Apartment","Hotel","Other"];

// GET /api/requests?status=&priority=&client_id=&search=&sort=
router.get("/", async (req, res) => {
  const { status, priority, client_id, search, sort } = req.query;
  let query = supabase
    .from("requests")
    .select("*, clients(name, whatsapp)");

  if (status) query = query.eq("status", String(status));
  if (priority) query = query.eq("priority", String(priority));
  if (client_id) query = query.eq("client_id", String(client_id));
  if (search) {
    const s = String(search);
    query = query.or(`client_name.ilike.%${s}%,notes.ilike.%${s}%`);
  }

  // Default sort: follow-up date ascending (most urgent first)
  const sortKey = sort === "created" ? "created_at" : "follow_up_date";
  const ascending = sort !== "created";
  query = query.order(sortKey, { ascending });

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  // Auto-expire requests whose follow_up_date is more than 7 days past and
  // status is still New/Following Up
  const today = new Date().toISOString().slice(0, 10);
  const expiredIds = (data ?? [])
    .filter((r: any) => ["New","Following Up"].includes(r.status))
    .filter((r: any) => {
      if (!r.follow_up_date) return false;
      const diff = (Date.parse(today) - Date.parse(r.follow_up_date)) / (1000 * 60 * 60 * 24);
      return diff > 7;
    })
    .map((r: any) => r.id);

  if (expiredIds.length > 0) {
    await supabase.from("requests").update({ status: "Expired" }).in("id", expiredIds);
  }

  const requests = (data ?? []).map((r: any) => ({
    ...r,
    client_name: r.clients?.name ?? r.client_name,
    client_whatsapp: r.clients?.whatsapp ?? null,
    clients: undefined,
    status: expiredIds.includes(r.id) ? "Expired" : r.status,
  }));

  return res.json(requests);
});

router.post("/", async (req, res) => {
  const user = await getUserFromToken(req.headers.authorization);

  const body = req.body || {};
  if (!VALID_SERVICE.includes(body.service_type)) {
    return res.status(400).json({ error: "Invalid service_type" });
  }
  if (body.priority && !VALID_PRIORITY.includes(body.priority)) {
    return res.status(400).json({ error: "Invalid priority" });
  }
  if (body.status && !VALID_STATUS.includes(body.status)) {
    return res.status(400).json({ error: "Invalid status" });
  }
  if (!body.follow_up_date) {
    return res.status(400).json({ error: "follow_up_date is required" });
  }

  const { data, error } = await supabase
    .from("requests")
    .insert({ ...body, created_by: user?.id ?? null })
    .select("*, clients(name)")
    .single();

  if (error) return res.status(400).json({ error: error.message });
  await auditLog(
    "create_request", "request", data.id, user?.id ?? null,
    `Created request for ${data.clients?.name ?? data.client_name ?? "client"}`
  );

  // Fix — bell notification when a new request lands. Goes to staff because
  // any operator may pick it up. dedupe_key prevents double-fires from retries.
  {
    const clientName = data.clients?.name ?? data.client_name ?? "client";
    notifyByRoles(STAFF_ROLES, {
      type: "request_new",
      title: "New Request",
      message: `${data.service_type ?? "Request"} · ${clientName}`,
      link: `/requests/${data.id}`,
      entityType: "request",
      entityId: data.id,
      severity: data.priority === "urgent" ? "urgent" : "info",
      dedupeKey: `request_new:${data.id}`,
    }).catch(() => {});
  }

  return res.status(201).json({
    ...data,
    client_name: data.clients?.name ?? data.client_name,
    clients: undefined,
  });
});

router.get("/:id", async (req, res) => {
  const { data, error } = await supabase
    .from("requests")
    .select("*, clients(name, whatsapp, email)")
    .eq("id", req.params.id)
    .single();

  if (error || !data) return res.status(404).json({ error: "Request not found" });
  return res.json({
    ...data,
    client_name: data.clients?.name ?? data.client_name,
    client_whatsapp: data.clients?.whatsapp ?? null,
    client_email: data.clients?.email ?? null,
    clients: undefined,
  });
});

router.put("/:id", async (req, res) => {
  const user = await getUserFromToken(req.headers.authorization);
  const body = req.body || {};
  if (body.status && !VALID_STATUS.includes(body.status)) {
    return res.status(400).json({ error: "Invalid status" });
  }
  if (body.priority && !VALID_PRIORITY.includes(body.priority)) {
    return res.status(400).json({ error: "Invalid priority" });
  }
  if (body.service_type && !VALID_SERVICE.includes(body.service_type)) {
    return res.status(400).json({ error: "Invalid service_type" });
  }

  const { data, error } = await supabase
    .from("requests")
    .update(body)
    .eq("id", req.params.id)
    .select("*, clients(name)")
    .single();

  if (error) return res.status(400).json({ error: error.message });
  await auditLog("update_request", "request", req.params.id, user?.id ?? null, "Request updated");
  return res.json({
    ...data,
    client_name: data.clients?.name ?? data.client_name,
    clients: undefined,
  });
});

router.delete("/:id", async (req, res) => {
  const user = await getUserFromToken(req.headers.authorization);
  const { error } = await supabase
    .from("requests")
    .delete()
    .eq("id", req.params.id);
  if (error) return res.status(400).json({ error: error.message });
  await auditLog("delete_request", "request", req.params.id, user?.id ?? null, "Request deleted");
  return res.json({ ok: true });
});

// Convert request → returns prefilled draft used by the booking form.
// Marks the request as Ready to Book until an actual booking is created
// (the booking form then PUTs status=Converted with converted_booking_id).
router.post("/:id/convert", async (req, res) => {
  const user = await getUserFromToken(req.headers.authorization);
  const { data: r, error } = await supabase
    .from("requests")
    .select("*, clients(name, whatsapp)")
    .eq("id", req.params.id)
    .single();

  if (error || !r) return res.status(404).json({ error: "Request not found" });

  // Build a booking draft (not yet inserted — frontend opens /bookings/new prefilled)
  const draft = {
    request_id: r.id,
    client_id: r.client_id,
    client_name: r.clients?.name ?? r.client_name,
    service_type: r.service_type,
    date_time: r.requested_date_time,
    notes: r.notes,
    price: r.estimated_price ?? 0,
  };

  await supabase
    .from("requests")
    .update({ status: "Ready to Book" })
    .eq("id", r.id)
    .eq("status", "New");

  await auditLog(
    "convert_request", "request", r.id, user?.id ?? null,
    `Request prepared for booking conversion`
  );

  return res.json({ draft });
});

export default router;
