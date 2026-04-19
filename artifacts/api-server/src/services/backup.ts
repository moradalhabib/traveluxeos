import { supabase, auditLog, getServiceRoleClient } from "../lib/supabase";
import { sendEmail } from "./email";

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
  return Array.from(new Set(emails));
}

export async function emailDailyBackup(): Promise<{ sent: boolean; bytes: number; rowCounts: Record<string, number> }> {
  const recipients = await getBackupRecipients();
  const backup = await generateBackup();

  if (recipients.length === 0) {
    console.warn("[Backup] No super_admin / admin recipients to email backup to");
    return { sent: false, bytes: backup.bytes, rowCounts: backup.rowCounts };
  }

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

  await auditLog(
    "daily_backup_sent",
    "system",
    "00000000-0000-0000-0000-000000000000",
    null,
    `Daily backup ${result.sent ? "emailed" : "FAILED"} (${(backup.bytes / 1024).toFixed(1)} KB) to ${recipients.length} recipient(s)`
  ).catch(() => {});

  return { sent: result.sent, bytes: backup.bytes, rowCounts: backup.rowCounts };
}
