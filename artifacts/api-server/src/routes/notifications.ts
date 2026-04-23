import { Router } from "express";
import { getDbClient, getUserFromToken } from "../lib/supabase";
import { notifyByRoles, STAFF_ROLES } from "../services/notify";

const router = Router();

const auth = (req: any) => req.headers.authorization;

// POST /api/notifications/broadcast-staff
// Admin-only. Used by bulk-delete fan-outs to emit ONE aggregated
// notification to all staff after silently deleting many rows, instead
// of letting each per-row DELETE notify and spam the bell.
// Body: { type, title, message, link?, severity? }
router.post("/broadcast-staff", async (req, res) => {
  const user = await getUserFromToken(auth(req));
  if (!user) return res.status(401).json({ error: "Unauthorized" });
  if (!["admin", "super_admin"].includes(user.role)) {
    return res.status(403).json({ error: "Admin only" });
  }
  const { type, title, message, link, severity } = req.body ?? {};
  if (!type || !title || !message) {
    return res.status(400).json({ error: "type, title and message are required" });
  }
  await notifyByRoles(STAFF_ROLES, {
    type,
    title,
    message,
    link,
    severity: severity ?? "info",
  }).catch((e) => console.warn("[broadcast-staff] notify error:", e?.message));
  return res.json({ ok: true });
});

// GET /api/notifications?limit=50&unread_only=false
router.get("/", async (req, res) => {
  const user = await getUserFromToken(auth(req));
  if (!user) return res.status(401).json({ error: "Unauthorized" });

  const limit = Math.min(parseInt(String(req.query.limit ?? "50"), 10) || 50, 200);
  const unreadOnly = String(req.query.unread_only ?? "false") === "true";

  const db = getDbClient(auth(req));
  let q = db
    .from("notifications")
    .select("*")
    .eq("user_id", user.id)
    .eq("dismissed", false)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (unreadOnly) q = q.eq("read", false);

  const { data, error } = await q;
  if (error) return res.status(400).json({ error: error.message });

  const { count: unreadCount } = await db
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("dismissed", false)
    .eq("read", false);

  return res.json({ items: data ?? [], unread_count: unreadCount ?? 0 });
});

// POST /api/notifications/mark-all-read
router.post("/mark-all-read", async (req, res) => {
  const user = await getUserFromToken(auth(req));
  if (!user) return res.status(401).json({ error: "Unauthorized" });

  const db = getDbClient(auth(req));
  const { error } = await db
    .from("notifications")
    .update({ read: true, read_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .eq("read", false);
  if (error) return res.status(400).json({ error: error.message });
  return res.json({ ok: true });
});

// POST /api/notifications/:id/read
router.post("/:id/read", async (req, res) => {
  const user = await getUserFromToken(auth(req));
  if (!user) return res.status(401).json({ error: "Unauthorized" });
  const db = getDbClient(auth(req));
  const { error } = await db
    .from("notifications")
    .update({ read: true, read_at: new Date().toISOString() })
    .eq("id", req.params.id)
    .eq("user_id", user.id);
  if (error) return res.status(400).json({ error: error.message });
  return res.json({ ok: true });
});

// POST /api/notifications/:id/dismiss  (soft-hide; keeps audit trail)
router.post("/:id/dismiss", async (req, res) => {
  const user = await getUserFromToken(auth(req));
  if (!user) return res.status(401).json({ error: "Unauthorized" });
  const db = getDbClient(auth(req));
  const { error } = await db
    .from("notifications")
    .update({ dismissed: true, read: true, read_at: new Date().toISOString() })
    .eq("id", req.params.id)
    .eq("user_id", user.id);
  if (error) return res.status(400).json({ error: error.message });
  return res.json({ ok: true });
});

// POST /api/notifications/clear-all
router.post("/clear-all", async (req, res) => {
  const user = await getUserFromToken(auth(req));
  if (!user) return res.status(401).json({ error: "Unauthorized" });
  const db = getDbClient(auth(req));
  const { error } = await db
    .from("notifications")
    .update({ dismissed: true, read: true, read_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .eq("dismissed", false);
  if (error) return res.status(400).json({ error: error.message });
  return res.json({ ok: true });
});

// GET /api/notifications/prefs/me
router.get("/prefs/me", async (req, res) => {
  const user = await getUserFromToken(auth(req));
  if (!user) return res.status(401).json({ error: "Unauthorized" });
  const db = getDbClient(auth(req));
  const { data, error } = await db
    .from("notification_prefs")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) return res.status(400).json({ error: error.message });

  return res.json(data ?? {
    user_id: user.id,
    booking_new: true,
    booking_status: true,
    booking_amended: true,
    booking_cancelled: true,
    no_driver_3h: true,
    no_driver_24h: true,
    flight_delay: true,
    follow_up_due: true,
    task_overdue: true,
    weekly_commission: true,
    unpaid_invoice: true,
  });
});

// PUT /api/notifications/prefs/me
router.put("/prefs/me", async (req, res) => {
  const user = await getUserFromToken(auth(req));
  if (!user) return res.status(401).json({ error: "Unauthorized" });
  const db = getDbClient(auth(req));

  const allowed = [
    "booking_new", "booking_status", "booking_amended", "booking_cancelled",
    "no_driver_3h", "no_driver_24h", "flight_delay", "follow_up_due",
    "task_overdue", "weekly_commission", "unpaid_invoice",
  ];
  const patch: any = { user_id: user.id, updated_at: new Date().toISOString() };
  for (const k of allowed) if (typeof req.body?.[k] === "boolean") patch[k] = req.body[k];

  const { data, error } = await db
    .from("notification_prefs")
    .upsert(patch, { onConflict: "user_id" })
    .select()
    .single();
  if (error) return res.status(400).json({ error: error.message });
  return res.json(data);
});

export default router;
