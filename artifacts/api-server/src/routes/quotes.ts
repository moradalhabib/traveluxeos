import { Router } from "express";
import { supabase, auditLog, getUserFromToken } from "../lib/supabase";

const router = Router();

router.get("/", async (req, res) => {
  const { status, client_id } = req.query;
  let query = supabase
    .from("quotes")
    .select("*, clients(name)")
    .order("created_at", { ascending: false });

  if (status) query = query.eq("status", String(status));
  if (client_id) query = query.eq("client_id", String(client_id));

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  const quotes = (data ?? []).map((q: any) => ({
    ...q,
    client_name: q.clients?.name ?? q.client_name,
    clients: undefined,
  }));

  // Auto-expire quotes older than 48 hours
  const expiredIds = quotes
    .filter((q: any) => q.status === "Pending" || q.status === "Sent")
    .filter((q: any) => {
      const created = new Date(q.created_at);
      const diff = Date.now() - created.getTime();
      return diff > 48 * 60 * 60 * 1000;
    })
    .map((q: any) => q.id);

  if (expiredIds.length > 0) {
    await supabase.from("quotes").update({ status: "Expired" }).in("id", expiredIds);
    quotes.forEach((q: any) => {
      if (expiredIds.includes(q.id)) q.status = "Expired";
    });
  }

  return res.json(quotes);
});

router.post("/", async (req, res) => {
  const user = await getUserFromToken(req.headers.authorization);
  const { data, error } = await supabase
    .from("quotes")
    .insert({ ...req.body, created_by: user?.id ?? null })
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  await auditLog("create_quote", "quote", data.id, user?.id ?? null, `Created quote for ${data.client_name ?? "client"}`);
  return res.status(201).json(data);
});

router.get("/:id", async (req, res) => {
  const { data, error } = await supabase
    .from("quotes")
    .select("*, clients(name, whatsapp)")
    .eq("id", req.params.id)
    .single();

  if (error || !data) return res.status(404).json({ error: "Quote not found" });
  return res.json({ ...data, client_name: data.clients?.name ?? data.client_name, clients: undefined });
});

router.put("/:id", async (req, res) => {
  const user = await getUserFromToken(req.headers.authorization);
  const { data, error } = await supabase
    .from("quotes")
    .update(req.body)
    .eq("id", req.params.id)
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  await auditLog("update_quote", "quote", req.params.id, user?.id ?? null, "Quote updated");
  return res.json(data);
});

// Convert quote to booking
router.post("/:id/convert", async (req, res) => {
  const user = await getUserFromToken(req.headers.authorization);
  const { data: quote, error } = await supabase
    .from("quotes")
    .select("*, clients(name, whatsapp)")
    .eq("id", req.params.id)
    .single();

  if (error || !quote) return res.status(404).json({ error: "Quote not found" });

  // Create booking from quote
  const { data: booking, error: bookingError } = await supabase
    .from("bookings")
    .insert({
      client_id: quote.client_id,
      quote_id: quote.id,
      service_type: quote.service_type,
      direction: quote.direction,
      pickup: quote.pickup,
      dropoff: quote.dropoff,
      destination: quote.destination,
      date_time: quote.date_time,
      passengers: quote.passengers,
      vehicle_type: quote.vehicle_type,
      duration: quote.duration,
      price: quote.price,
      status: "Confirmed",
      operator_id: user?.id ?? null,
      created_by: user?.id ?? null,
    })
    .select()
    .single();

  if (bookingError) return res.status(400).json({ error: bookingError.message });

  // Update quote status
  await supabase.from("quotes").update({ status: "Accepted" }).eq("id", quote.id);

  // If client doesn't exist, register them
  if (!quote.client_id && quote.client_name) {
    await auditLog("convert_quote", "booking", booking.id, user?.id ?? null,
      `Quote ${quote.id} converted to booking ${booking.tvl_ref}`);
  }

  await auditLog("convert_quote", "booking", booking.id, user?.id ?? null,
    `Quote ${quote.id} converted to booking ${booking.tvl_ref}`);

  return res.status(201).json(booking);
});

export default router;
