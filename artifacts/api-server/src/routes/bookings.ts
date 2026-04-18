import { Router } from "express";
import { supabase, auditLog, getUserFromToken } from "../lib/supabase";

const router = Router();

async function enrichBooking(booking: any) {
  const [{ data: client }, { data: driver }, { data: operator }] = await Promise.all([
    supabase.from("clients").select("name, vip_tier").eq("id", booking.client_id).single(),
    supabase.from("drivers").select("name, vehicle_type, vehicle_model").eq("id", booking.driver_id).single(),
    supabase.from("users").select("name").eq("id", booking.operator_id).single(),
  ]);

  return {
    ...booking,
    client_name: client?.name ?? null,
    client_vip_tier: client?.vip_tier ?? null,
    driver_name: driver?.name ?? null,
    driver_vehicle: driver ? `${driver.vehicle_type} ${driver.vehicle_model ?? ""}`.trim() : null,
    operator_name: operator?.name ?? null,
  };
}

router.get("/", async (req, res) => {
  const { status, service_type, date_from, date_to, driver_id, operator_id, payment_status } = req.query;

  let query = supabase
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

router.post("/", async (req, res) => {
  const user = await getUserFromToken(req.headers.authorization);
  const body = {
    ...req.body,
    operator_id: req.body.operator_id ?? user?.id ?? null,
    created_by: user?.id ?? null,
  };

  const { data, error } = await supabase
    .from("bookings")
    .insert(body)
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });

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
  const { data: booking, error } = await supabase
    .from("bookings")
    .select("*, clients(name, vip_tier, whatsapp), drivers(name, vehicle_type, vehicle_model, whatsapp), users!bookings_operator_id_fkey(name)")
    .eq("id", req.params.id)
    .single();

  if (error || !booking) return res.status(404).json({ error: "Booking not found" });

  const { data: auditEntries } = await supabase
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
  const body = { ...req.body, is_amended: true };

  const { data, error } = await supabase
    .from("bookings")
    .update(body)
    .eq("id", req.params.id)
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });

  // If driver assigned, update status
  if (body.driver_id && data.status === "Confirmed") {
    await supabase.from("bookings").update({ status: "Driver Assigned" }).eq("id", req.params.id);
  }

  await auditLog("amend_booking", "booking", req.params.id, user?.id ?? null,
    `Booking ${data.tvl_ref} amended`);

  const enriched = await enrichBooking(data);
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
