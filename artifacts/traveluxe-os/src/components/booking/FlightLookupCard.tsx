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
  onAutoFill?: (dateTime: string, origin: string, destination: string) => void;
}

const STATUS_META: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  "On Time":  { label: "On Time",  color: "text-green-400 border-green-500/30 bg-green-500/10", icon: <CheckCircle2 className="w-3.5 h-3.5" /> },
  "Delayed":  { label: "Delayed",  color: "text-amber-400 border-amber-500/30 bg-amber-500/10", icon: <AlertTriangle className="w-3.5 h-3.5" /> },
  "Landed":   { label: "Landed",   color: "text-blue-400 border-blue-500/30 bg-blue-500/10",   icon: <PlaneLanding className="w-3.5 h-3.5" /> },
  "Cancelled":{ label: "Cancelled",color: "text-red-400 border-red-500/30 bg-red-500/10",     icon: <XCircle className="w-3.5 h-3.5" /> },
  "Unknown":  { label: "Unknown",  color: "text-muted-foreground border-border",               icon: <Clock className="w-3.5 h-3.5" /> },
};

export function FlightLookupCard({ flightNumber, direction, onAutoFill }: Props) {
  const [data, setData] = useState<FlightStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastFetched, setLastFetched] = useState("");

  useEffect(() => {
    const normalized = flightNumber?.toUpperCase().replace(/\s/g, "");
    if (!normalized || normalized.length < 3) {
      setData(null);
      return;
    }
    if (normalized === lastFetched) return;

    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const today = new Date().toISOString().split("T")[0];
        const res = await fetch(`/api/flight-tracker/${normalized}?date=${today}`);
        if (res.ok) {
          const json = await res.json();
          if (json && json.status !== undefined) {
            setData(json);
            setLastFetched(normalized);
          }
        }
      } catch {
        // silent — no disruptive error
      } finally {
        setLoading(false);
      }
    }, 900);

    return () => clearTimeout(timer);
  }, [flightNumber]);

  if (!flightNumber || flightNumber.length < 3) return null;

  const meta = STATUS_META[data?.status ?? "Unknown"] ?? STATUS_META["Unknown"];
  const isArrival = direction !== "Departure";

  const relevantTime = isArrival
    ? (data?.estimated_time || data?.scheduled_time)
    : (data?.estimated_time || data?.scheduled_time);

  const handleAutoFill = () => {
    if (!data || !relevantTime || !onAutoFill) return;
    const dt = new Date(relevantTime);
    // Format as datetime-local value (YYYY-MM-DDTHH:mm)
    const local = new Date(dt.getTime() - dt.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);
    const origin = data.origin ?? "";
    const destination = data.destination ?? "";
    onAutoFill(local, origin, destination);
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-border bg-card/50 text-xs text-muted-foreground">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        Looking up {flightNumber.toUpperCase()}…
      </div>
    );
  }

  if (!data) return null;

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
          </Badge>
        </div>
        {data.terminal && (
          <span className="text-xs text-muted-foreground">Terminal {data.terminal}</span>
        )}
      </div>

      {/* Route */}
      {(data.origin || data.destination) && (
        <div className="flex items-center gap-2 text-sm">
          <span className="font-medium text-foreground">{data.origin ?? "—"}</span>
          <ArrowRight className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="font-medium text-foreground">{data.destination ?? "—"}</span>
        </div>
      )}

      {/* Times */}
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        {data.scheduled_time && (
          <span>🕐 Scheduled: <span className="text-foreground font-medium">{format(new Date(data.scheduled_time), "HH:mm")}</span></span>
        )}
        {data.estimated_time && data.estimated_time !== data.scheduled_time && (
          <span>⏱ Est: <span className="text-amber-400 font-medium">{format(new Date(data.estimated_time), "HH:mm")}</span></span>
        )}
      </div>

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
          Auto-fill date & time
        </Button>
      )}

      {data.last_updated && (
        <p className="text-[10px] text-muted-foreground/50">
          Updated {format(new Date(data.last_updated), "HH:mm")}
        </p>
      )}
    </div>
  );
}
