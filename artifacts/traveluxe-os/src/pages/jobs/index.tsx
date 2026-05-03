import { useState, useMemo, useEffect } from "react";
import {
  useListBookings, getListBookingsQueryKey,
  useUpdateBookingStatus, useDeleteBooking,
} from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useLocation, useSearch, Link } from "wouter";
import {
  format, isToday, isTomorrow, startOfDay, endOfDay, addDays,
  isBefore, isAfter, startOfMonth, endOfMonth, isSameMonth,
} from "date-fns";
import {
  AlertTriangle, Plus, Clock, Briefcase, X, Check, Building2, Search,
  ChevronDown, ChevronRight, EyeOff, Eye, CheckSquare,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { isSupplierDrivenJob } from "@/lib/supplierDriven";
import { FilterDropdown, useFilterState } from "@/components/ui/filter-dropdown";
import { ActiveFilterChips, type ActiveFilter } from "@/components/ui/active-filter-chips";
import { RecentActivityFeed } from "@/components/activity/RecentActivityFeed";
import { useQueryClient } from "@tanstack/react-query";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { supabase } from "@/lib/supabase";
import { useBulkSelect } from "@/hooks/use-bulk-select";
import { BulkActionBar } from "@/components/bulk-action-bar";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { JobCard } from "@/components/booking/JobCard";
import { useJobCardContext } from "@/lib/booking-data";

type TimeFilter = "month" | "today" | "tomorrow" | "this_week";

export default function Jobs() {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();
  const canDelete = user?.role === "admin" || user?.role === "super_admin";

  // Default time view = "month" (whole current calendar month). The
  // narrower options (today/tomorrow/this week) further filter inside it.
  const [timeFilter, setTimeFilter] = useFilterState<TimeFilter>("time", "month");
  const search = useSearch();
  const statusFilter = new URLSearchParams(search).get("status") ?? "";
  const customFilter = new URLSearchParams(search).get("filter") ?? "";
  const qc = useQueryClient();
  const bulk = useBulkSelect();

  const { data: bookings, isLoading } = useListBookings(
    {},
    { query: { enabled: true, queryKey: getListBookingsQueryKey({}) } }
  );

  const updateStatus = useUpdateBookingStatus();

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

  // URL-backed "show only unassigned" filter, toggled by the urgent banner.
  const [unassignedFlag, setUnassignedFlag] = useFilterState<"0" | "1">("unassigned", "0");
  const unassignedOnly = unassignedFlag === "1";
  const setUnassignedOnly = (v: boolean) => setUnassignedFlag(v ? "1" : "0");

  // UI-local filters (intentionally not URL-persisted).
  const [searchQuery, setSearchQuery] = useState("");
  const [hideCompleted, setHideCompleted] = useState(true);
  const [collapsedDays, setCollapsedDays] = useState<Record<string, boolean>>({});

  // Hard cap to the current calendar month — Jobs Board never shows past
  // months or future months. Past goes to /bookings, future goes to /upcoming.
  const monthStart = useMemo(() => startOfMonth(new Date()), []);
  const monthEnd   = useMemo(() => endOfMonth(new Date()),   []);
  const monthLabel = format(new Date(), "MMMM yyyy");

  const filteredBookings = useMemo(() => {
    if (!bookings) return [];
    const now = new Date();
    const q = searchQuery.trim().toLowerCase();
    return bookings.filter(b => {
      if (b.status === "Cancelled") return false;
      // Hard month boundary. A booking with no date_time is hidden from the
      // Jobs Board (it lives in Bookings → Date TBC instead).
      if (!b.date_time) return false;
      const d = new Date(b.date_time);
      if (isBefore(d, monthStart) || isAfter(d, monthEnd)) return false;

      if (
        hideCompleted && !q &&
        b.status === "Completed" && statusFilter !== "Completed"
      ) return false;

      if (q) {
        const hay = [
          b.tvl_ref, (b as any).client_name, (b as any).driver_name,
          b.pickup, (b as any).dropoff, (b as any).destination,
          b.vehicle_type, (b as any).flight_number,
        ].filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (unassignedOnly) {
        if (b.driver_id || isSupplierDrivenJob(b as any)) return false;
        if (b.status === "Completed") return false;
        return true;
      }
      if (customFilter === "needs-driver") {
        if (b.driver_id || isSupplierDrivenJob(b as any)) return false;
        if (b.status !== "Pending" && b.status !== "Confirmed") return false;
        return true;
      }
      if (statusFilter && b.status !== statusFilter) return false;
      if (statusFilter) return true;
      switch (timeFilter) {
        case "today":     return isToday(d);
        case "tomorrow":  return isTomorrow(d);
        case "this_week": {
          const weekEnd = endOfDay(addDays(now, 7));
          return !isBefore(d, startOfDay(now)) && !isAfter(d, weekEnd);
        }
        case "month":
        default:
          return true; // already month-bounded above
      }
    });
  }, [bookings, timeFilter, statusFilter, customFilter, unassignedOnly, searchQuery, hideCompleted, monthStart, monthEnd]);

  // Card data context (drivers, suppliers, vehicles).
  // Derive IDs from filteredBookings so the booking_vehicles fetch is
  // scoped to only the jobs currently visible — no full-table scan.
  const visibleBookingIds = useMemo(
    () => filteredBookings.map((b: any) => b.id).filter(Boolean),
    [filteredBookings],
  );
  const { driversById, suppliersById, vehiclesByBooking } = useJobCardContext(visibleBookingIds);

  // Long-press quick-status menu (bottom sheet)
  const [quickMenuJob, setQuickMenuJob] = useState<any>(null);
  const quickSetStatus = (status: string) => {
    if (!quickMenuJob) return;
    updateStatus.mutate({ id: quickMenuJob.id, data: { status } }, {
      onSuccess: () => qc.invalidateQueries({ queryKey: getListBookingsQueryKey({}) }),
    });
    setQuickMenuJob(null);
  };

  // Urgent count is derived from THIS month's bookings only so the strip
  // doesn't count jobs that live in /upcoming or /bookings (archive).
  const urgentJobs = useMemo(
    () => (bookings ?? []).filter(b => {
      if (!b.date_time) return false;
      const d = new Date(b.date_time);
      if (!isSameMonth(d, monthStart)) return false;
      return !b.driver_id &&
        !isSupplierDrivenJob(b as any) &&
        b.status !== "Completed" &&
        b.status !== "Cancelled";
    }),
    [bookings, monthStart]
  );

  // Bookings starting within the next 60 minutes — "prepare now" strip.
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
      if (b.status === "Cancelled" || b.status === "Active" || b.status === "Completed") return false;
      const t = new Date(b.date_time).getTime();
      return t >= lo && t <= hi;
    });
  }, [bookings, now]);

  // Active jobs THIS MONTH (for the header counter). Respects the
  // "Completed hidden" toggle so the header total matches the visible list.
  const activeJobsThisMonth = useMemo(
    () => (bookings ?? []).filter(b => {
      if (!b.date_time || b.status === "Cancelled") return false;
      if (hideCompleted && b.status === "Completed") return false;
      const d = new Date(b.date_time);
      return isSameMonth(d, monthStart);
    }),
    [bookings, monthStart, hideCompleted],
  );

  // Group by date.
  const groupedByDate = useMemo(() => {
    const groups = new Map<string, { label: string; sortKey: string; jobs: typeof filteredBookings }>();
    for (const job of filteredBookings) {
      if (!job.date_time) continue; // month-only board has no Date TBC
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
      j.status === "Completed" && j.date_time && new Date(j.date_time).getTime() < nowMs;
    for (const g of sorted) {
      g.jobs.sort((a, b) => {
        const aDone = isFinishedPast(a);
        const bDone = isFinishedPast(b);
        if (aDone !== bDone) return aDone ? 1 : -1;
        return new Date(a.date_time!).getTime() - new Date(b.date_time!).getTime();
      });
    }
    return sorted;
  }, [filteredBookings]);

  return (
    <div className={`space-y-2 ${bulk.selectMode ? "pb-32 sm:pb-4" : ""}`}>
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <h1 className="text-xl font-bold tracking-tight text-foreground">
            {statusFilter ? `${statusFilter} Jobs · ${monthLabel}` : `${monthLabel} Jobs`}
          </h1>
          <p className="text-xs text-muted-foreground">
            {statusFilter
              ? `${filteredBookings.length} job${filteredBookings.length !== 1 ? "s" : ""}`
              : `${activeJobsThisMonth.length} job${activeJobsThisMonth.length !== 1 ? "s" : ""} this month`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canDelete && (
            bulk.selectMode ? (
              <>
                <Button variant="outline" size="sm"
                  onClick={() => bulk.selectAll(filteredBookings.map((j: any) => j.id))}
                  data-testid="button-select-all">
                  <CheckSquare className="w-4 h-4 mr-1.5" /> All
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
              <Plus className="w-4 h-4 mr-2" /> New Booking
            </Button>
          )}
        </div>
      </div>

      {/* Cross-link strip */}
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <Link href="/upcoming" className="underline hover:text-primary">Upcoming months →</Link>
        <span>·</span>
        <Link href="/bookings" className="underline hover:text-primary">All bookings (archive)</Link>
      </div>

      {/* Urgent alert */}
      {urgentJobs.length > 0 && (
        <button
          type="button"
          className="w-full border rounded-xl p-4 bg-destructive/10 border-destructive/30 text-left hover:bg-destructive/15 active:bg-destructive/20 transition-colors cursor-pointer"
          onClick={() => setUnassignedOnly(!unassignedOnly)}
        >
          <div className="flex items-center gap-2 text-destructive font-semibold text-sm">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            <span>{urgentJobs.length} job{urgentJobs.length > 1 ? "s" : ""} need{urgentJobs.length === 1 ? "s" : ""} a driver assigned urgently</span>
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

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search TVL ref, client, driver, route, vehicle…"
          className="pl-8 pr-8 h-9 text-sm bg-card border-border"
          data-testid="input-jobs-search"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => setSearchQuery("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            aria-label="Clear search"
            data-testid="button-jobs-search-clear"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap sm:overflow-x-auto sm:pb-0.5">
        {!statusFilter && (
          <>
            <FilterDropdown
              label="Time"
              value={timeFilter}
              onChange={(v) => setTimeFilter(v as TimeFilter)}
              options={[
                { value: "month",     label: `All ${monthLabel}` },
                { value: "today",     label: "Today" },
                { value: "tomorrow",  label: "Tomorrow" },
                { value: "this_week", label: "This Week" },
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
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setHideCompleted(v => !v)}
          className={`h-9 sm:h-8 px-2.5 text-[11px] flex-shrink-0 ${hideCompleted ? "border-border text-muted-foreground" : "border-primary/40 text-primary bg-primary/5"}`}
          title={hideCompleted ? "Completed jobs hidden — click to show" : "Completed jobs visible — click to hide"}
          data-testid="button-toggle-hide-completed"
        >
          {hideCompleted ? <EyeOff className="w-3 h-3 mr-1" /> : <Eye className="w-3 h-3 mr-1" />}
          {hideCompleted ? "Completed hidden" : "Completed shown"}
        </Button>
        {(() => {
          const TIME_LABELS: Record<string, string> = {
            month: `All ${monthLabel}`, today: "Today", tomorrow: "Tomorrow", this_week: "This Week",
          };
          const chips: ActiveFilter[] = [];
          if (statusFilter) chips.push({ key: "status", label: "Status", value: statusFilter, onClear: () => setLocation("/jobs") });
          if (timeFilter !== "month") chips.push({ key: "time", label: "Time", value: TIME_LABELS[timeFilter] ?? timeFilter, onClear: () => setTimeFilter("month") });
          if (unassignedOnly) chips.push({ key: "unassigned", label: "Show", value: "Unassigned only", onClear: () => setUnassignedOnly(false) });
          if (chips.length === 0) return null;
          return (
            <ActiveFilterChips
              filters={chips}
              onClearAll={() => { setTimeFilter("month"); setUnassignedOnly(false); if (statusFilter) setLocation("/jobs"); }}
            />
          );
        })()}
      </div>

      {/* Job cards grouped by date */}
      <div className="space-y-4">
        {isLoading ? (
          [...Array(4)].map((_, i) => <Skeleton key={i} className="h-28" />)
        ) : filteredBookings.length > 0 ? groupedByDate.map((group) => {
          const isPast = group.sortKey < format(new Date(), "yyyy-MM-dd");
          const defaultCollapsed = isPast;
          const isCollapsed = collapsedDays[group.sortKey] ?? defaultCollapsed;
          return (
            <div key={group.sortKey} className="space-y-1.5">
              <button
                type="button"
                onClick={() => setCollapsedDays(prev => ({ ...prev, [group.sortKey]: !isCollapsed }))}
                className="w-full min-h-9 sm:min-h-0 flex items-center gap-2 sticky top-0 bg-background/95 backdrop-blur-sm py-1.5 sm:py-1 z-10 hover:bg-secondary/20 rounded-md px-1 transition-colors"
                data-testid={`day-toggle-${group.sortKey}`}
              >
                {isCollapsed ? <ChevronRight className="w-4 h-4 sm:w-3 sm:h-3 text-primary flex-shrink-0" /> : <ChevronDown className="w-4 h-4 sm:w-3 sm:h-3 text-primary flex-shrink-0" />}
                <h2 className="text-[11px] font-bold text-primary uppercase tracking-widest text-left">{group.label}</h2>
                <div className="flex-1 h-px bg-border" />
                <Badge variant="outline" className="text-[10px] text-muted-foreground border-border">
                  {group.jobs.length}
                </Badge>
              </button>
              {!isCollapsed && group.jobs.map((job) => (
                <JobCard
                  key={job.id}
                  job={job}
                  driversById={driversById}
                  suppliersById={suppliersById}
                  extras={vehiclesByBooking.get(job.id) ?? []}
                  selectMode={bulk.selectMode}
                  isSelected={bulk.isSelected(job.id)}
                  onToggleSelect={(id) => bulk.toggle(id)}
                  canDelete={canDelete}
                  onDelete={(id) => deleteBookingMut.mutate({ id })}
                  onLongPress={(j) => setQuickMenuJob(j)}
                />
              ))}
            </div>
          );
        }) : (() => {
          const hasAnyBookings = (bookings?.length ?? 0) > 0;
          const hasActiveFilters =
            !!statusFilter || timeFilter !== "month" || unassignedOnly ||
            !!searchQuery.trim() || hideCompleted;
          const resetFilters = () => {
            setSearchQuery("");
            setTimeFilter("month");
            setUnassignedOnly(false);
            setHideCompleted(false);
            if (statusFilter) setLocation("/jobs");
          };
          if (hasAnyBookings && hasActiveFilters) {
            return (
              <div className="flex flex-col items-center justify-center py-16 text-center" data-testid="empty-jobs-filtered">
                <Briefcase className="w-12 h-12 text-muted-foreground/30 mb-4" />
                <p className="text-muted-foreground font-medium">
                  No jobs match the current filters in {monthLabel}
                </p>
                <p className="text-sm text-muted-foreground/70 mt-1 mb-6">
                  Try widening the filters, look at <Link href="/upcoming" className="underline text-primary hover:text-primary/80">Upcoming months</Link>, or browse the full <Link href="/bookings" className="underline text-primary hover:text-primary/80">archive</Link>.
                </p>
                <div className="flex flex-wrap gap-2 justify-center">
                  <Button variant="outline" onClick={resetFilters} data-testid="button-reset-filters">
                    <X className="w-4 h-4 mr-2" /> Clear filters
                  </Button>
                </div>
              </div>
            );
          }
          return (
            <div className="flex flex-col items-center justify-center py-16 text-center" data-testid="empty-jobs-fresh">
              <Briefcase className="w-12 h-12 text-muted-foreground/30 mb-4" />
              <p className="text-muted-foreground font-medium">No jobs in {monthLabel}</p>
              <p className="text-sm text-muted-foreground/70 mt-1 mb-6">Create a booking to get started, or check <Link href="/upcoming" className="underline text-primary hover:text-primary/80">Upcoming</Link>.</p>
              <Button onClick={() => setLocation("/bookings/new")}>
                <Plus className="w-4 h-4 mr-2" /> New Booking
              </Button>
            </div>
          );
        })()}
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
