import { useState, useMemo } from "react";
import {
  useListBookings, getListBookingsQueryKey,
  useUpdateBookingStatus, useUpdateBooking,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useLocation, useSearch } from "wouter";
import { format, isToday, isTomorrow, startOfDay, endOfDay, addDays, isBefore, isAfter } from "date-fns";
import { AlertTriangle, MapPin, Plus, Car, Clock, Briefcase, X } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQueryClient } from "@tanstack/react-query";

const STATUS_COLORS: Record<string, string> = {
  'Pending':   'bg-amber-500/20 text-amber-400 border-amber-500/50',
  'Confirmed': 'bg-blue-500/20 text-blue-400 border-blue-500/50',
  'Active':    'bg-green-500/20 text-green-400 border-green-500/50',
  'Completed': 'bg-gray-500/20 text-gray-400 border-gray-500/50',
  'Cancelled': 'bg-destructive/20 text-destructive border-destructive/50',
};

const PAYMENT_COLORS: Record<string, string> = {
  'Paid':    'text-green-400 border-green-500/40 bg-green-500/10',
  'Partial': 'text-blue-400  border-blue-500/40  bg-blue-500/10',
  'Unpaid':  'text-amber-400 border-amber-500/40 bg-amber-500/10',
};

export default function Jobs() {
  const [, setLocation] = useLocation();
  const [timeFilter, setTimeFilter] = useState("all");
  const search = useSearch();
  const statusFilter = new URLSearchParams(search).get("status") ?? "";
  const qc = useQueryClient();

  const { data: bookings, isLoading } = useListBookings(
    {},
    { query: { enabled: true, queryKey: getListBookingsQueryKey({}) } }
  );

  const updateStatus  = useUpdateBookingStatus();
  const updateBooking = useUpdateBooking();

  const handleStatusChange = (e: React.ChangeEvent<HTMLSelectElement>, jobId: string) => {
    e.preventDefault();
    e.stopPropagation();
    const newStatus = e.target.value;
    updateStatus.mutate({ id: jobId, data: { status: newStatus } }, {
      onSuccess: () => qc.invalidateQueries({ queryKey: getListBookingsQueryKey({}) }),
    });
  };

  const handlePaymentChange = (e: React.ChangeEvent<HTMLSelectElement>, jobId: string) => {
    e.preventDefault();
    e.stopPropagation();
    const newPayment = e.target.value;
    updateBooking.mutate({ id: jobId, data: { payment_status: newPayment } as any }, {
      onSuccess: () => qc.invalidateQueries({ queryKey: getListBookingsQueryKey({}) }),
    });
  };

  const filteredBookings = useMemo(() => {
    if (!bookings) return [];
    const now = new Date();
    return bookings.filter(b => {
      if (b.status === 'Cancelled') return false;
      if (statusFilter && b.status !== statusFilter) return false;
      if (statusFilter) return true;
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
  }, [bookings, timeFilter, statusFilter]);

  const urgentJobs = filteredBookings.filter(b => !b.driver_id && b.status !== 'Completed');
  const activeJobs = bookings?.filter(b => b.status !== 'Cancelled') || [];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            {statusFilter ? `${statusFilter} Jobs` : "Jobs Board"}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {filteredBookings.length} job{filteredBookings.length !== 1 ? 's' : ''}
            {statusFilter ? ` · status: ${statusFilter}` : ` · ${activeJobs.length} total active`}
          </p>
        </div>
        <Button
          className="shadow-[0_0_15px_rgba(201,168,76,0.25)] hover:shadow-[0_0_25px_rgba(201,168,76,0.4)]"
          onClick={() => setLocation("/bookings/new")}
        >
          <Plus className="w-4 h-4 mr-2" />
          New Booking
        </Button>
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

      {statusFilter && (
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="border-primary/40 text-primary bg-primary/10 gap-1.5 py-1">
            Showing only: {statusFilter}
          </Badge>
          <Button variant="ghost" size="sm" className="text-muted-foreground gap-1 h-8" onClick={() => setLocation("/jobs")}>
            <X className="w-3.5 h-3.5" /> Clear
          </Button>
        </div>
      )}

      {!statusFilter && (
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
      )}

      {/* Job cards */}
      <div className="space-y-3">
        {isLoading ? (
          [...Array(4)].map((_, i) => <Skeleton key={i} className="h-36" />)
        ) : filteredBookings.length > 0 ? filteredBookings.map((job) => (
          <Card
            key={job.id}
            className="border-border hover:border-primary/40 hover:bg-secondary/10 transition-all bg-card overflow-hidden cursor-pointer"
            onClick={() => setLocation(`/bookings/${job.id}`)}
          >
            <CardContent className="p-4">
              {/* Top row: ref + time + status dropdown */}
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
                <div className="flex flex-col items-end gap-1.5">
                  {/* Inline status dropdown */}
                  <select
                    value={job.status}
                    onClick={e => e.stopPropagation()}
                    onChange={e => handleStatusChange(e, job.id)}
                    className={`h-7 rounded-full border text-[11px] font-semibold px-2 cursor-pointer appearance-none text-center ${STATUS_COLORS[job.status] ?? 'bg-secondary text-secondary-foreground border-border'}`}
                  >
                    <option value="Pending">Pending</option>
                    <option value="Confirmed">Confirmed</option>
                    <option value="Active">Active</option>
                    <option value="Completed">Completed</option>
                    <option value="Cancelled">Cancelled</option>
                  </select>
                  {job.date_time && (
                    <div className="flex flex-col items-end gap-0.5">
                      <div className="flex items-center gap-1 text-sm font-semibold text-foreground">
                        <Clock className="w-3 h-3 text-primary" />
                        {format(new Date(job.date_time), 'HH:mm')}
                      </div>
                      <span className="text-[10px] text-muted-foreground">
                        {isToday(new Date(job.date_time)) ? "Today"
                          : isTomorrow(new Date(job.date_time)) ? "Tomorrow"
                          : format(new Date(job.date_time), "dd MMM")}
                      </span>
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
                  <span className="text-foreground">{(job as any).dropoff || (job as any).destination || '—'}</span>
                </span>
              </div>

              {/* Bottom row: driver + price + payment dropdown */}
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
                  {/* Inline payment status dropdown */}
                  <select
                    value={job.payment_status || "Unpaid"}
                    onClick={e => e.stopPropagation()}
                    onChange={e => handlePaymentChange(e, job.id)}
                    className={`h-6 rounded-full border text-[10px] font-semibold px-2 cursor-pointer appearance-none text-center ${PAYMENT_COLORS[job.payment_status || 'Unpaid'] ?? 'text-amber-400 border-amber-500/40 bg-amber-500/10'}`}
                  >
                    <option value="Unpaid">Unpaid</option>
                    <option value="Partial">Partial</option>
                    <option value="Paid">Paid</option>
                  </select>
                </div>
              </div>
            </CardContent>
          </Card>
        )) : (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Briefcase className="w-12 h-12 text-muted-foreground/30 mb-4" />
            <p className="text-muted-foreground font-medium">No jobs for this period</p>
            <p className="text-sm text-muted-foreground/70 mt-1 mb-6">Create your first booking to get started</p>
            <Button onClick={() => setLocation("/bookings/new")}>
              <Plus className="w-4 h-4 mr-2" />
              New Booking
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
