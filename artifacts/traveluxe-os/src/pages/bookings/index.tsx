import { useState, useMemo } from "react";
import { useListBookings, getListBookingsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, Briefcase, CalendarRange, Home, X } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Link, useSearch } from "wouter";
import { format, startOfDay, isBefore } from "date-fns";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/use-auth";

export default function Bookings() {
  const { user } = useAuth();
  const isResidenceManager = user?.role === "residence_manager";

  const [status, setStatus] = useState<string>("");
  const [search, setSearch] = useState<string>("");
  const [source, setSource] = useState<"active" | "imported">("active");
  const urlSearch = useSearch();
  const upcomingOnly = new URLSearchParams(urlSearch).get("upcoming") === "1";

  // The "Imported (Odoo)" sub-tab pulls archived legacy bookings; the default
  // "Active" tab excludes them so day-to-day operations aren't cluttered with
  // historic records that no longer require attention.
  const importedParam = source === "imported" ? ("only" as const) : ("exclude" as const);
  const params = { status: status || undefined, imported: importedParam };
  const { data: rawBookings, isLoading } = useListBookings(
    params,
    { query: { enabled: true, queryKey: getListBookingsQueryKey(params) } }
  );

  // Residence Managers only ever see Apartment bookings
  const bookings = useMemo(() => {
    if (!rawBookings) return [];
    let list = rawBookings as any[];
    if (isResidenceManager) {
      list = list.filter((b) => b.service_type === "Apartment");
    }
    // ?upcoming=1 → only show future bookings that aren't already running/finished
    if (upcomingOnly) {
      const today = startOfDay(new Date());
      const exclude = new Set(["Active", "Completed", "Cancelled"]);
      list = list.filter((b) => {
        if (exclude.has(b.status)) return false;
        if (!b.date_time) return true;
        return !isBefore(new Date(b.date_time), today);
      });
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (b) =>
          (b.client_name ?? "").toLowerCase().includes(q) ||
          (b.tvl_ref ?? "").toLowerCase().includes(q) ||
          (b.pickup ?? "").toLowerCase().includes(q) ||
          (b.dropoff ?? "").toLowerCase().includes(q)
      );
    }
    return list;
  }, [rawBookings, isResidenceManager, search, upcomingOnly]);

  const getStatusColor = (s: string) => {
    switch (s) {
      case "Pending":   return "bg-amber-500/20 text-amber-500 border-amber-500/50";
      case "Confirmed": return "bg-blue-500/20 text-blue-500 border-blue-500/50";
      case "Active":    return "bg-green-500/20 text-green-500 border-green-500/50";
      case "Completed": return "bg-gray-500/20 text-gray-500 border-gray-500/50";
      case "Cancelled": return "bg-destructive/20 text-destructive border-destructive/50";
      default:          return "bg-secondary text-secondary-foreground border-border";
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-2">
            {isResidenceManager && <Home className="w-7 h-7 text-primary" />}
            {isResidenceManager
              ? "Apartment Bookings"
              : upcomingOnly
                ? "Upcoming Bookings"
                : "Bookings"}
          </h1>
          {isResidenceManager && (
            <p className="text-sm text-muted-foreground mt-0.5">
              View and update status on apartment bookings
            </p>
          )}
          {upcomingOnly && !isResidenceManager && (
            <div className="flex items-center gap-2 mt-2">
              <Badge variant="outline" className="border-primary/40 text-primary bg-primary/10">
                Showing only: future bookings (excl. Active / Completed)
              </Badge>
              <Link href="/bookings">
                <Button variant="ghost" size="sm" className="text-muted-foreground gap-1 h-8">
                  <X className="w-3.5 h-3.5" /> Clear
                </Button>
              </Link>
            </div>
          )}
        </div>
        {!isResidenceManager && (
          <Link href="/bookings/new">
            <Button className="w-full sm:w-auto h-12 shadow-[0_0_10px_rgba(201,168,76,0.2)]">
              <Plus className="w-4 h-4 mr-2" />
              New Booking
            </Button>
          </Link>
        )}
      </div>

      {/* Source tabs — keep imported Odoo data segregated from active ops */}
      {!isResidenceManager && (
        <div className="flex gap-1 border border-border rounded-xl p-1 bg-secondary/20 w-full sm:w-fit">
          <button
            onClick={() => setSource("active")}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${
              source === "active"
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
            data-testid="tab-bookings-active"
          >
            Active
          </button>
          <button
            onClick={() => setSource("imported")}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${
              source === "imported"
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
            data-testid="tab-bookings-imported"
          >
            Imported (Odoo)
          </button>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col md:flex-row gap-4">
        <Input
          placeholder="Search by client, ref, pickup…"
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

      {/* Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {isLoading ? (
          [...Array(6)].map((_, i) => <Skeleton key={i} className="h-48" />)
        ) : bookings.map((booking: any) => (
          <Card key={booking.id} className="border-primary/10 hover:border-primary/30 transition-colors bg-card overflow-hidden flex flex-col">
            <CardContent className="p-5 flex-1 flex flex-col">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <div className="text-xs text-muted-foreground font-mono">{booking.tvl_ref}</div>
                  <h3 className="font-bold text-lg text-foreground">{booking.client_name || "Unknown Client"}</h3>
                  <div className="text-sm text-muted-foreground mt-1 flex items-center">
                    <CalendarRange className="w-3 h-3 mr-1" />
                    {booking.date_time ? format(new Date(booking.date_time), "PPp") : "TBD"}
                  </div>
                </div>
                <Badge variant="outline" className={getStatusColor(booking.status)}>
                  {booking.status}
                </Badge>
              </div>

              <div className="mt-auto grid grid-cols-2 gap-2 text-sm text-muted-foreground mb-4">
                {/* Residence Manager: no driver info, no price */}
                {isResidenceManager ? (
                  <>
                    <div>
                      <span className="block text-xs uppercase opacity-70">Pickup</span>
                      <span className="font-medium text-foreground text-sm">{booking.pickup || "—"}</span>
                    </div>
                    <div>
                      <span className="block text-xs uppercase opacity-70">Check-in</span>
                      <span className="font-medium text-foreground text-sm">
                        {booking.date_time ? format(new Date(booking.date_time), "d MMM") : "—"}
                      </span>
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <span className="block text-xs uppercase opacity-70">Driver</span>
                      <span className="font-medium text-foreground">{booking.driver_name || "Unassigned"}</span>
                    </div>
                    <div>
                      <span className="block text-xs uppercase opacity-70">Price</span>
                      <span className="font-medium text-primary">£{booking.price?.toLocaleString()}</span>
                    </div>
                  </>
                )}
              </div>

              <div className="flex gap-2 mt-auto pt-4 border-t border-border/50">
                <Link href={`/bookings/${booking.id}`} className="flex-1">
                  <Button variant="outline" className="w-full h-10">
                    <Briefcase className="w-4 h-4 mr-2" />
                    {isResidenceManager ? "View Details" : "Job Sheet"}
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        ))}
        {bookings.length === 0 && !isLoading && (
          <div className="col-span-full py-12 text-center text-muted-foreground border border-dashed rounded-lg">
            {isResidenceManager
              ? "No apartment bookings found."
              : "No bookings found."}
          </div>
        )}
      </div>
    </div>
  );
}
