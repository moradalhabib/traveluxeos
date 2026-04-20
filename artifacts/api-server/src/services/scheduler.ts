import { supabase, auditLog } from "../lib/supabase";
import { sendEmail } from "./email";
import { emailDailyBackup } from "./backup";
import { notifyByRoles, notifyUser, STAFF_ROLES } from "./notify";

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
    .in("status", ["Confirmed", "Pending"])
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
        .in("status", ["Confirmed", "Pending"]);
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

// ─── No-driver alerts (3-hour & 24-hour windows) ────────────────────────────
// Repeats every 30 min for the 3h alert (dedupe via 30-min bucket key),
// and once per day for the 24h alert (dedupe per booking per day).
async function checkNoDriverAlerts() {
  const now = Date.now();
  const in3h = new Date(now + 3 * 60 * 60 * 1000).toISOString();
  const in24h = new Date(now + 24 * 60 * 60 * 1000).toISOString();
  const nowIso = new Date(now).toISOString();

  // ── 3-hour urgent alerts ─────────────────────────────────────────────
  const { data: urgent } = await supabase
    .from("bookings")
    .select("id, tvl_ref, client_name, date_time, status")
    .is("driver_id", null)
    .in("status", ["Confirmed", "Pending"])
    .gte("date_time", nowIso)
    .lte("date_time", in3h)
    .limit(50);

  if (urgent && urgent.length > 0) {
    // 30-min dedupe bucket: alert renews every half-hour as spec says
    const bucket = new Date();
    bucket.setMinutes(bucket.getMinutes() < 30 ? 0 : 30, 0, 0);
    const bucketKey = bucket.toISOString().slice(0, 16); // YYYY-MM-DDTHH:MM

    for (const b of urgent) {
      const start = b.date_time ? new Date(b.date_time).getTime() : now;
      const minsLeft = Math.max(0, Math.round((start - now) / 60000));
      const hoursLeft = (minsLeft / 60).toFixed(1);
      notifyByRoles(STAFF_ROLES, {
        type: "no_driver_3h",
        title: "⚠️ URGENT — No Driver",
        message: `${b.tvl_ref ?? ""} has no driver assigned — job in ${hoursLeft}h`,
        link: `/bookings/${b.id}`,
        entityType: "booking",
        entityId: b.id,
        severity: "urgent",
        dedupeKey: `no_driver_3h:${b.id}:${bucketKey}`,
      }).catch(() => {});
    }
  }

  // ── 24-hour warning alerts (only outside the 3h window) ──────────────
  const { data: tomorrow } = await supabase
    .from("bookings")
    .select("id, tvl_ref, client_name, date_time, status")
    .is("driver_id", null)
    .in("status", ["Confirmed", "Pending"])
    .gt("date_time", in3h)
    .lte("date_time", in24h)
    .limit(50);

  if (tomorrow && tomorrow.length > 0) {
    const today = new Date().toISOString().slice(0, 10);
    for (const b of tomorrow) {
      const t = b.date_time
        ? new Date(b.date_time).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" })
        : "soon";
      notifyByRoles(STAFF_ROLES, {
        type: "no_driver_24h",
        title: "⚠️ No Driver — Tomorrow",
        message: `${b.tvl_ref ?? ""} has no driver assigned — ${t}`,
        link: `/bookings/${b.id}`,
        entityType: "booking",
        entityId: b.id,
        severity: "warning",
        dedupeKey: `no_driver_24h:${b.id}:${today}`,
      }).catch(() => {});
    }
  }
}

