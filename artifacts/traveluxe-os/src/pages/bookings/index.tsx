import { useState } from "react";
import { useListBookings, getListBookingsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, Briefcase, CalendarRange } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { format } from "date-fns";
import { Input } from "@/components/ui/input";

export default function Bookings() {
  const [status, setStatus] = useState<string>("");
  const [search, setSearch] = useState<string>("");
  
  const { data: bookings, isLoading } = useListBookings(
    { status: status || undefined },
    { query: { enabled: true, queryKey: getListBookingsQueryKey({ status: status || undefined }) } }
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

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Bookings</h1>
        <Link href="/bookings/new">
          <Button className="w-full sm:w-auto h-12 shadow-[0_0_10px_rgba(201,168,76,0.2)]">
            <Plus className="w-4 h-4 mr-2" />
            New Booking
          </Button>
        </Link>
      </div>

      <div className="flex flex-col md:flex-row gap-4">
        <Input 
          placeholder="Filter... (Mock UI for now)" 
          className="md:w-64"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="flex gap-2 overflow-x-auto pb-2 flex-1">
          <Button variant={status === "" ? "default" : "outline"} onClick={() => setStatus("")}>All</Button>
          <Button variant={status === "Confirmed" ? "default" : "outline"} onClick={() => setStatus("Confirmed")}>Confirmed</Button>
          <Button variant={status === "Driver Assigned" ? "default" : "outline"} onClick={() => setStatus("Driver Assigned")}>Assigned</Button>
          <Button variant={status === "Active" ? "default" : "outline"} onClick={() => setStatus("Active")}>Active</Button>
          <Button variant={status === "Completed" ? "default" : "outline"} onClick={() => setStatus("Completed")}>Completed</Button>
          <Button variant={status === "Cancelled" ? "default" : "outline"} onClick={() => setStatus("Cancelled")}>Cancelled</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {isLoading ? (
          [...Array(6)].map((_, i) => <Skeleton key={i} className="h-48" />)
        ) : bookings?.map((booking) => (
          <Card key={booking.id} className="border-primary/10 hover:border-primary/30 transition-colors bg-card overflow-hidden flex flex-col">
            <CardContent className="p-5 flex-1 flex flex-col">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <div className="text-xs text-muted-foreground font-mono">{booking.tvl_ref}</div>
                  <h3 className="font-bold text-lg text-foreground">{booking.client_name || 'Unknown Client'}</h3>
                  <div className="text-sm text-muted-foreground mt-1 flex items-center">
                    <CalendarRange className="w-3 h-3 mr-1" />
                    {booking.date_time ? format(new Date(booking.date_time), 'PPp') : 'TBD'}
                  </div>
                </div>
                <Badge variant="outline" className={getStatusColor(booking.status)}>
                  {booking.status}
                </Badge>
              </div>
              
              <div className="mt-auto grid grid-cols-2 gap-2 text-sm text-muted-foreground mb-4">
                <div>
                  <span className="block text-xs uppercase opacity-70">Driver</span>
                  <span className="font-medium text-foreground">{booking.driver_name || 'Unassigned'}</span>
                </div>
                <div>
                  <span className="block text-xs uppercase opacity-70">Price</span>
                  <span className="font-medium text-primary">£{booking.price.toLocaleString()}</span>
                </div>
              </div>
              
              <div className="flex gap-2 mt-auto pt-4 border-t border-border/50">
                <Link href={`/bookings/${booking.id}`} className="flex-1">
                  <Button variant="outline" className="w-full h-10">
                    <Briefcase className="w-4 h-4 mr-2" />
                    Job Sheet
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        ))}
        {bookings?.length === 0 && (
          <div className="col-span-full py-12 text-center text-muted-foreground border border-dashed rounded-lg">
            No bookings found.
          </div>
        )}
      </div>
    </div>
  );
}
