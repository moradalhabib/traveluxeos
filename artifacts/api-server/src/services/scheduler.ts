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

// ─── Daily 8 AM digest ───────────────────────────────────────────────────────
function digestHtml(today: any[], unassigned: any[], overdue: any[]) {
  const row = (b: any) => `
    <tr>
      <td style="padding:6px 8px;border-bottom:1px solid #eee"><b>${b.tvl_ref ?? "—"}</b></td>
      <td style="padding:6px 8px;border-bottom:1px solid #eee">${b.client_name ?? "—"}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #eee">${b.service_type ?? "—"}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #eee">${b.date_time ? new Date(b.date_time).toLocaleString("en-GB") : "—"}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #eee">${b.driver_name ?? "<i style='color:#b45309'>Unassigned</i>"}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #eee">${b.status ?? "—"}</td>
    </tr>`;
  const section = (title: string, rows: any[], emptyMsg: string) => `
    <h3 style="margin:24px 0 8px;color:#111">${title} <span style="color:#888;font-weight:normal">(${rows.length})</span></h3>
    ${rows.length === 0
      ? `<p style="color:#888;margin:0">${emptyMsg}</p>`
      : `<table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead><tr style="background:#f6f6f6">
            <th style="text-align:left;padding:6px 8px">Ref</th>
            <th style="text-align:left;padding:6px 8px">Client</th>
            <th style="text-align:left;padding:6px 8px">Service</th>
            <th style="text-align:left;padding:6px 8px">When</th>
            <th style="text-align:left;padding:6px 8px">Driver</th>
            <th style="text-align:left;padding:6px 8px">Status</th>
          </tr></thead>
          <tbody>${rows.map(row).join("")}</tbody>
        </table>`}`;

  return `
    <div style="font-family:Arial,sans-serif;max-width:780px;margin:auto;padding:24px;color:#111">
      <h2 style="margin:0 0 4px">Traveluxe — Daily Digest</h2>
      <p style="margin:0;color:#666">${new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</p>
      ${section("Today's Jobs", today, "No bookings scheduled for today.")}
      ${section("Needs a Driver", unassigned, "All confirmed bookings have a driver.")}
      ${section("Overdue Invoices", overdue, "No outstanding invoices over 7 days.")}
      <p style="margin-top:28px;font-size:12px;color:#888">Traveluxe OS · automated 08:00 digest</p>
    </div>
  `;
}

async function sendDailyDigest() {
  const recipients = await getNotifyRecipients();
  if (recipients.length === 0) return;

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);

  const { data: today } = await supabase
    .from("bookings")
    .select("id, tvl_ref, client_name, service_type, status, date_time, drivers(name)")
    .gte("date_time", startOfDay.toISOString())
    .lte("date_time", endOfDay.toISOString())
    .neq("status", "Cancelled")
    .order("date_time", { ascending: true });

  const { data: unassigned } = await supabase
    .from("bookings")
    .select("id, tvl_ref, client_name, service_type, status, date_time, drivers(name)")
    .eq("status", "Confirmed")
    .is("driver_id", null)
    .gte("date_time", new Date().toISOString())
    .order("date_time", { ascending: true })
    .limit(20);

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: overdueInv } = await supabase
    .from("invoices")
    .select("id, invoice_number, client_name, total_amount, created_at, bookings(tvl_ref, service_type, date_time, drivers(name))")
    .in("status", ["Generated", "Sent", "Overdue"])
    .lte("created_at", sevenDaysAgo)
    .order("created_at", { ascending: true })
    .limit(20);

  const todayRows = (today ?? []).map((b: any) => ({ ...b, driver_name: b.drivers?.name ?? null }));
  const unassignedRows = (unassigned ?? []).map((b: any) => ({ ...b, driver_name: null }));
  const overdueRows = (overdueInv ?? []).map((i: any) => ({
    tvl_ref: i.invoice_number ?? i.bookings?.tvl_ref ?? "—",
    client_name: i.client_name ?? "—",
    service_type: `Invoice £${Number(i.total_amount ?? 0).toLocaleString()}`,
    date_time: i.created_at,
    driver_name: i.bookings?.drivers?.name ?? null,
    status: "Outstanding",
  }));

  await sendEmail({
    to: recipients.join(", "),
    subject: `Traveluxe Daily Digest — ${todayRows.length} job(s) today, ${unassignedRows.length} unassigned`,
    html: digestHtml(todayRows, unassignedRows, overdueRows),
  }).catch(() => {});

  await auditLog("daily_digest_sent", "system", "00000000-0000-0000-0000-000000000000", null,
    `Daily digest sent: ${todayRows.length} today, ${unassignedRows.length} unassigned, ${overdueRows.length} overdue`).catch(() => {});
}

