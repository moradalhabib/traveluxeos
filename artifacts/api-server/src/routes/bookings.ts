import { Router } from "express";
import { supabase, auditLog, getUserFromToken, getDbClient, getServiceRoleClient } from "../lib/supabase";
import { logActivity } from "../lib/activity";
import { sendEmail } from "../services/email";
import { notifyDriverAssigned, notifyDriverDeclined } from "../services/scheduler";
import { notifyByRoles, notifyUser, STAFF_ROLES, ADMIN_ROLES } from "../services/notify";
import { sendWebPushToAll } from "../services/webpush";

function bookingShortLabel(b: any) {
  const ref = b.tvl_ref ?? "TVL-????";
  const name = b.client_name ?? "client";
  const svc = b.service_type ?? "booking";
  const when = b.date_time
    ? new Date(b.date_time).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
    : "";
  return { ref, name, svc, when };
}
import { bookingConfirmationHtml, paymentReceiptHtml } from "../templates/emailTemplates";
import { buildPdf, buildReceiptPdf } from "./booking-pdf";

const router = Router();

// ─── Email automation: de-dup + structured logging ─────────────────────────
// Every transactional email about a booking goes through `sendBookingEmail()`.
// It writes a row to `booking_email_log` for every attempt — sent, failed, or
// skipped — so the UI can show a real status badge and the operator can retry.
// De-dup: if a 'sent' row already exists for (booking_id, kind) we skip
// silently, unless the caller passes `force=true` (used by the manual
// "Send Invoice" / "Retry" buttons).

type EmailKind = "booking_confirmation" | "payment_receipt" | "invoice_resend" | "manual_invoice";

function emailLogClient() {
  // booking_email_log writes are trusted server-side audit rows. RLS on the
  // table is staff-only, so per-request JWTs from non-staff callers (e.g.
  // /send-test-email invoked while signed in as a regular user) would be
  // blocked. Use the service-role client so audit always lands.
  return getServiceRoleClient() ?? supabase;
}

async function hasAlreadySent(bookingId: string, kind: EmailKind): Promise<boolean> {
  const { data, error } = await emailLogClient()
    .from("booking_email_log")
    .select("id")
    .eq("booking_id", bookingId)
    .eq("kind", kind)
    .eq("status", "sent")
    .limit(1)
    .maybeSingle();
  if (error) {
    // Most likely cause: migration-booking-email-log.sql not run yet. Don't
    // block the email — just log so we can spot the schema gap quickly.
    console.warn(`[Email] de-dup lookup failed (table missing?): ${error.message}`);
    return false;
  }
  return !!data;
}

async function recordEmailLog(row: {
  booking_id: string;
  kind: EmailKind;
  status: "sent" | "failed" | "skipped_no_email";
  to_email?: string | null;
  error?: string | null;
  triggered_by?: string | null;
  trigger_source?: "auto" | "manual";
}) {
  const { error } = await emailLogClient().from("booking_email_log").insert({
    booking_id: row.booking_id,
    kind: row.kind,
    status: row.status,
    to_email: row.to_email ?? null,
    error: row.error ?? null,
    triggered_by: row.triggered_by ?? null,
    trigger_source: row.trigger_source ?? "auto",
  });
  if (error) {
    console.warn(`[Email] could not write booking_email_log row: ${error.message}`);
  }
}

interface SendBookingEmailArgs {
  bookingId: string;
  tvlRef: string | null;
  kind: EmailKind;
  to: string | null | undefined;
  subject: string;
  html: string;
  attachments?: { filename: string; content: Buffer; contentType?: string }[];
  triggeredBy?: string | null;
  triggerSource?: "auto" | "manual";
  force?: boolean;
}

async function sendBookingEmail(args: SendBookingEmailArgs): Promise<{ sent: boolean; reason?: string; skipped?: boolean }> {
  const tag = `[Email:${args.kind}:${args.tvlRef ?? args.bookingId.slice(0, 8)}]`;
  console.info(`${tag} trigger fired`);

  if (!args.to || !String(args.to).trim()) {
    console.warn(`${tag} skipped — no email on file for client`);
    await recordEmailLog({
      booking_id: args.bookingId,
      kind: args.kind,
      status: "skipped_no_email",
      triggered_by: args.triggeredBy,
      trigger_source: args.triggerSource ?? "auto",
    });
    return { sent: false, skipped: true, reason: "no_email_on_file" };
  }

  if (!args.force && (await hasAlreadySent(args.bookingId, args.kind))) {
    console.info(`${tag} skipped — already sent (de-dup); use force=true to resend`);
    return { sent: false, skipped: true, reason: "already_sent" };
  }

  console.info(`${tag} sending → ${args.to} (${args.attachments?.length ?? 0} attachment(s))`);
  const result = await sendEmail({
    to: args.to,
    subject: args.subject,
    html: args.html,
    account: "invoice",
    attachments: args.attachments,
  });

  await recordEmailLog({
    booking_id: args.bookingId,
    kind: args.kind,
    status: result.sent ? "sent" : "failed",
    to_email: args.to,
    error: result.sent ? null : result.reason ?? "Unknown error",
    triggered_by: args.triggeredBy,
    trigger_source: args.triggerSource ?? "auto",
  });

  if (result.sent) {
    console.info(`${tag} ✓ sent successfully`);
  } else {
    console.error(`${tag} ✗ FAILED: ${result.reason}`);
    // Fix 5 — surface email-send failures in the bell so admins/operators
    // notice instead of silently letting confirmations/receipts disappear.
    // Dedupe per booking+kind so a retry storm doesn't spam the inbox.
    notifyByRoles(ADMIN_ROLES, {
      type: "invoice_email_failed",
      title: "Email Failed to Send",
      message: `${args.kind === "payment_receipt" ? "Receipt" : "Confirmation"} for ${args.tvlRef ?? args.bookingId.slice(0, 8)} failed: ${(result.reason ?? "Unknown error").slice(0, 80)}`,
      link: `/bookings/${args.bookingId}`,
      entityType: "booking",
      entityId: args.bookingId,
      severity: "warning",
      dedupeKey: `invoice_email_failed:${args.bookingId}:${args.kind}`,
    }).catch(() => {});
  }
  return result;
}

// Build the receipt PDF buffer for a fully-enriched booking. Returns null on
// any failure so a missing PDF never blocks the email itself.
async function buildReceiptAttachment(booking: any): Promise<{ filename: string; content: Buffer; contentType: string } | null> {
  try {
    const { data: client } = await supabase
      .from("clients")
      .select("name, email, address, vip_tier")
      .eq("id", booking.client_id)
      .single();
    const buf = await buildReceiptPdf(booking, client ?? null);
    return {
      filename: `Receipt-${booking.tvl_ref ?? "Traveluxe"}.pdf`,
      content: buf,
      contentType: "application/pdf",
    };
  } catch (e: any) {
    console.warn(`[Email] could not build receipt PDF for ${booking.tvl_ref}: ${e?.message}`);
    return null;
  }
}

async function buildConfirmationAttachment(booking: any): Promise<{ filename: string; content: Buffer; contentType: string } | null> {
  try {
    const [{ data: client }, { data: driver }] = await Promise.all([
      supabase.from("clients").select("name, email, address, vip_tier").eq("id", booking.client_id).single(),
      booking.driver_id
        ? supabase.from("drivers").select("name, vehicle_model, vehicle_year, plate, whatsapp").eq("id", booking.driver_id).single()
        : Promise.resolve({ data: null }),
    ]);
    const buf = await buildPdf(booking, client ?? null, driver ?? null);
    return {
      filename: `Booking-${booking.tvl_ref ?? "Traveluxe"}.pdf`,
      content: buf,
      contentType: "application/pdf",
    };
  } catch (e: any) {
    console.warn(`[Email] could not build confirmation PDF for ${booking.tvl_ref}: ${e?.message}`);
    return null;
  }
}

// ─── Auto-create follow-up for Arrival Airport Transfers ─────────────────────
// Race-safe in two layers:
//  1) Pre-check via SELECT covers the common case (no extra row).
//  2) The partial unique index on follow_ups(booking_id) added in
//     migration-followup-unique.sql will reject any racing duplicate insert
//     with a "duplicate key" error, which we swallow.
async function autoCreateFollowUp(bookingId: string, booking: any) {
  // Auto-create a follow-up for any service type once the booking is paid /
  // completed. Each service gets a sensible "check in with the client" gap
  // tuned to its lifecycle:
  //   • Airport Transfer (Arrival): +3 days — original behaviour, gives the
  //     client a few days on the ground before we ping them about a return.
  //   • Airport Transfer (Departure): +1 day — confirm safe arrival home.
  //   • Tour: +1 day after the tour end (date_to) — feedback while it's fresh.
  //   • Hotel / Apartment: +1 day after checkout (date_to).
  //   • Car Rental / As Directed / anything else: +3 days from the pickup.
  // Keep the early return for any booking we don't want to chase (none today,
  // but easy to short-circuit by service type if needed).
  const { data: existing } = await supabase
    .from("follow_ups")
    .select("id")
    .eq("booking_id", bookingId)
    .maybeSingle();
  if (existing) return;

  const svc = booking.service_type;
  const dir = booking.direction;
  const baseIso = booking.date_to || booking.date_time;
  const base = baseIso ? new Date(baseIso) : new Date();
  const due = new Date(base);
  let offsetDays = 3;
  if (svc === "Airport Transfer" && dir === "Departure") offsetDays = 1;
  else if (svc === "Tour") offsetDays = 1;
  else if (svc === "Hotel" || svc === "Apartment") offsetDays = 1;
  due.setDate(due.getDate() + offsetDays);
  const { error } = await supabase.from("follow_ups").insert({
    booking_id: bookingId,
    client_id: booking.client_id ?? null,
    driver_id: booking.driver_id ?? null,
    due_date: due.toISOString().split("T")[0],
    status: "pending",
  });
  if (error && !/duplicate key|unique/i.test(error.message)) {
    console.error("[FollowUp] insert failed:", error.message);
  }
}

