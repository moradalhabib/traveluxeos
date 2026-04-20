import { supabase, auditLog, getServiceRoleClient } from "../lib/supabase";
import { sendEmail } from "./email";
import { objectStorageClient } from "../lib/objectStorage";

const BUCKET_ID = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID ?? "";
const PRIVATE_DIR = process.env.PRIVATE_OBJECT_DIR ?? "";

function backupCloudPrefix(): string | null {
  if (!BUCKET_ID || !PRIVATE_DIR) return null;
  // PRIVATE_OBJECT_DIR is in the form "/<bucket>/<.private>" — extract the
  // path inside the bucket then append our backups subdirectory.
  const parts = PRIVATE_DIR.split("/").filter(Boolean);
  // Drop the leading bucket-id segment (matches BUCKET_ID); keep the rest.
  const inner = parts[0] === BUCKET_ID ? parts.slice(1).join("/") : parts.join("/");
  return `${inner}/backups`.replace(/\/+$/, "");
}

export interface CloudBackupEntry {
  name: string;
  bytes: number;
  uploadedAt: string;
}

export async function uploadBackupToCloud(
  filename: string,
  json: string,
): Promise<{ uploaded: boolean; path?: string; reason?: string }> {
  const prefix = backupCloudPrefix();
  if (!prefix || !BUCKET_ID) {
    return { uploaded: false, reason: "Object storage not configured" };
  }
  try {
    const objectName = `${prefix}/${filename}`;
    const file = objectStorageClient.bucket(BUCKET_ID).file(objectName);
    await file.save(json, {
      contentType: "application/json",
      resumable: false,
      metadata: {
        cacheControl: "private, max-age=0",
        metadata: { product: "Traveluxe OS", kind: "daily-backup" },
      },
    });
    return { uploaded: true, path: objectName };
  } catch (e: any) {
    return { uploaded: false, reason: e?.message ?? "unknown" };
  }
}

export async function listCloudBackups(limit = 30): Promise<CloudBackupEntry[]> {
  const prefix = backupCloudPrefix();
  if (!prefix || !BUCKET_ID) return [];
  try {
    const [files] = await objectStorageClient
      .bucket(BUCKET_ID)
      .getFiles({ prefix: `${prefix}/` });
    const entries: CloudBackupEntry[] = files
      .map((f) => ({
        name: f.name.split("/").pop() ?? f.name,
        bytes: Number(f.metadata?.size ?? 0),
        uploadedAt:
          (f.metadata?.updated as string | undefined) ??
          (f.metadata?.timeCreated as string | undefined) ??
          new Date(0).toISOString(),
      }))
      .sort((a, b) => (a.uploadedAt < b.uploadedAt ? 1 : -1));
    return entries.slice(0, limit);
  } catch {
    return [];
  }
}

const BACKUP_TABLES = [
  "users",
  "clients",
  "drivers",
  "bookings",
  "booking_products",
  "quotes",
  "invoices",
  "commissions",
  "products",
  "service_types",
  "audit_log",
  "driver_ratings",
  "tasks",
  "messages",
];

export interface BackupResult {
  filename: string;
  json: string;
  bytes: number;
  generatedAt: string;
  rowCounts: Record<string, number>;
}

export async function generateBackup(): Promise<BackupResult> {
  const generatedAt = new Date().toISOString();
  // Prefer the service-role client so the backup includes EVERY row regardless
  // of the caller's RLS visibility (essential for the 03:00 scheduler tick,
  // which has no auth context). Falls back to the request-scoped client if the
  // service-role key isn't configured — in that case the snapshot is limited
  // to what the caller can read.
  const client = getServiceRoleClient() ?? supabase;
  const usedServiceRole = client !== supabase;
  const data: Record<string, any> = {
    _meta: {
      product: "Traveluxe OS",
      generatedAt,
      version: 1,
      auth: usedServiceRole ? "service_role" : "rls_scoped",
      note: "Full database snapshot. Restore by re-inserting into matching tables (skipping computed columns such as bookings.driver_receives).",
    },
  };
  const rowCounts: Record<string, number> = {};

  for (const table of BACKUP_TABLES) {
    try {
      const { data: rows, error } = await client.from(table).select("*").limit(50000);
      if (error) {
        rowCounts[table] = -1;
        data[table] = { _error: error.message };
        continue;
      }
      data[table] = rows ?? [];
      rowCounts[table] = rows?.length ?? 0;
    } catch (e: any) {
      rowCounts[table] = -1;
      data[table] = { _error: e?.message ?? "unknown" };
    }
  }

  const json = JSON.stringify(data, null, 2);
  const bytes = Buffer.byteLength(json, "utf8");
  const stamp = generatedAt.replace(/[:.]/g, "-").slice(0, 19);
  const filename = `traveluxe-backup-${stamp}.json`;

  return { filename, json, bytes, generatedAt, rowCounts };
}

