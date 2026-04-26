import { Router } from "express";
import { supabase, getServiceRoleClient } from "../lib/supabase";
import {
  fetchFlightStatus,
  buildCacheResponse,
  upsertCache,
} from "../services/flightTracker";

const router = Router();

// ─── GET /api/flight/:flight_number ──────────────────────────────────────────
// Single-flight lookup — used by FlightLookupCard when creating/editing a booking.
// Optional query params: date (YYYY-MM-DD), direction (Arrival|Departure)
//
// AeroDataBox is called ONLY when there is no cache row at all for this
// flight+date — i.e. a future booking that the background poller hasn't reached
// yet. Once any cache entry exists (written by the poller or a previous lookup)
// it is returned as-is; the poller is the sole updater at T-1h / T-30min / etc.
// This guarantees AeroDataBox is consumed only at booking-creation time.
router.get("/:flight_number", async (req, res) => {
  const { flight_number } = req.params;
  const { date, direction } = req.query;
  const flightDate = date ? String(date) : new Date().toISOString().split("T")[0];
  const dir = direction === "Departure" ? "Departure" : "Arrival" as const;

  const db = getServiceRoleClient() ?? supabase;

  // Always try cache first — if it exists, return it immediately (any age).
  const { data: cached } = await db
    .from("flight_status_cache")
    .select("*")
    .eq("flight_number", flight_number.toUpperCase())
    .eq("date", flightDate)
    .single();

  if (cached) return res.json(buildCacheResponse(cached, flight_number));

  // No cache at all → this is a brand-new booking lookup. Call AeroDataBox once
  // and store the result so the poller can take over from here.
  const result = await fetchFlightStatus(flight_number.toUpperCase(), flightDate, dir);

  if (result.ok) {
    await upsertCache(db, result.data, flightDate);
    return res.json(result.data);
  }

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
// Flight tracker board: today + tomorrow Airport Transfer bookings.
// CACHE-ONLY — never calls AeroDataBox directly. The background poller
// (T-1h / T-30min / post-arrival) is the sole writer to flight_status_cache.
// This keeps browser auto-refreshes (Flights dashboard, booking detail) from
// consuming any AeroDataBox quota.
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

  // Batch-fetch all cached statuses in one query to avoid N+1 round-trips.
  const flightKeys = (bookings ?? [])
    .filter((b: any) => b.flight_number && b.date_time)
    .map((b: any) => ({
      fn:   (b.flight_number as string).toUpperCase(),
      date: new Date(b.date_time).toISOString().split("T")[0],
    }));

  // Build a lookup map: "FLIGHT|DATE" → cached row
  const cacheMap = new Map<string, any>();
  if (flightKeys.length) {
    // Supabase doesn't support OR on composite keys natively, so we fetch
    // all cache rows for any of the flight numbers across the date range and
    // filter in JS. The result set is tiny (today + tomorrow's flights).
    const fns  = [...new Set(flightKeys.map(k => k.fn))];
    const dates = [...new Set(flightKeys.map(k => k.date))];
    const { data: rows } = await db
      .from("flight_status_cache")
      .select("*")
      .in("flight_number", fns)
      .in("date", dates);
    for (const row of (rows ?? [])) {
      cacheMap.set(`${row.flight_number}|${row.date}`, row);
    }
  }

  const results = (bookings ?? []).map((b: any) => {
      const flightDate = b.date_time ? new Date(b.date_time).toISOString().split("T")[0] : null;
      let flightStatus: any = null;

      if (b.flight_number && flightDate) {
        const cached = cacheMap.get(`${(b.flight_number as string).toUpperCase()}|${flightDate}`);
        if (cached) flightStatus = buildCacheResponse(cached, b.flight_number);
        // No cache yet → poller hasn't fired yet (pre T-1h). Show null so the
        // dashboard displays "Awaiting feed" rather than calling AeroDataBox.
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
    });

  return res.json(results);
});

export default router;