// ── Settled-commission cancel warning ────────────────────────────────────
// When a booking is cancelled AFTER its driver commission was already
// settled (or paid out), the financial ledger is now out of step with the
// live booking state. We can't auto-unwind silently — that would corrupt
// finance history — so instead we surface a loud warning: an audit row,
// an activity entry, and an admin in-app notification. An admin can then
// open Commissions and reverse the settlement manually.
async function warnIfBookingPreviouslySettled(
  bookingId: string,
  bookingRef: string | null,
  userId: string | null,
): Promise<void> {
  try {
    // Step 1: gather every booking_vehicles.id under this booking — the
    // extra cars may have been settled / paid out independently of the
    // primary booking, so we need to hit BOTH the booking_ids array and
    // the booking_vehicle_ids array on the ledger tables.
    const { data: vehRows } = await supabase
      .from("booking_vehicles")
      .select("id")
      .eq("booking_id", bookingId);
    const vehIds = (vehRows ?? []).map((r: any) => r.id).filter(Boolean);

    // Step 2: look in commission_settlements (cash) and driver_payouts
    // (bank/card) for any entry that references this booking either via
    // booking_ids OR booking_vehicle_ids.
    const queries: any[] = [
      supabase
        .from("commission_settlements")
        .select("id, total_amount, settled_at, drivers(name)")
        .contains("booking_ids", [bookingId])
        .limit(5),
      supabase
        .from("driver_payouts")
        .select("id, total_amount, paid_at, drivers(name)")
        .contains("booking_ids", [bookingId])
        .limit(5),
    ];
    if (vehIds.length > 0) {
      queries.push(
        supabase
          .from("commission_settlements")
          .select("id, total_amount, settled_at, drivers(name)")
          .overlaps("booking_vehicle_ids", vehIds)
          .limit(5),
        supabase
          .from("driver_payouts")
          .select("id, total_amount, paid_at, drivers(name)")
          .overlaps("booking_vehicle_ids", vehIds)
          .limit(5),
      );
    }
    const results = await Promise.all(queries);
    const settMap = new Map<string, any>();
    const payMap = new Map<string, any>();
    // Index 0 + 2 = settlements, 1 + 3 = payouts. De-dupe by id so we
    // don't double-warn when a single ledger row covers both arrays.
    [results[0]?.data, results[2]?.data].forEach(arr =>
      (arr ?? []).forEach((r: any) => settMap.set(r.id, r)));
    [results[1]?.data, results[3]?.data].forEach(arr =>
      (arr ?? []).forEach((r: any) => payMap.set(r.id, r)));
    const settHits = [...settMap.values()];
    const payHits = [...payMap.values()];
    if (settHits.length === 0 && payHits.length === 0) return;

    const parts: string[] = [];
    for (const s of settHits) {
      parts.push(`settlement ${s.id} (£${s.total_amount} to ${s.drivers?.name ?? "driver"})`);
    }
    for (const p of payHits) {
      parts.push(`payout ${p.id} (£${p.total_amount} to ${p.drivers?.name ?? "driver"})`);
    }
    const summary = `Booking ${bookingRef ?? bookingId} cancelled but driver finance was already settled — ${parts.join("; ")}. Admin must reverse manually on the Commissions page.`;
    await auditLog("cancel_after_settled", "booking", bookingId, userId, summary);
    await logActivity({
      action_type: "booking_cancelled",
      description: summary,
      entity_type: "booking",
      entity_id: bookingId,
      entity_label: bookingRef ?? null,
      operator_id: userId,
    });
    notifyByRoles(ADMIN_ROLES, {
      type: "booking_cancelled",
      title: "Cancelled — driver already paid",
      message: summary.slice(0, 200),
      link: `/commissions`,
      entityType: "booking",
      entityId: bookingId,
      severity: "warning",
      dedupeKey: `cancel_after_settled:${bookingId}`,
    }).catch(() => {});
  } catch (e: any) {
    console.error("[warnIfBookingPreviouslySettled] failed:", e?.message);
  }
}

async function fetchDriverSafely(driverId: string | null) {
  if (!driverId) return null;
  // Try with staff_no first (post-migration). Fall back without it if column is missing.
  const withStaff = await supabase
    .from("drivers")
    .select("name, staff_no, vehicle_type, vehicle_model, vehicle_year")
    .eq("id", driverId)
    .single();
  if (!withStaff.error) return withStaff.data;
  const fallback = await supabase
    .from("drivers")
    .select("name, vehicle_type, vehicle_model, vehicle_year")
    .eq("id", driverId)
    .single();
  if (fallback.error) return null;
  return { ...fallback.data, staff_no: null };
}

// Exported so invoices.ts can shape a booking exactly the same way for the
// shared email helpers (which expect client_email + tvl_ref + service_type).
export async function enrichBooking(booking: any) {
  const [{ data: client }, driver, { data: operator }] = await Promise.all([
    supabase.from("clients").select("name, vip_tier, email, nationality").eq("id", booking.client_id).single(),
    fetchDriverSafely(booking.driver_id),
    supabase.from("users").select("name").eq("id", booking.operator_id).single(),
  ]);

  return {
    ...booking,
    client_name: client?.name ?? null,
    client_vip_tier: client?.vip_tier ?? null,
    client_email: client?.email ?? null,
    client_nationality: client?.nationality ?? null,
    driver_name: driver?.name ?? null,
    driver_staff_no: driver?.staff_no ?? null,
    driver_vehicle: driver
      ? [driver.vehicle_year, driver.vehicle_model ?? driver.vehicle_type].filter(Boolean).join(" ").trim() || null
      : null,
    operator_name: operator?.name ?? null,
  };
}

async function autoGenerateInvoice(bookingId: string, userId: string | null): Promise<string | null> {
  const { data: existing } = await supabase.from("invoices").select("invoice_number").eq("booking_id", bookingId).single();
  if (existing) return existing.invoice_number;

  const { data, error } = await supabase
    .from("invoices")
    .insert({ booking_id: bookingId, generated_by: userId, status: "Generated" })
    .select("invoice_number")
    .single();

  if (error) { console.error("[Invoice] Auto-generate failed:", error.message); return null; }
  return data.invoice_number;
}

// Shared helper — both confirmation and payment-receipt emails want the
// same per-vehicle leg list so the client sees consistent "which car
// collects you where" wording across the journey. Failure is non-fatal.
async function loadVehicleLegsForEmail(
  booking: any,
): Promise<import("../templates/emailTemplates").EmailVehicleLeg[]> {
  const legs: import("../templates/emailTemplates").EmailVehicleLeg[] = [];
  try {
    const { data: vrows } = await supabase
      .from("booking_vehicles")
      .select("vehicle_type, pickup, dropoff, date_time, drivers(name), created_at")
      .eq("booking_id", booking.id)
      .order("created_at", { ascending: true });
    if (Array.isArray(vrows) && vrows.length > 0) {
      legs.push({
        car_no: 1,
        driver_name: booking.driver_name ?? null,
        vehicle_type: booking.vehicle_type ?? null,
        pickup: booking.pickup ?? null,
        dropoff: booking.dropoff ?? booking.destination ?? null,
        date_time: booking.date_time ?? null,
        is_override: false,
      });
      vrows.forEach((row: any, idx: number) => {
        legs.push({
          car_no: idx + 2,
          driver_name: (row as any)?.drivers?.name ?? null,
          vehicle_type: row?.vehicle_type ?? null,
          pickup: row?.pickup ?? null,
          dropoff: row?.dropoff ?? null,
          date_time: row?.date_time ?? null,
          is_override: !!(row?.pickup || row?.dropoff || row?.date_time),
        });
      });
    }
  } catch (e) {
    console.warn("[loadVehicleLegsForEmail] roster lookup failed", e);
  }
  return legs;
}

// Exported so invoices.ts can fire the same canonical pipeline (de-dup,
// structured logging, booking_email_log row) instead of bypassing it with a
// raw sendEmail call. Both routes must end up writing the same audit trail.
export async function sendConfirmationEmail(
  booking: any,
  invoiceNumber: string | null,
  opts: { triggeredBy?: string | null; force?: boolean; triggerSource?: "auto" | "manual" } = {}
) {
  const vehicleLegs = await loadVehicleLegsForEmail(booking);

  // When the booking has been amended (vehicle swap, date change, supplier
  // products added, …) flag the email so the client knows it's an update
  // rather than a duplicate confirmation.
  const isAmended = booking.is_amended === true;
  const subject = isAmended
    ? `Booking Updated — ${booking.tvl_ref ?? ""} — ${booking.service_type}`
    : `Booking Confirmed — ${booking.tvl_ref ?? ""} — ${booking.service_type}`;

  return sendBookingEmail({
    bookingId: booking.id,
    tvlRef: booking.tvl_ref ?? null,
    kind: "booking_confirmation",
    to: booking.client_email,
    subject,
    html: bookingConfirmationHtml(booking, invoiceNumber ?? undefined, vehicleLegs),
    triggeredBy: opts.triggeredBy ?? null,
    triggerSource: opts.triggerSource ?? "auto",
    force: !!opts.force,
  });
}

export async function sendPaymentReceiptEmail(
  booking: any,
  opts: { triggeredBy?: string | null; force?: boolean; triggerSource?: "auto" | "manual" } = {}
) {
  const { data: inv } = await supabase.from("invoices").select("invoice_number").eq("booking_id", booking.id).single();
  // Build the invoice / receipt PDF as an attachment per the operator spec.
  const pdf = await buildReceiptAttachment(booking);
  // Mirror the per-leg routes block from the confirmation email so a
  // multi-car booking's receipt also reminds the client which car
  // collected them where (matches PDF + WhatsApp wording).
  const vehicleLegs = await loadVehicleLegsForEmail(booking);
  return sendBookingEmail({
    bookingId: booking.id,
    tvlRef: booking.tvl_ref ?? null,
    kind: "payment_receipt",
    to: booking.client_email,
    subject: `Payment Confirmed — ${booking.tvl_ref ?? ""} — Thank You`,
    html: paymentReceiptHtml(booking, inv?.invoice_number ?? undefined, vehicleLegs),
    attachments: pdf ? [pdf] : undefined,
    triggeredBy: opts.triggeredBy ?? null,
    triggerSource: opts.triggerSource ?? "auto",
    force: !!opts.force,
  });
}

