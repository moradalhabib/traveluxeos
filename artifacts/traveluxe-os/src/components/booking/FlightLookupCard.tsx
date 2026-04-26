import { useState, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, PlaneTakeoff, PlaneLanding, Clock, CheckCircle2, AlertTriangle, XCircle, ArrowRight } from "lucide-react";
import { format } from "date-fns";

interface FlightStatus {
  flight_number: string;
  origin?: string | null;
  destination?: string | null;
  scheduled_time?: string | null;
  estimated_time?: string | null;
  status: string;
  delay_minutes?: number;
  terminal?: string | null;
  last_updated?: string;
}

interface Props {
  flightNumber: string;
  direction?: string;
  // YYYY-MM-DD — the booking date the operator has entered. We query
  // AeroDataBox for that specific date so pre-bookings resolve correctly.
  // If empty, the lookup is paused until a date is entered.
  date?: string;
  // `timeUk` is the flight's scheduled/estimated time as an HH:mm string in
  // Europe/London (GMT/BST). The consumer is expected to merge it onto the
  // date the operator manually entered — we never auto-fill the date because
  // clients pre-book.
  onAutoFill?: (timeUk: string, origin: string, destination: string, terminal: string | null) => void;
}

const STATUS_META: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  "On Time":  { label: "On Time",  color: "text-green-400 border-green-500/30 bg-green-500/10",  icon: <CheckCircle2 className="w-3.5 h-3.5" /> },
  "Early":    { label: "Early",    color: "text-emerald-400 border-emerald-500/30 bg-emerald-500/10", icon: <PlaneLanding className="w-3.5 h-3.5" /> },
  "Delayed":  { label: "Delayed",  color: "text-amber-400 border-amber-500/30 bg-amber-500/10",  icon: <AlertTriangle className="w-3.5 h-3.5" /> },
  "Landed":   { label: "Landed",   color: "text-blue-400 border-blue-500/30 bg-blue-500/10",    icon: <PlaneLanding className="w-3.5 h-3.5" /> },
  "Cancelled":{ label: "Cancelled",color: "text-red-400 border-red-500/30 bg-red-500/10",      icon: <XCircle className="w-3.5 h-3.5" /> },
  "Unknown":  { label: "Unknown",  color: "text-muted-foreground border-border",                icon: <Clock className="w-3.5 h-3.5" /> },
};

