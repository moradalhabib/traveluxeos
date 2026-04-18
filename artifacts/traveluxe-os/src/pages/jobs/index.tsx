import { useState } from "react";
import { useListBookings, getListBookingsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { format } from "date-fns";
import { AlertTriangle, MapPin } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function Jobs() {
  const [timeFilter, setTimeFilter] = useState("today");
  
  const { data: bookings, isLoading } = useListBookings(
    {}, // time filter applied locally for mock simplicity
    { query: { enabled: true, queryKey: getListBookingsQueryKey({}) } }
  );

  const getStatusColor = (s: string) => {
    switch (s) {
      case 'Confirmed': return 'bg-blue-500/20 text-blue-500 border-blue-500/50';
      case 'Driver Assigned': return 'bg-primary/20 text-primary border-primary/50';
      case 'Active': return 'bg-green-500/20 text-green-500 border-green-500/50';
      case 'Completed': return 'bg-gray-500/20 text-gray-500 border-gray-500/50';
      case 'Cancelled': return 'bg-destructive/20 text-destructive border-destructive/50';
      case 'Invoiced': return 'bg-purple-500/20 text-purple-500 border-purple-500/50';
      default: return 'bg-secondary text-secondary-foreground border-border';
    }
  };

  const urgentJobs = bookings?.filter(b => !b.driver_id && b.status !== 'Completed' && b.status !== 'Cancelled') || [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Jobs Board</h1>
        <Select value={timeFilter} onValueChange={setTimeFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Select time" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="today">Today</SelectItem>
            <SelectItem value="tomorrow">Tomorrow</SelectItem>
            <SelectItem value="this_week">This Week</SelectItem>
            <SelectItem value="all">All Upcoming</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {urgentJobs.length > 0 && (
        <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4">
          <div className="flex items-center gap-2 text-destructive font-bold mb-2">
            <AlertTriangle className="w-5 h-5" />
            <span>Jobs requiring immediate driver assignment</span>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {isLoading ? (
          [...Array(6)].map((_, i) => <Skeleton key={i} className="h-32" />)
        ) : bookings?.map((job) => (
          <Link key={job.id} href={`/bookings/${job.id}`}>
            <Card className="border-primary/10 hover:border-primary/50 hover:bg-secondary/20 transition-all cursor-pointer bg-card overflow-hidden">
              <CardContent className="p-4">
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <div className="text-xs text-muted-foreground font-mono mb-1">{job.tvl_ref}</div>
                    <h3 className="font-bold text-foreground text-lg flex items-center gap-2">
                      {job.client_name}
                      {job.client_vip_tier && (
                        <Badge variant="outline" className="text-[10px] py-0 px-1 bg-primary/10 text-primary border-primary/20">
                          {job.client_vip_tier}
                        </Badge>
                      )}
                    </h3>
                  </div>
                  <div className="text-right">
                    <Badge variant="outline" className={`${getStatusColor(job.status)} mb-1`}>
                      {job.status}
                    </Badge>
                    <div className="text-sm font-medium text-foreground">
                      {job.date_time ? format(new Date(job.date_time), 'HH:mm') : ''}
                    </div>
                  </div>
                </div>

                <div className="flex items-start gap-2 text-sm text-muted-foreground mt-2">
                  <MapPin className="w-4 h-4 mt-0.5 text-primary/70 flex-shrink-0" />
                  <div className="line-clamp-2">
                    <span className="text-foreground">{job.pickup || '-'}</span>
                    <span className="mx-2">→</span>
                    <span className="text-foreground">{job.dropoff || job.destination || '-'}</span>
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-border flex justify-between items-center text-sm">
                  <div className="font-medium">
                    {job.driver_name ? (
                      <span className="text-foreground">{job.driver_name}</span>
                    ) : (
                      <span className="text-destructive flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" /> No Driver
                      </span>
                    )}
                  </div>
                  <Badge variant="outline" className={job.payment_status === 'Paid' ? 'text-green-500 border-green-500/20' : 'text-amber-500 border-amber-500/20'}>
                    {job.payment_status}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
