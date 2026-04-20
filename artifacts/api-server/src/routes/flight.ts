import { Router } from "express";
import { supabase } from "../lib/supabase";

const router = Router();
const AVIATIONSTACK_KEY = process.env.VITE_AVIATIONSTACK_KEY;

type LookupResult =
  | { ok: true; data: any }
  | { ok: false; reason: "no_key" | "plan_restricted" | "not_active" | "api_error"; message?: string };

async function fetchFlightStatus(flightNumber: string, date: string): Promise<LookupResult> {
  if (!AVIATIONSTACK_KEY || AVIATIONSTACK_KEY === "placeholder") {
    return { ok: false, reason: "no_key" };
  }

  try {
    const url = `http://api.aviationstack.com/v1/flights?access_key=${AVIATIONSTACK_KEY}&flight_iata=${flightNumber}&flight_date=${date}&limit=1`;
    const response = await fetch(url);
    const json = await response.json() as any;

    // Plan-level restriction (e.g. flight_date is a paid feature on AviationStack)
    if (json?.error?.code === "function_access_restricted" || json?.error?.code === "usage_limit_reached") {
      return { ok: false, reason: "plan_restricted", message: json.error.message };
    }
    if (!response.ok || json?.error) {
      return { ok: false, reason: "api_error", message: json?.error?.message };
    }

    const flight = json?.data?.[0];
    if (!flight) {
      // Free tier returns empty when the flight is not currently airborne
      return { ok: false, reason: "not_active" };
    }

    const scheduled = flight.departure?.scheduled ?? flight.arrival?.scheduled ?? null;
    const estimated = flight.departure?.estimated ?? flight.arrival?.estimated ?? null;
    const actual = flight.departure?.actual ?? flight.arrival?.actual ?? null;

    const scheduledTime = scheduled ? new Date(scheduled) : null;
    const estimatedTime = (estimated || actual) ? new Date(estimated ?? actual) : null;
    const delayMins = scheduledTime && estimatedTime
      ? Math.max(0, Math.round((estimatedTime.getTime() - scheduledTime.getTime()) / 60000))
      : 0;

    const flightStatus = flight.flight_status ?? "unknown";

    let status = "Unknown";
    if (flightStatus === "active") status = "On Time";
    else if (flightStatus === "landed") status = "Landed";
    else if (flightStatus === "cancelled") status = "Cancelled";
    else if (flightStatus === "scheduled") status = delayMins >= 15 ? "Delayed" : "On Time";
    else if (flightStatus === "diverted") status = "Cancelled";

    return {
      ok: true,
      data: {
        flight_number: flightNumber,
        origin: flight.departure?.airport ?? null,
        destination: flight.arrival?.airport ?? null,
        scheduled_time: scheduled,
        estimated_time: estimated ?? actual,
        status,
        delay_minutes: delayMins,
        terminal: flight.arrival?.terminal ?? null,
        last_updated: new Date().toISOString(),
      },
    };
  } catch (e: any) {
    return { ok: false, reason: "api_error", message: e?.message };
  }
}

