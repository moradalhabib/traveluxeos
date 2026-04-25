import { useListFlightTracker, getListFlightTrackerQueryKey } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Plane, RefreshCcw, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { isValid } from "date-fns";

// Format a UTC ISO string → "dd MMM, HH:mm" in London time
const fmtTime = (iso?: string | null): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (!isValid(d)) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit", month: "short",
    hour: "2-digit", minute: "2-digit",
    timeZone: "Europe/London",
  }).format(d);
};

// Format a UTC ISO string → "HH:mm" only (for the compact estimated column)
const fmtHm = (iso?: string | null): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (!isValid(d)) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit", minute: "2-digit",
    timeZone: "Europe/London",
  }).format(d);
};

const diffMins = (scheduled?: string | null, estimated?: string | null): number => {
  if (!scheduled || !estimated) return 0;
  return Math.round((new Date(estimated).getTime() - new Date(scheduled).getTime()) / 60000);
};

export default function Flights() {
  const { data: flights, isLoading, refetch } = useListFlightTracker(
    { query: { enabled: true, queryKey: getListFlightTrackerQueryKey() } }
  );

  const statusBadgeClass = (status?: string) => {
    switch (status?.toLowerCase()) {
      case "landed":    return "bg-blue-500/20 text-blue-400 border-blue-500/40";
      case "early":     return "bg-emerald-500/20 text-emerald-400 border-emerald-500/40";
      case "delayed":   return "bg-amber-500/20 text-amber-400 border-amber-500/40";
      case "cancelled": return "bg-destructive/20 text-destructive border-destructive/40";
      case "on time":   return "bg-green-500/20 text-green-400 border-green-500/40";
      default:          return "bg-secondary text-secondary-foreground border-border";
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Flight Tracker</h1>
        <Button variant="outline" onClick={() => refetch()} className="border-primary/20 hover:bg-primary/10 hover:text-primary">
          <RefreshCcw className="w-4 h-4 mr-2" />
          Refresh Now
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {isLoading ? (
          [...Array(4)].map((_, i) => <Skeleton key={i} className="h-24" />)
        ) : flights?.map((tracker: any) => {
          const fs = tracker.flight_status;
          const hasLive = !!fs;
          const liveStatus = fs?.status as string | undefined;

          // Prefer AeroDataBox scheduled time; fall back to booking date_time
          const schedIso  = fs?.scheduled_time || tracker.scheduled_time || null;
          const estIso    = fs?.estimated_time || null;
          const delayMin  = diffMins(schedIso, estIso);
          const isDelayed = delayMin > 10;
          const isEarly   = delayMin < -10;

          const origin      = fs?.origin      || tracker.pickup  || "Awaiting feed";
          const destination = fs?.destination || tracker.dropoff || "Awaiting feed";

          return (
            <Card key={tracker.booking_id} className="border-primary/10 bg-card overflow-hidden">
              <CardContent className="p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                {/* Left: flight icon + number + route */}
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-full bg-blue-500/10 flex items-center justify-center flex-shrink-0">
                    <Plane className="w-6 h-6 text-blue-400" />
                  </div>
                  <div>
                    <h3 className="font-bold text-lg text-foreground flex items-center gap-2 flex-wrap">
                      <Link href={`/bookings/${tracker.booking_id}`} className="hover:underline">
                        {tracker.flight_number}
                      </Link>
                      <Badge variant="outline" className={statusBadgeClass(liveStatus)}>
                        {liveStatus || (hasLive ? "Unknown" : "Awaiting feed")}
                      </Badge>
                      {tracker.tvl_ref && (
                        <span className="font-mono text-xs text-muted-foreground">{tracker.tvl_ref}</span>
                      )}
                    </h3>
                    <div className="text-sm text-muted-foreground">
                      {origin} → {destination}
                    </div>
                    {fs?.terminal && (
                      <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                        <Terminal className="w-3 h-3" />
                        Terminal {fs.terminal}
                      </div>
                    )}
                  </div>
                </div>

                {/* Right: grid of time/client/driver cells */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 w-full md:w-auto text-sm">
                  {/* Scheduled */}
                  <div>
                    <span className="block text-xs uppercase text-muted-foreground opacity-70 mb-0.5">Scheduled</span>
                    <span className={`font-medium ${isDelayed ? "line-through text-muted-foreground" : "text-foreground"}`}>
                      {fmtTime(schedIso)}
                    </span>
                  </div>

                  {/* Estimated / actual */}
                  <div>
                    <span className="block text-xs uppercase text-muted-foreground opacity-70 mb-0.5">Estimated</span>
                    {estIso ? (
                      <span className={`font-semibold ${isDelayed ? "text-amber-400" : isEarly ? "text-green-400" : "text-foreground"}`}>
                        {fmtHm(estIso)}
                        {isDelayed && (
                          <span className="ml-1 text-[11px] font-normal text-amber-500">(+{delayMin}m)</span>
                        )}
                        {isEarly && (
                          <span className="ml-1 text-[11px] font-normal text-green-500">({Math.abs(delayMin)}m early)</span>
                        )}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </div>

                  {/* Client */}
                  <div>
                    <span className="block text-xs uppercase text-muted-foreground opacity-70 mb-0.5">Client</span>
                    <span className="font-medium text-foreground">{tracker.client_name || "—"}</span>
                  </div>

                  {/* Driver */}
                  <div>
                    <span className="block text-xs uppercase text-muted-foreground opacity-70 mb-0.5">Driver</span>
                    <span className="font-medium text-foreground flex items-center gap-1.5 flex-wrap">
                      {(tracker as any).driver_staff_no && (
                        <span className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-primary/15 text-primary border border-primary/30">
                          {(tracker as any).driver_staff_no}
                        </span>
                      )}
                      {tracker.driver_name || "Unassigned"}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
        {!isLoading && flights?.length === 0 && (
          <div className="py-12 text-center text-muted-foreground border border-dashed rounded-lg">
            No airport transfer flights to track today or tomorrow.
          </div>
        )}
      </div>
    </div>
  );
}
