import { Router } from "express";
import { supabase, auditLog, getUserFromToken, getDbClient } from "../lib/supabase";
import { sendEmail } from "../services/email";
import { bookingConfirmationHtml, paymentReceiptHtml } from "../templates/emailTemplates";

const router = Router();

async function enrichBooking(booking: any) {
  const [{ data: client }, { data: driver }, { data: operator }] = await Promise.all([
    supabase.from("clients").select("name, vip_tier, email").eq("id", booking.client_id).single(),
    supabase.from("drivers").select("name, vehicle_type, vehicle_model").eq("id", booking.driver_id).single(),
    supabase.from("users").select("name").eq("id", booking.operator_id).single(),
  ]);

  return {
    ...booking,
    client_name: client?.name ?? null,
    client_vip_tier: client?.vip_tier ?? null,
    client_email: client?.email ?? null,
    driver_name: driver?.name ?? null,
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
  });
}

router.get("/", async (req, res) => {
  const { status, service_type, date_from, date_to, driver_id, operator_id, payment_status } = req.query;
  const db = getDbClient(req.headers.authorization);

  let query = db
    .from("bookings")
    .select("*, clients(name, vip_tier), drivers(name, vehicle_type, vehicle_model), users!bookings_operator_id_fkey(name)")
    .order("date_time", { ascending: true });

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
  "client_id","quote_id","service_type","direction","pickup","dropoff",
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
  for (const f of ["price","tvl_commission","additional_charges","passengers","luggage","duration","commission_amount","num_nights","num_guests","nights"]) {
    if (body[f] !== undefined && body[f] !== null) {
      const n = Number(body[f]);
      body[f] = isNaN(n) ? null : n;
    }
  }

  // Ensure required defaults
  if (!body.price && body.price !== 0) body.price = 0;
  if (!body.status) body.status = "Confirmed";
  if (!body.payment_status) body.payment_status = "Unpaid";

  const { data, error } = await db
    .from("bookings")
    .insert(body)
    .select()
    .single();

  if (error) {
    console.error("[POST /bookings] Supabase error:", error.message, "| body keys:", Object.keys(body).join(", "));
    return res.status(400).json({ error: error.message });
  }

  // Update driver assigned status if driver provided
  if (body.driver_id) {
    await supabase.from("bookings").update({ status: "Driver Assigned" }).eq("id", data.id).eq("status", "Confirmed");
  }

  await auditLog("create_booking", "booking", data.id, user?.id ?? null,
    `Created booking ${data.tvl_ref} for service: ${data.service_type}`);

  const enriched = await enrichBooking(data);
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
  const { data: prev } = await db.from("bookings").select("payment_status, status").eq("id", req.params.id).single();
  const prevPaymentStatus = prev?.payment_status;

  // Apply same whitelist as POST to avoid unknown-column errors on update
  const raw: Record<string, any> = {};
  for (const [k, v] of Object.entries(req.body)) {
    if (BOOKING_COLUMNS.has(k) && v !== "" && v !== undefined) raw[k] = v;
  }
  for (const f of ["price","tvl_commission","additional_charges","passengers","luggage","duration","commission_amount","num_nights","num_guests","nights"]) {
    if (raw[f] !== undefined && raw[f] !== null) {
      const n = Number(raw[f]);
      raw[f] = isNaN(n) ? null : n;
    }
  }
  const body = { ...raw, is_amended: true };

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

  // If driver assigned, update status
  if (body.driver_id && data.status === "Confirmed") {
    await supabase.from("bookings").update({ status: "Driver Assigned" }).eq("id", req.params.id);
  }

  await auditLog("amend_booking", "booking", req.params.id, user?.id ?? null,
    `Booking ${data.tvl_ref} amended`);

  const enriched = await enrichBooking(data);

  // On payment_status → Paid: auto-mark related invoice Paid + send receipt email
  if (body.payment_status === "Paid" && prevPaymentStatus !== "Paid") {
    // Auto-sync invoice status
    void (async () => {
      await supabase
        .from("invoices")
        .update({ status: "Paid", paid_at: new Date().toISOString() })
        .eq("booking_id", req.params.id)
        .in("status", ["Generated", "Sent", "Overdue"]);
    })();

    sendPaymentReceiptEmail(enriched).catch(err =>
      console.error("[Email] Receipt send error:", err?.message)
    );
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
  return res.json(enriched);
});

router.put("/:id/status", async (req, res) => {
  const user = await getUserFromToken(req.headers.authorization);
  const { status } = req.body;

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
