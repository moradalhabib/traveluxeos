import { supabase, getServiceRoleClient } from "../lib/supabase";

const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY;
const AERO_HOST    = "aerodatabox.p.rapidapi.com";
const AERO_BASE    = `https://${AERO_HOST}`;

export interface FlightData {
  flight_number:  string;
  origin:         string | null;
  destination:    string | null;
  scheduled_time: string | null;
  estimated_time: string | null;
  status:         string;
  delay_minutes:  number;
  terminal:       string | null;
  last_updated:   string;
}

export type FlightLookupResult =
  | { ok: true; data: FlightData }
  | { ok: false; reason: "no_key" | "not_found" | "api_error"; message?: string };

// Map AeroDataBox status strings → our UI labels
export function mapAeroStatus(raw: string, delayMins: number): string {
  switch (raw) {
    case "Arrived":           return "Landed";
    case "EnRoute":           return delayMins >= 15 ? "Delayed" : "On Time";
    case "Scheduled":         return delayMins >= 15 ? "Delayed" : "On Time";
    case "Expected":          return delayMins >= 15 ? "Delayed" : "On Time";
    case "CheckIn":           return "On Time";
    case "GateClosed":        return "On Time";
    case "Departed":          return delayMins >= 15 ? "Delayed" : "On Time";
    case "Canceled":
    case "CanceledUncertain":
    case "Diverted":          return "Cancelled";
    default:                  return "Unknown";
  }
}

/**
 * Fetch live flight status from AeroDataBox.
 * direction = "Arrival" → uses arrival leg times (default).
 * direction = "Departure" → uses departure leg times.
 */
export async function fetchFlightStatus(
  flightNumber: string,
  date: string,  // YYYY-MM-DD
  direction: "Arrival" | "Departure" | null = "Arrival"
): Promise<FlightLookupResult> {
  if (!RAPIDAPI_KEY) return { ok: false, reason: "no_key" };

  try {
    const url = `${AERO_BASE}/flights/iata/${encodeURIComponent(flightNumber)}/${date}?withAircraftImage=false&withLocation=false`;
    const resp = await fetch(url, {
      headers: {
        "x-rapidapi-host": AERO_HOST,
        "x-rapidapi-key":  RAPIDAPI_KEY,
        "Content-Type":    "application/json",
      },
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      return { ok: false, reason: "api_error", message: `HTTP ${resp.status}: ${text.slice(0, 200)}` };
    }

    const json = await resp.json() as any;
    const flights: any[] = Array.isArray(json) ? json : (json?.flights ?? []);
    if (!flights.length) return { ok: false, reason: "not_found" };

    const f = flights[0];

    const useDep = direction === "Departure";
    const leg    = useDep ? f.departure : f.arrival;

    const scheduledUtc  = leg?.scheduledTime?.utc  ?? null;
    const revisedUtc    = leg?.revisedTime?.utc    ?? null;
    const estimatedTime = revisedUtc ?? scheduledUtc;

    const scheduledMs = scheduledUtc  ? new Date(scheduledUtc).getTime()  : null;
    const estimatedMs = estimatedTime ? new Date(estimatedTime).getTime() : null;
    const delayMins   = (scheduledMs && estimatedMs && estimatedMs > scheduledMs)
      ? Math.round((estimatedMs - scheduledMs) / 60000)
      : 0;

    const rawStatus = f.status ?? "Unknown";
    const status    = mapAeroStatus(rawStatus, delayMins);

    const origin      = f.departure?.airport?.iata ?? f.departure?.airport?.name ?? null;
    const destination = f.arrival?.airport?.iata  ?? f.arrival?.airport?.name  ?? null;
    const terminal    = leg?.terminal ?? null;

    return {
      ok: true,
      data: {
        flight_number:  flightNumber.toUpperCase(),
        origin,
        destination,
        scheduled_time: scheduledUtc  ?? null,
        estimated_time: estimatedTime ?? null,
        status,
        delay_minutes:  delayMins,
        terminal,
        last_updated:   new Date().toISOString(),
      },
    };
  } catch (e: any) {
    return { ok: false, reason: "api_error", message: e?.message };
  }
}

export function buildCacheResponse(cached: any, flightNumber: string): FlightData {
  return {
    flight_number:  cached.flight_number ?? flightNumber,
    origin:         cached.origin,
    destination:    cached.destination,
    scheduled_time: cached.scheduled_time,
    estimated_time: cached.estimated_time,
    status:         cached.status ?? "Unknown",
    delay_minutes:  cached.delay_minutes ?? 0,
    terminal:       cached.terminal,
    last_updated:   cached.last_updated,
  };
}

export async function upsertCache(db: any, data: FlightData, date: string): Promise<void> {
  await db.from("flight_status_cache").upsert(
    {
      flight_number:  data.flight_number,
      date,
      status:         data.status,
      origin:         data.origin,
      destination:    data.destination,
      scheduled_time: data.scheduled_time,
      estimated_time: data.estimated_time,
      delay_minutes:  data.delay_minutes,
      terminal:       data.terminal,
      last_updated:   data.last_updated,
    },
    { onConflict: "flight_number,date" }
  );
}

/**
 * Poll flight status for Airport Transfer bookings starting in 25–35 min.
 * Called by the scheduler every minute.
 */
export async function pollUpcomingFlights(): Promise<void> {
  const db = getServiceRoleClient() ?? supabase;

  const now = new Date();
  const in25 = new Date(now.getTime() + 25 * 60 * 1000).toISOString();
  const in35 = new Date(now.getTime() + 35 * 60 * 1000).toISOString();

  const { data: bookings, error } = await db
    .from("bookings")
    .select("id, tvl_ref, flight_number, date_time, direction")
    .eq("service_type", "Airport Transfer")
    .not("flight_number", "is", null)
    .in("status", ["Confirmed", "Active"])
    .gte("date_time", in25)
    .lte("date_time", in35);

  if (error) {
    console.error("[FlightPoll] query error:", error.message);
    return;
  }
  if (!bookings?.length) return;

  console.info(`[FlightPoll] ${bookings.length} booking(s) starting in 25-35 min — refreshing flight status`);

  await Promise.allSettled(
    bookings.map(async (b: any) => {
      const flightDate = new Date(b.date_time).toISOString().split("T")[0];
      const dir = b.direction === "Departure" ? "Departure" : "Arrival" as const;
      const result = await fetchFlightStatus(b.flight_number, flightDate, dir);
      if (result.ok) {
        await upsertCache(db, result.data, flightDate);
        const d = result.data;
        if (d.delay_minutes > 0) {
          console.info(`[FlightPoll] ${b.flight_number} (${b.tvl_ref}): ${d.status}, ${d.delay_minutes} min delay`);
        }
      } else {
        console.warn(`[FlightPoll] ${b.flight_number} (${b.tvl_ref}): ${result.reason} — ${result.message ?? ""}`);
      }
    })
  );
}
