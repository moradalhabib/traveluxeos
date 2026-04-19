import { useState, useMemo } from "react";
import { useListBookings, getListBookingsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { format, isToday, isTomorrow, startOfDay, endOfDay, addDays, isBefore, isAfter } from "date-fns";
import { AlertTriangle, MapPin, Plus, Car, Clock, Briefcase } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function Jobs() {
  const [timeFilter, setTimeFilter] = useState("today");

  const { data: bookings, isLoading } = useListBookings(
    {},
    { query: { enabled: true, queryKey: getListBookingsQueryKey({}) } }
  );

  const getStatusColor = (s: string) => {
    switch (s) {
      case 'Confirmed': return 'bg-blue-500/20 text-blue-400 border-blue-500/50';
      case 'Driver Assigned': return 'bg-primary/20 text-primary border-primary/50';
      case 'Active': return 'bg-green-500/20 text-green-400 border-green-500/50';
      case 'Completed': return 'bg-gray-500/20 text-gray-400 border-gray-500/50';
      case 'Cancelled': return 'bg-destructive/20 text-destructive border-destructive/50';
      case 'Invoiced': return 'bg-purple-500/20 text-purple-400 border-purple-500/50';
      default: return 'bg-secondary text-secondary-foreground border-border';
    }
  };

  const filteredBookings = useMemo(() => {
    if (!bookings) return [];
    const now = new Date();
    return bookings.filter(b => {
      if (b.status === 'Cancelled') return false;
      if (!b.date_time) return timeFilter === 'all';
      const d = new Date(b.date_time);
      switch (timeFilter) {
        case 'today': return isToday(d);
        case 'tomorrow': return isTomorrow(d);
        case 'this_week': {
          const weekEnd = endOfDay(addDays(now, 7));
          return !isBefore(d, startOfDay(now)) && !isAfter(d, weekEnd);
        }
        case 'all':
        default: return !isBefore(d, startOfDay(now));
      }
    });
  }, [bookings, timeFilter]);

  const urgentJobs = filteredBookings.filter(b => !b.driver_id && b.status !== 'Completed');
  const activeJobs = bookings?.filter(b => b.status !== 'Cancelled') || [];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Jobs Board</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{filteredBookings.length} job{filteredBookings.length !== 1 ? 's' : ''} · {activeJobs.length} total active</p>
        </div>
        <Link href="/bookings/new">
          <Button className="shadow-[0_0_15px_rgba(201,168,76,0.25)] hover:shadow-[0_0_25px_rgba(201,168,76,0.4)]">
            <Plus className="w-4 h-4 mr-2" />
            New Booking
          </Button>
        </Link>
      </div>

      {/* Urgent alert */}
      {urgentJobs.length > 0 && (
        <div className="bg-destructive/10 border border-destructive/30 rounded-xl p-4">
          <div className="flex items-center gap-2 text-destructive font-semibold text-sm">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            <span>{urgentJobs.length} job{urgentJobs.length > 1 ? 's' : ''} need a driver assigned urgently</span>
          </div>
        </div>
      )}

      {/* Time filter */}
      <Select value={timeFilter} onValueChange={setTimeFilter}>
        <SelectTrigger className="w-full sm:w-[200px]">
          <SelectValue placeholder="Filter by time" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="today">Today</SelectItem>
          <SelectItem value="tomorrow">Tomorrow</SelectItem>
          <SelectItem value="this_week">This Week</SelectItem>
          <SelectItem value="all">All Upcoming</SelectItem>
        </SelectContent>
      </Select>

      {/* Job cards */}
      <div className="space-y-3">
        {isLoading ? (
          [...Array(4)].map((_, i) => <Skeleton key={i} className="h-36" />)
        ) : filteredBookings.length > 0 ? filteredBookings.map((job) => (
          <Link key={job.id} href={`/bookings/${job.id}`}>
            <Card className="border-border hover:border-primary/40 hover:bg-secondary/10 transition-all cursor-pointer bg-card overflow-hidden">
              <CardContent className="p-4">
                {/* Top row: ref + time + status */}
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="text-xs text-muted-foreground font-mono">{job.tvl_ref}</div>
                    <div className="font-bold text-foreground text-base mt-0.5 flex items-center gap-2">
                      {job.client_name || 'Unknown Client'}
                      {job.client_vip_tier && job.client_vip_tier !== 'Standard' && (
                        <Badge variant="outline" className="text-[10px] py-0 px-1.5 bg-primary/10 text-primary border-primary/30">
                          {job.client_vip_tier}
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div className="text-right flex flex-col items-end gap-1.5">
                    <Badge variant="outline" className={getStatusColor(job.status)}>
                      {job.status}
                    </Badge>
                    {job.date_time && (
                      <div className="flex items-center gap-1 text-sm font-semibold text-foreground">
                        <Clock className="w-3 h-3 text-primary" />
                        {format(new Date(job.date_time), 'HH:mm')}
                      </div>
                    )}
                  </div>
                </div>

                {/* Route */}
                <div className="flex items-start gap-2 text-sm mb-3">
                  <MapPin className="w-4 h-4 mt-0.5 text-primary flex-shrink-0" />
                  <span className="text-muted-foreground line-clamp-1">
                    <span className="text-foreground">{job.pickup || '—'}</span>
                    <span className="mx-1.5 text-muted-foreground">→</span>
                    <span className="text-foreground">{job.dropoff || job.destination || '—'}</span>
                  </span>
                </div>

                {/* Bottom row: driver + price + payment */}
                <div className="flex items-center justify-between pt-3 border-t border-border">
                  <div className="flex items-center gap-2 text-sm">
                    <Car className="w-4 h-4 text-muted-foreground" />
                    {job.driver_name ? (
                      <span className="font-medium text-foreground">{job.driver_name}</span>
                    ) : (
                      <span className="text-destructive font-medium flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" /> No Driver
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-foreground">£{job.price}</span>
                    <Badge variant="outline" className={job.payment_status === 'Paid' ? 'text-green-400 border-green-500/30 text-[10px]' : 'text-amber-400 border-amber-500/30 text-[10px]'}>
                      {job.payment_status}
                    </Badge>
                  </div>
                </div>
              </CardContent>
            </Card>
          </Link>
        )) : (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Briefcase className="w-12 h-12 text-muted-foreground/30 mb-4" />
            <p className="text-muted-foreground font-medium">No jobs for this period</p>
            <p className="text-sm text-muted-foreground/70 mt-1 mb-6">Create your first booking to get started</p>
            <Link href="/bookings/new">
              <Button>
                <Plus className="w-4 h-4 mr-2" />
                New Booking
              </Button>
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

