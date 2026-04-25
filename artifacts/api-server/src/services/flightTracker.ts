import { supabase, getServiceRoleClient } from "../lib/supabase";
import { sendWebPushToAll } from "./webpush";
import { notifyByRoles, STAFF_ROLES } from "./notify";

const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY;
const AERO_HOST    = "aerodatabox.p.rapidapi.com";
const AERO_BASE    = `https://${AERO_HOST}`;

// ── Quota-protection circuit breaker ────────────────────────────────────────
// AeroDataBox is a monthly-quota service. Once we hit HTTP 429, every further
// call is wasted (and may still be billed by some tiers). We park the
// integration until the start of the *next* calendar month UTC + a 1-day
// buffer, so the next billing cycle has settled before we resume.
let quotaExceededUntil = 0; // ms timestamp. While Date.now() < this, skip all calls.

function markQuotaExceeded(reason: string) {
  const now = new Date();
  const resumeAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 2, 0, 0, 0));
  quotaExceededUntil = resumeAt.getTime();
  console.warn(`[FlightPoll] Quota exhausted (${reason}). Pausing flight-tracker API calls until ${resumeAt.toISOString()}.`);
}

export function isFlightApiPaused(): { paused: boolean; resumeAt: string | null } {
  if (Date.now() < quotaExceededUntil) {
    return { paused: true, resumeAt: new Date(quotaExceededUntil).toISOString() };
  }
  return { paused: false, resumeAt: null };
}

// ── Negative-result cache (per flight+date) ─────────────────────────────────
// When a single flight lookup fails (404/timeout/etc.), don't keep retrying
// every minute — back off for 30 min before trying that specific flight again.
const negativeCache = new Map<string, number>();
const NEG_CACHE_TTL_MS = 30 * 60 * 1000;

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

