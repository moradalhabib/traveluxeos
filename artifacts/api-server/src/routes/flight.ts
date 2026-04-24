import { Router } from "express";
import { supabase, getServiceRoleClient } from "../lib/supabase";
import {
  fetchFlightStatus,
  buildCacheResponse,
  upsertCache,
} from "../services/flightTracker";

const router = Router();

// ─── GET /api/flight/:flight_number ──────────────────────────────────────────
// Returns live status for a single flight (5-min cache).
// Optional query params: date (YYYY-MM-DD), direction (Arrival|Departure)
router.get("/:flight_number", async (req, res) => {
  const { flight_number } = req.params;
  const { date, direction } = req.query;
  const flightDate = date ? String(date) : new Date().toISOString().split("T")[0];
  const dir = direction === "Departure" ? "Departure" : "Arrival" as const;

  const db = getServiceRoleClient() ?? supabase;

  // Cache check (5 min TTL)
  const { data: cached } = await db
    .from("flight_status_cache")
    .select("*")
    .eq("flight_number", flight_number.toUpperCase())
    .eq("date", flightDate)
    .single();

  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  if (cached && cached.last_updated > fiveMinAgo) {
    return res.json(buildCacheResponse(cached, flight_number));
  }

  const result = await fetchFlightStatus(flight_number.toUpperCase(), flightDate, dir);

  if (result.ok) {
    await upsertCache(db, result.data, flightDate);
    return res.json(result.data);
  }

  // Return stale cache rather than an error if available
  if (cached) return res.json(buildCacheResponse(cached, flight_number));

  const unavailableReason = (() => {
    switch (result.reason) {
      case "no_key":    return "Flight tracking not configured (RAPIDAPI_KEY missing).";
      case "not_found": return "Flight not found — check the flight number and date.";
      case "api_error": return result.message
        ? `Flight lookup error: ${result.message}`
        : "Flight lookup temporarily unavailable.";
    }
  })();

  return res.json({
    flight_number:      flight_number.toUpperCase(),
    status:             "Unknown",
    delay_minutes:      0,
    unavailable_reason: unavailableReason,
    last_updated:       new Date().toISOString(),
  });
});

// ─── GET /api/flight/ ─────────────────────────────────────────────────────────
// Flight tracker board: today + tomorrow Airport Transfer bookings with a
// flight number. Uses 5-min cache; calls API only for missing/stale entries.
router.get("/", async (_req, res) => {
  const now = new Date();
  const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
  const tomorrowEnd = new Date(now);
  tomorrowEnd.setDate(now.getDate() + 2);
  tomorrowEnd.setHours(0, 0, 0, 0);

  const db = getServiceRoleClient() ?? supabase;

  const { data: bookings, error } = await db
    .from("bookings")
    .select("id, tvl_ref, flight_number, date_time, pickup, dropoff, destination, direction, client_id, driver_id, clients(name), drivers(name, staff_no)")
    .eq("service_type", "Airport Transfer")
    .not("flight_number", "is", null)
    .not("status", "eq", "Cancelled")
    .gte("date_time", todayStart.toISOString())
    .lt("date_time", tomorrowEnd.toISOString())
    .order("date_time", { ascending: true });

  if (error) return res.status(500).json({ error: error.message });

  const results = await Promise.all(
    (bookings ?? []).map(async (b: any) => {
      const flightDate = b.date_time ? new Date(b.date_time).toISOString().split("T")[0] : null;
      let flightStatus: any = null;

      if (b.flight_number && flightDate) {
        const { data: cached } = await db
          .from("flight_status_cache")
          .select("*")
          .eq("flight_number", b.flight_number)
          .eq("date", flightDate)
          .single();

        const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
        if (cached && cached.last_updated > fiveMinAgo) {
          flightStatus = buildCacheResponse(cached, b.flight_number);
        } else {
          const dir = b.direction === "Departure" ? "Departure" : "Arrival" as const;
          const live = await fetchFlightStatus(b.flight_number, flightDate, dir);
          if (live.ok) {
            flightStatus = live.data;
            await upsertCache(db, live.data, flightDate);
          } else if (cached) {
            flightStatus = buildCacheResponse(cached, b.flight_number);
          }
        }
      }

      const enriched = flightStatus
        ? {
            ...flightStatus,
            origin:      flightStatus.origin      ?? b.pickup      ?? null,
            destination: flightStatus.destination ?? b.dropoff ?? b.destination ?? null,
          }
        : null;

      return {
        booking_id:      b.id,
        tvl_ref:         b.tvl_ref,
        client_name:     b.clients?.name ?? null,
        flight_number:   b.flight_number,
        scheduled_time:  b.date_time,
        pickup:          b.pickup  ?? null,
        dropoff:         b.dropoff ?? b.destination ?? null,
        driver_name:     b.drivers?.name     ?? null,
        driver_staff_no: b.drivers?.staff_no ?? null,
        flight_status:   enriched,
      };
    })
  );

  return res.json(results);
});

export default router;
