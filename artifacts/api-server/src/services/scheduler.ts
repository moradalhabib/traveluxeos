import { supabase, auditLog, getServiceRoleClient } from "../lib/supabase";
import { sendEmail } from "./email";
import { emailDailyBackup } from "./backup";
import { notifyByRoles, notifyUser, STAFF_ROLES } from "./notify";
import { sendWebPushToAll } from "./webpush";
import { pollUpcomingFlights } from "./flightTracker";

const TICK_MS = 60 * 1000;

// The scheduler runs outside any HTTP request — no JWT in AsyncLocalStorage,
// so `supabase` falls back to the anon client which RLS blocks.
// Use the service-role client for ALL scheduler DB operations.
function schedDb() {
  return getServiceRoleClient() ?? supabase;
}

async function getNotifyRecipients(): Promise<string[]> {
  const { data } = await schedDb()
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

  const svc = getServiceRoleClient();
  if (!svc) {
    console.warn("[Scheduler] autoActivateJobs: service-role client unavailable — skipping (check SUPABASE_SERVICE_ROLE_KEY)");
    return;
  }

  const { data: due, error } = await schedDb()
    .from("bookings")
    .select("id, tvl_ref, clients(name), service_type, status, date_time, driver_id, drivers(name)")
    .in("status", ["Confirmed", "Pending"])
    .gte("date_time", dayAgo)
    .lte("date_time", now.toISOString())
    .limit(50);

  if (error) {
    console.error("[Scheduler] autoActivateJobs query error:", error.message);
    return;
  }
  if (!due || due.length === 0) {
    console.info(`[Scheduler] autoActivateJobs: no past-due bookings (checked ${dayAgo.slice(0,16)} → now)`);
    return;
  }
  console.info(`[Scheduler] autoActivateJobs: ${due.length} booking(s) to activate`);

  const recipients = await getNotifyRecipients();

  for (const b of due) {
    try {
      const { error: upErr } = await schedDb()
        .from("bookings")
        .update({ status: "Active" })
        .eq("id", b.id)
        .in("status", ["Confirmed", "Pending"]);
      if (upErr) continue;

      await auditLog("auto_active", "booking", b.id, null,
        `Booking ${b.tvl_ref} auto-activated at start time`);

      const enriched = {
        ...b,
        driver_name: (b as any).drivers?.name ?? null,
        client_name: (b as any).clients?.name ?? null,
      };
      const when = b.date_time
        ? new Date(b.date_time).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" })
        : "—";

      sendWebPushToAll({
        title: `Job starting now — ${b.tvl_ref ?? ""}`,
        body:  `${enriched.client_name ?? "—"} · ${b.service_type ?? "—"} at ${when}${enriched.driver_name ? " · " + enriched.driver_name : ""}`,
        link:  `/bookings/${b.id}`,
        tag:   `active-${b.id}`,
        requireInteraction: true,
      }).catch(() => {});

      if (recipients.length > 0) {
        sendEmail({
          to: recipients.join(", "),
          subject: `Job Started — ${b.tvl_ref ?? ""} — ${enriched.client_name ?? ""}`,
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

  const { data: stale } = await schedDb()
    .from("bookings")
    .select("id, tvl_ref, clients(name), status, date_time, payment_status")
    .eq("status", "Active")
    .lte("date_time", twoHoursAgo)
    .gte("date_time", dayAgo)
    .limit(50);

  if (!stale || stale.length === 0) return;

  // Find which already had a reminder sent
  const ids = stale.map(b => b.id);
  const { data: alreadySent } = await schedDb()
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
    const bEnriched = { ...b, client_name: (b as any).clients?.name ?? "—" };
    try {
      await sendEmail({
        to: recipients.join(", "),
        subject: `Action Required — ${b.tvl_ref ?? ""} still Active after 2h`,
        html: reminderHtml(bEnriched),
      });
      await auditLog("reminder_sent", "booking", b.id, null,
        `2h post-start reminder sent for ${b.tvl_ref}`);
    } catch (e: any) {
      console.error("[Scheduler] reminder error:", e?.message);
    }
  }
}

// ─── 1-hour upcoming alert (push + in-app) ───────────────────────────────────
// Fires for Confirmed/Pending bookings starting in 50–70 minutes.
// Wide window (~20 min) so the 60 s tick never misses a booking.
// Deduplicated by an audit_log row so each booking only alerts once.

async function sendUpcomingAlerts() {
  const now  = new Date();
  const lo   = new Date(now.getTime() + 50 * 60 * 1000).toISOString();
  const hi   = new Date(now.getTime() + 70 * 60 * 1000).toISOString();

  const { data: upcoming } = await schedDb()
    .from("bookings")
    .select("id, tvl_ref, clients(name), service_type, date_time, driver_id, drivers(name)")
    .in("status", ["Confirmed", "Pending"])
    .gte("date_time", lo)
    .lte("date_time", hi)
    .limit(30);

  if (!upcoming || upcoming.length === 0) return;

  // Dedup: only alert once per booking
  const ids = upcoming.map(b => b.id);
  const { data: alreadySent } = await schedDb()
    .from("audit_log")
    .select("entity_id")
    .eq("action", "upcoming_push_sent")
    .in("entity_id", ids);
  const sentSet = new Set((alreadySent ?? []).map((r: any) => r.entity_id));

  const unsent = upcoming.filter(b => !sentSet.has(b.id));
  if (unsent.length === 0) return;

  for (const b of unsent) {
    const driverName = (b as any).drivers?.name ?? null;
    const when = b.date_time
      ? new Date(b.date_time).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" })
      : "—";
    const driverLabel = driverName ? ` · ${driverName}` : " · Driver TBC";
    const clientName = (b as any).clients?.name ?? "—";
    const title = `Starting in ~1 hour — ${b.tvl_ref ?? ""}`;
    const body  = `${clientName} · ${b.service_type ?? "—"} at ${when}${driverLabel}`;
    const link  = `/bookings/${b.id}`;

    await sendWebPushToAll({ title, body, link, tag: `upcoming-${b.id}`, requireInteraction: true }).catch(() => {});

    await notifyByRoles(STAFF_ROLES, {
      type: "booking_status",
      title,
      message: body,
      link,
      severity: "warning",
      dedupeKey: `upcoming-1h-${b.id}`,
    }).catch(() => {});

    await auditLog("upcoming_push_sent", "booking", b.id, null,
      `1h upcoming push sent for ${b.tvl_ref}`).catch(() => {});

    console.info(`[Scheduler] upcoming push: ${b.tvl_ref} at ${when}`);
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

  const { data: today } = await schedDb()
    .from("bookings")
    .select("id, tvl_ref, clients(name), service_type, status, date_time, drivers(name)")
    .gte("date_time", startOfDay.toISOString())
    .lte("date_time", endOfDay.toISOString())
    .neq("status", "Cancelled")
    .order("date_time", { ascending: true });

  const { data: unassigned } = await schedDb()
    .from("bookings")
    .select("id, tvl_ref, clients(name), service_type, status, date_time, drivers(name)")
    .eq("status", "Confirmed")
    .is("driver_id", null)
    .gte("date_time", new Date().toISOString())
    .order("date_time", { ascending: true })
    .limit(20);

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: overdueInv } = await schedDb()
    .from("invoices")
    .select("id, invoice_number, client_name, total_amount, created_at, bookings(tvl_ref, service_type, date_time, drivers(name))")
    .in("status", ["Generated", "Sent", "Overdue"])
    .lte("created_at", sevenDaysAgo)
    .order("created_at", { ascending: true })
    .limit(20);

  const todayRows = (today ?? []).map((b: any) => ({ ...b, driver_name: b.drivers?.name ?? null, client_name: b.clients?.name ?? null }));
  const unassignedRows = (unassigned ?? []).map((b: any) => ({ ...b, driver_name: null, client_name: b.clients?.name ?? null }));
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

// ─── 07:00 UK admin daily briefing ────────────────────────────────────────
// Configurable recipient (app_settings.admin_email), BST/GMT-aware, sent
// from the 'system' (info@) mailbox. Always sends — even when there are no
// jobs — so the admin knows the system is alive.

const APP_URL =
  process.env.APP_PUBLIC_URL ??
  process.env.PUBLIC_APP_URL ??
  "https://app.traveluxelondon.com";

async function getAdminBriefingRecipient(): Promise<string> {
  try {
    const { data } = await schedDb()
      .from("app_settings")
      .select("value")
      .eq("key", "admin_email")
      .maybeSingle();
    const v = (data as any)?.value;
    if (v && typeof v === "string" && v.includes("@")) return v;
  } catch {}
  return "info@traveluxelondon.com";
}

function moneyGBP(n: number): string {
  return `£${(Number(n) || 0).toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function briefingHtml(opts: {
  todayDateLabel: string;
  jobs: any[];
  unassigned: any[];
  overdueFollowUps: any[];
  commissionRows: Array<{ ref: string; client: string; amount: number }>;
  commissionTotal: number;
}) {
  const { todayDateLabel, jobs, unassigned, overdueFollowUps, commissionRows, commissionTotal } = opts;

  const goldBar  = "background:linear-gradient(90deg,#c9a961,#8a7340);height:4px";
  const panel    = "background:#141414;border:1px solid #2a2a2a;border-radius:8px;padding:16px";
  const muted    = "color:#9a9a9a;font-size:12px";
  const stat     = (label: string, value: string, accent = "#c9a961") => `
    <td style="${panel};text-align:center;width:25%">
      <div style="${muted};text-transform:uppercase;letter-spacing:1px">${label}</div>
      <div style="color:${accent};font-size:24px;font-weight:700;margin-top:6px">${value}</div>
    </td>`;

  const jobRow = (b: any) => `
    <tr>
      <td style="padding:8px;border-bottom:1px solid #222;color:#c9a961;font-weight:600">
        ${b.date_time ? new Date(b.date_time).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" }) : "—"}
      </td>
      <td style="padding:8px;border-bottom:1px solid #222;color:#f5f5f5">${b.client_name ?? "—"}</td>
      <td style="padding:8px;border-bottom:1px solid #222;color:#f5f5f5">${b.service_type ?? "—"}</td>
      <td style="padding:8px;border-bottom:1px solid #222;color:#f5f5f5">${b.vehicle_type ?? "—"}</td>
      <td style="padding:8px;border-bottom:1px solid #222;color:${b.driver_name ? "#f5f5f5" : "#e26666"}">
        ${b.driver_name ?? "<b>UNASSIGNED</b>"}
      </td>
    </tr>`;

  const unassignedAlert = unassigned.length > 0 ? `
    <div style="background:#3a0e0e;border:1px solid #e26666;border-radius:8px;padding:14px;margin-top:18px">
      <div style="color:#ffb4b4;font-weight:700;font-size:13px">⚠ ${unassigned.length} JOB${unassigned.length === 1 ? "" : "S"} TODAY WITHOUT A DRIVER</div>
      <div style="color:#f5cccc;font-size:12px;margin-top:4px">
        ${unassigned.map((u: any) => `${u.tvl_ref ?? ""} — ${u.client_name ?? ""}`).join("<br>")}
      </div>
    </div>` : "";

  const followUpsBlock = overdueFollowUps.length > 0 ? `
    <h3 style="color:#c9a961;margin:24px 0 8px">Overdue Follow-ups (${overdueFollowUps.length})</h3>
    <div style="${panel}">
      ${overdueFollowUps.map((f: any) => `
        <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #222;color:#f5f5f5">
          <span>${f.client_name ?? "—"}</span>
          <span style="color:#e26666;font-weight:600">${f.days_overdue}d overdue</span>
        </div>`).join("")}
    </div>` : `
    <h3 style="color:#c9a961;margin:24px 0 8px">Overdue Follow-ups</h3>
    <div style="${panel};color:#9a9a9a">All follow-ups are on schedule.</div>`;

  const commissionBlock = commissionRows.length > 0 ? `
    <h3 style="color:#c9a961;margin:24px 0 8px">Commission to Collect Today (${moneyGBP(commissionTotal)})</h3>
    <div style="${panel}">
      ${commissionRows.map(r => `
        <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #222;color:#f5f5f5">
          <span>${r.ref} · ${r.client}</span>
          <span style="color:#c9a961;font-weight:700">${moneyGBP(r.amount)}</span>
        </div>`).join("")}
    </div>` : "";

  const jobsBlock = jobs.length > 0 ? `
    <h3 style="color:#c9a961;margin:24px 0 8px">Today's Jobs (${jobs.length})</h3>
    <table style="width:100%;border-collapse:collapse;font-size:13px;${panel};padding:0">
      <thead><tr style="background:#1a1a1a;color:#9a9a9a;font-size:11px;text-transform:uppercase;letter-spacing:1px">
        <th style="padding:10px 8px;text-align:left">Time</th>
        <th style="padding:10px 8px;text-align:left">Client</th>
        <th style="padding:10px 8px;text-align:left">Service</th>
        <th style="padding:10px 8px;text-align:left">Vehicle</th>
        <th style="padding:10px 8px;text-align:left">Driver</th>
      </tr></thead>
      <tbody>${jobs.map(jobRow).join("")}</tbody>
    </table>` : `
    <h3 style="color:#c9a961;margin:24px 0 8px">Today's Jobs</h3>
    <div style="${panel};color:#9a9a9a;text-align:center;padding:28px">
      No jobs scheduled for today.
    </div>`;

  return `
  <div style="background:#0b0b0b;padding:0;margin:0">
    <div style="max-width:720px;margin:0 auto;background:#0b0b0b;font-family:Helvetica,Arial,sans-serif;color:#f5f5f5">
      <div style="${goldBar}"></div>
      <div style="padding:24px 28px 8px">
        <div style="color:#c9a961;font-size:22px;font-weight:700;letter-spacing:1px">TRAVELUXE <span style="color:#f5f5f5">LONDON</span></div>
        <div style="${muted};margin-top:4px">Daily Briefing · ${todayDateLabel}</div>
      </div>

      <div style="padding:8px 28px 0">
        <table style="width:100%;border-collapse:separate;border-spacing:8px">
          <tr>
            ${stat("Jobs Today", String(jobs.length))}
            ${stat("Unassigned", String(unassigned.length), unassigned.length > 0 ? "#e26666" : "#7ed957")}
            ${stat("Overdue F/U", String(overdueFollowUps.length), overdueFollowUps.length > 0 ? "#f4c542" : "#7ed957")}
            ${stat("Commission", moneyGBP(commissionTotal))}
          </tr>
        </table>
      </div>

      <div style="padding:0 28px 12px">
        ${unassignedAlert}
        ${jobsBlock}
        ${followUpsBlock}
        ${commissionBlock}
      </div>

      <div style="padding:24px 28px;text-align:center;border-top:1px solid #2a2a2a;margin-top:24px">
        <a href="${APP_URL}" style="display:inline-block;background:#c9a961;color:#0b0b0b;padding:10px 22px;border-radius:6px;text-decoration:none;font-weight:700;letter-spacing:0.5px">Open Traveluxe OS →</a>
        <div style="${muted};margin-top:14px">Sent automatically at 07:00 UK time. Adjust the recipient under Settings → Admin Email.</div>
      </div>
      <div style="${goldBar}"></div>
    </div>
  </div>`;
}

async function sendDailyBriefing() {
  const recipient = await getAdminBriefingRecipient();

  // ── Today window in UK time ───────────────────────────────────────────
  // Compute the start/end of "today in London" expressed as ISO strings.
  // We do this by formatting Date in the London timezone, then constructing
  // the boundaries in that local day.
  const tzFmt = new Intl.DateTimeFormat("en-CA", {
    year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Europe/London",
  });
  const ymd = tzFmt.format(new Date()); // YYYY-MM-DD
  // Build start/end as UTC ISO by treating "ymd 00:00 London" → UTC instant.
  // DST-safe: compute the offset AT midnight (not noon) and iterate once
  // to converge across BST/GMT transition days where the offset can change
  // mid-day. This handles spring-forward and fall-back boundaries correctly.
  const londonOffsetMinAt = (utc: Date): number => {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    }).formatToParts(utc);
    const get = (t: string) => parseInt(parts.find(p => p.type === t)?.value ?? "0", 10);
    const ld = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
    return Math.round((ld - utc.getTime()) / 60000);
  };
  // Converge on the UTC instant for London local midnight on a given YYYY-MM-DD.
  const londonStartOfDayUtc = (y: string): Date => {
    let utc = new Date(`${y}T00:00:00Z`);
    for (let i = 0; i < 2; i++) {
      const off = londonOffsetMinAt(utc);
      utc = new Date(new Date(`${y}T00:00:00Z`).getTime() - off * 60000);
    }
    return utc;
  };
  // Compute next day's midnight INDEPENDENTLY so DST-transition days that
  // are 23h or 25h long are handled correctly (not always exactly +24h).
  const nextYmd = tzFmt.format(new Date(Date.now() + 36 * 60 * 60 * 1000));
  const startUtc = londonStartOfDayUtc(ymd);
  const endUtc = new Date(londonStartOfDayUtc(nextYmd).getTime() - 1);

  const todayDateLabel = new Intl.DateTimeFormat("en-GB", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
    timeZone: "Europe/London",
  }).format(new Date());

  const { data: todayJobsRaw } = await schedDb()
    .from("bookings")
    .select("id, tvl_ref, clients(name), service_type, vehicle_type, status, date_time, price, payment_status, driver_id, drivers(name)")
    .gte("date_time", startUtc.toISOString())
    .lte("date_time", endUtc.toISOString())
    .neq("status", "Cancelled")
    .order("date_time", { ascending: true });

  const todayJobs = (todayJobsRaw ?? []).map((b: any) => ({
    ...b,
    driver_name: b.drivers?.name ?? null,
    client_name: b.clients?.name ?? null,
  }));

  const unassignedToday = todayJobs.filter(j => !j.driver_name);

  // ── Overdue follow-ups (due_date < today_uk, status pending) ─────────
  const { data: overdueRaw } = await schedDb()
    .from("follow_ups")
    .select("id, due_date, status, clients(name)")
    .lt("due_date", ymd)
    .eq("status", "pending")
    .limit(50);

  const overdueFollowUps = (overdueRaw ?? []).map((f: any) => {
    const due = new Date(f.due_date);
    const today = new Date(`${ymd}T00:00:00Z`);
    const days = Math.max(0, Math.round((today.getTime() - due.getTime()) / 86400000));
    return { client_name: f.clients?.name ?? "—", days_overdue: days };
  });

  // ── Commission to collect today (unpaid bookings due today) ──────────
  const commissionRows = todayJobs
    .filter((j: any) => j.payment_status !== "Paid")
    .map((j: any) => ({
      ref: j.tvl_ref ?? "—",
      client: j.client_name ?? "—",
      amount: Number(j.price ?? 0),
    }))
    .filter(r => r.amount > 0);
  const commissionTotal = commissionRows.reduce((s, r) => s + r.amount, 0);

  const html = briefingHtml({
    todayDateLabel,
    jobs: todayJobs,
    unassigned: unassignedToday,
    overdueFollowUps,
    commissionRows,
    commissionTotal,
  });

  const subject = `Traveluxe OS — Daily Briefing ${todayDateLabel}`;
  await sendEmail({ to: recipient, subject, html, account: "system" }).catch(() => {});

  await auditLog(
    "daily_briefing_sent", "system", "00000000-0000-0000-0000-000000000000", null,
    `Briefing → ${recipient}: ${todayJobs.length} jobs, ${unassignedToday.length} unassigned, ${overdueFollowUps.length} overdue, ${moneyGBP(commissionTotal)} to collect`,
  ).catch(() => {});
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
    const { data: b } = await schedDb()
      .from("bookings")
      .select("id, tvl_ref, clients(name), service_type, date_time, pickup, dropoff, flight_number, passengers, luggage, nameboard, notes, drivers(name, email)")
      .eq("id", bookingId)
      .single();
    const email = (b as any)?.drivers?.email;
    if (!b || !email) return;
    const bEnriched = { ...b, client_name: (b as any).clients?.name ?? null };
    await sendEmail({
      to: email,
      subject: `New Job — ${b.tvl_ref ?? ""} — ${bEnriched.client_name ?? ""}`,
      html: driverAssignedHtml(bEnriched),
    });
    await auditLog("driver_email_sent", "booking", bookingId, null,
      `Job assignment email sent to driver (${email})`);
  } catch (e: any) {
    console.error("[notifyDriverAssigned] error:", e?.message);
  }
}

// ─── Driver-declined admin alert ────────────────────────────────────────────
// One-shot urgent notification when a driver declines a booking. Reuses the
// existing in-app notification fan-out so admins see it instantly; the
// frontend WhatsApp banner picks this up via the urgent severity.
export async function notifyDriverDeclined(bookingId: string, driverName: string | null) {
  try {
    const { data: b } = await schedDb()
      .from("bookings")
      .select("id, tvl_ref, clients(name), date_time")
      .eq("id", bookingId)
      .single();
    if (!b) return;
    const when = b.date_time
      ? new Date(b.date_time).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
      : "";
    notifyByRoles(STAFF_ROLES, {
      type: "driver_declined",
      title: "❗ Driver Declined — Reassign",
      message: `Driver ${driverName ?? ""} declined ${b.tvl_ref ?? ""}${when ? " · " + when : ""}. Reassignment required.`,
      link: `/bookings/${bookingId}`,
      entityType: "booking",
      entityId: bookingId,
      severity: "urgent",
      dedupeKey: `driver_declined:${bookingId}:${Date.now()}`,
    }).catch(() => {});
    await auditLog("driver_declined", "booking", bookingId, null,
      `Driver ${driverName ?? ""} declined booking ${b.tvl_ref ?? ""}`).catch(() => {});
  } catch (e: any) {
    console.error("[notifyDriverDeclined] error:", e?.message);
  }
}

// ─── No-driver alerts — 3 fixed milestones only ──────────────────────────────
// Exactly 3 pushes per unassigned booking, no more:
//   • 12 h before departure  — "heads up, sort this today"
//   •  8 h before departure  — "getting urgent"
//   •  2 h before departure  — "URGENT, act now"
//
// Each milestone fires once and is gated by an audit_log row so the 60-second
// ticker cannot re-send even if the server restarts mid-window.
// Detection window for each milestone is ±15 minutes so the 60-second tick
// reliably catches it even if a tick is slightly delayed.
async function checkNoDriverAlerts() {
  const now = Date.now();
  const nowIso = new Date(now).toISOString();

  // Fetch ALL unassigned upcoming bookings in the next 13 h (covers all windows)
  const in13h = new Date(now + 13 * 60 * 60 * 1000).toISOString();
  const { data: unassigned } = await schedDb()
    .from("bookings")
    .select("id, tvl_ref, date_time, status")
    .is("driver_id", null)
    .in("status", ["Confirmed", "Pending"])
    .gte("date_time", nowIso)
    .lte("date_time", in13h)
    .limit(100);

  if (!unassigned || unassigned.length === 0) return;

  const ids = unassigned.map(b => b.id);

  // Fetch all no-driver audit rows for these bookings in the last 13 h
  const cutoff = new Date(now - 13 * 60 * 60 * 1000).toISOString();
  const { data: sentRows } = await schedDb()
    .from("audit_log")
    .select("entity_id, action")
    .in("action", ["no_driver_12h_push", "no_driver_8h_push", "no_driver_2h_push"])
    .in("entity_id", ids)
    .gte("created_at", cutoff);

  // Build a Set of "bookingId:action" already sent
  const sentSet = new Set((sentRows ?? []).map((r: any) => `${r.entity_id}:${r.action}`));

  const WINDOW_MS = 15 * 60 * 1000; // ±15 min detection window

  const milestones = [
    { hours: 12, action: "no_driver_12h_push", title: "No Driver — 12h Warning",    severity: "warning", requireInteraction: false },
    { hours:  8, action: "no_driver_8h_push",  title: "No Driver — 8h Warning",     severity: "warning", requireInteraction: false },
    { hours:  2, action: "no_driver_2h_push",  title: "URGENT — No Driver Assigned", severity: "urgent",  requireInteraction: true  },
  ] as const;

  for (const b of unassigned) {
    if (!b.date_time) continue;
    const start = new Date(b.date_time).getTime();
    const timeLabel = new Date(b.date_time).toLocaleString("en-GB", {
      weekday: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London",
    });

    for (const m of milestones) {
      const targetMs = start - m.hours * 60 * 60 * 1000;
      const inWindow = Math.abs(now - targetMs) <= WINDOW_MS;
      if (!inWindow) continue;

      const key = `${b.id}:${m.action}`;
      if (sentSet.has(key)) continue; // already fired this milestone

      const msg = `${b.tvl_ref ?? ""} has no driver — ${m.hours}h to departure (${timeLabel})`;

      notifyByRoles(STAFF_ROLES, {
        type: "no_driver_3h",
        title: m.title,
        message: msg,
        link: `/bookings/${b.id}`,
        entityType: "booking",
        entityId: b.id,
        severity: m.severity,
        dedupeKey: `${m.action}:${b.id}`,
      }).catch(() => {});

      await sendWebPushToAll({
        title: m.title,
        body:  msg,
        link:  `/bookings/${b.id}`,
        tag:   `no-driver-${b.id}`,          // same tag → replaces previous push silently
        requireInteraction: m.requireInteraction,
      }).catch(() => {});

      await auditLog(m.action, "booking", b.id, null, msg).catch(() => {});
      sentSet.add(key); // prevent double-fire within same tick if bookings overlap

      console.info(`[Scheduler] ${m.action}: ${b.tvl_ref}`);
    }
  }
}

// ─── Follow-up due alerts ──────────────────────────────────────────────────
async function checkFollowUpsDue() {
  const today = new Date().toISOString().slice(0, 10);

  // 1. Existing follow_ups table
  const { data: due } = await schedDb()
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
  const { data: dueRequests } = await schedDb()
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
let lastBriefingDate = "";
let lastBackupDate = "";
let lastFollowUpDate = "";
let lastNoDriverTickMs = 0;
let lastOverdueAlertDate = "";

// ── UK time helpers (BST/GMT-aware via Intl) ──────────────────────────
// Returns the current hour-of-day in Europe/London regardless of server TZ.
function ukHourNow(): number {
  return parseInt(
    new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone: "Europe/London" })
      .format(new Date()),
    10,
  );
}
// Returns YYYY-MM-DD for "today" in Europe/London — used for daily dedupe so
// a 23:00 UTC trigger that's 00:00 BST counts as the new local day.
function ukDateKey(): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Europe/London",
  });
  return fmt.format(new Date()); // en-CA gives YYYY-MM-DD
}

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

async function maybeRunBriefing() {
  // Daily admin briefing at 07:00 Europe/London (handles BST/GMT automatically).
  if (ukHourNow() !== 7) return;
  const today = ukDateKey();
  if (lastBriefingDate === today) return;
  lastBriefingDate = today;
  await sendDailyBriefing().catch(e =>
    console.error("[Scheduler] briefing error:", e?.message),
  );
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

async function maybeRunOverdueCommissionAlert() {
  // Daily at 09:00 Europe/London — email admin about drivers with cash commission
  // outstanding for >= 30 days. Skip silently if nothing overdue.
  if (ukHourNow() !== 9) return;
  const today = ukDateKey();
  if (lastOverdueAlertDate === today) return;
  lastOverdueAlertDate = today;

  try {
    const { data: rows } = await schedDb()
      .from("bookings")
      .select("driver_id, tvl_commission, date_time, drivers(name, staff_no, whatsapp)")
      .eq("payment_method", "Cash")
      .eq("commission_status", "Outstanding")
      .neq("status", "Cancelled");

    const dayMs = 86400000;
    const overdueByDriver: Record<string, { name: string; staff_no: string | null; whatsapp: string | null; total: number; oldest: number; jobs: number }> = {};
    (rows ?? []).forEach((b: any) => {
      if (!b.driver_id || !b.date_time) return;
      const age = Math.floor((Date.now() - new Date(b.date_time).getTime()) / dayMs);
      if (age < 30) return;
      const key = b.driver_id;
      const cur = overdueByDriver[key] ?? {
        name: b.drivers?.name ?? "Unknown",
        staff_no: b.drivers?.staff_no ?? null,
        whatsapp: b.drivers?.whatsapp ?? null,
        total: 0,
        oldest: 0,
        jobs: 0,
      };
      cur.total += Number(b.tvl_commission) || 0;
      cur.jobs += 1;
      if (age > cur.oldest) cur.oldest = age;
      overdueByDriver[key] = cur;
    });

    const list = Object.values(overdueByDriver).sort((a, b) => b.oldest - a.oldest);
    if (list.length === 0) return;

    const recipient = await getAdminBriefingRecipient();
    const totalOwed = list.reduce((s, d) => s + d.total, 0);
    const rowsHtml = list.map(d => `
      <tr>
        <td style="padding:6px 10px;border-bottom:1px solid #eee">${d.name}${d.staff_no ? ` <span style="color:#888">(${d.staff_no})</span>` : ""}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">£${d.total.toFixed(2)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right;color:#b00020"><strong>${d.oldest}d</strong></td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${d.jobs}</td>
      </tr>
    `).join("");

    const html = `
      <h2 style="font-family:system-ui">Overdue Commission Alert</h2>
      <p>${list.length} driver(s) have cash commission outstanding for 30+ days.
      Total overdue: <strong>£${totalOwed.toFixed(2)}</strong></p>
      <table style="border-collapse:collapse;font-family:system-ui;font-size:14px;min-width:480px">
        <thead><tr style="background:#f5f5f5">
          <th style="padding:6px 10px;text-align:left">Driver</th>
          <th style="padding:6px 10px;text-align:right">Owed</th>
          <th style="padding:6px 10px;text-align:right">Oldest</th>
          <th style="padding:6px 10px;text-align:right">Jobs</th>
        </tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
      <p style="color:#666;margin-top:16px">Sent automatically by Traveluxe OS scheduler.</p>
    `;

    await sendEmail({
      to: recipient,
      subject: `[Traveluxe OS] ${list.length} driver(s) with overdue commission (≥30d)`,
      html,
      account: "system",
    }).catch(() => {});
  } catch (e: any) {
    console.error("[Scheduler] overdue commission alert:", e?.message);
  }
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

// ─── Unpaid-invoice operator reminder ────────────────────────────────────────
// Re-introduced per the T005 spec, but tightly scoped: emails the single
// operator account (moradlondon1, falling back to any super_admin) when an
// invoice has been Generated/Sent for more than 48h after its booking was
// completed. Uses invoices.unpaid_reminder_sent_at as a 24h throttle so the
// inbox isn't flooded by the 60s tick.
async function getUnpaidReminderRecipient(): Promise<string | null> {
  // Primary: the named operator account.
  const { data: byUsername } = await schedDb()
    .from("users")
    .select("email, active")
    .eq("username", "moradlondon1")
    .maybeSingle();
  if (byUsername?.active && byUsername.email) return byUsername.email;
  // Fallback: any active super_admin.
  const { data: superAdmins } = await schedDb()
    .from("users")
    .select("email, active")
    .eq("role", "super_admin")
    .eq("active", true)
    .limit(1);
  return superAdmins?.[0]?.email ?? null;
}

function unpaidInvoiceReminderHtml(rows: any[]) {
  const itemsHtml = rows
    .map((r: any) => {
      const since = r.completed_at
        ? new Date(r.completed_at).toLocaleString("en-GB")
        : "—";
      return `
        <tr>
          <td style="padding:8px;border-bottom:1px solid #eee">${r.invoice_number ?? "—"}</td>
          <td style="padding:8px;border-bottom:1px solid #eee">${r.tvl_ref ?? "—"}</td>
          <td style="padding:8px;border-bottom:1px solid #eee">${r.client_name ?? "—"}</td>
          <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">£${Number(r.amount ?? 0).toLocaleString()}</td>
          <td style="padding:8px;border-bottom:1px solid #eee">${since}</td>
        </tr>`;
    })
    .join("");
  return `
    <div style="font-family:Arial,sans-serif;max-width:680px;margin:auto;padding:24px;color:#111">
      <h2 style="margin:0 0 12px;color:#b45309">Unpaid invoices &gt; 48h after completion</h2>
      <p style="margin:0 0 12px">${rows.length} invoice${rows.length === 1 ? "" : "s"} need${rows.length === 1 ? "s" : ""} attention. Booking is Completed but invoice is still Generated or Sent.</p>
      <table style="width:100%;border-collapse:collapse;margin-top:8px;font-size:14px">
        <tr style="background:#f5f5f5">
          <th style="padding:8px;text-align:left">Invoice</th>
          <th style="padding:8px;text-align:left">Booking</th>
          <th style="padding:8px;text-align:left">Client</th>
          <th style="padding:8px;text-align:right">Amount</th>
          <th style="padding:8px;text-align:left">Completed</th>
        </tr>
        ${itemsHtml}
      </table>
      <p style="margin-top:20px;font-size:12px;color:#888">Traveluxe OS · automated unpaid-invoice reminder · throttled to one alert per 24h per invoice</p>
    </div>
  `;
}

let lastUnpaidReminderHour: number | null = null;
async function maybeRunUnpaidInvoiceReminder() {
  // Hourly cadence: only run once per wall-clock hour to keep the load light.
  const nowHour = Math.floor(Date.now() / 3_600_000);
  if (lastUnpaidReminderHour === nowHour) return;
  lastUnpaidReminderHour = nowHour;

  try {
    const cutoff = new Date(Date.now() - 48 * 3_600_000).toISOString();
    const throttleAfter = new Date(Date.now() - 24 * 3_600_000).toISOString();

    // Pull candidate invoices: Generated/Sent + booking Completed > 48h ago,
    // and either never reminded or last reminder more than 24h ago.
    const { data: invoices, error } = await schedDb()
      .from("invoices")
      .select("id, invoice_number, status, unpaid_reminder_sent_at, booking_id, bookings:booking_id(tvl_ref, status, completed_at, price, client_id, clients(name))")
      .in("status", ["Generated", "Sent"]);

    if (error) {
      // unpaid_reminder_sent_at column missing → migration not run yet.
      console.warn("[Scheduler] unpaid-invoice reminder skipped:", error.message);
      return;
    }

    const due = (invoices ?? []).filter((inv: any) => {
      const bk = inv.bookings;
      if (!bk || bk.status !== "Completed" || !bk.completed_at) return false;
      if (bk.completed_at > cutoff) return false; // not 48h yet
      if (inv.unpaid_reminder_sent_at && inv.unpaid_reminder_sent_at > throttleAfter) return false;
      return true;
    });

    if (due.length === 0) return;

    const recipient = await getUnpaidReminderRecipient();
    if (!recipient) {
      console.warn("[Scheduler] unpaid-invoice reminder: no recipient (moradlondon1 / super_admin) found");
      return;
    }

    const rows = due.map((inv: any) => ({
      invoice_number: inv.invoice_number,
      amount: inv.bookings?.price ?? 0,
      tvl_ref: inv.bookings?.tvl_ref,
      completed_at: inv.bookings?.completed_at,
      client_name: inv.bookings?.clients?.name,
    }));

    const result = await sendEmail({
      to: recipient,
      subject: `[Traveluxe OS] ${due.length} unpaid invoice${due.length === 1 ? "" : "s"} > 48h after completion`,
      html: unpaidInvoiceReminderHtml(rows),
      account: "system",
    });

    if (result.sent) {
      // Stamp the throttle column on every invoice we just notified about.
      // CRITICAL: if this update fails the throttle is bypassed and the same
      // invoice would be re-emailed every hour. We must surface the failure
      // and skip the audit-log entry so an operator can intervene.
      const ids = due.map((inv: any) => inv.id);
      const { error: stampErr } = await schedDb()
        .from("invoices")
        .update({ unpaid_reminder_sent_at: new Date().toISOString() })
        .in("id", ids);
      if (stampErr) {
        console.error(
          `[Scheduler] Unpaid-invoice reminder: SENT to ${recipient} but throttle stamp FAILED for ${ids.length} invoice(s): ${stampErr.message} — next hourly tick may re-send`,
        );
        return;
      }
      await auditLog(
        "unpaid_invoice_reminder",
        "system",
        "00000000-0000-0000-0000-000000000000",
        null,
        `Reminded ${recipient} about ${due.length} unpaid invoice(s)`,
      ).catch(() => {});
      console.info(`[Scheduler] Unpaid-invoice reminder: sent to ${recipient} (${due.length} invoice${due.length === 1 ? "" : "s"})`);
    } else {
      // Send failed — release the in-memory hourly guard so the next tick
      // can retry rather than waiting a full hour for a transient SMTP blip.
      lastUnpaidReminderHour = null;
      console.error("[Scheduler] Unpaid-invoice reminder send failed:", result.reason);
    }
  } catch (e: any) {
    console.error("[Scheduler] unpaid-invoice reminder error:", e?.message ?? e);
  }
}

export function startScheduler() {
  if (started) return;
  started = true;

  const tick = async () => {
    try {
      await autoActivateJobs();
      await sendReminders();
      await sendUpcomingAlerts();
      await maybeRunNoDriverScan();
      await maybeRunFollowUpScan();
      await maybeRunDigest();
      await maybeRunBriefing();
      await maybeRunOverdueCommissionAlert();
      await maybeRunUnpaidInvoiceReminder();
      await maybeRunBackup();
      await pollUpcomingFlights();
    } catch (e: any) {
      console.error("[Scheduler] tick error:", e?.message);
    }
  };

  // Run shortly after boot, then every minute
  setTimeout(tick, 5000);
  timer = setInterval(tick, TICK_MS);
  console.info("[Scheduler] auto-activate + reminders + no-driver alerts + follow-up scan + 08:00 digest + 03:00 backup + flight-poll loop started (60s interval)");
}

export function stopScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
  started = false;
}
