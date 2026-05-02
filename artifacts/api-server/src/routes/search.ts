import { Router } from "express";
import { supabase } from "../lib/supabase";

const router = Router();

// Global search endpoint backing two surfaces:
//   1. The dedicated /search page (default `limit` of 10, three groups consumed).
//   2. The Cmd/Ctrl+K command palette (passes ?limit=5, four groups consumed).
//
// Auth: this route inherits the per-request user JWT via authStorage in
// ../lib/supabase, so every query runs under the operator's RLS policies —
// never the service role.
router.get("/", async (req, res) => {
  const q = String(req.query.q ?? "").toLowerCase().trim();

  // Clamp the per-group limit. Default is 5 (palette-friendly); /search page
  // explicitly passes 10 to preserve its grid layout.
  const rawLimit = Number(req.query.limit);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(20, Math.max(1, Math.trunc(rawLimit)))
    : 5;

  const empty = { clients: [], bookings: [], drivers: [], suppliers: [] };
  if (!q || q.length < 2) {
    return res.json(empty);
  }

  // PostgREST .or() needs commas escaped inside the value, but our search
  // input strips punctuation already; still, guard against a malicious comma.
  const safe = q.replace(/[,()]/g, " ").trim();
  if (!safe) return res.json(empty);
  const ilike = `%${safe}%`;

  const [
    clientsRes,
    bookingsAllRes,
    driversRes,
    suppliersRes,
  ] = await Promise.all([
    // Clients — server-side ilike + limit. Excludes merged duplicates.
    supabase
      .from("clients")
      .select("id, name, whatsapp, email, vip_tier, nationality, inactive")
      .is("merged_into", null)
      .or(`name.ilike.${ilike},whatsapp.ilike.${ilike},email.ilike.${ilike}`)
      .limit(limit),

    // Bookings — direct-field ilike on the bookings row. Joined client-name
    // matches are handled by a second pass below because PostgREST can't
    // OR a parent column with a foreign-table column in one query. We cap
    // the prefetch tightly because most ref/flight-number lookups will
    // resolve via this query alone.
    supabase
      .from("bookings")
      .select(
        "id, tvl_ref, service_type, status, pickup, dropoff, flight_number, date_time, price, client_id, clients(name, vip_tier)"
      )
      .or(
        `tvl_ref.ilike.${ilike},flight_number.ilike.${ilike},pickup.ilike.${ilike},dropoff.ilike.${ilike}`
      )
      .limit(limit),

    // Drivers — name / staff_no / whatsapp / vehicle / plate.
    supabase
      .from("drivers")
      .select(
        "id, name, staff_no, whatsapp, vehicle_type, vehicle_model, vehicle_year, plate, status, avg_rating:driver_ratings(rating)"
      )
      .or(
        `name.ilike.${ilike},staff_no.ilike.${ilike},whatsapp.ilike.${ilike},vehicle_model.ilike.${ilike},plate.ilike.${ilike}`
      )
      .limit(limit),

    // Suppliers — company name match. The DB column is `name`; we expose it
    // as `company_name` in the API contract so consumers don't confuse it
    // with Client.name.
    supabase
      .from("suppliers")
      .select("id, name, primary_service_type, contact_name, is_active")
      .eq("is_active", true)
      .ilike("name", ilike)
      .limit(limit),
  ]);

  const clients = clientsRes.data ?? [];
  const driversRaw = driversRes.data ?? [];

  // Same booking SELECT shape we use everywhere in this route — keep it as a
  // single string so the direct query, client-id second pass, and driver-id
  // second pass stay in sync. PostgREST can't OR a parent column with a
  // foreign-table column in one query, hence the second-pass pattern.
  const bookingSelect =
    "id, tvl_ref, service_type, status, pickup, dropoff, flight_number, date_time, price, client_id, clients(name, vip_tier)";

  let bookings = bookingsAllRes.data ?? [];
  const seen = new Set(bookings.map((b: any) => b.id));

  // Second pass: bookings whose match lives on the joined client name.
  if (bookings.length < limit && clients.length > 0) {
    const clientIds = clients.map((c: any) => c.id);
    const { data: byClient } = await supabase
      .from("bookings")
      .select(bookingSelect)
      .in("client_id", clientIds)
      .limit(limit);
    for (const b of byClient ?? []) {
      if (!seen.has(b.id) && bookings.length < limit) {
        bookings.push(b);
        seen.add(b.id);
      }
    }
  }

  // Third pass: bookings whose match lives on the joined driver (name,
  // vehicle_model, plate). Required by spec — without it, searching a driver
  // name would surface the driver row but no related jobs. Reuses driversRes
  // from the parallel batch above so we don't re-query drivers.
  if (bookings.length < limit && driversRaw.length > 0) {
    const driverIds = driversRaw.map((d: any) => d.id);
    const { data: byDriver } = await supabase
      .from("bookings")
      .select(bookingSelect)
      .in("driver_id", driverIds)
      .limit(limit);
    for (const b of byDriver ?? []) {
      if (!seen.has(b.id) && bookings.length < limit) {
        bookings.push(b);
        seen.add(b.id);
      }
    }
  }

  bookings = bookings.slice(0, limit).map((b: any) => ({
    ...b,
    client_name: b.clients?.name ?? null,
    client_vip_tier: b.clients?.vip_tier ?? null,
    clients: undefined,
  }));

  const drivers = (driversRes.data ?? []).map((d: any) => {
    const ratings = d.avg_rating ?? [];
    const avg =
      ratings.length > 0
        ? ratings.reduce((s: number, r: any) => s + r.rating, 0) /
          ratings.length
        : 0;
    return { ...d, avg_rating: Math.round(avg * 10) / 10, total_jobs: 0 };
  });

  const suppliers = (suppliersRes.data ?? []).map((s: any) => ({
    id: s.id,
    company_name: s.name,
    primary_service_type: s.primary_service_type ?? null,
    contact_name: s.contact_name ?? null,
  }));

  return res.json({ clients, bookings, drivers, suppliers });
});

export default router;
