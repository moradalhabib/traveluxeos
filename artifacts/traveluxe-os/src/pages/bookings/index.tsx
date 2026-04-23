import { useState, useMemo } from "react";
import { useListBookings, getListBookingsQueryKey, useDeleteBooking } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, Briefcase, CalendarRange, Home, X, StickyNote, Trash2 } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { Link, useSearch } from "wouter";
import { format, startOfDay, isBefore } from "date-fns";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/hooks/use-auth";

// Sort + Group controls (Fix 3). Default sort is Most Recent (created_at desc)
// across all list pages in the app; bookings additionally exposes Group By
// Service Type so operators can scan bookings clustered by service.
type SortKey = "recent" | "oldest" | "service" | "status" | "price";
type GroupKey = "none" | "service";
const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "recent",  label: "Most Recent" },
  { value: "oldest",  label: "Oldest" },
  { value: "service", label: "By Service Type" },
  { value: "status",  label: "By Status" },
  { value: "price",   label: "By Price" },
];
const STATUS_ORDER: Record<string, number> = {
  Pending: 0, Confirmed: 1, Active: 2, Completed: 3, Cancelled: 4,
};

export default function Bookings() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isResidenceManager = user?.role === "residence_manager";
  const isSuperAdmin = user?.role === "super_admin";
  // Admin + Super Admin can hard-delete bookings; every deletion is
  // captured in the audit log + activity feed and broadcast to all staff.
  const canDeleteBookings = user?.role === "admin" || user?.role === "super_admin";

  // Hard delete — Super Admin only. Backend purges all dependent rows
  // (invoices, follow-ups, products, amendments, ratings, email log) then
  // the booking itself. Used to clean up test bookings.
  const deleteBookingMut = useDeleteBooking({
    mutation: {
      onSuccess: (data: any) => {
        toast({ title: "Booking deleted", description: data?.tvl_ref ? `${data.tvl_ref} permanently removed` : "Removed" });
        queryClient.invalidateQueries({
          predicate: (q) => Array.isArray(q.queryKey) && typeof q.queryKey[0] === "string" && (q.queryKey[0] as string).startsWith("/api/bookings"),
        });
      },
      onError: (err: any) => {
        toast({ title: "Delete failed", description: err?.response?.data?.error ?? err?.message ?? "Unknown error", variant: "destructive" });
      },
    },
  });

  const [status, setStatus] = useState<string>("");
  const [search, setSearch] = useState<string>("");
  const [source, setSource] = useState<"active" | "imported">("active");
  const [sortKey, setSortKey] = useState<SortKey>("recent");
  const [groupKey, setGroupKey] = useState<GroupKey>("none");
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

  // Sort the filtered list by the selected key. Defaults to Most Recent
  // (created_at desc) per Fix 3 — replaces whatever order the API returned.
  const sortedBookings = useMemo(() => {
    const arr = [...bookings];
    const ts = (v: any) => (v ? new Date(v).getTime() : 0);
    switch (sortKey) {
      case "oldest":
        arr.sort((a, b) => ts(a.created_at) - ts(b.created_at));
        break;
      case "service":
        arr.sort((a, b) =>
          String(a.service_type ?? "").localeCompare(String(b.service_type ?? "")) ||
          ts(b.created_at) - ts(a.created_at)
        );
        break;
      case "status":
        arr.sort((a, b) =>
          (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99) ||
          ts(b.created_at) - ts(a.created_at)
        );
        break;
      case "price":
        arr.sort((a, b) => Number(b.price ?? 0) - Number(a.price ?? 0));
        break;
      case "recent":
      default:
        arr.sort((a, b) => ts(b.created_at) - ts(a.created_at));
    }
    return arr;
  }, [bookings, sortKey]);

  // Group the sorted list. "none" returns a single anonymous bucket so the
  // render path stays uniform.
  const grouped = useMemo<{ key: string; items: any[] }[]>(() => {
    if (groupKey !== "service") return [{ key: "", items: sortedBookings }];
    const map = new Map<string, any[]>();
    for (const b of sortedBookings) {
      const k = b.service_type || "Other";
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(b);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, items]) => ({ key, items }));
  }, [sortedBookings, groupKey]);

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

      {/* Source tabs — keep imported Odoo data segregated from active ops.
          Operators don't see the Imported tab; only super_admin can browse
          legacy archived data. */}
      {!isResidenceManager && isSuperAdmin && (
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
          <Button variant={status === "Pending" ? "default" : "outline"} onClick={() => setStatus("Pending")}>Pending</Button>
          <Button variant={status === "Confirmed" ? "default" : "outline"} onClick={() => setStatus("Confirmed")}>Confirmed</Button>
          <Button variant={status === "Active" ? "default" : "outline"} onClick={() => setStatus("Active")}>Active</Button>
          <Button variant={status === "Completed" ? "default" : "outline"} onClick={() => setStatus("Completed")}>Completed</Button>
          <Button variant={status === "Cancelled" ? "default" : "outline"} onClick={() => setStatus("Cancelled")}>Cancelled</Button>
        </div>
      </div>

      {/* Sort + Group controls (Fix 3) */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground whitespace-nowrap">Sort:</span>
          <Select value={sortKey} onValueChange={(v) => setSortKey(v as SortKey)}>
            <SelectTrigger className="h-9 w-44" data-testid="select-bookings-sort">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SORT_OPTIONS.map(o => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground whitespace-nowrap">Group by:</span>
          <Select value={groupKey} onValueChange={(v) => setGroupKey(v as GroupKey)}>
            <SelectTrigger className="h-9 w-44" data-testid="select-bookings-group">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              <SelectItem value="service">Service Type</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Grid (grouped) */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-48" />)}
        </div>
      ) : (
        <div className="space-y-6">
          {grouped.map(group => (
            <div key={group.key || "_all"} className="space-y-3">
              {groupKey === "service" && (
                <div className="flex items-center gap-2 pt-1">
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                    {group.key}
                  </h2>
                  <span className="text-xs text-muted-foreground">({group.items.length})</span>
                </div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {group.items.map((booking: any) => (
          <Card key={booking.id} className="border-primary/10 hover:border-primary/30 transition-colors bg-card overflow-hidden flex flex-col">
            <CardContent className="p-5 flex-1 flex flex-col">
              <div className="flex justify-between items-start mb-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="text-xs text-muted-foreground font-mono">{booking.tvl_ref}</div>
                    {booking.service_type && (
                      <Badge variant="outline" className="text-[10px] py-0 px-1.5 bg-secondary/40 text-foreground border-border">
                        {booking.service_type}{booking.direction ? ` · ${booking.direction}` : ""}
                      </Badge>
                    )}
                    {/* Notes / special-requests indicator — gives operators
                        a heads-up that the booking has free-text instructions
                        worth opening the job sheet for. */}
                    {(booking.notes || booking.special_requests) && (
                      <Badge
                        variant="outline"
                        className="text-[10px] py-0 px-1.5 bg-amber-500/10 text-amber-300 border-amber-500/40 gap-1"
                        title={booking.special_requests || booking.notes}
                        data-testid={`badge-notes-${booking.id}`}
                      >
                        <StickyNote className="w-2.5 h-2.5" />
                        Notes
                      </Badge>
                    )}
                  </div>
                  <h3 className="font-bold text-lg text-foreground truncate">{booking.client_name || "Unknown Client"}</h3>
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
                      <span className="font-medium text-foreground">
                        {(booking as any).driver_staff_no && (
                          <span className="font-mono text-[11px] mr-1.5 px-1.5 py-0.5 rounded bg-primary/15 text-primary border border-primary/30">
                            {(booking as any).driver_staff_no}
                          </span>
                        )}
                        {booking.driver_name || "Unassigned"}
                      </span>
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
                {canDeleteBookings && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-10 w-10 text-destructive hover:bg-destructive/10 hover:text-destructive border-destructive/40"
                        title="Delete booking"
                        data-testid={`button-delete-${booking.id}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete {booking.tvl_ref}?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This permanently removes the booking and all related records (invoice, follow-ups, products, ratings, email log). This cannot be undone. For real cancellations, use the Cancel action on the job sheet instead.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Keep booking</AlertDialogCancel>
                        <AlertDialogAction
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          onClick={() => deleteBookingMut.mutate({ id: booking.id })}
                          data-testid={`button-confirm-delete-${booking.id}`}
                        >
                          Delete permanently
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
              </div>
            </CardContent>
          </Card>
                ))}
              </div>
            </div>
          ))}
          {bookings.length === 0 && (
            <div className="py-12 text-center text-muted-foreground border border-dashed rounded-lg">
              {isResidenceManager
                ? "No apartment bookings found."
                : "No bookings found."}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