router.get("/", async (req, res) => {
  const { status, service_type, date_from, date_to, driver_id, operator_id, payment_status, imported } = req.query;
  const db = getDbClient(req.headers.authorization);

  let query = db
    .from("bookings")
    .select("*, clients(name, vip_tier), drivers(name, staff_no, vehicle_type, vehicle_model, vehicle_year), users!bookings_operator_id_fkey(name)")
    // Newest bookings first (UI may re-sort further on date_time as needed).
    .order("date_time", { ascending: false, nullsFirst: false });

  // Imported Odoo bookings have legacy refs starting with 'S' (e.g. S01089).
  // New bookings use the 'TVL-' pattern. By default the operator's day-to-day
  // views exclude these legacy records so aggregate stats aren't polluted;
  // the dedicated "Imported (Odoo)" sub-tabs pass ?imported=only to show them.
  // Strict enum — unknown values default to "exclude" so segregation is never
  // silently bypassed by a malformed query string.
  const rawImported = String(imported ?? "exclude").toLowerCase();
  const importedMode: "exclude" | "only" | "all" =
    rawImported === "only" ? "only" : rawImported === "all" ? "all" : "exclude";
  if (importedMode === "exclude") {
    query = query.not("tvl_ref", "like", "S%");
  } else if (importedMode === "only") {
    query = query.like("tvl_ref", "S%");
  }

  if (status) query = query.eq("status", String(status));
  if (service_type) query = query.eq("service_type", String(service_type));
  if (date_from) query = query.gte("date_time", String(date_from));
  if (date_to) query = query.lte("date_time", String(date_to));
  if (driver_id) query = query.eq("driver_id", String(driver_id));
  if (operator_id) query = query.eq("operator_id", String(operator_id));
  if (payment_status) query = query.eq("payment_status", String(payment_status));

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  // T004: enrich each booking with the most recent email-log status so the
  // jobs board can show a tiny status dot per row. Single bulk query, mapped
  // in JS. If the booking_email_log table doesn't exist yet (migration not
  // applied) we silently treat every booking as `last_email_status: null`.
  const bookingIds = (data ?? []).map((b: any) => b.id).filter(Boolean);
  const latestEmailByBooking = new Map<string, { kind: string; status: string; created_at: string }>();
  if (bookingIds.length > 0) {
    const { data: logs, error: logErr } = await db
      .from("booking_email_log")
      .select("booking_id, kind, status, created_at")
      .in("booking_id", bookingIds)
      .order("created_at", { ascending: false });
    if (!logErr && logs) {
      for (const row of logs as any[]) {
        if (!latestEmailByBooking.has(row.booking_id)) {
          latestEmailByBooking.set(row.booking_id, {
            kind: row.kind,
            status: row.status,
            created_at: row.created_at,
          });
        }
      }
    }
  }

  // Batch-enrich Airport Transfer bookings with cached flight status so the
  // jobs board and anywhere using the list can show Delayed / Early / On Time.
  const cacheDb = getServiceRoleClient() ?? supabase;
  const flightBookings = (data ?? []).filter(
    (b: any) => b.service_type === "Airport Transfer" && b.flight_number && b.date_time
  );
  const flightStatusByKey = new Map<string, any>();
  if (flightBookings.length > 0) {
    // Collect unique flight_number+date pairs to avoid N queries.
    const pairs = Array.from(
      new Set(
        flightBookings.map((b: any) => `${b.flight_number}|${new Date(b.date_time).toISOString().split("T")[0]}`)
      )
    );
    for (const pair of pairs) {
      const [fn, dt] = pair.split("|");
      const { data: cached } = await cacheDb
        .from("flight_status_cache")
        .select("*")
        .eq("flight_number", fn)
        .eq("date", dt)
        .maybeSingle();
      if (cached) flightStatusByKey.set(pair, cached);
    }
  }

  const result = (data ?? []).map((b: any) => {
    const latest = latestEmailByBooking.get(b.id);
    const flightKey = b.flight_number && b.date_time
      ? `${b.flight_number}|${new Date(b.date_time).toISOString().split("T")[0]}`
      : null;
    const cachedFlight = flightKey ? flightStatusByKey.get(flightKey) ?? null : null;
    return {
      ...b,
      client_name: b.clients?.name ?? null,
      client_vip_tier: b.clients?.vip_tier ?? null,
      client_nationality: b.clients?.nationality ?? null,
      driver_name: b.drivers?.name ?? null,
      driver_staff_no: b.drivers?.staff_no ?? null,
      driver_vehicle: b.drivers
        ? [b.drivers.vehicle_year, b.drivers.vehicle_model ?? b.drivers.vehicle_type].filter(Boolean).join(" ").trim() || null
        : null,
      operator_name: b.users?.name ?? null,
      last_email_status: latest?.status ?? null,
      last_email_kind: latest?.kind ?? null,
      last_email_at: latest?.created_at ?? null,
      flight_status: cachedFlight,
      clients: undefined,
      drivers: undefined,
      users: undefined,
    };
  });

  return res.json(result);
});

// Server-side validator for the Airport Transfer extras snapshot. Runs on
// both POST and PUT — rejects malformed payloads (wrong type, missing keys,
// non-numeric or negative price, oversize array) so the JSONB column stays
// trustable for finance reporting downstream.
const MAX_TRANSFER_EXTRAS = 20;
function sanitizeTransferExtras(input: unknown): { ok: true; value: any[] } | { ok: false; error: string } {
  if (input == null) return { ok: true, value: [] };
  if (!Array.isArray(input)) return { ok: false, error: "transfer_extras must be an array" };
  if (input.length > MAX_TRANSFER_EXTRAS) return { ok: false, error: `transfer_extras exceeds ${MAX_TRANSFER_EXTRAS} entries` };
  const seen = new Set<string>();
  const cleaned: any[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") return { ok: false, error: "transfer_extras entries must be objects" };
    const id = (raw as any).id;
    const name = (raw as any).name;
    const price = Number((raw as any).price);
    if (typeof id !== "string" || !id.trim()) return { ok: false, error: "transfer_extras entry missing id" };
    if (typeof name !== "string" || !name.trim()) return { ok: false, error: "transfer_extras entry missing name" };
    if (!isFinite(price) || price < 0 || price > 100000) return { ok: false, error: "transfer_extras entry has invalid price" };
    if (seen.has(id)) continue; // de-dupe by id
    seen.add(id);
    cleaned.push({ id: id.trim(), name: name.trim().slice(0, 200), price });
  }
  return { ok: true, value: cleaned };
}

// Exhaustive whitelist of every column in the bookings table
const BOOKING_COLUMNS = new Set([
  "client_id","service_type","direction","pickup","dropoff",
  "destination","flight_number","date_time","passengers","luggage",
  "vehicle_type","vehicle_preference","nameboard","special_requests","additional_charges",
  "price","tvl_commission","commission_type","payment_status",
  "payment_method","commission_status","payout_status","status",
  "operator_id","driver_id","return_booking_id","is_amended","notes",
  "duration","created_by","updated_at",
  // hotel columns
  "hotel_name","room_type","hotel_booking_ref","breakfast_included",
  "num_guests","num_nights","commission_amount","commission_notes",
  // tour / apartment columns
  "tour_name","meeting_point","guide_included","itinerary",
  "property_name","property_address","check_in_date","check_out_date",
  "nights","property_contact","arrangement_fee_status",
  // Product-restructure additions (April 2026)
  "airport_code","hours","supplier_cost","client_price",
  "vehicle_product_id","tour_product_id",
  // Airport Transfer extras snapshot: array of {id,name,price}.
  // Stored as JSONB so price totals stay historically accurate even if
  // the products catalogue is edited after the booking is saved.
  "transfer_extras",
  // Build 4: supplier link + car-rental cost breakdown + notification timestamps
  // supplier_items is a JSONB array of picked supplier products with qty
  // and rate snapshots — replaces the legacy single supplier_product_id link.
  "supplier_id","supplier_items","supplier_commission",
  "base_daily_rate","rental_days","fuel_cost","driver_cost","extra_charges",
  "as_directed_supplier_driver",
  "client_notified_at","driver_notified_at",
  // Payment-tracking (April 2026 migration B)
  "payment_date","paid_amount","payment_notes",
  // Booking extensions (April-21 migration): driver acceptance, completion
  "driver_acceptance_status","driver_accepted_at","driver_declined_at","driver_decline_reason",
  "client_satisfied","driver_on_time","completion_notes","completed_at",
  // Feature 4 — Commission Split (referral partner)
  "referral_partner_name","referral_commission_type","referral_commission_value",
  // Feature 5 — Supplier Balance Tracker
  "supplier_paid_at","supplier_payment_ref",
  // Client-facing pricing breakdown (April 2026):
  // quoted_price = original quote shown on invoice subtotal line.
  // discount_amount + discount_reason = goodwill / adjustment line.
  // Final price column stays the source of truth for "what client owes".
  "quoted_price","discount_amount","discount_reason",
]);

// Friendlier labels for amendment-history field rows.
const AMENDMENT_FIELD_LABELS: Record<string, string> = {
  driver_id: "Driver",
  status: "Status",
  payment_status: "Payment Status",
  payment_method: "Payment Method",
  payment_date: "Payment Date",
  paid_amount: "Paid Amount",
  payment_notes: "Payment Notes",
  date_time: "Date / Time",
  pickup: "Pickup",
  dropoff: "Drop-off",
  vehicle_type: "Vehicle",
  flight_number: "Flight",
  direction: "Direction",
  passengers: "Passengers",
  luggage: "Luggage",
  price: "Client Price",
  quoted_price: "Quoted Price",
  discount_amount: "Discount",
  discount_reason: "Discount Reason",
  tvl_commission: "Driver Commission",
  supplier_commission: "Supplier Commission",
  supplier_cost: "Supplier Cost",
  driver_cost: "Driver Pay",
  notes: "Notes",
  nameboard: "Meet & Greet Board",
  special_requests: "Special Requests",
  driver_acceptance_status: "Driver Acceptance",
};

function classifyAmendment(field: string): string {
  if (field === "status") return "status_change";
  if (field === "payment_status" || field === "payment_method" || field === "payment_date" || field === "paid_amount" || field === "payment_notes") return "payment_change";
  if (field === "driver_id") return "driver_assigned";
  if (field === "driver_acceptance_status") return "edit";
  return "edit";
}