export function FlightLookupCard({ flightNumber, direction, date, onAutoFill }: Props) {
  const [data, setData] = useState<FlightStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [unavailableReason, setUnavailableReason] = useState<string | null>(null);
  // Cache key: flight|date|direction — exactly one request per unique combination.
  const [lastFetched, setLastFetched] = useState("");

  const dir = direction === "Departure" ? "Departure" : "Arrival";

  useEffect(() => {
    const normalized = flightNumber?.toUpperCase().replace(/\s/g, "");
    // Require at least 4 characters (e.g. "BA12") before firing so partial
    // entries like "BA1" don't consume quota.
    if (!normalized || normalized.length < 4) {
      setData(null);
      setNotFound(false);
      return;
    }
    // Need a date — pre-bookings can be weeks out.
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setData(null);
      setNotFound(false);
      return;
    }
    // One request per unique flight + date + direction combination.
    const cacheKey = `${normalized}|${date}|${dir}`;
    if (cacheKey === lastFetched) return;

    // 1 s debounce so the user finishes typing before we fire.
    const timer = setTimeout(async () => {
      setLoading(true);
      setNotFound(false);
      try {
        const res = await fetch(
          `/api/flight-tracker/${encodeURIComponent(normalized)}?date=${date}&direction=${dir}`
        );
        if (res.ok) {
          const json = await res.json();
          if (json && json.status !== undefined && (json.origin || json.destination || json.scheduled_time)) {
            setData(json);
            setUnavailableReason(null);
          } else {
            setData(null);
            setNotFound(true);
            setUnavailableReason(json?.unavailable_reason ?? null);
          }
          setLastFetched(cacheKey);
        } else {
          setData(null);
          setNotFound(true);
          setUnavailableReason(null);
          setLastFetched(cacheKey);
        }
      } catch {
        // silent — no disruptive error for the operator
      } finally {
        setLoading(false);
      }
    }, 1000);

    return () => clearTimeout(timer);
  }, [flightNumber, date, dir]);

  if (!flightNumber || flightNumber.length < 4) return null;

  // Helpful hint when the operator hasn't entered a date yet.
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return (
      <div className="px-3 py-2.5 rounded-xl border border-border bg-card/50 text-xs text-muted-foreground">
        Enter the booking date above to look up live data for{" "}
        <span className="font-mono text-foreground">{flightNumber.toUpperCase()}</span>.
      </div>
    );
  }

  const meta = STATUS_META[data?.status ?? "Unknown"] ?? STATUS_META["Unknown"];
  const isArrival = dir !== "Departure";

  const relevantTime = data?.estimated_time || data?.scheduled_time;

  const handleAutoFill = () => {
    if (!data || !relevantTime || !onAutoFill) return;
    // Format as HH:mm in UK time (Europe/London handles GMT vs BST automatically).
    const dt = new Date(relevantTime);
    const ukTime = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(dt);
    const origin = data.origin ?? "";
    const destination = data.destination ?? "";
    onAutoFill(ukTime, origin, destination, data.terminal ?? null);
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-border bg-card/50 text-xs text-muted-foreground">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        Verifying {flightNumber.toUpperCase()} on {format(new Date(`${date}T00:00:00`), "dd MMM yyyy")}…
      </div>
    );
  }

  if (!data) {
    if (notFound) {
      return (
        <div className="px-3 py-2.5 rounded-xl border border-amber-500/20 bg-amber-500/5 text-xs text-amber-300/90 space-y-1">
          <div>
            No live data for <span className="font-mono">{flightNumber.toUpperCase()}</span> on{" "}
            {format(new Date(`${date}T00:00:00`), "dd MMM yyyy")}. Enter pickup, drop-off and time manually.
          </div>
          {unavailableReason && (
            <div className="text-[11px] text-amber-300/70 italic">{unavailableReason}</div>
          )}
        </div>
      );
    }
    return null;
  }

  return (
    <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 space-y-2">
      {/* Header row */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {isArrival ? <PlaneLanding className="w-4 h-4 text-primary" /> : <PlaneTakeoff className="w-4 h-4 text-primary" />}
          <span className="font-mono font-bold text-sm text-foreground">{data.flight_number}</span>
          <Badge variant="outline" className={`text-[10px] gap-1 ${meta.color}`}>
            {meta.icon} {meta.label}
            {(data.delay_minutes ?? 0) > 0 && ` +${data.delay_minutes}m`}
            {(data.delay_minutes ?? 0) < 0 && ` ${Math.abs(data.delay_minutes!)}m early`}
          </Badge>
        </div>
        {data.terminal && (
          <span className="text-xs text-muted-foreground">Terminal {data.terminal}</span>
        )}
      </div>

      {/* Route — confirms which flight the operator is booking */}
      {(data.origin || data.destination) && (
        <div className="flex items-center gap-2 text-sm">
          <span className="font-medium text-foreground">{data.origin ?? "—"}</span>
          <ArrowRight className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="font-medium text-foreground">{data.destination ?? "—"}</span>
          {data.terminal && (
            <span className="text-xs text-muted-foreground ml-1">· Terminal {data.terminal}</span>
          )}
        </div>
      )}

      {/* Times — displayed in Europe/London */}
      {data.scheduled_time && (() => {
        const fmtHm = (iso: string) => new Intl.DateTimeFormat("en-GB", {
          hour: "2-digit", minute: "2-digit", timeZone: "Europe/London",
        }).format(new Date(iso));
        const fmtDate = (iso: string) => new Intl.DateTimeFormat("en-GB", {
          day: "numeric", month: "short", timeZone: "Europe/London",
        }).format(new Date(iso));
        const diffMins = data.estimated_time
          ? Math.round((new Date(data.estimated_time).getTime() - new Date(data.scheduled_time).getTime()) / 60000)
          : 0;
        const isDelayed = diffMins > 10;
        const isEarly   = diffMins < -10;
        return (
          <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
            <span className="flex items-center gap-1">
              🕐 {isArrival ? "Arrival" : "Departure"}:{" "}
              <span className={`font-medium ${(isDelayed || isEarly) ? "line-through text-muted-foreground" : "text-foreground"}`}>
                {fmtDate(data.scheduled_time)} · {fmtHm(data.scheduled_time)}
              </span>
            </span>
            {data.estimated_time && (isDelayed || isEarly) && (
              <span className="flex items-center gap-1">
                ⏱ Est:{" "}
                <span className={`font-medium ${isDelayed ? "text-amber-400" : "text-green-400"}`}>
                  {fmtDate(data.estimated_time)} · {fmtHm(data.estimated_time)}
                  {isDelayed && <span className="ml-1 text-amber-500 font-normal">(+{diffMins}m)</span>}
                  {isEarly  && <span className="ml-1 text-green-500 font-normal">({Math.abs(diffMins)}m early)</span>}
                </span>
              </span>
            )}
          </div>
        );
      })()}

      {/* Auto-fill button */}
      {relevantTime && onAutoFill && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleAutoFill}
          className="h-7 text-xs border-primary/30 text-primary hover:bg-primary/10"
        >
          <Clock className="w-3 h-3 mr-1" />
          Auto-fill time{isArrival ? ", pickup airport" : ", drop-off airport"}{data.terminal ? " & terminal" : ""}
        </Button>
      )}

      {data.last_updated && (
        <p className="text-[10px] text-muted-foreground/50">
          Verified {new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" }).format(new Date(data.last_updated))}
        </p>
      )}
    </div>
  );
}
