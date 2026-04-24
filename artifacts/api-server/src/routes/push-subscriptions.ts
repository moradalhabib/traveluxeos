import { Router } from "express";
import { getUserFromToken, getServiceRoleClient } from "../lib/supabase";

const router = Router();

// POST /api/push-subscriptions
// Saves (upserts) a Web Push subscription for the authenticated user.
// Called by the frontend after PushManager.subscribe().
router.post("/", async (req, res) => {
  const user = await getUserFromToken(req.headers.authorization ?? "");
  if (!user) return res.status(401).json({ error: "Unauthorized" });

  const { endpoint, keys, expirationTime } = req.body ?? {};
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return res.status(400).json({ error: "endpoint, keys.p256dh and keys.auth are required" });
  }

  const db = getServiceRoleClient();
  if (!db) return res.status(503).json({ error: "Service role not configured" });

  const { error } = await db.from("push_subscriptions").upsert({
    user_id:    user.id,
    endpoint,
    p256dh:     keys.p256dh,
    auth:       keys.auth,
    expires_at: expirationTime ? new Date(expirationTime).toISOString() : null,
    updated_at: new Date().toISOString(),
  }, { onConflict: "endpoint" });

  if (error) return res.status(400).json({ error: error.message });
  return res.json({ ok: true });
});

// DELETE /api/push-subscriptions
// Removes the subscription for a given endpoint (called on unsubscribe).
router.delete("/", async (req, res) => {
  const user = await getUserFromToken(req.headers.authorization ?? "");
  if (!user) return res.status(401).json({ error: "Unauthorized" });

  const { endpoint } = req.body ?? {};
  if (!endpoint) return res.status(400).json({ error: "endpoint is required" });

  const db = getServiceRoleClient();
  if (!db) return res.status(503).json({ error: "Service role not configured" });

  await db.from("push_subscriptions").delete()
    .eq("user_id", user.id).eq("endpoint", endpoint);

  return res.json({ ok: true });
});

export default router;