// ─── Follow-up due alerts ──────────────────────────────────────────────────
async function checkFollowUpsDue() {
  const today = new Date().toISOString().slice(0, 10);

  // 1. Existing follow_ups table
  const { data: due } = await supabase
    .from("follow_ups")
    .select("id, client_id, operator_id, due_date, status, clients(name)")
    .lte("due_date", today)
    .eq("status", "pending")
    .limit(100);

  if (due && due.length > 0) {
    for (const f of due as any[]) {
      const clientName = f.clients?.name ?? "client";
      const targetUser = f.operator_id;
      if (!targetUser) continue;
      notifyUser(targetUser, {
        type: "follow_up_due",
        title: "📞 Follow-up Due",
        message: `Follow-up due: ${clientName}`,
        link: `/follow-ups`,
        entityType: "follow_up",
        entityId: f.id,
        severity: "info",
        dedupeKey: `follow_up_due:${f.id}:${today}`,
      }).catch(() => {});
    }
  }

  // 2. NEW: requests table (Slice 2) — notify all staff for any request
  // whose follow_up_date is today or earlier and that's still actionable.
  const { data: dueRequests } = await supabase
    .from("requests")
    .select("id, client_id, client_name, follow_up_date, status, priority, clients(name)")
    .lte("follow_up_date", today)
    .in("status", ["New", "Following Up"])
    .limit(200);

  if (!dueRequests || dueRequests.length === 0) return;

  for (const r of dueRequests as any[]) {
    const clientName = r.clients?.name ?? r.client_name ?? "client";
    const isUrgent = r.priority === "Urgent" || r.priority === "High";
    notifyByRoles(STAFF_ROLES, {
      type: "follow_up_due",
      title: isUrgent ? "🔥 Urgent Request Follow-up" : "📋 Request Follow-up Due",
      message: `${clientName} — ${r.priority} priority`,
      link: `/requests/${r.id}`,
      entityType: "request",
      entityId: r.id,
      severity: isUrgent ? "warning" : "info",
      dedupeKey: `follow_up_due:request:${r.id}:${today}`,
    }).catch(() => {});
  }
}

let started = false;
let timer: ReturnType<typeof setInterval> | null = null;
let lastDigestDate = "";
let lastBackupDate = "";
let lastFollowUpDate = "";
let lastNoDriverTickMs = 0;

async function maybeRunDigest() {
  const now = new Date();
  // Fire any time during the 08:00 hour, deduped per calendar date so it only
  // runs once. The hour-window (vs. an exact minute) protects us against tick
  // jitter if a previous tick ran long.
  if (now.getHours() !== 8) return;
  const today = now.toISOString().slice(0, 10);
  if (lastDigestDate === today) return;
  lastDigestDate = today;
  await sendDailyDigest();
}

async function maybeRunFollowUpScan() {
  const now = new Date();
  // Run any time during the 08:00 hour, deduped per calendar date.
  if (now.getHours() !== 8) return;
  const today = now.toISOString().slice(0, 10);
  if (lastFollowUpDate === today) return;
  lastFollowUpDate = today;
  await checkFollowUpsDue().catch(e => console.error("[Scheduler] follow-up scan:", e?.message));
}

async function maybeRunNoDriverScan() {
  // Throttle to every 5 minutes to keep load light. Dedupe in createNotification
  // means real alert frequency is governed by the dedupe bucket.
  const now = Date.now();
  if (now - lastNoDriverTickMs < 5 * 60 * 1000) return;
  lastNoDriverTickMs = now;
  await checkNoDriverAlerts().catch(e => console.error("[Scheduler] no-driver scan:", e?.message));
}

async function maybeRunBackup() {
  const now = new Date();
  // Fire any time during the 03:00 hour, deduped per calendar date.
  if (now.getHours() !== 3) return;
  const today = now.toISOString().slice(0, 10);
  if (lastBackupDate === today) return;
  lastBackupDate = today;
  try {
    const r = await emailDailyBackup();
    console.info(`[Scheduler] Daily backup: sent=${r.sent} bytes=${r.bytes}`);
  } catch (e: any) {
    console.error("[Scheduler] backup error:", e?.message);
  }
}

export function startScheduler() {
  if (started) return;
  started = true;

  const tick = async () => {
    try {
      await autoActivateJobs();
      await sendReminders();
      await maybeRunNoDriverScan();
      await maybeRunFollowUpScan();
      await maybeRunDigest();
      await maybeRunBackup();
    } catch (e: any) {
      console.error("[Scheduler] tick error:", e?.message);
    }
  };

  // Run shortly after boot, then every minute
  setTimeout(tick, 5000);
  timer = setInterval(tick, TICK_MS);
  console.info("[Scheduler] auto-activate + reminders + no-driver alerts + follow-up scan + 08:00 digest + 03:00 backup loop started (60s interval)");
}

export function stopScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
  started = false;
}