async function insertAmendments(rows: Array<{
  booking_id: string;
  field_name: string;
  old_value: string | null;
  new_value: string | null;
  change_type: string;
  reason?: string | null;
  changed_by: string | null;
  changed_by_name: string | null;
}>) {
  if (!rows.length) return;
  const { error } = await supabase.from("booking_amendments").insert(rows);
  if (error) console.error("[booking_amendments] insert failed:", error.message);
}

function stringify(v: any): string | null {
  if (v == null) return null;
  if (typeof v === "object") {
    try { return JSON.stringify(v); } catch { return String(v); }
  }
  return String(v);
}

router.post("/", async (req, res) => {
  const user = await getUserFromToken(req.headers.authorization);
  // Use the user's JWT so RLS sees an authenticated request
  const db = getDbClient(req.headers.authorization);

  // Strip any field not in the bookings table to prevent PostgREST 400s
  const raw: Record<string, any> = {};
  for (const [k, v] of Object.entries(req.body)) {
    if (BOOKING_COLUMNS.has(k) && v !== "" && v !== undefined) raw[k] = v;
  }

  if (raw.transfer_extras !== undefined) {
    const sanitized = sanitizeTransferExtras(raw.transfer_extras);
    if (!sanitized.ok) return res.status(400).json({ error: sanitized.error });
    raw.transfer_extras = sanitized.value;
  }

  const body: Record<string, any> = {
    ...raw,
    operator_id: raw.operator_id ?? user?.id ?? null,
    created_by: user?.id ?? null,
  };

  // Coerce numeric fields so strings like "150" don't cause type errors
  for (const f of ["price","tvl_commission","additional_charges","passengers","luggage","duration","commission_amount","num_nights","num_guests","nights","hours","supplier_cost","client_price","base_daily_rate","rental_days","fuel_cost","driver_cost","referral_commission_value","quoted_price","discount_amount"]) {
    if (body[f] !== undefined && body[f] !== null) {
      const n = Number(body[f]);
      body[f] = isNaN(n) ? null : n;
    }
  }

  // Auto-derive Client Price from Quoted - Discount when the operator left
  // it blank but supplied both inputs. The form usually pre-fills price too
  // but this guards direct API callers (Zapier / scripts).
  if ((body.price == null || body.price === "") && body.quoted_price != null) {
    body.price = Number(body.quoted_price) - Number(body.discount_amount ?? 0);
  }

  // Ensure required defaults
  if (!body.price && body.price !== 0) body.price = 0;
  if (!body.status) body.status = "Confirmed";
  if (!body.payment_status) body.payment_status = "Unpaid";

  // Supplier-items integrity (multi-select picker):
  //  - Meaningful for Car Rental / As Directed and Airport Transfer.
  //    Cleared otherwise so a stale picker selection can't leak in.
  //  - Every product must belong to the chosen supplier — reject mismatches.
  //  - Auto-sums supplier_cost = Σ(qty × daily_rate ?? hourly_rate) when
  //    the caller hasn't already pinned a manual override.
  if (Array.isArray(body.supplier_items) && body.supplier_items.length > 0) {
    const svc = body.service_type;
    const usesSupplierItems = svc === "Car Rental" || svc === "As Directed" || svc === "Airport Transfer";
    if (!usesSupplierItems) {
      body.supplier_items = [];
    } else {
      if (!body.supplier_id) {
        return res.status(400).json({ error: "Pick a supplier before adding products." });
      }
      const ids = body.supplier_items.map((i: any) => i?.product_id).filter(Boolean);
      const { data: rows } = await db
        .from("supplier_products")
        .select("id, supplier_id")
        .in("id", ids);
      const byId = new Map((rows ?? []).map((r: any) => [r.id, r.supplier_id]));
      for (const id of ids) {
        const sId = byId.get(id);
        if (!sId) return res.status(400).json({ error: "Supplier product not found." });
        if (sId !== body.supplier_id) {
          return res.status(400).json({ error: "Selected product does not belong to the chosen supplier." });
        }
      }
      if (body.supplier_cost == null) {
        body.supplier_cost = body.supplier_items.reduce((s: number, it: any) => {
          // Override wins — operator typed a manual amount on this line
          // (e.g. "no buggy available − £50"). Otherwise fall back to
          // qty × (daily_rate ?? hourly_rate).
          if (it?.override_price != null) return s + Number(it.override_price);
          const rate = it?.daily_rate != null ? Number(it.daily_rate)
            : it?.hourly_rate != null ? Number(it.hourly_rate)
            : 0;
          return s + rate * Number(it?.qty || 0);
        }, 0);
      }
    }
  }

  const { data, error } = await db
    .from("bookings")
    .insert(body)
    .select()
    .single();

  if (error) {
    console.error("[POST /bookings] Supabase error:", error.message, "| body keys:", Object.keys(body).join(", "));
    return res.status(400).json({ error: error.message });
  }

  // Workaround: a DB trigger (bookings_recalc_supplier_commission) auto-derives
  // supplier_commission from supplier.commission_rate * price on INSERT,
  // overwriting any operator-supplied value. The trigger fires on
  // BEFORE INSERT OR UPDATE OF supplier_id, price — so a follow-up UPDATE
  // that touches ONLY supplier_commission bypasses it. Persist the operator's
  // manual value (used by Airport Transfer split commissions).
  if (
    typeof body.supplier_commission === "number" &&
    !isNaN(body.supplier_commission) &&
    Number(data.supplier_commission ?? 0) !== body.supplier_commission
  ) {
    const { data: patched, error: patchErr } = await db
      .from("bookings")
      .update({ supplier_commission: body.supplier_commission })
      .eq("id", data.id)
      .select()
      .single();
    if (patchErr) {
      console.error("[POST /bookings] supplier_commission patch error:", patchErr.message);
    } else if (patched) {
      data.supplier_commission = patched.supplier_commission;
    }
  }

  // Notify driver if one was provided at creation time
  if (body.driver_id) {
    notifyDriverAssigned(data.id).catch(() => {});
  }

  await auditLog("create_booking", "booking", data.id, user?.id ?? null,
    `Created booking ${data.tvl_ref} for service: ${data.service_type}`);

  await logActivity({
    action_type: "booking_created",
    description: `Booking ${data.tvl_ref ?? data.id} created (${data.service_type ?? "service"})`,
    entity_type: "booking",
    entity_id: data.id,
    entity_label: data.tvl_ref ?? null,
    operator_id: user?.id ?? null,
    operator_name: user?.name ?? null,
  });

  const enriched = await enrichBooking(data);

  // ── In-app notifications ────────────────────────────────────────────────
  {
    const lbl = bookingShortLabel(enriched);
    // Broadcast new-booking alert to all staff (in-app + OS push)
    const newBookingMsg = `${lbl.ref} · ${lbl.name} · ${lbl.svc}${lbl.when ? " · " + lbl.when : ""}`;
    notifyByRoles(STAFF_ROLES, {
      type: "booking_new",
      title: "New Booking",
      message: newBookingMsg,
      link: `/bookings/${data.id}`,
      entityType: "booking",
      entityId: data.id,
      severity: "info",
    }).catch(() => {});
    sendWebPushToAll({
      title: "New Booking",
      body:  newBookingMsg,
      link:  `/bookings/${data.id}`,
      tag:   `new-booking-${data.id}`,
    }).catch(() => {});

    // Targeted alert to the assigned operator (if different from the creator)
    if (data.operator_id && data.operator_id !== user?.id) {
      notifyUser(data.operator_id, {
        type: "job_assigned",
        title: "New Job Assigned to You",
        message: `${lbl.ref} · ${lbl.name}${lbl.when ? " · " + lbl.when : ""}`,
        link: `/bookings/${data.id}`,
        entityType: "booking",
        entityId: data.id,
        severity: "info",
      }).catch(() => {});
    }
  }

  // Auto-generate invoice for confirmed bookings on creation, and fire the
  // booking-confirmation email too. This was the biggest silent gap — most
  // new bookings are created with the default status "Confirmed" (set above)
  // but the email trigger only existed on the PUT /:id and PUT /:id/status
  // paths, so the very first transactional email was being skipped entirely.
  if (data.status === "Confirmed") {
    const invNumber = await autoGenerateInvoice(data.id, user?.id ?? null);
    sendConfirmationEmail(enriched, invNumber, { triggeredBy: user?.id ?? null }).catch(err =>
      console.error("[Email] Confirmation send error (POST /bookings):", err?.message ?? err)
    );
  }

  return res.status(201).json(enriched);
});

router.get("/:id", async (req, res) => {
  const db = getDbClient(req.headers.authorization);
  const { data: booking, error } = await db
    .from("bookings")
    .select("*, clients(name, vip_tier, email, whatsapp, nationality), drivers(name, staff_no, vehicle_type, vehicle_model, vehicle_year, whatsapp), users!bookings_operator_id_fkey(name)")
    .eq("id", req.params.id)
    .single();

  if (error || !booking) return res.status(404).json({ error: "Booking not found" });

  // PostgREST embed: be explicit about which FK we mean. audit_log has
  // operator_id → users(id); without the !operator_id hint, the join can
  // silently return null for users (which is why the UI fell back to "System").
  const { data: auditEntries } = await db
    .from("audit_log")
    .select("*, users!operator_id(name, email)")
    .eq("entity_id", req.params.id)
    .order("created_at", { ascending: false });

  // Defensive fallback: if the embed didn't hydrate (FK metadata missing on
  // older Supabase projects), fetch the names in a second pass keyed by the
  // operator_id so the audit log never shows "System" for a real user action.
  const missingIds = (auditEntries ?? [])
    .filter((a: any) => a.operator_id && !a.users)
    .map((a: any) => a.operator_id as string);
  let nameMap: Record<string, { name: string | null; email: string | null }> = {};
  if (missingIds.length > 0) {
    const { data: usersRows } = await db
      .from("users")
      .select("id, name, email")
      .in("id", Array.from(new Set(missingIds)));
    for (const u of usersRows ?? []) nameMap[u.id] = { name: u.name ?? null, email: u.email ?? null };
  }

  const { data: invoice } = await supabase
    .from("invoices")
    .select("*")
    .eq("booking_id", req.params.id)
    .single();

  // Get flight status if applicable (Airport Transfers only).
  // CACHE-ONLY — never calls AeroDataBox from the booking detail endpoint.
  // The background poller is the sole updater (T-1h / T-30min / post-arrival).
  // This prevents browsing a booking from consuming AeroDataBox quota.
  let flightStatus = null;
  if (booking.flight_number && booking.service_type === "Airport Transfer") {
    const flightDate = booking.date_time ? new Date(booking.date_time).toISOString().split("T")[0] : null;
    if (flightDate) {
      const cacheDb = getServiceRoleClient() ?? supabase;
      const { data: cachedFlight } = await cacheDb
        .from("flight_status_cache")
        .select("*")
        .eq("flight_number", booking.flight_number)
        .eq("date", flightDate)
        .single();
      if (cachedFlight) {
        const { buildCacheResponse } = await import("../services/flightTracker");
        flightStatus = buildCacheResponse(cachedFlight, booking.flight_number);
      }
    }
  }

  const enrichedAudit = (auditEntries ?? []).map((a: any) => {
    const fallback = a.operator_id ? nameMap[a.operator_id] : null;
    return {
      ...a,
      operator_name: a.users?.name ?? fallback?.name ?? a.users?.email ?? fallback?.email ?? null,
      users: undefined,
    };
  });

  return res.json({
    ...booking,
    client_name: booking.clients?.name ?? null,
    client_vip_tier: booking.clients?.vip_tier ?? null,
    client_email: booking.clients?.email ?? null,
    client_whatsapp: booking.clients?.whatsapp ?? null,
    client_nationality: booking.clients?.nationality ?? null,
    driver_name: booking.drivers?.name ?? null,
    driver_staff_no: booking.drivers?.staff_no ?? null,
    driver_vehicle: booking.drivers
      ? [booking.drivers.vehicle_year, booking.drivers.vehicle_model ?? booking.drivers.vehicle_type].filter(Boolean).join(" ").trim() || null
      : null,
    driver_whatsapp: booking.drivers?.whatsapp ?? null,
    operator_name: booking.users?.name ?? null,
    clients: undefined,
    drivers: undefined,
    users: undefined,
    audit_log: enrichedAudit,
    flight_status: flightStatus,
    invoice: invoice ?? null,
  });
});

