import { useState, useMemo } from "react";
import {
  useListBookings, getListBookingsQueryKey, useDeleteBooking,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, Home, X, CheckSquare, Search, ChevronDown, ChevronRight, Archive } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useBulkSelect } from "@/hooks/use-bulk-select";
import { BulkActionBar } from "@/components/bulk-action-bar";
import { supabase } from "@/lib/supabase";
import { Link } from "wouter";
import { format } from "date-fns";
import { FilterDropdown, useFilterState } from "@/components/ui/filter-dropdown";
import { ActiveFilterChips, type ActiveFilter } from "@/components/ui/active-filter-chips";
import { useAuth } from "@/hooks/use-auth";
import { JobCard } from "@/components/booking/JobCard";
import { useJobCardContext } from "@/lib/booking-data";

/**
 * Bookings = the full archive. Drill-down: Year → Month → Date → Job card.
 * Search + status filter span the whole archive. Current/upcoming work
 * lives on /jobs and /upcoming respectively.
 */
export default function Bookings() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isResidenceManager = user?.role === "residence_manager";
  const isSuperAdmin = user?.role === "super_admin";
  const canDeleteBookings = user?.role === "admin" || user?.role === "super_admin";

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

  const bulk = useBulkSelect();

  const handleBulkDelete = async () => {
    const ids = bulk.ids;
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    // Single server round-trip — server batches cascades and emits one
    // aggregated staff notification instead of N individual ones.
    const r = await fetch("/api/bookings/bulk-delete", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ ids }),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) {
      toast({ title: "Delete failed", description: body.error ?? "Unknown error", variant: "destructive" });
      return;
    }
    const { deleted = 0, failed = 0, missing = 0 } = body;
    const missedNote = missing > 0 ? ` · ${missing} already gone` : "";
    toast({
      title: failed === 0 ? "Bookings deleted" : `${deleted} deleted, ${failed} failed`,
      description: (failed === 0 ? `${deleted} booking${deleted === 1 ? "" : "s"} permanently removed` : "Some deletions failed — check audit log") + missedNote,
      variant: failed === 0 ? undefined : "destructive",
    });
    queryClient.invalidateQueries();
    bulk.exitSelectMode();
  };

  const [status, setStatus] = useFilterState<string>("status", "");
  const [search, setSearch] = useFilterState<string>("q", "");
  const [source, setSource] = useFilterState<"active" | "imported">("source", "active");
  const [reason, setReason] = useFilterState<string>("reason", "");

  const importedParam = source === "imported" ? ("only" as const) : ("exclude" as const);
  const params = {
    status: status || undefined,
    imported: importedParam,
    cancellation_reason: reason || undefined,
  };
  const { data: rawBookings, isLoading } = useListBookings(
    params,
    { query: { enabled: true, queryKey: getListBookingsQueryKey(params) } },
  );

  // RM scope: apartments only.
  const bookings = useMemo(() => {
    if (!rawBookings) return [];
    let list = rawBookings as any[];
    if (isResidenceManager) list = list.filter((b) => b.service_type === "Apartment");
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (b) =>
          (b.client_name ?? "").toLowerCase().includes(q) ||
          (b.tvl_ref ?? "").toLowerCase().includes(q) ||
          (b.pickup ?? "").toLowerCase().includes(q) ||
          (b.dropoff ?? "").toLowerCase().includes(q),
      );
    }
    return list;
  }, [rawBookings, isResidenceManager, search]);

  const visibleBookingIds = useMemo(
    () => bookings.map((b: any) => b.id).filter(Boolean),
    [bookings],
  );
  const { driversById, suppliersById, vehiclesByBooking } = useJobCardContext(visibleBookingIds);

  // Year → Month → Date hierarchy.
  type DayBucket = { dayKey: string; dayLabel: string; jobs: any[] };
  type MonthBucket = { monthKey: string; monthLabel: string; days: Map<string, DayBucket>; total: number };
  type YearBucket = { yearKey: string; months: Map<string, MonthBucket>; total: number };

  const grouped = useMemo(() => {
    const years = new Map<string, YearBucket>();
    const undated: any[] = [];
    for (const b of bookings) {
      if (!b.date_time) { undated.push(b); continue; }
      const d = new Date(b.date_time);
      const yearKey = format(d, "yyyy");
      const monthKey = format(d, "yyyy-MM");
      const monthLabel = format(d, "MMMM yyyy");
      const dayKey = format(d, "yyyy-MM-dd");
      const dayLabel = format(d, "EEEE d MMMM yyyy");
      if (!years.has(yearKey)) years.set(yearKey, { yearKey, months: new Map(), total: 0 });
      const y = years.get(yearKey)!;
      if (!y.months.has(monthKey)) y.months.set(monthKey, { monthKey, monthLabel, days: new Map(), total: 0 });
      const m = y.months.get(monthKey)!;
      if (!m.days.has(dayKey)) m.days.set(dayKey, { dayKey, dayLabel, jobs: [] });
      m.days.get(dayKey)!.jobs.push(b);
      m.total++;
      y.total++;
    }
    // Sort newest year first, newest month first within year, newest day first within month.
    const yearsSorted = [...years.values()].sort((a, b) => b.yearKey.localeCompare(a.yearKey));
    for (const y of yearsSorted) {
      const monthsSorted = [...y.months.values()].sort((a, b) => b.monthKey.localeCompare(a.monthKey));
      for (const m of monthsSorted) {
        const daysSorted = [...m.days.values()].sort((a, b) => b.dayKey.localeCompare(a.dayKey));
        for (const day of daysSorted) {
          day.jobs.sort((a: any, b: any) => new Date(a.date_time!).getTime() - new Date(b.date_time!).getTime());
        }
        (m as any).daysSorted = daysSorted;
      }
      (y as any).monthsSorted = monthsSorted;
    }
    return { years: yearsSorted as Array<YearBucket & { monthsSorted: Array<MonthBucket & { daysSorted: DayBucket[] }> }>, undated };
  }, [bookings]);

  const totalBookings = useMemo(
    () => grouped.years.reduce((s, y) => s + y.total, 0) + grouped.undated.length,
    [grouped],
  );

  // Default expansion: current year + current month.
  const currentYear = format(new Date(), "yyyy");
  const currentMonthKey = format(new Date(), "yyyy-MM");
  const [expandedYears, setExpandedYears] = useState<Record<string, boolean>>({});
  const [expandedMonths, setExpandedMonths] = useState<Record<string, boolean>>({});
  const [expandedDays, setExpandedDays] = useState<Record<string, boolean>>({});

  // While searching/filtering by status or reason, force-expand everything so
  // results aren't hidden behind closed accordions.
  const expandAll = !!search.trim() || !!status || !!reason;
  const isYearOpen = (k: string) => expandAll || (expandedYears[k] ?? (k === currentYear));
  const isMonthOpen = (k: string) => expandAll || (expandedMonths[k] ?? (k === currentMonthKey));
  const isDayOpen = (k: string) => expandAll || (expandedDays[k] ?? false);

  const toggleYear = (k: string) => setExpandedYears(p => ({ ...p, [k]: !isYearOpen(k) }));
  const toggleMonth = (k: string) => setExpandedMonths(p => ({ ...p, [k]: !isMonthOpen(k) }));
  const toggleDay = (k: string) => setExpandedDays(p => ({ ...p, [k]: !isDayOpen(k) }));

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            {isResidenceManager ? <Home className="w-6 h-6 text-primary" /> : <Archive className="w-6 h-6 text-primary" />}
            {isResidenceManager ? "Apartment Bookings" : "Bookings Archive"}
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            {totalBookings} booking{totalBookings !== 1 ? "s" : ""} on file
            {!isResidenceManager && " · drill down by year → month → day"}
          </p>
          {!isResidenceManager && (
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-2">
              <Link href="/jobs" className="underline hover:text-primary">{format(new Date(), "MMMM")} Jobs Board →</Link>
              <span>·</span>
              <Link href="/upcoming" className="underline hover:text-primary">Upcoming months →</Link>
            </div>
          )}
        </div>
        {!isResidenceManager && (
          <div className="flex gap-2 w-full sm:w-auto">
            {canDeleteBookings && (
              bulk.selectMode ? (
                <Button variant="outline" onClick={bulk.exitSelectMode} className="h-12 flex-1 sm:flex-initial" data-testid="button-cancel-select">
                  <X className="w-4 h-4 mr-2" /> Cancel
                </Button>
              ) : (
                <Button variant="outline" onClick={bulk.enterSelectMode} className="h-12 flex-1 sm:flex-initial" data-testid="button-select-mode">
                  <CheckSquare className="w-4 h-4 mr-2" /> Select
                </Button>
              )
            )}
            {!bulk.selectMode && (
              <Link href="/bookings/new" className="flex-1 sm:flex-initial">
                <Button className="w-full h-12 shadow-[0_0_10px_rgba(201,168,76,0.2)]">
                  <Plus className="w-4 h-4 mr-2" /> New Booking
                </Button>
              </Link>
            )}
          </div>
        )}
      </div>

      {/* Search + filters */}
      <div className="flex flex-col md:flex-row md:items-center gap-3">
        <div className="relative md:w-72">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search across all bookings…"
            className="pl-8"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-testid="input-bookings-search"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!isResidenceManager && isSuperAdmin && (
            <FilterDropdown
              label="Source:"
              value={source}
              onChange={(v) => { if (v === "active" || v === "imported") setSource(v); }}
              options={[
                { value: "active",   label: "Active" },
                { value: "imported", label: "Imported (Odoo)" },
              ]}
              widthClass="w-44"
              testId="filter-bookings-source"
            />
          )}
          <FilterDropdown
            label="Status:"
            value={status === "" ? "all" : status}
            onChange={(v) => setStatus(v === "all" ? "" : v)}
            options={[
              { value: "all", label: "All" },
              { value: "Pending", label: "Pending" },
              { value: "Confirmed", label: "Confirmed" },
              { value: "Active", label: "Active" },
              { value: "Completed", label: "Completed" },
              { value: "Cancelled", label: "Cancelled" },
            ]}
            testId="filter-bookings-status"
          />
        </div>
      </div>

      {(() => {
        const chips: ActiveFilter[] = [];
        if (isSuperAdmin && !isResidenceManager && source !== "active") {
          chips.push({ key: "source", label: "Source", value: "Imported (Odoo)", onClear: () => setSource("active") });
        }
        if (status !== "") chips.push({ key: "status", label: "Status", value: status, onClear: () => setStatus("") });
        if (reason !== "") chips.push({ key: "reason", label: "Reason", value: reason === "__none" ? "Unspecified" : reason, onClear: () => setReason("") });
        return <ActiveFilterChips filters={chips} onClearAll={() => {
          if (isSuperAdmin && !isResidenceManager) setSource("active");
          setStatus("");
          setReason("");
        }} />;
      })()}

      {/* Drill-down */}
      {isLoading ? (
        <div className="space-y-3">
          {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-14" />)}
        </div>
      ) : grouped.years.length === 0 && grouped.undated.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center" data-testid="empty-bookings">
          <Archive className="w-12 h-12 text-muted-foreground/30 mb-4" />
          <p className="text-muted-foreground font-medium">No bookings match your filters</p>
          <p className="text-sm text-muted-foreground/70 mt-1 mb-6">Try clearing filters or check the Jobs Board for current activity.</p>
          <Button variant="outline" onClick={() => { setStatus(""); setSearch(""); setReason(""); }}>
            <X className="w-4 h-4 mr-2" /> Clear filters
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {grouped.years.map((year) => {
            const yearOpen = isYearOpen(year.yearKey);
            return (
              <div key={year.yearKey} className="border border-border rounded-xl overflow-hidden">
                <button
                  type="button"
                  onClick={() => toggleYear(year.yearKey)}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-secondary/20 transition-colors"
                  data-testid={`year-toggle-${year.yearKey}`}
                >
                  {yearOpen ? <ChevronDown className="w-5 h-5 text-primary" /> : <ChevronRight className="w-5 h-5 text-primary" />}
                  <span className="font-bold text-base text-foreground">{year.yearKey}</span>
                  <Badge variant="outline" className="text-[10px] text-muted-foreground border-border">
                    {year.total} booking{year.total !== 1 ? "s" : ""}
                  </Badge>
                  <div className="flex-1" />
                </button>

                {yearOpen && (
                  <div className="border-t border-border bg-card/30 divide-y divide-border">
                    {year.monthsSorted.map((month) => {
                      const monthOpen = isMonthOpen(month.monthKey);
                      return (
                        <div key={month.monthKey}>
                          <button
                            type="button"
                            onClick={() => toggleMonth(month.monthKey)}
                            className="w-full flex items-center gap-3 px-5 py-2.5 hover:bg-secondary/20 transition-colors"
                            data-testid={`month-toggle-${month.monthKey}`}
                          >
                            {monthOpen ? <ChevronDown className="w-4 h-4 text-primary/80" /> : <ChevronRight className="w-4 h-4 text-primary/80" />}
                            <span className="font-semibold text-sm text-foreground">{format(new Date(month.monthKey + "-01"), "MMMM")}</span>
                            <Badge variant="outline" className="text-[10px] text-muted-foreground border-border">
                              {month.total} booking{month.total !== 1 ? "s" : ""}
                            </Badge>
                          </button>

                          {monthOpen && (
                            <div className="px-3 sm:px-5 pb-3 space-y-2.5">
                              {(month as any).daysSorted.map((day: DayBucket) => {
                                const dayOpen = isDayOpen(day.dayKey);
                                return (
                                  <div key={day.dayKey} className="border border-border/60 rounded-lg overflow-hidden">
                                    <button
                                      type="button"
                                      onClick={() => toggleDay(day.dayKey)}
                                      className="w-full flex items-center gap-2 px-3 py-2 hover:bg-secondary/20 transition-colors text-left"
                                      data-testid={`day-toggle-${day.dayKey}`}
                                    >
                                      {dayOpen ? <ChevronDown className="w-3.5 h-3.5 text-primary/70" /> : <ChevronRight className="w-3.5 h-3.5 text-primary/70" />}
                                      <span className="text-[12px] font-bold text-primary uppercase tracking-wide">{day.dayLabel}</span>
                                      <Badge variant="outline" className="text-[10px] text-muted-foreground border-border ml-auto">
                                        {day.jobs.length}
                                      </Badge>
                                    </button>
                                    {dayOpen && (
                                      <div className="p-2 space-y-1.5 bg-background/50">
                                        {day.jobs.map((job) => (
                                          <JobCard
                                            key={job.id}
                                            job={job}
                                            driversById={driversById}
                                            suppliersById={suppliersById}
                                            extras={vehiclesByBooking.get(job.id) ?? []}
                                            selectMode={bulk.selectMode}
                                            isSelected={bulk.isSelected(job.id)}
                                            onToggleSelect={(id) => bulk.toggle(id)}
                                            canDelete={canDeleteBookings}
                                            onDelete={(id) => deleteBookingMut.mutate({ id })}
                                          />
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}

          {grouped.undated.length > 0 && (
            <div className="border border-border rounded-xl overflow-hidden">
              <div className="px-4 py-3 flex items-center gap-3">
                <span className="font-bold text-base text-foreground">Date TBC</span>
                <Badge variant="outline" className="text-[10px] text-muted-foreground border-border">
                  {grouped.undated.length} booking{grouped.undated.length !== 1 ? "s" : ""}
                </Badge>
              </div>
              <div className="p-3 space-y-1.5 border-t border-border">
                {grouped.undated.map((job: any) => (
                  <JobCard
                    key={job.id}
                    job={job}
                    driversById={driversById}
                    suppliersById={suppliersById}
                    extras={vehiclesByBooking.get(job.id) ?? []}
                    selectMode={bulk.selectMode}
                    isSelected={bulk.isSelected(job.id)}
                    onToggleSelect={(id) => bulk.toggle(id)}
                    canDelete={canDeleteBookings}
                    onDelete={(id) => deleteBookingMut.mutate({ id })}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <BulkActionBar
        count={bulk.count}
        noun="booking"
        onClear={bulk.clear}
        onDelete={handleBulkDelete}
        warning="This permanently removes the selected bookings and all related records (invoices, follow-ups, email logs). This cannot be undone."
      />
    </div>
  );
}