function backupEmailHtml(b: BackupResult): string {
  const rows = Object.entries(b.rowCounts)
    .map(([t, c]) => `<tr><td style="padding:4px 12px;border-bottom:1px solid #eee">${t}</td><td style="padding:4px 12px;border-bottom:1px solid #eee;text-align:right"><b>${c >= 0 ? c.toLocaleString() : "—"}</b></td></tr>`)
    .join("");
  return `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:24px;color:#111">
      <h2 style="margin:0 0 12px">Traveluxe — Daily Backup</h2>
      <p style="margin:0 0 8px;color:#666">Generated ${new Date(b.generatedAt).toLocaleString("en-GB")}</p>
      <p>The full database snapshot is attached as <b>${b.filename}</b> (${(b.bytes / 1024).toFixed(1)} KB).</p>
      <table style="width:100%;border-collapse:collapse;margin-top:16px;font-size:13px">
        <thead><tr style="background:#f6f6f6">
          <th style="text-align:left;padding:6px 12px">Table</th>
          <th style="text-align:right;padding:6px 12px">Rows</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p style="margin-top:20px;font-size:12px;color:#888">
        Keep this file safe — it lets you restore the system if the database is ever lost.<br>
        Traveluxe OS · automated 03:00 backup
      </p>
    </div>
  `;
}

async function getBackupRecipients(): Promise<string[]> {
  const { data } = await supabase
    .from("users")
    .select("email, role, active")
    .in("role", ["super_admin", "admin"])
    .eq("active", true);
  const emails = (data ?? []).map((u: any) => u.email).filter(Boolean);
  // Always include the monitored hosted-domain mailbox. Our SMTP relay
  // (cPanel) is configured to accept mail to traveluxelondon.com addresses
  // but may reject relay to external domains like gmail.com — including
  // info@ guarantees at least one delivered copy.
  const fallback = process.env.SMTP_REPLY_TO ?? "info@traveluxelondon.com";
  emails.push(fallback);
  return Array.from(new Set(emails));
}

export async function emailDailyBackup(): Promise<{
  sent: boolean;
  bytes: number;
  rowCounts: Record<string, number>;
  cloudUploaded?: boolean;
  cloudReason?: string;
  emailReason?: string;
}> {
  const recipients = await getBackupRecipients();
  const backup = await generateBackup();

  // Always attempt the cloud upload first — this is the durable copy and
  // does NOT depend on SMTP being healthy. Email is the convenience copy.
  const cloud = await uploadBackupToCloud(backup.filename, backup.json);

  let emailSent = false;
  let emailReason: string | undefined;
  if (recipients.length === 0) {
    emailReason = "no super_admin/admin recipients";
    console.warn("[Backup] No super_admin / admin recipients to email backup to");
  } else {
    const result = await sendEmail({
      to: recipients.join(", "),
      subject: `Traveluxe Daily Backup — ${backup.generatedAt.slice(0, 10)}`,
      html: backupEmailHtml(backup),
      attachments: [{
        filename: backup.filename,
        content: backup.json,
        contentType: "application/json",
      }],
    });
    emailSent = result.sent;
    emailReason = result.reason;
  }

  const status = cloud.uploaded
    ? (emailSent ? "OK (cloud + email)" : `cloud OK / email FAILED: ${emailReason ?? "unknown"}`)
    : (emailSent ? `email OK / cloud FAILED: ${cloud.reason ?? "unknown"}` : `FAILED (cloud: ${cloud.reason}; email: ${emailReason})`);

  await auditLog(
    "daily_backup_sent",
    "system",
    "00000000-0000-0000-0000-000000000000",
    null,
    `Daily backup ${status} (${(backup.bytes / 1024).toFixed(1)} KB${recipients.length ? `, ${recipients.length} recipient(s)` : ""})`
  ).catch(() => {});

  return {
    sent: emailSent,
    bytes: backup.bytes,
    rowCounts: backup.rowCounts,
    cloudUploaded: cloud.uploaded,
    cloudReason: cloud.reason,
    emailReason,
  };
}
