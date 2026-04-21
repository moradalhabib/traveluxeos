import { Router } from "express";
import { supabase, auditLog, getUserFromToken, getDbClient } from "../lib/supabase";
import { sendEmail } from "../services/email";
import { notifyDriverAssigned } from "../services/scheduler";
import { notifyByRoles, notifyUser, STAFF_ROLES } from "../services/notify";

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

const router = Router();

// ─── Auto-create follow-up for Arrival Airport Transfers ─────────────────────
// Race-safe in two layers:
//  1) Pre-check via SELECT covers the common case (no extra row).
//  2) The partial unique index on follow_ups(booking_id) added in
//     migration-followup-unique.sql will reject any racing duplicate insert
//     with a "duplicate key" error, which we swallow.
async function autoCreateFollowUp(bookingId: string, booking: any) {
  if (booking.service_type !== "Airport Transfer" || booking.direction !== "Arrival") return;
  const { data: existing } = await supabase
    .from("follow_ups")
    .select("id")
    .eq("booking_id", bookingId)
    .maybeSingle();
  if (existing) return;
  const base = booking.date_time ? new Date(booking.date_time) : new Date();
  const due = new Date(base);
  due.setDate(due.getDate() + 3);
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

async function fetchDriverSafely(driverId: string | null) {
  if (!driverId) return null;
  // Try with staff_no first (post-migration). Fall back without it if column is missing.
  const withStaff = await supabase
    .from("drivers")
    .select("name, staff_no, vehicle_type, vehicle_model")
    .eq("id", driverId)
    .single();
  if (!withStaff.error) return withStaff.data;
  const fallback = await supabase
    .from("drivers")
    .select("name, vehicle_type, vehicle_model")
    .eq("id", driverId)
    .single();
  if (fallback.error) return null;
  return { ...fallback.data, staff_no: null };
}

async function enrichBooking(booking: any) {
  const [{ data: client }, driver, { data: operator }] = await Promise.all([
    supabase.from("clients").select("name, vip_tier, email").eq("id", booking.client_id).single(),
    fetchDriverSafely(booking.driver_id),
    supabase.from("users").select("name").eq("id", booking.operator_id).single(),
  ]);

  return {
    ...booking,
    client_name: client?.name ?? null,
    client_vip_tier: client?.vip_tier ?? null,
    client_email: client?.email ?? null,
    driver_name: driver?.name ?? null,
    driver_staff_no: driver?.staff_no ?? null,
    driver_vehicle: driver ? `${driver.vehicle_type} ${driver.vehicle_model ?? ""}`.trim() : null,
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

async function sendConfirmationEmail(booking: any, invoiceNumber: string | null) {
  const email = booking.client_email;
  if (!email) {
    console.warn(`[Email] No email for client on booking ${booking.tvl_ref} — skipping`);
    return;
  }
  await sendEmail({
    to: email,
    subject: `Booking Confirmed — ${booking.tvl_ref ?? ""} — ${booking.service_type}`,
    html: bookingConfirmationHtml(booking, invoiceNumber ?? undefined),
    account: "invoice",
  });
}

async function sendPaymentReceiptEmail(booking: any) {
  const email = booking.client_email;
  if (!email) {
    console.warn(`[Email] No email for client on booking ${booking.tvl_ref} — skipping receipt`);
    return;
  }
  const { data: inv } = await supabase.from("invoices").select("invoice_number").eq("booking_id", booking.id).single();
  await sendEmail({
    to: email,
    subject: `Payment Confirmed — ${booking.tvl_ref ?? ""} — Thank You`,
    html: paymentReceiptHtml(booking, inv?.invoice_number ?? undefined),
    account: "invoice",
  });
}

router.get("/", async (req, res) => {
  const { status, service_type, date_from, date_to, driver_id, operator_id, payment_status, imported } = req.query;
  const db = getDbClient(req.headers.authorization);

  let query = db
    .from("bookings")
    .select("*, clients(name, vip_tier), drivers(name, vehicle_type, vehicle_model), users!bookings_operator_id_fkey(name)")
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

  const result = (data ?? []).map((b: any) => ({
    ...b,
    client_name: b.clients?.name ?? null,
    client_vip_tier: b.clients?.vip_tier ?? null,
    driver_name: b.drivers?.name ?? null,
    driver_vehicle: b.drivers ? `${b.drivers.vehicle_type} ${b.drivers.vehicle_model ?? ""}`.trim() : null,
    operator_name: b.users?.name ?? null,
    clients: undefined,
    drivers: undefined,
    users: undefined,
  }));

  return res.json(result);
});

// Exhaustive whitelist of every column in the bookings table
const BOOKING_COLUMNS = new Set([
  "client_id","service_type","direction","pickup","dropoff",
  "destination","flight_number","date_time","passengers","luggage",
  "vehicle_type","nameboard","special_requests","additional_charges",
  "price","tvl_commission","commission_type","payment_status",
  "payment_method","commission_status","payout_status","source","status",
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
  "vehicle_product_id","tour_product_id","meet_greet_product_id",
  // Build 4: supplier link + car-rental cost breakdown + notification timestamps
  "supplier_id","supplier_product_id","supplier_commission",
  "base_daily_rate","rental_days","fuel_cost","driver_cost","extra_charges",
  "as_directed_supplier_driver",
  "client_notified_at","driver_notified_at",
  // Payment-tracking (April 2026 migration B)
  "payment_date","paid_amount","payment_notes",
]);

router.post("/", async (req, res) => {
  const user = await getUserFromToken(req.headers.authorization);
  // Use the user's JWT so RLS sees an authenticated request
  const db = getDbClient(req.headers.authorization);

  // Strip any field not in the bookings table to prevent PostgREST 400s
  const raw: Record<string, any> = {};
  for (const [k, v] of Object.entries(req.body)) {
    if (BOOKING_COLUMNS.has(k) && v !== "" && v !== undefined) raw[k] = v;
  }

  const body: Record<string, any> = {
    ...raw,
    operator_id: raw.operator_id ?? user?.id ?? null,
    created_by: user?.id ?? null,
  };

  // Coerce numeric fields so strings like "150" don't cause type errors
  for (const f of ["price","tvl_commission","additional_charges","passengers","luggage","duration","commission_amount","num_nights","num_guests","nights","hours","supplier_cost","client_price","base_daily_rate","rental_days","fuel_cost","driver_cost"]) {
    if (body[f] !== undefined && body[f] !== null) {
      const n = Number(body[f]);
      body[f] = isNaN(n) ? null : n;
    }
  }

  // Ensure required defaults
  if (!body.price && body.price !== 0) body.price = 0;
  if (!body.status) body.status = "Confirmed";
  if (!body.payment_status) body.payment_status = "Unpaid";

  // Supplier-product integrity:
  //  - Only meaningful for Car Rental / As Directed; clear otherwise.
  //  - Must belong to the chosen supplier — reject mismatches.
  if (body.supplier_product_id) {
    const svc = body.service_type;
    const usesSupplierProduct = svc === "Car Rental" || svc === "As Directed";
    if (!usesSupplierProduct) {
      body.supplier_product_id = null;
    } else {
      const { data: prod } = await db
        .from("supplier_products")
        .select("id, supplier_id")
        .eq("id", body.supplier_product_id)
        .maybeSingle();
      if (!prod) {
        return res.status(400).json({ error: "Supplier product not found." });
      }
      if (!body.supplier_id || prod.supplier_id !== body.supplier_id) {
        return res.status(400).json({
          error: "Selected product does not belong to the chosen supplier.",
        });
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

  // Notify driver if one was provided at creation time
  if (body.driver_id) {
    notifyDriverAssigned(data.id).catch(() => {});
  }

  await auditLog("create_booking", "booking", data.id, user?.id ?? null,
    `Created booking ${data.tvl_ref} for service: ${data.service_type}`);

  const enriched = await enrichBooking(data);

  // ── In-app notifications ────────────────────────────────────────────────
  {
    const lbl = bookingShortLabel(enriched);
    // Broadcast new-booking alert to all staff
    notifyByRoles(STAFF_ROLES, {
      type: "booking_new",
      title: "New Booking",
      message: `${lbl.ref} · ${lbl.name} · ${lbl.svc}${lbl.when ? " · " + lbl.when : ""}`,
      link: `/bookings/${data.id}`,
      entityType: "booking",
      entityId: data.id,
      severity: "info",
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

  // Auto-generate invoice for confirmed bookings on creation
  if (data.status === "Confirmed") {
    await autoGenerateInvoice(data.id, user?.id ?? null);
  }

  return res.status(201).json(enriched);
});

router.get("/:id", async (req, res) => {
  const db = getDbClient(req.headers.authorization);
  const { data: booking, error } = await db
    .from("bookings")
    .select("*, clients(name, vip_tier, whatsapp), drivers(name, vehicle_type, vehicle_model, whatsapp), users!bookings_operator_id_fkey(name)")
    .eq("id", req.params.id)
    .single();

  if (error || !booking) return res.status(404).json({ error: "Booking not found" });

  const { data: auditEntries } = await db
    .from("audit_log")
    .select("*, users(name)")
    .eq("entity_id", req.params.id)
    .order("created_at", { ascending: false });

  const { data: invoice } = await supabase
    .from("invoices")
    .select("*")
    .eq("booking_id", req.params.id)
    .single();

  // Get flight status if applicable
  let flightStatus = null;
  if (booking.flight_number && booking.service_type === "Airport Transfer" && booking.direction === "Arrival") {
    const flightDate = booking.date_time ? new Date(booking.date_time).toISOString().split("T")[0] : null;
    if (flightDate) {
      const { data: cachedFlight } = await supabase
        .from("flight_status_cache")
        .select("*")
        .eq("flight_number", booking.flight_number)
        .eq("date", flightDate)
        .single();
      flightStatus = cachedFlight;
    }
  }

  const enrichedAudit = (auditEntries ?? []).map((a: any) => ({
    ...a,
    operator_name: a.users?.name ?? null,
    users: undefined,
  }));

  return res.json({
    ...booking,
    client_name: booking.clients?.name ?? null,
    client_vip_tier: booking.clients?.vip_tier ?? null,
    client_whatsapp: booking.clients?.whatsapp ?? null,
    driver_name: booking.drivers?.name ?? null,
    driver_vehicle: booking.drivers ? `${booking.drivers.vehicle_type} ${booking.drivers.vehicle_model ?? ""}`.trim() : null,
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

  // Capture previous payment_status before update
  const { data: prev } = await db.from("bookings").select("payment_status, status, driver_id, date_time, duration").eq("id", req.params.id).single();
  const prevPaymentStatus = prev?.payment_status;

  // ── Driver-conflict pre-check (non-blocking warning) ────────────────────
  // When the operator assigns/changes the driver, look for any other live
  // booking for the same driver whose pickup window overlaps this one's.
  // Operators sometimes deliberately stack short jobs, so we warn rather
  // than block. The frontend surfaces this as a toast.
  let driverConflict: any = null;
  const incomingDriverId = req.body.driver_id;
  if (incomingDriverId && incomingDriverId !== prev?.driver_id) {
    const targetIso = req.body.date_time ?? prev?.date_time;
    const targetDuration = Number(req.body.duration ?? prev?.duration ?? 90);
    if (targetIso) {
      const target = new Date(targetIso);
      // Window = pickup ± 90min OR explicit duration, whichever is larger
      const buffer = Math.max(targetDuration, 90) * 60_000;
      const winStart = new Date(target.getTime() - buffer).toISOString();
      const winEnd = new Date(target.getTime() + buffer).toISOString();
      const { data: clashes } = await db
        .from("bookings")
        .select("id, tvl_ref, date_time, pickup, dropoff, status")
        .eq("driver_id", incomingDriverId)
        .neq("id", req.params.id)
        .neq("status", "Cancelled")
        .neq("status", "Completed")
        .gte("date_time", winStart)
        .lte("date_time", winEnd);
      if (clashes && clashes.length > 0) {
        driverConflict = {
          conflicts: clashes,
          message: `Driver already has ${clashes.length} job${clashes.length === 1 ? "" : "s"} within 90 min of this pickup.`,
        };
      }
    }
  }

  // Apply same whitelist as POST to avoid unknown-column errors on update
  const raw: Record<string, any> = {};
  for (const [k, v] of Object.entries(req.body)) {
    if (BOOKING_COLUMNS.has(k) && v !== "" && v !== undefined) raw[k] = v;
  }
  for (const f of ["price","tvl_commission","additional_charges","passengers","luggage","duration","commission_amount","num_nights","num_guests","nights","hours","supplier_cost","client_price","base_daily_rate","rental_days","fuel_cost","driver_cost"]) {
    if (raw[f] !== undefined && raw[f] !== null) {
      const n = Number(raw[f]);
      raw[f] = isNaN(n) ? null : n;
    }
  }
  const body: Record<string, any> = { ...raw, is_amended: true };

  // Supplier-product integrity (same rules as POST). Use the effective
  // supplier_id (incoming change OR previously-saved value).
  if (body.supplier_product_id) {
    const svc = body.service_type ?? (prev as any)?.service_type;
    const usesSupplierProduct = svc === "Car Rental" || svc === "As Directed";
    if (!usesSupplierProduct) {
      body.supplier_product_id = null;
    } else {
      const effectiveSupplierId =
        body.supplier_id ??
        (await db.from("bookings").select("supplier_id").eq("id", req.params.id).single()).data?.supplier_id;
      const { data: prod } = await db
        .from("supplier_products")
        .select("id, supplier_id")
        .eq("id", body.supplier_product_id)
        .maybeSingle();
      if (!prod) {
        return res.status(400).json({ error: "Supplier product not found." });
      }
      if (!effectiveSupplierId || prod.supplier_id !== effectiveSupplierId) {
        return res.status(400).json({
          error: "Selected product does not belong to the chosen supplier.",
        });
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

  // If driver assigned, update status
  // Notify driver if a new driver was just assigned via PUT
  if (body.driver_id && body.driver_id !== prev?.driver_id) {
    notifyDriverAssigned(req.params.id).catch(() => {});
  }

  await auditLog("amend_booking", "booking", req.params.id, user?.id ?? null,
    `Booking ${updated.tvl_ref} amended`);

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

    sendPaymentReceiptEmail(enriched).catch(err =>
      console.error("[Email] Receipt send error:", err?.message)
    );

    // Auto-create follow-up if this was an Arrival transfer
    autoCreateFollowUp(req.params.id, updated).catch(err =>
      console.error("[FollowUp] auto-create error:", err?.message)
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

  const enriched = await enrichBooking(data);

  // On Confirmed: auto-generate invoice + send booking confirmation email
  if (status === "Confirmed") {
    const invNumber = await autoGenerateInvoice(req.params.id, user?.id ?? null);
    const bookingWithEmail = { ...enriched };
    sendConfirmationEmail(bookingWithEmail, invNumber).catch(err =>
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

  return res.status(201).json(returnBooking);
});

export default router;