router.get("/:flight_number", async (req, res) => {
  const { flight_number } = req.params;
  const { date } = req.query;
  const flightDate = date ? String(date) : new Date().toISOString().split("T")[0];

  // Check cache first (5 min TTL)
  const { data: cached } = await supabase
    .from("flight_status_cache")
    .select("*")
    .eq("flight_number", flight_number.toUpperCase())
    .eq("date", flightDate)
    .single();

  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  if (cached && cached.last_updated > fiveMinAgo) {
    return res.json({
      flight_number: cached.flight_number,
      origin: cached.origin,
      destination: cached.destination,
      scheduled_time: cached.scheduled_time,
      estimated_time: cached.estimated_time,
      status: cached.status ?? "Unknown",
      delay_minutes: cached.delay_minutes ?? 0,
      terminal: cached.terminal,
      last_updated: cached.last_updated,
    });
  }

  const result = await fetchFlightStatus(flight_number.toUpperCase(), flightDate);

  if (result.ok) {
    const flightData = result.data;
    await supabase.from("flight_status_cache").upsert({
      flight_number: flight_number.toUpperCase(),
      date: flightDate,
      status: flightData.status,
      origin: flightData.origin,
      destination: flightData.destination,
      scheduled_time: flightData.scheduled_time,
      estimated_time: flightData.estimated_time,
      delay_minutes: flightData.delay_minutes,
      terminal: flightData.terminal,
      last_updated: new Date().toISOString(),
    }, { onConflict: "flight_number,date" });

    return res.json(flightData);
  }

  if (cached) {
    return res.json({
      flight_number: cached.flight_number,
      origin: cached.origin,
      destination: cached.destination,
      scheduled_time: cached.scheduled_time,
      estimated_time: cached.estimated_time,
      status: cached.status ?? "Unknown",
      delay_minutes: cached.delay_minutes ?? 0,
      terminal: cached.terminal,
      last_updated: cached.last_updated,
    });
  }

  // Surface why the lookup didn't yield data so the UI can show an
  // accurate message (plan limit vs flight-not-yet-active vs misconfig).
  const unavailableReason = (() => {
    switch (result.reason) {
      case "no_key": return "Flight lookup not configured.";
      case "plan_restricted": return "Flight lookup unavailable on current AviationStack plan (date queries require a paid subscription).";
      case "not_active": return "Flight not yet trackable — appears once airborne.";
      case "api_error": return result.message ? `Flight lookup error: ${result.message}` : "Flight lookup temporarily unavailable.";
    }
  })();

  return res.json({
    flight_number: flight_number.toUpperCase(),
    status: "Unknown",
    delay_minutes: 0,
    unavailable_reason: unavailableReason,
    last_updated: new Date().toISOString(),
  });
});

// Flight tracker — today and tomorrow arrival bookings
router.get("/", async (_req, res) => {
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const tomorrowEnd = new Date(now);
  tomorrowEnd.setDate(now.getDate() + 2);
  tomorrowEnd.setHours(0, 0, 0, 0);

  // Show every booking with a flight number that's scheduled in the next ~36h
  // and isn't already Cancelled. We intentionally do NOT filter by `direction`
  // — many imported Odoo bookings have null direction, and operators still
  // want live status on those. Completed bookings are kept too so a recently
  // landed flight remains visible until the day rolls over.
  const { data: bookings, error } = await supabase
    .from("bookings")
    .select("id, tvl_ref, flight_number, date_time, pickup, dropoff, destination, direction, client_id, driver_id, clients(name), drivers(name)")
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
      let flightStatus = null;

      if (b.flight_number && flightDate) {
        const { data: cached } = await supabase
          .from("flight_status_cache")
          .select("*")
          .eq("flight_number", b.flight_number)
          .eq("date", flightDate)
          .single();

        if (cached) {
          flightStatus = {
            flight_number: cached.flight_number,
            status: cached.status ?? "Unknown",
            scheduled_time: cached.scheduled_time,
            estimated_time: cached.estimated_time,
            delay_minutes: cached.delay_minutes ?? 0,
            terminal: cached.terminal,
            last_updated: cached.last_updated,
          };
        } else {
          const live = await fetchFlightStatus(b.flight_number, flightDate);
          if (live.ok) {
            flightStatus = live.data;
            await supabase.from("flight_status_cache").upsert({
              flight_number: b.flight_number,
              date: flightDate,
              status: live.data.status,
              origin: live.data.origin,
              destination: live.data.destination,
              scheduled_time: live.data.scheduled_time,
              estimated_time: live.data.estimated_time,
              delay_minutes: live.data.delay_minutes,
              terminal: live.data.terminal,
              last_updated: new Date().toISOString(),
            }, { onConflict: "flight_number,date" });
          }
        }
      }

      // Always surface the booking's pickup/dropoff so the UI never has to
      // show "Unknown → Unknown" — even when AviationStack returns nothing,
      // the operator at least sees the airport/destination from the job.
      const enrichedStatus = flightStatus
        ? {
            ...flightStatus,
            origin: flightStatus.origin ?? b.pickup ?? null,
            destination: flightStatus.destination ?? b.dropoff ?? b.destination ?? null,
          }
        : null;

      return {
        booking_id: b.id,
        tvl_ref: b.tvl_ref,
        client_name: b.clients?.name ?? null,
        flight_number: b.flight_number,
        scheduled_time: b.date_time,
        pickup: b.pickup ?? null,
        dropoff: b.dropoff ?? b.destination ?? null,
        driver_name: b.drivers?.name ?? null,
        flight_status: enrichedStatus,
      };
    })
  );

  return res.json(results);
});

export default router;
