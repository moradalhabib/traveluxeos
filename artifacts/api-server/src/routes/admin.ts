import { Router } from "express";
import { getUserFromToken, auditLog, supabase, getServiceRoleClient } from "../lib/supabase";
import {
  generateBackup,
  emailDailyBackup,
  uploadBackupToCloud,
  listCloudBackups,
} from "../services/backup";

const router = Router();

async function requireAdmin(authHeader: string | undefined) {
  const user = await getUserFromToken(authHeader);
  if (!user) return { ok: false as const, status: 401, msg: "Unauthorized" };
  if (!["super_admin", "admin"].includes(user.role)) {
    return { ok: false as const, status: 403, msg: "Admin access required" };
  }
  return { ok: true as const, user };
}

// Download a fresh backup as a JSON file. Also pushes a copy to cloud
// storage so even ad-hoc downloads contribute to the rolling archive.
router.get("/export", async (req, res) => {
  const auth = await requireAdmin(req.headers.authorization);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.msg });

  const backup = await generateBackup();
  const cloud = await uploadBackupToCloud(backup.filename, backup.json);
  await auditLog(
    "manual_backup_download",
    "system",
    "00000000-0000-0000-0000-000000000000",
    auth.user.id ?? null,
    `Manual backup downloaded (${(backup.bytes / 1024).toFixed(1)} KB) by ${auth.user.email}${cloud.uploaded ? " — cloud copy saved" : ` — cloud upload FAILED: ${cloud.reason}`}`
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

// Backup health: returns the most recent successful cloud backup,
// most recent attempt audit entry, and a small history list. Used by
// the admin panel to surface the "Last backup" indicator.
router.get("/backup/status", async (req, res) => {
  const auth = await requireAdmin(req.headers.authorization);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.msg });

  // audit_log may be RLS-protected — use the service-role client so the
  // status indicator can always read the recent backup attempts.
  const dbClient = getServiceRoleClient() ?? supabase;
  const [cloud, audit] = await Promise.all([
    listCloudBackups(20),
    dbClient
      .from("audit_log")
      .select("action, created_at, detail")
      .in("action", ["daily_backup_sent", "manual_backup_download"])
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  const auditRows = audit.data ?? [];
  const lastAttempt = auditRows[0] ?? null;
  const lastCloud = cloud[0] ?? null;
  const lastEmailOk =
    auditRows.find(
      (r: any) =>
        r.action === "daily_backup_sent" &&
        typeof r.detail === "string" &&
        /OK \(cloud \+ email\)|email OK/.test(r.detail),
    ) ?? null;

  return res.json({
    cloudConfigured: !!process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID,
    lastCloudBackup: lastCloud,
    lastEmailedBackup: lastEmailOk
      ? { at: (lastEmailOk as any).created_at, detail: (lastEmailOk as any).detail }
      : null,
    lastAttempt: lastAttempt
      ? {
          at: (lastAttempt as any).created_at,
          action: (lastAttempt as any).action,
          detail: (lastAttempt as any).detail,
        }
      : null,
    cloudHistory: cloud,
    auditHistory: auditRows.map((r: any) => ({
      at: r.created_at,
      action: r.action,
      detail: r.detail,
    })),
  });
});

export default router;
