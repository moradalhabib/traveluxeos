import { Router } from "express";
import { supabase } from "../lib/supabase";

const router = Router();

router.get("/", async (req, res) => {
  const q = String(req.query.q ?? "").toLowerCase().trim();

  if (!q || q.length < 2) {
    return res.json({ clients: [], bookings: [], drivers: [] });
  }

  const [
    { data: allClients },
    { data: allBookings },
    { data: allDrivers },
  ] = await Promise.all([
    supabase.from("clients").select("id, name, whatsapp, email, vip_tier, nationality, inactive").is("merged_into", null),
    supabase.from("bookings").select("id, tvl_ref, service_type, status, pickup, dropoff, flight_number, date_time, price, client_id, clients(name, vip_tier)").limit(1000),
    supabase.from("drivers").select("id, name, staff_no, whatsapp, vehicle_type, vehicle_model, plate, status, avg_rating:driver_ratings(rating)"),
  ]);

  const clients = (allClients ?? []).filter(c =>
    c.name?.toLowerCase().includes(q) ||
    c.whatsapp?.toLowerCase().includes(q) ||
    c.email?.toLowerCase().includes(q) ||
    c.nationality?.toLowerCase().includes(q)
  ).slice(0, 10);

  const bookings = (allBookings ?? []).filter((b: any) =>
    b.tvl_ref?.toLowerCase().includes(q) ||
    b.flight_number?.toLowerCase().includes(q) ||
    b.pickup?.toLowerCase().includes(q) ||
    b.dropoff?.toLowerCase().includes(q) ||
    b.clients?.name?.toLowerCase().includes(q)
  ).slice(0, 10).map((b: any) => ({
    ...b,
    client_name: b.clients?.name ?? null,
    client_vip_tier: b.clients?.vip_tier ?? null,
    clients: undefined,
  }));

  // Normalise the query so "TVL01", "tvl 01", "tvl-01" all match "TVL 01"
  const qNorm = q.replace(/[\s\-]/g, "");
  const drivers = (allDrivers ?? []).filter((d: any) =>
    d.name?.toLowerCase().includes(q) ||
    d.staff_no?.toLowerCase().includes(q) ||
    (d.staff_no && d.staff_no.toLowerCase().replace(/[\s\-]/g, "").includes(qNorm)) ||
    d.whatsapp?.toLowerCase().includes(q) ||
    d.vehicle_model?.toLowerCase().includes(q) ||
    d.plate?.toLowerCase().includes(q)
  ).slice(0, 10).map((d: any) => {
    const ratings = d.avg_rating ?? [];
    const avg = ratings.length > 0 ? ratings.reduce((s: number, r: any) => s + r.rating, 0) / ratings.length : 0;
    return { ...d, avg_rating: Math.round(avg * 10) / 10, total_jobs: 0 };
  });

  return res.json({ clients, bookings, drivers });
});

export default router;