router.put("/:id", async (req, res) => {
  const user = await getUserFromToken(req.headers.authorization);
  const db = getDbClient(req.headers.authorization);
  const force = String(req.query.force ?? "").toLowerCase() === "true";

  // Fetch previous row in full so we can diff for amendment auto-logging.
  const { data: prevFull } = await db.from("bookings").select("*").eq("id", req.params.id).single();
  const prev: any = prevFull ?? {};
  const prevPaymentStatus = prev?.payment_status;

  // Resolve operator name once (for changed_by_name on amendments)
  let operatorName: string | null = null;
  if (user?.id) {
    const { data: opRow } = await supabase.from("users").select("name").eq("id", user.id).single();
    operatorName = opRow?.name ?? null;
  }

  // ── Driver-conflict pre-check ───────────────────────────────────────────
  // When operator assigns/changes a driver and the new pickup window overlaps
  // an existing live job for that driver, withhold the write and surface the
  // conflict so the frontend can prompt the operator to confirm. Operators
  // who explicitly want to stack short jobs re-call with ?force=true.
  let driverConflict: any = null;
  const incomingDriverId = req.body.driver_id;
  if (incomingDriverId && incomingDriverId !== prev?.driver_id) {
    const targetIso = req.body.date_time ?? prev?.date_time;
    const targetDuration = Number(req.body.duration ?? prev?.duration ?? 90);
    if (targetIso) {
      const target = new Date(targetIso);
      const buffer = Math.max(targetDuration, 90) * 60_000;
      const winStart = new Date(target.getTime() - buffer).toISOString();
      const winEnd = new Date(target.getTime() + buffer).toISOString();
      const { data: clashes } = await db
        .from("bookings")
        .select("id, tvl_ref, date_time, pickup, dropoff, status, clients(name)")
        .eq("driver_id", incomingDriverId)
        .neq("id", req.params.id)
        .neq("status", "Cancelled")
        .neq("status", "Completed")
        .gte("date_time", winStart)
        .lte("date_time", winEnd);
      if (clashes && clashes.length > 0) {
        driverConflict = {
          conflicts: clashes.map((c: any) => ({
            id: c.id, tvl_ref: c.tvl_ref, date_time: c.date_time,
            pickup: c.pickup, dropoff: c.dropoff, status: c.status,
            client_name: c.clients?.name ?? null,
          })),
          message: `Driver already has ${clashes.length} job${clashes.length === 1 ? "" : "s"} within 90 min of this pickup.`,
        };
        if (!force) {
          // Withhold the write. Frontend re-submits with ?force=true to override.
          return res.status(409).json({ driver_conflict: driverConflict });
        }
      }
    }
  }

  // ── Driver-declined flow ────────────────────────────────────────────────
  // When operator marks acceptance as "Driver Declined", clear the driver_id
  // server-side, log a special amendment, and trigger admin alert.
  let driverDeclined: { driverName: string | null; reason: string | null } | null = null;
  if (
    req.body.driver_acceptance_status === "Driver Declined" &&
    prev?.driver_acceptance_status !== "Driver Declined" &&
    prev?.driver_id
  ) {
    const { data: drv } = await supabase.from("drivers").select("name").eq("id", prev.driver_id).single();
    driverDeclined = {
      driverName: drv?.name ?? null,
      reason: req.body.driver_decline_reason ?? null,
    };
    // Force-clear driver on this update
    req.body.driver_id = null;
    req.body.driver_declined_at = req.body.driver_declined_at ?? new Date().toISOString();
  }
  // Mirror "Driver Confirmed" timestamp
  if (
    req.body.driver_acceptance_status === "Driver Confirmed" &&
    prev?.driver_acceptance_status !== "Driver Confirmed"
  ) {
    req.body.driver_accepted_at = req.body.driver_accepted_at ?? new Date().toISOString();
  }

  // Apply same whitelist as POST to avoid unknown-column errors on update.
  // NOTE: we explicitly allow `null` here (the driver-declined path needs to
  // null-out driver_id), and skip empty strings.
  const raw: Record<string, any> = {};
  for (const [k, v] of Object.entries(req.body)) {
    if (BOOKING_COLUMNS.has(k) && v !== "" && v !== undefined) raw[k] = v;
  }
  for (const f of ["price","tvl_commission","additional_charges","passengers","luggage","duration","commission_amount","num_nights","num_guests","nights","hours","supplier_cost","client_price","base_daily_rate","rental_days","fuel_cost","driver_cost","referral_commission_value","quoted_price","discount_amount"]) {
    if (raw[f] !== undefined && raw[f] !== null) {
      const n = Number(raw[f]);
      raw[f] = isNaN(n) ? null : n;
    }
  }
  // Auto-derive Client Price from Quoted - Discount on PUT too — but only
  // when the operator is editing quoted/discount AND didn't also change
  // price explicitly. Prevents a manual override from being silently undone.
  // Treat both `undefined` (field not sent) and `null` (operator cleared
  // the input) as "no manual price override" — otherwise clearing the
  // price field while editing a discount silently drops the column to NULL.
  if ((raw.price === undefined || raw.price === null) && raw.quoted_price !== undefined && raw.quoted_price !== null) {
    raw.price = Number(raw.quoted_price) - Number(raw.discount_amount ?? 0);
  }
  if (raw.transfer_extras !== undefined) {
    const sanitized = sanitizeTransferExtras(raw.transfer_extras);
    if (!sanitized.ok) return res.status(400).json({ error: sanitized.error });
    raw.transfer_extras = sanitized.value;
  }
  const body: Record<string, any> = { ...raw, is_amended: true };

  // Supplier-items integrity (same rules as POST). Use the effective
  // supplier_id (incoming change OR previously-saved value).
  if (Array.isArray(body.supplier_items) && body.supplier_items.length > 0) {
    const svc = body.service_type ?? (prev as any)?.service_type;
    const usesSupplierItems = svc === "Car Rental" || svc === "As Directed" || svc === "Airport Transfer";
    if (!usesSupplierItems) {
      body.supplier_items = [];
    } else {
      const effectiveSupplierId =
        body.supplier_id ??
        (await db.from("bookings").select("supplier_id").eq("id", req.params.id).single()).data?.supplier_id;
      if (!effectiveSupplierId) {
        return res.status(400).json({ error: "Pick a supplier before adding products." });
      }
      const ids = body.supplier_items.map((i: any) => i?.product_id).filter(Boolean);
      const { data: rows } = await db
        .from("supplier_products")
        .select("id, supplier_id")
        .in("id", ids);
      const byId = new Map((rows ?? []).map((r: any) => [r.id, r.supplier_id]));
      for (const id of ids) {
        const sId = byId.get(id);
        if (!sId) return res.status(400).json({ error: "Supplier product not found." });
        if (sId !== effectiveSupplierId) {
          return res.status(400).json({ error: "Selected product does not belong to the chosen supplier." });
        }
      }
      if (body.supplier_cost == null) {
        body.supplier_cost = body.supplier_items.reduce((s: number, it: any) => {
          if (it?.override_price != null) return s + Number(it.override_price);
          const rate = it?.daily_rate != null ? Number(it.daily_rate)
            : it?.hourly_rate != null ? Number(it.hourly_rate)
            : 0;
          return s + rate * Number(it?.qty || 0);
        }, 0);
      }
    }
  }

  const { data, error } = await db
    .from("bookings")
    .update(body)
    .eq("id", req.params.id)
    .select()
    .single();

  if (error) {
    console.error("[PUT /bookings/:id] Supabase error:", error.message);
    return res.status(400).json({ error: error.message });
  }

  const updated: any = data;

  // Workaround: same trigger-bypass as POST. If the operator changed supplier_id
  // or price together with supplier_commission, the BEFORE UPDATE OF
  // supplier_id, price trigger will have just clobbered our value. Re-apply it
  // with a column-isolated UPDATE that does not match the trigger's column list.
  if (
    typeof body.supplier_commission === "number" &&
    !isNaN(body.supplier_commission) &&
    Number(updated.supplier_commission ?? 0) !== body.supplier_commission
  ) {
    const { data: patched, error: patchErr } = await db
      .from("bookings")
      .update({ supplier_commission: body.supplier_commission })
      .eq("id", req.params.id)
      .select()
      .single();
    if (patchErr) {
      console.error("[PUT /bookings/:id] supplier_commission patch error:", patchErr.message);
    } else if (patched) {
      updated.supplier_commission = patched.supplier_commission;
    }
  }

  // If driver assigned, update status
  // Notify driver if a new driver was just assigned via PUT
  if (body.driver_id && body.driver_id !== prev?.driver_id) {
    notifyDriverAssigned(req.params.id).catch(() => {});
  }

  // ── Invoice total_amount sync ──────────────────────────────────────────
  // The invoice snapshots the billable amount at generation. When the
  // operator edits the booking's price / additional_charges later, the
  // linked invoice's total_amount must follow so the dashboard "invoice
  // total" tile and finance reports stay accurate. Skip when the invoice
  // is already Paid (locked ledger) or Cancelled.
  {
    const priceChanged = "price" in body && Number(body.price ?? 0) !== Number(prev?.price ?? 0);
    const chargesChanged = "additional_charges" in body && Number(body.additional_charges ?? 0) !== Number(prev?.additional_charges ?? 0);
    if (priceChanged || chargesChanged) {
      const newTotal = Number(updated.price ?? 0) + Number(updated.additional_charges ?? 0);
      const { error: invSyncErr } = await supabase
        .from("invoices")
        .update({ total_amount: newTotal })
        .eq("booking_id", req.params.id)
        .not("status", "in", "(Paid,Cancelled)");
      if (invSyncErr) {
        console.error("[Booking→Invoice total sync] failed:", invSyncErr.message);
      } else {
        await auditLog("update_invoice_total", "invoice", req.params.id, user?.id ?? null,
          `Invoice total re-snapped to £${newTotal} after booking ${updated.tvl_ref} price edit`);
      }
    }
  }

  // ── Amendment auto-log ──────────────────────────────────────────────────
  // Diff the patch body against the previous row and emit one
  // booking_amendments entry per changed field. Special-case rows are
  // appended below (driver_declined, double_booking_override).
  {
    const amendmentRows: any[] = [];
    const skip = new Set([
      "is_amended", "updated_at", "created_by", "operator_id",
      // Timestamps that always change as side-effects of declared changes
      "driver_accepted_at", "driver_declined_at", "completed_at",
    ]);
    for (const [k, v] of Object.entries(body)) {
      if (skip.has(k)) continue;
      const oldV = prev?.[k];
      // Normalise null/undefined for comparison
      const oldStr = stringify(oldV);
      const newStr = stringify(v);
      if (oldStr === newStr) continue;
      let changeType = classifyAmendment(k);
      let reason: string | null = null;
      if (k === "driver_id" && driverConflict && force) {
        changeType = "double_booking_override";
        reason = `Override of conflict with refs: ${driverConflict.conflicts.map((c: any) => c.tvl_ref).join(", ")}`;
      }
      amendmentRows.push({
        booking_id: req.params.id,
        field_name: AMENDMENT_FIELD_LABELS[k] ?? k,
        old_value: oldStr,
        new_value: newStr,
        change_type: changeType,
        reason,
        changed_by: user?.id ?? null,
        changed_by_name: operatorName,
      });
    }
    if (driverDeclined) {
      amendmentRows.push({
        booking_id: req.params.id,
        field_name: "Driver Acceptance",
        old_value: prev?.driver_acceptance_status ?? null,
        new_value: "Driver Declined",
        change_type: "driver_declined",
        reason: `Driver ${driverDeclined.driverName ?? ""} declined${driverDeclined.reason ? ` — ${driverDeclined.reason}` : ""}`.trim(),
        changed_by: user?.id ?? null,
        changed_by_name: operatorName,
      });
    }

    // Resolve driver_id UUIDs → human-readable driver names before persisting.
    // Collect all unique driver IDs that appear in old_value / new_value for
    // "Driver" rows, fetch them in one query, then substitute.
    const driverRows = amendmentRows.filter(r => r.field_name === "Driver");
    if (driverRows.length > 0) {
      const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const ids = new Set<string>();
      for (const r of driverRows) {
        if (r.old_value && uuidRe.test(r.old_value)) ids.add(r.old_value);
        if (r.new_value && uuidRe.test(r.new_value)) ids.add(r.new_value);
      }
      if (ids.size > 0) {
        const { data: drvNames } = await supabase
          .from("drivers")
          .select("id, name")
          .in("id", [...ids]);
        const nameMap = new Map((drvNames ?? []).map((d: any) => [d.id, d.name]));
        for (const r of driverRows) {
          if (r.old_value && nameMap.has(r.old_value)) r.old_value = nameMap.get(r.old_value);
          if (r.new_value && nameMap.has(r.new_value)) r.new_value = nameMap.get(r.new_value);
        }
      }
    }

    insertAmendments(amendmentRows).catch(() => {});
  }

  // Fire admin alert for driver-declined flow
  if (driverDeclined) {
    notifyDriverDeclined(req.params.id, driverDeclined.driverName).catch(() => {});
  }

  await auditLog("amend_booking", "booking", req.params.id, user?.id ?? null,
    `Booking ${updated.tvl_ref} amended`);

  await logActivity({
    action_type: "booking_updated",
    description: `Booking ${updated.tvl_ref ?? req.params.id} updated`,
    entity_type: "booking",
    entity_id: req.params.id,
    entity_label: updated.tvl_ref ?? null,
    operator_id: user?.id ?? null,
    operator_name: operatorName,
  });

  const enriched = await enrichBooking(updated);
  if (driverConflict) (enriched as any).driver_conflict = driverConflict;

  // ── In-app notifications for amendment / status change ──────────────────
  {
    const lbl = bookingShortLabel(enriched);

    // Status changed inline via PUT (e.g. Confirmed → Active)
    if (body.status && prev?.status && body.status !== prev.status) {
      if (updated.operator_id) {
        notifyUser(updated.operator_id, {
          type: "booking_status",
          title: "Booking Status Updated",
          message: `${lbl.ref} · ${lbl.name} → ${body.status}`,
          link: `/bookings/${req.params.id}`,
          entityType: "booking",
          entityId: req.params.id,
          severity: "info",
        }).catch(() => {});
      }
      // Fix 5 — cancellations go to admins + the booking owner only, not
      // every operator. ADMIN_ROLES + explicit notifyUser keeps the alert
      // useful without spamming the whole staff list.
      if (body.status === "Cancelled") {
        // If the driver was already settled / paid out for this booking,
        // raise a separate alert so an admin can reverse the ledger entry.
        warnIfBookingPreviouslySettled(req.params.id, updated.tvl_ref ?? null, user?.id ?? null).catch(() => {});
        const cancelMsg = `${lbl.ref} · ${lbl.name} cancelled`;
        notifyByRoles(ADMIN_ROLES, {
          type: "booking_cancelled",
          title: "Booking Cancelled",
          message: cancelMsg,
          link: `/bookings/${req.params.id}`,
          entityType: "booking",
          entityId: req.params.id,
          severity: "warning",
          dedupeKey: `booking_cancelled:${req.params.id}`,
        }).catch(() => {});
        if (updated.operator_id) {
          notifyUser(updated.operator_id, {
            type: "booking_cancelled",
            title: "Booking Cancelled",
            message: cancelMsg,
            link: `/bookings/${req.params.id}`,
            entityType: "booking",
            entityId: req.params.id,
            severity: "warning",
            dedupeKey: `booking_cancelled:${req.params.id}`,
          }).catch(() => {});
        }
        sendWebPushToAll({
          title: "Booking Cancelled",
          body:  cancelMsg,
          link:  `/bookings/${req.params.id}`,
          tag:   `cancelled-${req.params.id}`,
          requireInteraction: true,
        }).catch(() => {});
      }
    }

    // General amendment broadcast (only if it was already a confirmed booking,
    // and not just a status flip we already announced above)
    const fieldsChanged = Object.keys(body).filter(k => k !== "is_amended" && k !== "status").length;
    if (fieldsChanged > 0 && prev?.status && prev.status !== "Pending") {
      notifyByRoles(STAFF_ROLES, {
        type: "booking_amended",
        title: "Booking Amended",
        message: `${lbl.ref} · ${lbl.name} — details updated`,
        link: `/bookings/${req.params.id}`,
        entityType: "booking",
        entityId: req.params.id,
        severity: "info",
      }).catch(() => {});
    }
  }

  // On payment_status → Paid: auto-mark invoice Paid, complete booking, send receipt
  if (body.payment_status === "Paid" && prevPaymentStatus !== "Paid") {
    // Mark invoice as Paid (awaited so failures surface in the audit trail)
    const { error: invPaidErr } = await supabase
      .from("invoices")
      .update({ status: "Paid", paid_at: new Date().toISOString() })
      .eq("booking_id", req.params.id)
      .in("status", ["Generated", "Sent", "Overdue"]);
    if (invPaidErr) {
      console.error("[Booking→Invoice sync] failed:", invPaidErr.message);
    }

    // Auto-transition booking to Completed (unless already cancelled)
    if (updated.status !== "Cancelled" && updated.status !== "Completed") {
      await supabase
        .from("bookings")
        .update({ status: "Completed" })
        .eq("id", req.params.id);
      await auditLog("status_change", "booking", req.params.id, user?.id ?? null,
        `Booking ${updated.tvl_ref} auto-completed on payment`);
    }

    sendPaymentReceiptEmail(enriched, { triggeredBy: user?.id ?? null }).catch(err =>
      console.error("[Email] Receipt send error:", err?.message)
    );

    // Fix 5 — payment notifications go to admins + the booking owner. Other
    // operators don't need every cash event in their bell. Dedupe key
    // prevents double-fires if the PUT is retried.
    {
      const lbl = bookingShortLabel(enriched);
      const amt = Number(enriched?.price ?? 0);
      const payload = {
        type: "payment_paid" as const,
        title: "Payment Received",
        message: `${lbl.ref} · ${lbl.name}${amt > 0 ? ` — £${amt.toLocaleString()}` : ""}`,
        link: `/bookings/${req.params.id}`,
        entityType: "booking",
        entityId: req.params.id,
        severity: "success" as const,
        dedupeKey: `payment_paid:${req.params.id}`,
      };
      notifyByRoles(ADMIN_ROLES, payload).catch(() => {});
      if (updated.operator_id) {
        notifyUser(updated.operator_id, payload).catch(() => {});
      }
    }

    // Auto-create follow-up if this was an Arrival transfer
    autoCreateFollowUp(req.params.id, updated).catch(err =>
      console.error("[FollowUp] auto-create error:", err?.message)
    );
  }

  // On status → Confirmed via the general edit form (PUT /:id):
  // PUT /:id/status already covers the dedicated status control on the jobs
  // board / detail page, but the booking-edit form goes through this route
  // and was previously skipping the confirmation email entirely.
  if (body.status === "Confirmed" && prev?.status !== "Confirmed") {
    const invNumber = await autoGenerateInvoice(req.params.id, user?.id ?? null);
    sendConfirmationEmail(enriched, invNumber, { triggeredBy: user?.id ?? null }).catch(err =>
      console.error("[Email] Confirmation send error:", err?.message)
    );
  }

  // Manual status change to Completed → auto-create follow-up.
  // Skip if the payment-paid block above already auto-completed this booking
  // in the same request (avoids double-firing; the upsert is idempotent but
  // we'd rather not waste the round-trip).
  const completedByPaymentPath =
    body.payment_status === "Paid" && prevPaymentStatus !== "Paid";
  if (
    body.status === "Completed" &&
    prev?.status !== "Completed" &&
    !completedByPaymentPath
  ) {
    autoCreateFollowUp(req.params.id, updated).catch(err =>
      console.error("[FollowUp] auto-create error:", err?.message)
    );
  }

  // Reverse path: operator changes booking back to Unpaid (e.g. payment
  // bounced) → flip the invoice back so the two stay symmetric.
  if (
    body.payment_status &&
    body.payment_status !== "Paid" &&
    prevPaymentStatus === "Paid"
  ) {
    const { error: invUnpayErr } = await supabase
      .from("invoices")
      .update({ status: "Sent", paid_at: null })
      .eq("booking_id", req.params.id)
      .eq("status", "Paid");
    if (invUnpayErr) {
      console.error("[Booking→Invoice unpay sync] failed:", invUnpayErr.message);
    } else {
      await auditLog("status_change", "invoice", req.params.id, user?.id ?? null,
        `Invoice for ${updated.tvl_ref} reverted to Sent (booking marked ${body.payment_status})`);
    }
  }

  return res.json(enriched);
});