// Map AeroDataBox status strings → our UI labels.
// delayMins: positive = late, negative = early.
export function mapAeroStatus(raw: string, delayMins: number): string {
  const isDelayed = delayMins >= 15;
  const isEarly   = delayMins <= -10;
  switch (raw) {
    case "Arrived":           return delayMins <= -10 ? "Early" : "Landed";
    case "EnRoute":           return isDelayed ? "Delayed" : isEarly ? "Early" : "On Time";
    case "Scheduled":         return isDelayed ? "Delayed" : isEarly ? "Early" : "On Time";
    case "Expected":          return isDelayed ? "Delayed" : isEarly ? "Early" : "On Time";
    case "CheckIn":           return isDelayed ? "Delayed" : "On Time";
    case "GateClosed":        return isDelayed ? "Delayed" : "On Time";
    case "Departed":          return isDelayed ? "Delayed" : isEarly ? "Early" : "On Time";
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

  // Circuit breaker: skip the call entirely if we've already hit the monthly
  // quota — otherwise every retry burns a slot AND a 429 log line.
  if (Date.now() < quotaExceededUntil) {
    return {
      ok: false,
      reason: "api_error",
      message: `Flight API paused — monthly quota exhausted. Resumes ${new Date(quotaExceededUntil).toISOString()}.`,
    };
  }

  try {
    const url = `${AERO_BASE}/flights/number/${encodeURIComponent(flightNumber)}/${date}?withAircraftImage=false&withLocation=false`;
    const resp = await fetch(url, {
      headers: {
        "x-rapidapi-host": AERO_HOST,
        "x-rapidapi-key":  RAPIDAPI_KEY,
        "Content-Type":    "application/json",
      },
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      // 429 = monthly quota exhausted. Trip the circuit breaker so we stop
      // hammering the API for the rest of the billing cycle.
      if (resp.status === 429) {
        markQuotaExceeded(`HTTP 429 on ${flightNumber} ${date}`);
      }
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
    // Positive = delayed, Negative = early arrival. Keep full signed value
    // so the UI can show both "Delayed +25m" and "10 min early".
    const delayMins   = (scheduledMs && estimatedMs)
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
 * Poll flight status for ALL upcoming Airport Transfer bookings in the next
 * 24 hours (and up to 2 hours ago, to catch in-progress arrivals).
 * Only re-fetches when the cache entry is stale (>5 min old).
 * Called by the scheduler every minute.
 */
export async function pollUpcomingFlights(): Promise<void> {
  // Hard short-circuit: if monthly quota is exhausted, don't even hit the DB
  // for upcoming bookings. The poll resumes automatically on the configured
  // resume date (start of next billing month).
  if (Date.now() < quotaExceededUntil) return;

  const db = getServiceRoleClient() ?? supabase;

  const now = new Date();
  const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
  const in24h       = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();

  const { data: bookings, error } = await db
    .from("bookings")
    .select("id, tvl_ref, flight_number, date_time, direction")
    .eq("service_type", "Airport Transfer")
    .not("flight_number", "is", null)
    .in("status", ["Confirmed", "Active"])
    .gte("date_time", twoHoursAgo)
    .lte("date_time", in24h);

  if (error) {
    console.error("[FlightPoll] query error:", error.message);
    return;
  }
  if (!bookings?.length) return;

  console.info(`[FlightPoll] ${bookings.length} upcoming Airport Transfer booking(s) — checking flight cache`);

  await Promise.allSettled(
    bookings.map(async (b: any) => {
      const flightDate = new Date(b.date_time).toISOString().split("T")[0];

      // Negative-cache: if this exact flight failed recently, skip for 30 min.
      const negKey = `${b.flight_number}|${flightDate}`;
      const negUntil = negativeCache.get(negKey);
      if (negUntil && Date.now() < negUntil) return;

      // ── Adaptive cache TTL ─────────────────────────────────────────────
      // Polling every minute when the flight is 24h away wastes quota. Use a
      // wider TTL when the flight is far out, narrowing it as departure nears.
      const flightMs = new Date(b.date_time).getTime();
      const hoursToFlight = (flightMs - Date.now()) / (60 * 60 * 1000);
      let cacheTtlMs: number;
      if (hoursToFlight > 12)      cacheTtlMs = 4 * 60 * 60 * 1000;   // 4h
      else if (hoursToFlight > 6)  cacheTtlMs = 60 * 60 * 1000;        // 1h
      else if (hoursToFlight > 2)  cacheTtlMs = 15 * 60 * 1000;        // 15m
      else                         cacheTtlMs = 5 * 60 * 1000;         // 5m (active window)
      const cacheCutoff = new Date(Date.now() - cacheTtlMs).toISOString();

      // Read existing cached entry (status + delay) BEFORE fetching fresh data,
      // so we can detect meaningful status changes and fire push notifications.
      const { data: cached } = await db
        .from("flight_status_cache")
        .select("last_updated, status, delay_minutes")
        .eq("flight_number", b.flight_number)
        .eq("date", flightDate)
        .single();

      // Skip if cache is still fresh — avoids burning API quota on unchanged data.
      if (cached?.last_updated && cached.last_updated > cacheCutoff) return;

      const prevStatus    = cached?.status      ?? null;
      const prevDelayMins = cached?.delay_minutes ?? 0;

      const dir = b.direction === "Departure" ? "Departure" : "Arrival" as const;
      const result = await fetchFlightStatus(b.flight_number, flightDate, dir);
      if (result.ok) {
        await upsertCache(db, result.data, flightDate);
        const d = result.data;
        const delayNote = d.delay_minutes > 0
          ? `+${d.delay_minutes}m late`
          : d.delay_minutes < 0
            ? `${Math.abs(d.delay_minutes)}m early`
            : "on time";
        console.info(`[FlightPoll] ${b.flight_number} (${b.tvl_ref ?? ""}): ${d.status} — ${delayNote}`);

        // ── Detect meaningful status changes → OS push + in-app notification ──
        const flightLabel = b.flight_number.toUpperCase();
        const ref         = b.tvl_ref ? ` (${b.tvl_ref})` : "";
        const link        = b.id ? `/bookings/${b.id}` : "/flights";

        const statusChanged = d.status !== prevStatus;
        // Delay increase of ≥5 min compared to previous value (even within same status label)
        const delayIncreased = d.status === "Delayed" && d.delay_minutes >= (prevDelayMins + 5);

        if (statusChanged || delayIncreased) {
          let pushTitle: string | null = null;
          let pushBody:  string | null = null;
          let notifType: "flight_delay" | "flight_early" | "flight_landed" = "flight_delay";
          let severity: "warning" | "success" | "info" = "info";

          if (d.status === "Delayed") {
            pushTitle = `✈️ Flight Delayed — ${flightLabel}`;
            pushBody  = `${flightLabel}${ref} is now ${d.delay_minutes} min late.`;
            notifType = "flight_delay";
            severity  = "warning";
          } else if (d.status === "Early") {
            pushTitle = `✈️ Flight Early — ${flightLabel}`;
            const earlyMin = Math.abs(d.delay_minutes);
            pushBody  = `${flightLabel}${ref} is arriving ${earlyMin} min early — driver may need to move sooner.`;
            notifType = "flight_early";
            severity  = "warning";
          } else if (d.status === "Landed") {
            pushTitle = `✈️ Landed — ${flightLabel}`;
            pushBody  = `${flightLabel}${ref} has landed.`;
            notifType = "flight_landed";
            severity  = "success";
          } else if (d.status === "Cancelled") {
            pushTitle = `✈️ Flight Cancelled — ${flightLabel}`;
            pushBody  = `${flightLabel}${ref} has been cancelled. Check with the client.`;
            notifType = "flight_delay";
            severity  = "warning";
          } else if (prevStatus && d.status !== prevStatus) {
            // Generic status change (e.g. Scheduled → On Time, EnRoute, etc.)
            pushTitle = `✈️ ${flightLabel} — ${d.status}`;
            pushBody  = `${flightLabel}${ref} status updated to ${d.status}.`;
            notifType = "flight_delay";
            severity  = "info";
          }

          if (pushTitle && pushBody) {
            // OS-level push notification to all subscribed devices
            sendWebPushToAll({ title: pushTitle, body: pushBody, link, tag: `flight-${b.flight_number}`, requireInteraction: true }).catch(() => {});
            // In-app notification bell (for all staff)
            notifyByRoles(STAFF_ROLES, {
              type:     notifType,
              title:    pushTitle,
              message:  pushBody,
              link,
              severity,
              dedupeKey: `flight-${b.flight_number}-${d.status}-${d.delay_minutes}`,
            }).catch(() => {});
          }
        }
      } else {
        // Park this specific flight in the negative cache so we don't retry
        // every minute. Quota-exceeded errors are already handled by the
        // global circuit breaker, so this only affects 404 / network errors.
        negativeCache.set(negKey, Date.now() + NEG_CACHE_TTL_MS);
        console.warn(`[FlightPoll] ${b.flight_number} (${b.tvl_ref ?? ""}): ${result.reason} — ${result.message ?? ""}`);
      }
    })
  );
}
