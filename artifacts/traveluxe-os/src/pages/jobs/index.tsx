import { useState, useMemo, useRef, useEffect } from "react";
import {
  useListBookings, getListBookingsQueryKey,
  useUpdateBookingStatus, useUpdateBooking, useDeleteBooking,
  useListDrivers, getListDriversQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useLocation, useSearch, Link } from "wouter";
import { format, isToday, isTomorrow, startOfDay, endOfDay, addDays, isBefore, isAfter } from "date-fns";
import { AlertTriangle, MapPin, Plus, Car, Clock, Briefcase, X, Check, MessageCircle, Plane, Trash2, CheckSquare, Building2 } from "lucide-react";
import { isSupplierDrivenJob } from "@/lib/supplierDriven";
import { FilterDropdown, useFilterState } from "@/components/ui/filter-dropdown";
import { ActiveFilterChips, type ActiveFilter } from "@/components/ui/active-filter-chips";
import { RecentActivityFeed } from "@/components/activity/RecentActivityFeed";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { getVipBadgeColor } from "@/lib/vip";
import { supabase } from "@/lib/supabase";
import { useBulkSelect } from "@/hooks/use-bulk-select";
import { BulkActionBar } from "@/components/bulk-action-bar";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";

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
  const { user } = useAuth();
  const { toast } = useToast();
  const canDelete = user?.role === "admin" || user?.role === "super_admin";
  // URL-backed filters so a refresh / shared link restores the same view.
  // `status` and `filter` were already URL-driven; we now also persist
  // `time` and `unassigned` so every dropdown survives a reload.
  const [timeFilter, setTimeFilter] = useFilterState("time", "all");
  const search = useSearch();
  const statusFilter = new URLSearchParams(search).get("status") ?? "";
  const customFilter = new URLSearchParams(search).get("filter") ?? "";
  const qc = useQueryClient();
  const bulk = useBulkSelect();

  const { data: bookings, isLoading } = useListBookings(
    {},
    { query: { enabled: true, queryKey: getListBookingsQueryKey({}) } }
  );

  const updateStatus  = useUpdateBookingStatus();
  const updateBooking = useUpdateBooking();

  const deleteBookingMut = useDeleteBooking({
    mutation: {
      onSuccess: (data: any) => {
        toast({ title: "Job deleted", description: data?.tvl_ref ? `${data.tvl_ref} permanently removed` : "Removed" });
        qc.invalidateQueries({ queryKey: getListBookingsQueryKey({}) });
      },
      onError: (err: any) => {
        toast({ title: "Delete failed", description: err?.response?.data?.error ?? err?.message ?? "Unknown error", variant: "destructive" });
      },
    },
  });

  const handleBulkDelete = async () => {
    const ids = bulk.ids;
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    const results = await Promise.allSettled(
      ids.map(id => fetch(`/api/bookings/${id}?silent=1`, {
        method: "DELETE",
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      }).then(r => { if (!r.ok) throw new Error(String(r.status)); }))
    );
    const ok = results.filter(r => r.status === "fulfilled").length;
    const fail = results.length - ok;
    if (ok > 0) {
      fetch("/api/notifications/broadcast-staff", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          type: "booking_cancelled",
          title: "Jobs Deleted",
          message: `${ok} job${ok === 1 ? "" : "s"} permanently removed in a bulk action`,
          link: "/jobs",
          severity: "warning",
        }),
      }).catch(() => {});
    }
    toast({
      title: fail === 0 ? "Jobs deleted" : `${ok} deleted, ${fail} failed`,
      description: fail === 0 ? `${ok} job${ok === 1 ? "" : "s"} permanently removed` : "Some deletions failed — check audit log",
      variant: fail === 0 ? undefined : "destructive",
    });
    qc.invalidateQueries({ queryKey: getListBookingsQueryKey({}) });
    bulk.exitSelectMode();
  };

  const { data: drivers } = useListDrivers({}, { query: { queryKey: getListDriversQueryKey({}) } });
  const driversById = useMemo(() => {
    const m = new Map<string, any>();
    (drivers as any[] | undefined)?.forEach((d) => m.set(d.id, d));
    return m;
  }, [drivers]);

  // Fetch suppliers once for the whole job board so supplier-driven
  // jobs can render company name + WhatsApp without a per-card request.
  // No generated react-query hook exists for /api/suppliers, so we use
  // a plain query keyed off the auth session like the rest of the page.
  const { data: suppliers } = useQuery<any[]>({
    queryKey: ["jobs-suppliers"],
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/suppliers", {
        headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
      });
      if (!res.ok) return [];
      return res.json();
    },
  });
  const suppliersById = useMemo(() => {
    const m = new Map<string, any>();
    (suppliers as any[] | undefined)?.forEach((s) => m.set(s.id, s));
    return m;
  }, [suppliers]);

  // Multi-vehicle bookings: pull only the booking_vehicles rows for the
  // bookings currently visible on the board (avoids a full-table scan on
  // every page mount). Falls back to an empty list when there are no
  // bookings yet so the query stays disabled.
  const visibleBookingIds = useMemo(
    () => (bookings ?? []).map((b: any) => b.id).filter(Boolean),
    [bookings],
  );
  const visibleIdsKey = visibleBookingIds.join(",");
  const { data: allVehicles } = useQuery<any[]>({
    queryKey: ["jobs:booking-vehicles", visibleIdsKey],
    enabled: visibleBookingIds.length > 0,
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token ?? "";
      const r = await fetch(
        `/api/booking-vehicles?booking_ids=${encodeURIComponent(visibleIdsKey)}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!r.ok) return [];
      return r.json();
    },
  });
  const vehiclesByBooking = useMemo(() => {
    const m = new Map<string, any[]>();
    (allVehicles ?? []).forEach((v: any) => {
      if (!v.booking_id) return;
      if (!m.has(v.booking_id)) m.set(v.booking_id, []);
      m.get(v.booking_id)!.push(v);
    });
    return m;
  }, [allVehicles]);

  const handleStatusChange = (e: React.ChangeEvent<HTMLSelectElement>, jobId: string) => {
    e.preventDefault();
    e.stopPropagation();
    const newStatus = e.target.value;
    updateStatus.mutate({ id: jobId, data: { status: newStatus } }, {
      onSuccess: () => qc.invalidateQueries({ queryKey: getListBookingsQueryKey({}) }),
    });
  };

  // unused-import safety
  void Check;

  // ── Long-press → quick status menu ────────────────────────────────────────
  // Operators on the road want to flip a job to Active/Completed without
  // opening the booking. We bind touch + mouse hold (>500ms) to surface a
  // bottom sheet with status shortcuts. Short taps still navigate as before.
  const [quickMenuJob, setQuickMenuJob] = useState<any>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFired = useRef(false);

  // Clear pending long-press timer on unmount to avoid setState-after-unmount.
  useEffect(() => {
    return () => {
      if (longPressTimer.current) {
        clearTimeout(longPressTimer.current);
        longPressTimer.current = null;
      }
    };
  }, []);

  // When the quick-action sheet closes, reset the long-press latch so the
  // *next* card tap is treated as a navigation again (not swallowed).
  useEffect(() => {
    if (!quickMenuJob) longPressFired.current = false;
  }, [quickMenuJob]);

  const startLongPress = (job: any) => {
    longPressFired.current = false;
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    longPressTimer.current = setTimeout(() => {
      longPressFired.current = true;
      if (typeof navigator !== "undefined" && "vibrate" in navigator) {
        try { (navigator as any).vibrate?.(20); } catch { /* noop */ }
      }
      setQuickMenuJob(job);
    }, 500);
  };
  const cancelLongPress = () => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    longPressTimer.current = null;
  };
  const handleCardClick = (jobId: string, e: React.MouseEvent) => {
    if (longPressFired.current) {
      e.preventDefault();
      e.stopPropagation();
      longPressFired.current = false;
      return;
    }
    if (bulk.selectMode) {
      bulk.toggle(jobId);
      return;
    }
    setLocation(`/bookings/${jobId}`);
  };

  const quickSetStatus = (status: string) => {
    if (!quickMenuJob) return;
    updateStatus.mutate({ id: quickMenuJob.id, data: { status } }, {
      onSuccess: () => qc.invalidateQueries({ queryKey: getListBookingsQueryKey({}) }),
    });
    setQuickMenuJob(null);
  };

  const handlePaymentChange = (e: React.ChangeEvent<HTMLSelectElement>, jobId: string) => {
    e.preventDefault();
    e.stopPropagation();
    const newPayment = e.target.value;
    updateBooking.mutate({ id: jobId, data: { payment_status: newPayment } as any }, {
      onSuccess: () => qc.invalidateQueries({ queryKey: getListBookingsQueryKey({}) }),
    });
  };

  // Operator-driven "show only unassigned" filter. Toggled by tapping the
  // urgent banner so the operator can act on the alert with one tap.
  // URL-backed so a refresh keeps the same focused view.
  const [unassignedFlag, setUnassignedFlag] = useFilterState<"0" | "1">("unassigned", "0");
  const unassignedOnly = unassignedFlag === "1";
  const setUnassignedOnly = (v: boolean) => setUnassignedFlag(v ? "1" : "0");

  const filteredBookings = useMemo(() => {
    if (!bookings) return [];
    const now = new Date();
    return bookings.filter(b => {
      if (b.status === 'Cancelled') return false;
      if (unassignedOnly) {
        // Supplier-driven jobs are NOT "unassigned" — the supplier is
        // providing the vehicle, so the operator shouldn't be chased.
        if (b.driver_id || isSupplierDrivenJob(b as any)) return false;
        if (b.status === 'Completed') return false;
        return true;
      }
      if (customFilter === 'needs-driver') {
        if (b.driver_id || isSupplierDrivenJob(b as any)) return false;
        if (b.status !== 'Pending' && b.status !== 'Confirmed') return false;
        return true;
      }
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
        default:
          // Keep recently-completed jobs visible for 14 days so they don't
          // vanish after midnight the moment the driver marks them done.
          if (b.status === 'Completed' && !isBefore(d, startOfDay(addDays(now, -14)))) return true;
          return !isBefore(d, startOfDay(now));
      }
    });
  }, [bookings, timeFilter, statusFilter, customFilter, unassignedOnly]);

  // Urgent count is global across the visible (non-cancelled) bookings, not
  // the currently filtered view — so the count stays stable when the operator
  // applies time / status filters that would otherwise hide it.
  const urgentJobs = useMemo(
    () => (bookings ?? []).filter(b =>
      !b.driver_id &&
      !isSupplierDrivenJob(b as any) &&
      b.status !== 'Completed' &&
      b.status !== 'Cancelled'
    ),
    [bookings]
  );

  // Bookings starting within the next 60 minutes — shown as a "prepare now"
  // strip regardless of which time/status filter the operator has applied.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);
  const upcomingJobs = useMemo(() => {
    if (!bookings) return [];
    const lo = now.getTime();
    const hi = now.getTime() + 60 * 60 * 1000;
    return bookings.filter(b => {
      if (!b.date_time) return false;
      if (b.status === 'Cancelled' || b.status === 'Active' || b.status === 'Completed') return false;
      const t = new Date(b.date_time).getTime();
      return t >= lo && t <= hi;
    });
  }, [bookings, now]);
  const activeJobs = bookings?.filter(b => b.status !== 'Cancelled') || [];

  // Group jobs by date for date-section headings.
  // Sort rule per operator request: within each day, push Completed jobs whose
  // pickup time is in the past to the bottom — the operator wants the next
  // upcoming job at the top, not a finished morning airport run.
  const groupedByDate = useMemo(() => {
    const groups = new Map<string, { label: string; sortKey: string; jobs: typeof filteredBookings }>();
    const undated: typeof filteredBookings = [];
    for (const job of filteredBookings) {
      if (!job.date_time) { undated.push(job); continue; }
      const d = new Date(job.date_time);
      const sortKey = format(d, "yyyy-MM-dd");
      const label = isToday(d) ? `Today · ${format(d, "EEE d MMMM yyyy")}`
        : isTomorrow(d) ? `Tomorrow · ${format(d, "EEE d MMMM yyyy")}`
        : format(d, "EEEE d MMMM yyyy");
      if (!groups.has(sortKey)) groups.set(sortKey, { label, sortKey, jobs: [] });
      groups.get(sortKey)!.jobs.push(job);
    }
    const sorted = [...groups.values()].sort((a, b) => a.sortKey.localeCompare(b.sortKey));
    const nowMs = Date.now();
    const isFinishedPast = (j: any) =>
      j.status === 'Completed' && j.date_time && new Date(j.date_time).getTime() < nowMs;
    for (const g of sorted) {
      g.jobs.sort((a, b) => {
        const aDone = isFinishedPast(a);
        const bDone = isFinishedPast(b);
        if (aDone !== bDone) return aDone ? 1 : -1;            // upcoming first, finished-past last
        return new Date(a.date_time!).getTime() - new Date(b.date_time!).getTime();
      });
    }
    if (undated.length > 0) sorted.push({ label: "Date TBC", sortKey: "zzz", jobs: undated });
    return sorted;
  }, [filteredBookings]);

  return (
    <div className="space-y-2">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <h1 className="text-xl font-bold tracking-tight text-foreground">
            {statusFilter ? `${statusFilter} Jobs` : "Jobs Board"}
          </h1>
          <p className="text-xs text-muted-foreground">
            {filteredBookings.length} job{filteredBookings.length !== 1 ? 's' : ''}
            {!statusFilter && ` · ${activeJobs.length} active`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canDelete && (
            bulk.selectMode ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => bulk.selectAll(filteredBookings.map((j: any) => j.id))}
                  data-testid="button-select-all"
                >
                  <CheckSquare className="w-4 h-4 mr-1.5" />
                  All
                </Button>
                <Button variant="outline" size="sm" onClick={bulk.exitSelectMode} data-testid="button-cancel-select">
                  <X className="w-4 h-4 mr-1.5" /> Cancel
                </Button>
              </>
            ) : (
              <Button variant="outline" size="sm" onClick={bulk.enterSelectMode} data-testid="button-select-mode">
                <CheckSquare className="w-4 h-4 mr-1.5" /> Select
              </Button>
            )
          )}
          {!bulk.selectMode && (
            <Button
              className="shadow-[0_0_15px_rgba(201,168,76,0.25)] hover:shadow-[0_0_25px_rgba(201,168,76,0.4)]"
              onClick={() => setLocation("/bookings/new")}
            >
              <Plus className="w-4 h-4 mr-2" />
              New Booking
            </Button>
          )}
        </div>
      </div>

      {/* Urgent alert — tap to instantly filter to unassigned jobs only. */}
      {urgentJobs.length > 0 && (
        <button
          type="button"
          className="w-full border rounded-xl p-4 bg-destructive/10 border-destructive/30 text-left hover:bg-destructive/15 active:bg-destructive/20 transition-colors cursor-pointer"
          onClick={() => setUnassignedOnly(!unassignedOnly)}
        >
          <div className="flex items-center gap-2 text-destructive font-semibold text-sm">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            <span>{urgentJobs.length} job{urgentJobs.length > 1 ? 's' : ''} need{urgentJobs.length === 1 ? 's' : ''} a driver assigned urgently</span>
            <span className="ml-auto text-[11px] font-normal opacity-70 underline underline-offset-2">
              {unassignedOnly ? "Show all" : "Show only →"}
            </span>
          </div>
        </button>
      )}

      {upcomingJobs.length > 0 && (
        <div className="w-full border rounded-xl border-amber-500/40 bg-amber-500/5 overflow-hidden">
          <div className="flex items-center gap-2 px-4 pt-3 pb-2">
            <Clock className="w-4 h-4 text-amber-400 flex-shrink-0" />
            <span className="text-amber-400 font-semibold text-sm">
              Starting within 1 hour — prepare now
            </span>
            <Badge className="ml-auto bg-amber-500/20 text-amber-300 border-amber-500/40 text-[10px]">
              {upcomingJobs.length}
            </Badge>
          </div>
          <div className="divide-y divide-amber-500/10">
            {upcomingJobs.map(job => {
              const minsAway = Math.round((new Date(job.date_time!).getTime() - now.getTime()) / 60000);
              const driverName = (job as any).driver_name ?? (job as any).drivers?.name ?? null;
              // Supplier-driven jobs show the supplier company instead
              // of the missing-driver warning, so the operator isn't
              // chased by a false "No driver" alert when the supplier
              // is providing the vehicle.
              const supplierDriven = isSupplierDrivenJob(job as any);
              const sup = supplierDriven ? suppliersById.get((job as any).supplier_id) : null;
              return (
                <Link key={job.id} href={`/bookings/${job.id}`}>
                  <div className="flex items-center gap-3 px-4 py-2.5 hover:bg-amber-500/5 transition-colors cursor-pointer">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-mono text-muted-foreground">{job.tvl_ref}</span>
                        <span className="text-xs font-medium text-foreground truncate">{job.client_name ?? "—"}</span>
                        {job.service_type && (
                          <Badge variant="outline" className="text-[10px] py-0 px-1.5 border-amber-500/30 text-amber-300/80">
                            {job.service_type}
                          </Badge>
                        )}
                      </div>
                      <div className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1">
                        {supplierDriven ? (
                          <>
                            <Building2 className="w-3 h-3 text-primary flex-shrink-0" />
                            <span className="text-foreground">{sup?.name ?? "Supplier"}</span>
                            {job.vehicle_type ? <span> · {job.vehicle_type}</span> : null}
                          </>
                        ) : (
                          <>
                            {driverName ?? <span className="text-destructive font-medium">No driver</span>}
                            {driverName && job.vehicle_type ? ` · ${job.vehicle_type}` : ""}
                          </>
                        )}
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="text-amber-400 font-bold text-sm">{minsAway}m</div>
                      <div className="text-[10px] text-muted-foreground">
                        {format(new Date(job.date_time!), "HH:mm")}
                      </div>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* Filters + chips — single scrollable row */}
      <div className="flex items-center gap-2 overflow-x-auto pb-0.5">
        {!statusFilter && (
          <>
            <FilterDropdown
              label="Time"
              value={timeFilter}
              onChange={setTimeFilter}
              options={[
                { value: "today", label: "Today" },
                { value: "tomorrow", label: "Tomorrow" },
                { value: "this_week", label: "This Week" },
                { value: "all", label: "All Upcoming" },
              ]}
              testId="filter-jobs-time"
            />
            <FilterDropdown
              label="Show"
              value={unassignedOnly ? "unassigned" : "all"}
              onChange={(v) => setUnassignedOnly(v === "unassigned")}
              options={[
                { value: "all", label: "All jobs" },
                { value: "unassigned", label: "Unassigned only" },
              ]}
              testId="filter-jobs-unassigned"
            />
          </>
        )}
        {(() => {
          const TIME_LABELS: Record<string, string> = { today: "Today", tomorrow: "Tomorrow", this_week: "This Week", all: "All Upcoming" };
          const chips: ActiveFilter[] = [];
          if (statusFilter) chips.push({ key: "status", label: "Status", value: statusFilter, onClear: () => setLocation("/jobs") });
          if (timeFilter !== "all") chips.push({ key: "time", label: "Time", value: TIME_LABELS[timeFilter] ?? timeFilter, onClear: () => setTimeFilter("all") });
          if (unassignedOnly) chips.push({ key: "unassigned", label: "Show", value: "Unassigned only", onClear: () => setUnassignedOnly(false) });
          if (chips.length === 0) return null;
          return (
            <ActiveFilterChips
              filters={chips}
              onClearAll={() => { setTimeFilter("all"); setUnassignedOnly(false); if (statusFilter) setLocation("/jobs"); }}
            />
          );
        })()}
      </div>

      {/* Job cards grouped by date */}
      <div className="space-y-4">
        {isLoading ? (
          [...Array(4)].map((_, i) => <Skeleton key={i} className="h-28" />)
        ) : filteredBookings.length > 0 ? groupedByDate.map((group) => (
          <div key={group.sortKey} className="space-y-1.5">
            <div className="flex items-center gap-2 sticky top-0 bg-background/95 backdrop-blur-sm py-1 z-10">
              <h2 className="text-[11px] font-bold text-primary uppercase tracking-widest">{group.label}</h2>
              <div className="flex-1 h-px bg-border" />
              <Badge variant="outline" className="text-[10px] text-muted-foreground border-border">
                {group.jobs.length}
              </Badge>
            </div>
            {group.jobs.map((job) => {
              const extras = (vehiclesByBooking.get(job.id) ?? []);
              // Compute supplier-driven once per card. The "No Driver"
              // warning, the WhatsApp link, and the staff-no chip all
              // branch off this so a supplier-handled vehicle never
              // looks like an unstaffed job to the operator.
              const jobSupplierDriven = isSupplierDrivenJob(job as any);
              const jobSupplier = jobSupplierDriven ? suppliersById.get((job as any).supplier_id) : null;
              return (
              <div key={job.id} className="space-y-1.5">
              <Card
            key={job.id}
            className={`border-border hover:border-primary/40 hover:bg-secondary/10 transition-all bg-card overflow-hidden cursor-pointer select-none ${
              bulk.selectMode && bulk.isSelected(job.id) ? "ring-2 ring-primary border-primary" : ""
            }`}
            onClick={(e) => handleCardClick(job.id, e)}
            onTouchStart={() => !bulk.selectMode && startLongPress(job)}
            onTouchEnd={() => !bulk.selectMode && cancelLongPress()}
            onTouchMove={() => !bulk.selectMode && cancelLongPress()}
            onTouchCancel={() => !bulk.selectMode && cancelLongPress()}
            onMouseDown={() => !bulk.selectMode && startLongPress(job)}
            onMouseUp={() => !bulk.selectMode && cancelLongPress()}
            onMouseLeave={() => !bulk.selectMode && cancelLongPress()}
            onContextMenu={(e) => { e.preventDefault(); if (!bulk.selectMode) { setQuickMenuJob(job); longPressFired.current = true; } }}
          >
            <CardContent className="p-3">
              {/* Row 1: ref + badges | time + status */}
              <div className="flex items-center gap-2 mb-1.5">
                <div className="flex items-center gap-1 flex-1 min-w-0 flex-wrap">
                  {bulk.selectMode && (
                    <div className={`flex-shrink-0 w-3.5 h-3.5 rounded border-2 flex items-center justify-center ${bulk.isSelected(job.id) ? "bg-primary border-primary" : "border-muted-foreground/40"}`}>
                      {bulk.isSelected(job.id) && <CheckSquare className="w-2 h-2 text-primary-foreground" />}
                    </div>
                  )}
                  <span className="font-mono text-[10px] text-muted-foreground">{job.tvl_ref}</span>
                  {job.service_type && (
                    <Badge variant="outline" className="text-[9px] py-0 px-1 bg-secondary/40 text-foreground border-border">
                      {job.service_type}{(job as any).direction ? ` · ${(job as any).direction}` : ""}
                    </Badge>
                  )}
                  {(job as any).flight_number && (() => {
                    const fs = (job as any).flight_status;
                    const st = fs?.status as string | undefined;
                    const delayMins = fs?.delay_minutes ?? 0;
                    const cls =
                      st === "Delayed"   ? "bg-amber-500/15 text-amber-400 border-amber-500/40" :
                      st === "Early"     ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/40" :
                      st === "Cancelled" ? "bg-destructive/15 text-destructive border-destructive/40" :
                      st === "Landed"    ? "bg-blue-500/15 text-blue-400 border-blue-500/30" :
                      st === "On Time"   ? "bg-green-500/15 text-green-400 border-green-500/30" :
                                          "bg-blue-500/10 text-blue-400 border-blue-500/30";
                    const note = st === "Delayed" && delayMins > 0 ? ` +${delayMins}m` :
                                 st === "Early"   && delayMins < 0 ? ` ${Math.abs(delayMins)}m early` : "";
                    return (
                      <Badge variant="outline" className={`text-[9px] py-0 px-1 flex items-center gap-0.5 ${cls}`}>
                        <Plane className="w-2 h-2" />{(job as any).flight_number}
                        {st && st !== "Unknown" && <span className="opacity-80">{st}{note}</span>}
                      </Badge>
                    );
                  })()}
                  {(job as any).last_email_status === 'sent' && (
                    <Badge variant="outline" className="text-[9px] py-0 px-1 bg-emerald-500/10 text-emerald-300 border-emerald-500/30"
                      title={`Email sent${(job as any).last_email_kind ? ` · ${(job as any).last_email_kind.replace(/_/g, ' ')}` : ''}`}>
                      ✓ Email
                    </Badge>
                  )}
                  {(job as any).last_email_status === 'failed' && (
                    <Badge variant="outline" className="text-[9px] py-0 px-1 bg-destructive/10 text-destructive border-destructive/40">⚠ Email</Badge>
                  )}
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {job.date_time && (
                    <div className="text-right">
                      <div className="text-xs font-bold text-foreground leading-none">{format(new Date(job.date_time), 'HH:mm')}</div>
                      <div className="text-[9px] text-muted-foreground mt-0.5">{format(new Date(job.date_time), "EEE d MMM")}</div>
                    </div>
                  )}
                  <select
                    value={job.status}
                    onClick={e => e.stopPropagation()}
                    onChange={e => handleStatusChange(e, job.id)}
                    disabled={job.status === 'Cancelled'}
                    className={`h-6 rounded-full border text-[10px] font-semibold px-1.5 appearance-none text-center ${job.status === 'Cancelled' ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'} ${STATUS_COLORS[job.status] ?? 'bg-secondary text-secondary-foreground border-border'}`}
                  >
                    <option value="Pending">Pending</option>
                    <option value="Confirmed">Confirmed</option>
                    <option value="Active">Active</option>
                    <option value="Completed">Completed</option>
                    <option value="Cancelled">Cancelled</option>
                  </select>
                </div>
              </div>

              {/* Row 2: client name */}
              <div className="flex items-center gap-1.5 mb-1.5 min-w-0">
                {job.client_id ? (
                  <span className="font-semibold text-sm text-primary hover:underline cursor-pointer truncate"
                    onClick={(e) => { e.stopPropagation(); setLocation(`/clients/${job.client_id}`); }}>
                    {job.client_name || 'Unknown Client'}
                  </span>
                ) : (
                  <span className="font-semibold text-sm text-foreground truncate">{job.client_name || 'Unknown Client'}</span>
                )}
                {job.client_vip_tier && job.client_vip_tier !== 'Standard' && (
                  <Badge variant="outline" className={`text-[9px] py-0 px-1 flex-shrink-0 ${getVipBadgeColor(job.client_vip_tier)}`}>
                    {job.client_vip_tier}
                  </Badge>
                )}
              </div>

              {/* Row 3: route */}
              <div className="flex items-center gap-1 mb-2">
                <MapPin className="w-3 h-3 text-primary flex-shrink-0" />
                <span className="text-xs text-muted-foreground truncate">
                  <span className="text-foreground">{job.pickup || '—'}</span>
                  <span className="mx-1">→</span>
                  <span className="text-foreground">{(job as any).dropoff || (job as any).destination || '—'}</span>
                </span>
              </div>

              {/* Row 4: driver / supplier | price + payment.
                  For supplier-driven jobs we show the supplier company
                  + WhatsApp instead of the driver name + chip; the "No
                  Driver" red warning is suppressed because no TVL
                  driver is needed. */}
              <div className="flex items-center justify-between border-t border-border pt-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  {jobSupplierDriven ? (
                    <Building2 className="w-3 h-3 text-primary flex-shrink-0" />
                  ) : (
                    <Car className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                  )}
                  {jobSupplierDriven ? (
                    <span
                      className="text-xs font-medium text-primary hover:underline cursor-pointer flex items-center gap-1 truncate"
                      onClick={(e) => {
                        e.stopPropagation();
                        if ((job as any).supplier_id) setLocation(`/suppliers/${(job as any).supplier_id}`);
                      }}
                      data-testid={`supplier-driven-${job.id}`}
                    >
                      {jobSupplier?.name ?? "Supplier"}
                    </span>
                  ) : job.driver_name ? (
                    job.driver_id ? (
                      <span className="text-xs font-medium text-primary hover:underline cursor-pointer flex items-center gap-1 truncate"
                        onClick={(e) => { e.stopPropagation(); setLocation(`/drivers/${job.driver_id}`); }}>
                        {(job as any).driver_staff_no && (
                          <span className="font-mono text-[10px] px-1 py-0 rounded bg-primary/15 text-primary border border-primary/30">
                            {(job as any).driver_staff_no}
                          </span>
                        )}
                        {job.driver_name}
                      </span>
                    ) : (
                      <span className="text-xs font-medium text-foreground truncate">{job.driver_name}</span>
                    )
                  ) : (
                    <span className="text-xs text-destructive font-medium flex items-center gap-0.5">
                      <AlertTriangle className="w-3 h-3 flex-shrink-0" /> No Driver
                    </span>
                  )}
                  {jobSupplierDriven ? (() => {
                    // WhatsApp the supplier directly with a confirmation
                    // nudge — same UX shape as the driver WA link, just
                    // pointed at the supplier contact.
                    const phone = (jobSupplier?.whatsapp || jobSupplier?.phone || "").replace(/[^0-9+]/g, "");
                    if (!phone) return null;
                    const msg = `Hi ${jobSupplier?.contact_name ?? jobSupplier?.name ?? ""}, just confirming booking ${job.tvl_ref}. Please reply to confirm. Thanks.`;
                    return (
                      <a href={`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`} target="_blank" rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()} className="text-green-500 hover:text-green-400 flex-shrink-0"
                        data-testid={`link-wa-supplier-${job.id}`}>
                        <MessageCircle className="w-3 h-3" />
                      </a>
                    );
                  })() : job.driver_id && (() => {
                    const drv = driversById.get(job.driver_id);
                    const phone = (drv?.whatsapp || drv?.phone || "").replace(/[^0-9+]/g, "");
                    if (!phone) return null;
                    const msg = `Hi ${drv?.name ?? job.driver_name ?? ""}, I've just sent you booking ${job.tvl_ref}. Please confirm receipt. Thanks.`;
                    return (
                      <a href={`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`} target="_blank" rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()} className="text-green-500 hover:text-green-400 flex-shrink-0"
                        data-testid={`link-wa-driver-${job.id}`}>
                        <MessageCircle className="w-3 h-3" />
                      </a>
                    );
                  })()}
                  {(job as any).client_notified_at && (
                    <Badge variant="outline" className="text-[9px] py-0 px-1 bg-green-500/10 text-green-400 border-green-500/30 flex-shrink-0">
                      <MessageCircle className="w-2 h-2 mr-0.5" />C
                    </Badge>
                  )}
                  {(job as any).driver_notified_at && (
                    <Badge variant="outline" className="text-[9px] py-0 px-1 bg-amber-500/10 text-amber-400 border-amber-500/30 flex-shrink-0">
                      <Car className="w-2 h-2 mr-0.5" />D
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <span className="text-xs font-bold text-foreground">£{job.price}</span>
                  <select
                    value={job.payment_status || "Unpaid"}
                    onClick={e => e.stopPropagation()}
                    onChange={e => handlePaymentChange(e, job.id)}
                    className={`h-6 rounded-full border text-[10px] font-semibold px-1.5 cursor-pointer appearance-none text-center ${PAYMENT_COLORS[job.payment_status || 'Unpaid'] ?? 'text-amber-400 border-amber-500/40 bg-amber-500/10'}`}
                  >
                    <option value="Unpaid">Unpaid</option>
                    <option value="Partial">Partial</option>
                    <option value="Paid">Paid</option>
                  </select>
                  {canDelete && !bulk.selectMode && (
                    <AlertDialog>
                      <AlertDialogTrigger asChild onClick={(e) => e.stopPropagation()}>
                        <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive/50 hover:text-destructive hover:bg-destructive/10"
                          data-testid={`button-delete-${job.id}`}>
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete {job.tvl_ref}?</AlertDialogTitle>
                          <AlertDialogDescription>
                            Permanently removes the booking and all related records. Use Cancel status for real cancellations. Cannot be undone.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Keep job</AlertDialogCancel>
                          <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            onClick={() => deleteBookingMut.mutate({ id: job.id })}
                            data-testid={`button-confirm-delete-${job.id}`}>
                            Delete permanently
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Extra-vehicle sub-rows: one compact card per booking_vehicles
              row so operators see the second / third car on a transfer
              without opening the booking. Tapping still opens the parent
              booking so they can edit the leg details. */}
          {extras.map((v: any, idx: number) => {
            const drv = v.driver_id ? driversById.get(v.driver_id) : null;
            const drvName = v.driver_name ?? drv?.name ?? null;
            const drvStaff = v.driver_staff_no ?? drv?.staff_no ?? null;
            // Numbering: primary booking is "Car 1", first extra is "Car 2",
            // and so on. The booking-vehicles table doesn't store leg_index,
            // so we derive it from the array order (created_at-sorted by API).
            const carNo = idx + 2;
            // Per-leg pickup time falls back to the parent booking's time
            // when ops hasn't set one explicitly. When set explicitly, we
            // also compute the offset from the parent so the daily roster
            // shows that this car actually picks up later/earlier.
            const legTimeIso = v.date_time ?? job.date_time ?? null;
            const legTime = legTimeIso ? new Date(legTimeIso) : null;
            const parentTime = job.date_time ? new Date(job.date_time) : null;
            const offsetMin =
              v.date_time && parentTime && legTime
                ? Math.round((legTime.getTime() - parentTime.getTime()) / 60000)
                : 0;
            return (
              <Card
                key={`${job.id}-veh-${v.id}`}
                className="ml-6 border-border/60 bg-secondary/5 hover:bg-secondary/15 transition-all cursor-pointer"
                onClick={(e) => { e.stopPropagation(); setLocation(`/bookings/${job.id}`); }}
                data-testid={`extra-vehicle-row-${v.id}`}
              >
                <CardContent className="p-3">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20">
                        Car {carNo} · {job.tvl_ref}
                      </span>
                      <Badge
                        variant="outline"
                        className="text-[9px] py-0 px-1.5 bg-primary/10 text-primary border-primary/30 uppercase tracking-wide"
                        data-testid={`badge-extra-car-${v.id}`}
                      >
                        Extra car
                      </Badge>
                      <Badge variant="outline" className="text-[9px] py-0 px-1.5 bg-secondary/40 text-foreground border-border">
                        {v.vehicle_type ?? "—"}
                      </Badge>
                      {legTime && (
                        <span
                          className={`flex items-center gap-1 font-semibold ${
                            offsetMin !== 0 ? "text-amber-400" : "text-foreground"
                          }`}
                          data-testid={`extra-vehicle-time-${v.id}`}
                          title={
                            offsetMin !== 0 && parentTime
                              ? `Picks up ${offsetMin > 0 ? `${offsetMin} min after` : `${Math.abs(offsetMin)} min before`} Car 1 (${format(parentTime, "HH:mm")})`
                              : "Same pickup time as Car 1"
                          }
                        >
                          <Clock className="w-3 h-3" />
                          {format(legTime, "HH:mm")}
                          {offsetMin !== 0 && (
                            <span className="text-[9px] font-normal">
                              ({offsetMin > 0 ? `+${offsetMin}` : offsetMin}m)
                            </span>
                          )}
                        </span>
                      )}
                      <span className="text-muted-foreground truncate">
                        {(v.pickup ?? job.pickup) || "—"} → {(v.dropoff ?? (job as any).dropoff ?? (job as any).destination) || "—"}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {drvName ? (
                        <span className="flex items-center gap-1 text-foreground">
                          <Car className="w-3 h-3 text-muted-foreground" />
                          {drvStaff && (
                            <span className="font-mono text-[9px] px-1 py-0.5 rounded bg-primary/15 text-primary border border-primary/30">
                              {drvStaff}
                            </span>
                          )}
                          {drvName}
                        </span>
                      ) : (
                        <span className="text-destructive flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" /> No Driver
                        </span>
                      )}
                      <span className="text-muted-foreground">£{v.client_share ?? 0}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
              </div>
              );
            })}
          </div>
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

      {/* Quick status menu (long-press / right-click) */}
      <Sheet open={!!quickMenuJob} onOpenChange={(open) => !open && setQuickMenuJob(null)}>
        <SheetContent side="bottom" className="rounded-t-2xl">
          <SheetHeader className="text-left mb-4">
            <SheetTitle className="text-base">
              {quickMenuJob?.tvl_ref} · {quickMenuJob?.client_name ?? "—"}
            </SheetTitle>
            <p className="text-xs text-muted-foreground">Quick status update</p>
          </SheetHeader>
          <div className="grid grid-cols-2 gap-2">
            {(["Pending", "Confirmed", "Active", "Completed", "Cancelled"] as const).map(s => (
              <Button
                key={s}
                variant={quickMenuJob?.status === s ? "default" : "outline"}
                className="h-12 justify-start text-sm font-semibold"
                onClick={() => quickSetStatus(s)}
                disabled={quickMenuJob?.status === "Cancelled" && s !== "Cancelled"}
              >
                {quickMenuJob?.status === s && <Check className="w-4 h-4 mr-2" />}
                {s}
              </Button>
            ))}
          </div>
          <Button
            variant="ghost"
            className="w-full mt-4"
            onClick={() => { if (quickMenuJob) setLocation(`/bookings/${quickMenuJob.id}`); setQuickMenuJob(null); }}
          >
            Open full booking →
          </Button>
        </SheetContent>
      </Sheet>

      <RecentActivityFeed entityType="booking" title="Recent job activity" />

      <BulkActionBar
        count={bulk.count}
        noun="job"
        onClear={bulk.clear}
        onDelete={handleBulkDelete}
        warning="This permanently removes the selected jobs and all related records (invoices, follow-ups, email logs). This cannot be undone."
      />
    </div>
  );
}