// ── Hard delete a booking and all its dependent rows ────────────────────────
// Super Admin only. Used to purge test bookings cleanly. Order matters:
// child rows first (no ON DELETE CASCADE on these FKs), then the booking.
// Errors on individual child tables are logged but don't abort — some rows
// may simply not exist for a given booking, and a missing optional table
// (e.g. issues in a fresh deploy) shouldn't block the purge.
router.delete("/:id", async (req, res) => {
  const user = await getUserFromToken(req.headers.authorization);
  if (!user || !["admin", "super_admin"].includes(user.role)) {
    return res.status(403).json({ error: "Only Admin or Super Admin can delete bookings" });
  }
  const id = req.params.id;

  // Snapshot the booking before deletion so the audit trail captures the
  // full record (client, dates, financials) — once it's gone we can't
  // reconstruct it. The notification + activity feed also need the ref.
  const { data: bk } = await supabase
    .from("bookings")
    .select("*")
    .eq("id", id)
    .single();
  if (!bk) return res.status(404).json({ error: "Booking not found" });

  // Clear self-referential pointers (return_booking_id) on any sibling
  await supabase.from("bookings").update({ return_booking_id: null }).eq("return_booking_id", id);

  // Delete dependents — every table that holds booking_id
  const childTables = [
    "follow_ups",
    "booking_email_log",
    "booking_products",
    "booking_amendments",
    "driver_ratings",
    "issues",
    "invoices",
    "requests",
  ];
  for (const t of childTables) {
    const { error } = await supabase.from(t).delete().eq("booking_id", id);
    if (error && !/does not exist|relation .* does not exist/i.test(error.message)) {
      console.warn(`[delete-booking] ${t} cleanup warning:`, error.message);
    }
  }

  const { error: delErr } = await supabase.from("bookings").delete().eq("id", id);
  if (delErr) return res.status(400).json({ error: delErr.message });

  // Full audit trail — captures the entire booking record + who deleted it.
  // Audit log is the immutable record (compliance/forensics); activity feed
  // is the operator-visible timeline; the in-app notification alerts other
  // staff in real time so deletions can't happen quietly.
  const summary = `Booking ${bk.tvl_ref ?? id} permanently deleted by ${user.name ?? user.email ?? user.id} (${user.role}). ` +
    `Client: ${bk.client_name ?? "—"} · Service: ${bk.service_type ?? "—"} · ` +
    `Date: ${bk.date_time ?? "—"} · Price: £${bk.price ?? 0} · Status was: ${bk.status ?? "—"}`;

  await auditLog(
    "delete_booking",
    "booking",
    id,
    user.id,
    `${summary}\n--- SNAPSHOT ---\n${JSON.stringify(bk)}`,
  );

  await logActivity({
    action_type: "booking_deleted",
    description: summary,
    entity_type: "booking",
    entity_id: id,
    entity_label: bk.tvl_ref ?? null,
    operator_id: user.id,
    operator_name: user.name ?? user.email ?? null,
  });

  // Broadcast to every staff member so deletions are visible across the team.
  // Suppressed when ?silent=1 is set — used by bulk-delete fan-out so the
  // bell doesn't spam one row per deleted booking; the client emits one
  // aggregated "N bookings deleted" notification via /api/notifications/broadcast-staff.
  if (req.query.silent !== "1") {
    notifyByRoles(STAFF_ROLES, {
      type: "booking_cancelled",
      title: "Booking Deleted",
      message: `${bk.tvl_ref ?? id} · ${bk.client_name ?? "—"} — deleted by ${user.name ?? user.email ?? "admin"}`,
      link: `/bookings`,
      entityType: "booking",
      entityId: id,
      severity: "warning",
    }).catch(() => {});
  }

  return res.json({ ok: true, id, tvl_ref: bk.tvl_ref });
});

