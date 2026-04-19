import { Router } from "express";
import { getUserFromToken, auditLog } from "../lib/supabase";
import { generateBackup, emailDailyBackup } from "../services/backup";

const router = Router();

async function requireAdmin(authHeader: string | undefined) {
  const user = await getUserFromToken(authHeader);
  if (!user) return { ok: false as const, status: 401, msg: "Unauthorized" };
  if (!["super_admin", "admin"].includes(user.role)) {
    return { ok: false as const, status: 403, msg: "Admin access required" };
  }
  return { ok: true as const, user };
}

// Download a fresh backup as a JSON file
router.get("/export", async (req, res) => {
  const auth = await requireAdmin(req.headers.authorization);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.msg });

  const backup = await generateBackup();
  await auditLog(
    "manual_backup_download",
    "system",
    "00000000-0000-0000-0000-000000000000",
    auth.user.id ?? null,
    `Manual backup downloaded (${(backup.bytes / 1024).toFixed(1)} KB) by ${auth.user.email}`
  ).catch(() => {});

  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", `attachment; filename="${backup.filename}"`);
  return res.send(backup.json);
});

// Trigger the same email backup that runs at 03:00, on demand
router.post("/export/email", async (req, res) => {
  const auth = await requireAdmin(req.headers.authorization);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.msg });

  const result = await emailDailyBackup();
  return res.json(result);
});

export default router;
