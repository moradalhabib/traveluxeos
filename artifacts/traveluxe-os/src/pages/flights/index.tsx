import { useListFlightTracker, getListFlightTrackerQueryKey } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Plane, RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { format, isValid } from "date-fns";

const fmtTime = (iso?: string | null) => {
  if (!iso) return "-";
  const d = new Date(iso);
  return isValid(d) ? format(d, "dd MMM, HH:mm") : "-";
};

export default function Flights() {
  const { data: flights, isLoading, refetch } = useListFlightTracker(
    { query: { enabled: true, queryKey: getListFlightTrackerQueryKey() } }
  );

  const flightStatusColor = (status?: string) => {
    switch(status?.toLowerCase()) {
      case 'landed': return 'bg-blue-500/20 text-blue-500 border-blue-500/50';
      case 'delayed': return 'bg-amber-500/20 text-amber-500 border-amber-500/50';
      case 'cancelled': return 'bg-destructive/20 text-destructive border-destructive/50';
      case 'on time': return 'bg-green-500/20 text-green-500 border-green-500/50';
      default: return 'bg-secondary text-secondary-foreground border-border';
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
          // Prefer live origin/destination; fall back to the booking's pickup/dropoff
          // so the operator never sees "Unknown → Unknown" when AviationStack
          // hasn't returned data for this flight yet.
          const origin = tracker.flight_status?.origin || tracker.pickup || "Awaiting feed";
          const destination = tracker.flight_status?.destination || tracker.dropoff || "Awaiting feed";
          const liveStatus = tracker.flight_status?.status as string | undefined;
          const hasLive = !!tracker.flight_status;
          return (
            <Card key={tracker.booking_id} className="border-primary/10 bg-card overflow-hidden">
              <CardContent className="p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-full bg-blue-500/10 flex items-center justify-center flex-shrink-0">
                    <Plane className="w-6 h-6 text-blue-500" />
                  </div>
                  <div>
                    <h3 className="font-bold text-lg text-foreground flex items-center gap-2 flex-wrap">
                      <Link href={`/bookings/${tracker.booking_id}`} className="hover:underline">
                        {tracker.flight_number}
                      </Link>
                      <Badge variant="outline" className={flightStatusColor(liveStatus)}>
                        {liveStatus || (hasLive ? "Unknown" : "Awaiting feed")}
                      </Badge>
                      {tracker.tvl_ref && (
                        <span className="font-mono text-xs text-muted-foreground">{tracker.tvl_ref}</span>
                      )}
                    </h3>
                    <div className="text-sm text-muted-foreground">
                      {origin} → {destination}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 w-full md:w-auto text-sm">
                  <div>
                    <span className="block text-xs uppercase text-muted-foreground opacity-70">Scheduled</span>
                    <span className="font-medium text-foreground">{fmtTime(tracker.scheduled_time)}</span>
                  </div>
                  <div>
                    <span className="block text-xs uppercase text-muted-foreground opacity-70">Estimated</span>
                    <span className="font-medium text-foreground">{fmtTime(tracker.flight_status?.estimated_time)}</span>
                  </div>
                  <div>
                    <span className="block text-xs uppercase text-muted-foreground opacity-70">Client</span>
                    <span className="font-medium text-foreground">{tracker.client_name || '-'}</span>
                  </div>
                  <div>
                    <span className="block text-xs uppercase text-muted-foreground opacity-70">Driver</span>
                    <span className="font-medium text-foreground">{tracker.driver_name || 'Unassigned'}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
        {flights?.length === 0 && (
          <div className="py-12 text-center text-muted-foreground border border-dashed rounded-lg">
            No active arrival flights to track.
          </div>
        )}
      </div>
    </div>
  );
}