router.post("/:id/cancel", async (req, res) => {
  const user = await getUserFromToken(req.headers.authorization);
  const { reason, cancellation_fee } = req.body;

  const { data, error } = await supabase
    .from("bookings")
    .update({ status: "Cancelled", cancellation_reason: reason, cancellation_fee: cancellation_fee ?? 0 })
    .eq("id", req.params.id)
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });

  // Auto-cancel related invoice (unless already Paid)
  void (async () => {
    await supabase
      .from("invoices")
      .update({ status: "Cancelled" })
      .eq("booking_id", req.params.id)
      .not("status", "eq", "Paid");
  })();

  await auditLog("cancel_booking", "booking", req.params.id, user?.id ?? null,
    `Booking ${data.tvl_ref} cancelled. Reason: ${reason}`);

  // Same settled-commission warning as the PUT path.
  warnIfBookingPreviouslySettled(req.params.id, data.tvl_ref ?? null, user?.id ?? null).catch(() => {});

  await logActivity({
    action_type: "booking_cancelled",
    description: `Booking ${data.tvl_ref ?? req.params.id} cancelled — ${reason}`,
    entity_type: "booking",
    entity_id: req.params.id,
    entity_label: data.tvl_ref ?? null,
    operator_id: user?.id ?? null,
    operator_name: user?.name ?? null,
  });

  const enriched = await enrichBooking(data);

  // ── In-app notification ─────────────────────────────────────────────────
  {
    const lbl = bookingShortLabel(enriched);
    notifyByRoles(STAFF_ROLES, {
      type: "booking_cancelled",
      title: "Booking Cancelled",
      message: `${lbl.ref} · ${lbl.name}${reason ? " — " + String(reason).slice(0, 80) : ""}`,
      link: `/bookings/${req.params.id}`,
      entityType: "booking",
      entityId: req.params.id,
      severity: "warning",
    }).catch(() => {});
  }

  return res.json(enriched);
});

router.post("/:id/dismiss-return-followup", async (req, res) => {
  const user = await getUserFromToken(req.headers.authorization);

  const { data: existing, error: fetchErr } = await supabase
    .from("bookings")
    .select("id, tvl_ref, notes")
    .eq("id", req.params.id)
    .single();
  if (fetchErr || !existing) return res.status(404).json({ error: "Booking not found" });

  const currentNotes = existing.notes ?? "";
  const newNotes = currentNotes.includes("[NO_RETURN]")
    ? currentNotes
    : (currentNotes.trim() ? currentNotes.trim() + "\n[NO_RETURN] Operator marked: no return trip needed." : "[NO_RETURN] Operator marked: no return trip needed.");

  const { data, error } = await supabase
    .from("bookings")
    .update({ notes: newNotes })
    .eq("id", req.params.id)
    .select()
    .single();
  if (error) return res.status(400).json({ error: error.message });

  await auditLog("dismiss_return_followup", "booking", req.params.id, user?.id ?? null,
    `Return follow-up dismissed for ${existing.tvl_ref}`);

  return res.json({ ok: true, id: data.id });
});

router.put("/:id/status", async (req, res) => {
  const user = await getUserFromToken(req.headers.authorization);
  const { status } = req.body;

  // Capture the previous status so we can act only on real transitions
  // (e.g. Active → Completed) and not on no-op resaves.
  const { data: prev } = await supabase
    .from("bookings")
    .select("status")
    .eq("id", req.params.id)
    .maybeSingle();

  const { data, error } = await supabase
    .from("bookings")
    .update({ status })
    .eq("id", req.params.id)
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });

  await auditLog("status_change", "booking", req.params.id, user?.id ?? null,
    `Booking ${data.tvl_ref} status changed to ${status}`);

  await logActivity({
    action_type: status === "Completed" ? "booking_completed" : "booking_updated",
    description: `Booking ${data.tvl_ref ?? req.params.id} → ${status}`,
    entity_type: "booking",
    entity_id: req.params.id,
    entity_label: data.tvl_ref ?? null,
    operator_id: user?.id ?? null,
    operator_name: user?.name ?? null,
  });

  const enriched = await enrichBooking(data);

  // On Confirmed: auto-generate invoice + send booking confirmation email
  if (status === "Confirmed") {
    const invNumber = await autoGenerateInvoice(req.params.id, user?.id ?? null);
    const bookingWithEmail = { ...enriched };
    sendConfirmationEmail(bookingWithEmail, invNumber, { triggeredBy: user?.id ?? null }).catch(err =>
      console.error("[Email] Confirmation send error:", err?.message)
    );
  }

  // On Completed: auto-create the arrival follow-up. Most status changes
  // come through this endpoint (the dedicated status control on the booking
  // detail / jobs board uses it), not the general PUT /:id, so without this
  // hook the operator never sees the follow-up appear.
  if (status === "Completed" && prev?.status !== "Completed") {
    autoCreateFollowUp(req.params.id, data).catch(err =>
      console.error("[FollowUp] auto-create error:", err?.message)
    );
  }

  return res.json(enriched);
});