// ─── Driver-side email (called from routes/bookings.ts on assignment) ────────
function driverAssignedHtml(b: any) {
  const when = b.date_time ? new Date(b.date_time).toLocaleString("en-GB") : "—";
  return `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:24px;color:#111">
      <h2 style="margin:0 0 12px">New Job Assigned — ${b.tvl_ref ?? ""}</h2>
      <p>You have been assigned the following booking. Please confirm receipt and arrive 10 minutes early.</p>
      <table style="width:100%;border-collapse:collapse;margin-top:12px">
        <tr><td style="padding:6px 0;color:#666">Reference</td><td><b>${b.tvl_ref ?? "—"}</b></td></tr>
        <tr><td style="padding:6px 0;color:#666">Client</td><td>${b.client_name ?? "—"}</td></tr>
        <tr><td style="padding:6px 0;color:#666">Service</td><td>${b.service_type ?? "—"}</td></tr>
        <tr><td style="padding:6px 0;color:#666">Date / Time</td><td><b>${when}</b></td></tr>
        ${b.pickup    ? `<tr><td style="padding:6px 0;color:#666">Pickup</td><td>${b.pickup}</td></tr>` : ""}
        ${b.dropoff   ? `<tr><td style="padding:6px 0;color:#666">Drop-off</td><td>${b.dropoff}</td></tr>` : ""}
        ${b.flight_number ? `<tr><td style="padding:6px 0;color:#666">Flight</td><td>${b.flight_number}</td></tr>` : ""}
        ${b.passengers ? `<tr><td style="padding:6px 0;color:#666">Pax</td><td>${b.passengers}${b.luggage ? ` · ${b.luggage} bags` : ""}</td></tr>` : ""}
        ${b.nameboard ? `<tr><td style="padding:6px 0;color:#666">Name Board</td><td>${b.nameboard}</td></tr>` : ""}
        ${b.notes     ? `<tr><td style="padding:6px 0;color:#666">Notes</td><td style="white-space:pre-wrap">${b.notes}</td></tr>` : ""}
      </table>
      <p style="margin-top:20px;font-size:12px;color:#888">Traveluxe London · please reply to confirm</p>
    </div>
  `;
}

export async function notifyDriverAssigned(bookingId: string) {
  try {
    const { data: b } = await supabase
      .from("bookings")
      .select("id, tvl_ref, client_name, service_type, date_time, pickup, dropoff, flight_number, passengers, luggage, nameboard, notes, drivers(name, email)")
      .eq("id", bookingId)
      .single();
    const email = (b as any)?.drivers?.email;
    if (!b || !email) return;
    await sendEmail({
      to: email,
      subject: `New Job — ${b.tvl_ref ?? ""} — ${b.client_name ?? ""}`,
      html: driverAssignedHtml(b),
    });
    await auditLog("driver_email_sent", "booking", bookingId, null,
      `Job assignment email sent to driver (${email})`);
  } catch (e: any) {
    console.error("[notifyDriverAssigned] error:", e?.message);
  }
}

let started = false;
let timer: ReturnType<typeof setInterval> | null = null;
let lastDigestDate = "";

async function maybeRunDigest() {
  const now = new Date();
  // Run once between 08:00 and 08:01 UK time, deduped per calendar date
  if (now.getHours() !== 8 || now.getMinutes() !== 0) return;
  const today = now.toISOString().slice(0, 10);
  if (lastDigestDate === today) return;
  lastDigestDate = today;
  await sendDailyDigest();
}

export function startScheduler() {
  if (started) return;
  started = true;

  const tick = async () => {
    try {
      await autoActivateJobs();
      await sendReminders();
      await maybeRunDigest();
    } catch (e: any) {
      console.error("[Scheduler] tick error:", e?.message);
    }
  };

  // Run shortly after boot, then every minute
  setTimeout(tick, 5000);
  timer = setInterval(tick, TICK_MS);
  console.info("[Scheduler] auto-activate + 2h reminder + 08:00 daily digest loop started (60s interval)");
}

export function stopScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
  started = false;
}
