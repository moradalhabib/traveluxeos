import { supabase, auditLog } from "../lib/supabase";
import { sendEmail } from "./email";

const TICK_MS = 60 * 1000;

async function getNotifyRecipients(): Promise<string[]> {
  const { data } = await supabase
    .from("users")
    .select("email, role, active")
    .in("role", ["operator", "super_admin", "admin"])
    .eq("active", true);
  const emails = (data ?? []).map((u: any) => u.email).filter(Boolean);
  return Array.from(new Set(emails));
}

function bookingStartedHtml(b: any) {
  const when = b.date_time ? new Date(b.date_time).toLocaleString("en-GB") : "—";
  return `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:24px;color:#111">
      <h2 style="margin:0 0 12px">Job Started — ${b.tvl_ref ?? ""}</h2>
      <p style="margin:0 0 8px">A booking has just begun and has been auto-set to <b>Active</b>.</p>
      <table style="width:100%;border-collapse:collapse;margin-top:12px">
        <tr><td style="padding:6px 0;color:#666">Reference</td><td><b>${b.tvl_ref ?? "—"}</b></td></tr>
        <tr><td style="padding:6px 0;color:#666">Client</td><td>${b.client_name ?? "—"}</td></tr>
        <tr><td style="padding:6px 0;color:#666">Service</td><td>${b.service_type ?? "—"}</td></tr>
        <tr><td style="padding:6px 0;color:#666">Start</td><td>${when}</td></tr>
        <tr><td style="padding:6px 0;color:#666">Driver</td><td>${b.driver_name ?? "Unassigned"}</td></tr>
      </table>
      <p style="margin-top:20px;font-size:12px;color:#888">Traveluxe OS · automated alert</p>
    </div>
  `;
}

function reminderHtml(b: any) {
  const when = b.date_time ? new Date(b.date_time).toLocaleString("en-GB") : "—";
  return `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:24px;color:#111">
      <h2 style="margin:0 0 12px;color:#b45309">Action Required — ${b.tvl_ref ?? ""}</h2>
      <p style="margin:0 0 8px">This booking started over 2 hours ago and is still marked Active. Please update its status to <b>Completed</b> and confirm payment.</p>
      <table style="width:100%;border-collapse:collapse;margin-top:12px">
        <tr><td style="padding:6px 0;color:#666">Reference</td><td><b>${b.tvl_ref ?? "—"}</b></td></tr>
        <tr><td style="padding:6px 0;color:#666">Client</td><td>${b.client_name ?? "—"}</td></tr>
        <tr><td style="padding:6px 0;color:#666">Started</td><td>${when}</td></tr>
        <tr><td style="padding:6px 0;color:#666">Payment</td><td>${b.payment_status ?? "Unpaid"}</td></tr>
      </table>
      <p style="margin-top:20px;font-size:12px;color:#888">Traveluxe OS · automated reminder</p>
    </div>
  `;
}

async function autoActivateJobs() {
  const now = new Date();
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

  const { data: due, error } = await supabase
    .from("bookings")
    .select("id, tvl_ref, client_name, service_type, status, date_time, driver_id, drivers(name)")
    .in("status", ["Confirmed", "Driver Assigned"])
    .gte("date_time", dayAgo)
    .lte("date_time", now.toISOString())
    .limit(50);

  if (error || !due || due.length === 0) return;

  const recipients = await getNotifyRecipients();

  for (const b of due) {
    try {
      const { error: upErr } = await supabase
        .from("bookings")
        .update({ status: "Active" })
        .eq("id", b.id)
        .in("status", ["Confirmed", "Driver Assigned"]);
      if (upErr) continue;

      await auditLog("auto_active", "booking", b.id, null,
        `Booking ${b.tvl_ref} auto-activated at start time`);

      if (recipients.length > 0) {
        const enriched = { ...b, driver_name: (b as any).drivers?.name ?? null };
        sendEmail({
          to: recipients.join(", "),
          subject: `Job Started — ${b.tvl_ref ?? ""} — ${b.client_name ?? ""}`,
          html: bookingStartedHtml(enriched),
        }).catch(() => {});
      }
    } catch (e: any) {
      console.error("[Scheduler] auto-activate error:", e?.message);
    }
  }
}

async function sendReminders() {
  const now = new Date();
  const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

  const { data: stale } = await supabase
    .from("bookings")
    .select("id, tvl_ref, client_name, status, date_time, payment_status")
    .eq("status", "Active")
    .lte("date_time", twoHoursAgo)
    .gte("date_time", dayAgo)
    .limit(50);

  if (!stale || stale.length === 0) return;

  // Find which already had a reminder sent
  const ids = stale.map(b => b.id);
  const { data: alreadySent } = await supabase
    .from("audit_log")
    .select("entity_id")
    .eq("entity_type", "booking")
    .eq("action", "reminder_sent")
    .in("entity_id", ids);
  const sentSet = new Set((alreadySent ?? []).map((r: any) => r.entity_id));

  const recipients = await getNotifyRecipients();
  if (recipients.length === 0) return;

  for (const b of stale) {
    if (sentSet.has(b.id)) continue;
    try {
      await sendEmail({
        to: recipients.join(", "),
        subject: `Action Required — ${b.tvl_ref ?? ""} still Active after 2h`,
        html: reminderHtml(b),
      });
      await auditLog("reminder_sent", "booking", b.id, null,
        `2h post-start reminder sent for ${b.tvl_ref}`);
    } catch (e: any) {
      console.error("[Scheduler] reminder error:", e?.message);
    }
  }
}

let started = false;
let timer: ReturnType<typeof setInterval> | null = null;

export function startScheduler() {
  if (started) return;
  started = true;

  const tick = async () => {
    try {
      await autoActivateJobs();
      await sendReminders();
    } catch (e: any) {
      console.error("[Scheduler] tick error:", e?.message);
    }
  };

  // Run shortly after boot, then every minute
  setTimeout(tick, 5000);
  timer = setInterval(tick, TICK_MS);
  console.info("[Scheduler] Booking auto-activate + 2h reminder loop started (60s interval)");
}

export function stopScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
  started = false;
}