router.post("/:id/waiting-time", async (req, res) => {
  const user = await getUserFromToken(req.headers.authorization);
  const { amount } = req.body;
  const { id } = req.params;

  const { data: existing } = await supabase.from("bookings").select("price, additional_charges, notes").eq("id", id).single();
  if (!existing) return res.status(404).json({ error: "Booking not found" });

  const newAdditional = (existing.additional_charges ?? 0) + amount;
  const note = `Waiting time charge of £${amount} added on ${new Date().toLocaleDateString()} by ${user?.name ?? "operator"}`;
  const newNotes = existing.notes ? `${existing.notes}\n${note}` : note;

  const { data, error } = await supabase
    .from("bookings")
    .update({ additional_charges: newAdditional, notes: newNotes })
    .eq("id", id)
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });

  await auditLog("add_waiting_time", "booking", id, user?.id ?? null,
    `Waiting time £${amount} added to booking ${data.tvl_ref}`);

  const enriched = await enrichBooking(data);
  return res.json(enriched);
});

router.post("/:id/return", async (req, res) => {
  const user = await getUserFromToken(req.headers.authorization);

  const { data: original, error } = await supabase
    .from("bookings")
    .select("*")
    .eq("id", req.params.id)
    .single();

  if (error || !original) return res.status(404).json({ error: "Booking not found" });

  const { data: returnBooking, error: returnError } = await supabase
    .from("bookings")
    .insert({
      client_id: original.client_id,
      service_type: original.service_type,
      direction: original.direction === "Arrival" ? "Departure" : "Arrival",
      pickup: original.dropoff,
      dropoff: original.pickup,
      passengers: original.passengers,
      luggage: original.luggage,
      vehicle_type: original.vehicle_type,
      nameboard: original.nameboard,
      return_booking_id: original.id,
      status: "Confirmed",
      price: original.price,
      operator_id: user?.id ?? null,
      created_by: user?.id ?? null,
    })
    .select()
    .single();

  if (returnError) return res.status(400).json({ error: returnError.message });

  // Link original to return
  await supabase.from("bookings").update({ return_booking_id: returnBooking.id }).eq("id", original.id);

  await auditLog("create_return_journey", "booking", returnBooking.id, user?.id ?? null,
    `Return journey ${returnBooking.tvl_ref} created from ${original.tvl_ref}`);

  // Bell notification — return-journey creation is operationally a "new
  // booking" event and was previously skipped, leaving staff blind to
  // returns spawned from follow-ups. Mirrors the main POST / flow.
  {
    const { data: enriched } = await supabase
      .from("bookings")
      .select("id, tvl_ref, service_type, date_time, clients(name)")
      .eq("id", returnBooking.id)
      .single();
    const lbl = bookingShortLabel({
      ...enriched,
      client_name: (enriched as any)?.clients?.name,
    });
    notifyByRoles(STAFF_ROLES, {
      type: "booking_new",
      title: "New Booking (Return)",
      message: `${lbl.ref} · ${lbl.name} · ${lbl.svc}${lbl.when ? " · " + lbl.when : ""}`,
      link: `/bookings/${returnBooking.id}`,
      entityType: "booking",
      entityId: returnBooking.id,
      severity: "info",
    }).catch(() => {});
    if (returnBooking.operator_id && returnBooking.operator_id !== user?.id) {
      notifyUser(returnBooking.operator_id, {
        type: "job_assigned",
        title: "New Job Assigned to You",
        message: `${lbl.ref} · ${lbl.name}${lbl.when ? " · " + lbl.when : ""}`,
        link: `/bookings/${returnBooking.id}`,
        entityType: "booking",
        entityId: returnBooking.id,
        severity: "info",
      }).catch(() => {});
    }
  }

  return res.status(201).json(returnBooking);
});

// ─── Email log + manual send / retry endpoints ─────────────────────────────

// GET /api/bookings/:id/email-log
// Returns recent email attempts (newest first) so the UI can render the
// status badge and audit trail. Public to any authenticated session.
router.get("/:id/email-log", async (req, res) => {
  const user = await getUserFromToken(req.headers.authorization);
  if (!user) return res.status(401).json({ error: "Unauthorised" });

  const { data, error } = await supabase
    .from("booking_email_log")
    .select("id, kind, status, to_email, error, trigger_source, created_at")
    .eq("booking_id", req.params.id)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    // Table missing → return empty list so the badge falls back to "Not Sent"
    if (/relation .* does not exist|undefined table/i.test(error.message)) {
      return res.json({ entries: [], schema_missing: true });
    }
    return res.status(500).json({ error: error.message });
  }

  return res.json({ entries: data ?? [] });
});

// POST /api/bookings/:id/send-invoice-email
// Manual trigger from the invoice / booking detail screen. Always force=true
// so the operator can resend even after a previous successful delivery.
router.post("/:id/send-invoice-email", async (req, res) => {
  const user = await getUserFromToken(req.headers.authorization);
  if (!user) return res.status(401).json({ error: "Unauthorised" });

  const { data: booking, error } = await supabase
    .from("bookings")
    .select("*")
    .eq("id", req.params.id)
    .single();
  if (error || !booking) return res.status(404).json({ error: "Booking not found" });

  const enriched = await enrichBooking(booking);
  if (!enriched.client_email) {
    return res.status(400).json({
      error: "No email on file for this client. Add one on the client profile, then try again.",
    });
  }

  // If the booking is already Paid, send the receipt (with PDF attachment).
  // Otherwise send the booking confirmation.
  const kind = booking.payment_status === "Paid" ? "payment_receipt" : "booking_confirmation";
  const result =
    kind === "payment_receipt"
      ? await sendPaymentReceiptEmail(enriched, {
          triggeredBy: user.id,
          triggerSource: "manual",
          force: true,
        })
      : await sendConfirmationEmail(enriched, null, {
          triggeredBy: user.id,
          triggerSource: "manual",
          force: true,
        });

  if (!result.sent) {
    return res.status(502).json({
      error: result.reason ?? "Email send failed",
      kind,
    });
  }
  return res.json({ ok: true, kind, sent_to: enriched.client_email });
});

// POST /api/bookings/:id/send-test-email
// Operator-only diagnostic. Sends the same booking email (confirmation or
// receipt, picked by payment_status) to an OVERRIDE address — never to the
// client on file — and force=true so de-dup doesn't suppress it. Result and
// log row prove the SMTP path works end-to-end.
router.post("/:id/send-test-email", async (req, res) => {
  const user = await getUserFromToken(req.headers.authorization);
  if (!user) return res.status(401).json({ error: "Unauthorised" });
  // Restrict to admin tier — anyone else could spam arbitrary inboxes.
  if (!["super_admin", "admin", "operator"].includes((user as any).role)) {
    return res.status(403).json({ error: "Admin / operator only" });
  }
  const to = String(req.body?.to ?? "").trim();
  if (!to.includes("@")) return res.status(400).json({ error: "Provide a valid 'to' email in the body." });

  const { data: booking, error } = await supabase
    .from("bookings")
    .select("*")
    .eq("id", req.params.id)
    .single();
  if (error || !booking) return res.status(404).json({ error: "Booking not found" });

  const enriched = await enrichBooking(booking);
  // Deliberately swap the recipient to the test address.
  const overrideBooking = { ...enriched, client_email: to };
  const kind: EmailKind = booking.payment_status === "Paid" ? "payment_receipt" : "booking_confirmation";

  const result =
    kind === "payment_receipt"
      ? await sendPaymentReceiptEmail(overrideBooking, {
          triggeredBy: user.id,
          triggerSource: "manual",
          force: true,
        })
      : await sendConfirmationEmail(overrideBooking, null, {
          triggeredBy: user.id,
          triggerSource: "manual",
          force: true,
        });

  if (!result.sent) {
    return res.status(502).json({
      ok: false,
      kind,
      sent_to: to,
      reason: result.reason ?? "Email send failed",
    });
  }
  return res.json({ ok: true, kind, sent_to: to });
});

// POST /api/bookings/:id/resend-email
// Retry the most-recent failed attempt (any kind). If the last attempt was
// 'sent' or 'skipped_no_email', this is a no-op with an explanatory error.
router.post("/:id/resend-email", async (req, res) => {
  const user = await getUserFromToken(req.headers.authorization);
  if (!user) return res.status(401).json({ error: "Unauthorised" });

  const { data: lastAttempt, error: logErr } = await supabase
    .from("booking_email_log")
    .select("kind, status")
    .eq("booking_id", req.params.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (logErr) return res.status(500).json({ error: logErr.message });
  if (!lastAttempt) {
    return res.status(400).json({ error: "No previous email attempt to retry. Use Send Invoice instead." });
  }
  if (lastAttempt.status !== "failed") {
    return res.status(400).json({
      error: `Last attempt was '${lastAttempt.status}', not 'failed'. Nothing to retry.`,
    });
  }

  const { data: booking, error } = await supabase
    .from("bookings")
    .select("*")
    .eq("id", req.params.id)
    .single();
  if (error || !booking) return res.status(404).json({ error: "Booking not found" });

  const enriched = await enrichBooking(booking);
  const kind = lastAttempt.kind as EmailKind;
  let result: { sent: boolean; reason?: string };
  if (kind === "payment_receipt") {
    result = await sendPaymentReceiptEmail(enriched, {
      triggeredBy: user.id,
      triggerSource: "manual",
      force: true,
    });
  } else {
    result = await sendConfirmationEmail(enriched, null, {
      triggeredBy: user.id,
      triggerSource: "manual",
      force: true,
    });
  }

  if (!result.sent) return res.status(502).json({ error: result.reason ?? "Email send failed", kind });
  return res.json({ ok: true, kind, sent_to: enriched.client_email });
});

export default router;
