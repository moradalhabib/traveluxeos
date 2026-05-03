import { useMemo, useState, useRef, useCallback } from "react";
import {
  useListBookings, getListBookingsQueryKey, useDeleteBooking,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation, Link } from "wouter";
import {
  format, startOfMonth, endOfMonth, addMonths, isBefore,
} from "date-fns";
import { Calendar, Plus, Search, X, ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { JobCard } from "@/components/booking/JobCard";
import { useJobCardContext } from "@/lib/booking-data";

/**
 * Upcoming view: jobs scheduled in any FUTURE calendar month (i.e. starting
 * from the 1st of next month onward). The current month lives on /jobs;
 * past months live in /bookings (archive).
 */
export default function Upcoming() {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const canDelete = user?.role === "admin" || user?.role === "super_admin";

  const { data: bookings, isLoading } = useListBookings(
    {},
    { query: { queryKey: getListBookingsQueryKey({}) } },
  );

  const visibleBookingIds = useMemo(
    () => (bookings ?? []).map((b: any) => b.id).filter(Boolean),
    [bookings],
  );
  const { driversById, suppliersById, vehiclesByBooking } = useJobCardContext(visibleBookingIds);

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

  const [searchQuery, setSearchQuery] = useState("");
  const [collapsedMonths, setCollapsedMonths] = useState<Record<string, boolean>>({});
  // Track which month was last jumped to for chip highlight
  const [activeJump, setActiveJump] = useState<string | null>(null);

  // Refs for each month section so we can scroll them into view
  const monthRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // First day of NEXT calendar month — anything from this date forward.
  const horizon = useMemo(() => startOfMonth(addMonths(new Date(), 1)), []);

  const filtered = useMemo(() => {
    if (!bookings) return [];
    const q = searchQuery.trim().toLowerCase();
    return (bookings as any[]).filter(b => {
      if (b.status === "Cancelled") return false;
      if (!b.date_time) return false;
      const d = new Date(b.date_time);
      if (isBefore(d, horizon)) return false;
      if (q) {
        const hay = [
          b.tvl_ref, b.client_name, b.driver_name,
          b.pickup, b.dropoff, b.destination,
          b.vehicle_type, b.flight_number,
        ].filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [bookings, searchQuery, horizon]);

  // Month → date hierarchy.
  const grouped = useMemo(() => {
    const months = new Map<string, {
      monthKey: string; monthLabel: string;
      days: Map<string, { dayKey: string; dayLabel: string; jobs: any[] }>;
    }>();
    for (const b of filtered) {
      const d = new Date(b.date_time);
      const monthKey = format(d, "yyyy-MM");
      const monthLabel = format(d, "MMMM yyyy");
      const dayKey = format(d, "yyyy-MM-dd");
      const dayLabel = format(d, "EEEE d MMMM yyyy");
      if (!months.has(monthKey)) {
        months.set(monthKey, { monthKey, monthLabel, days: new Map() });
      }
      const month = months.get(monthKey)!;
      if (!month.days.has(dayKey)) {
        month.days.set(dayKey, { dayKey, dayLabel, jobs: [] });
      }
      month.days.get(dayKey)!.jobs.push(b);
    }
    const out = [...months.values()].sort((a, b) => a.monthKey.localeCompare(b.monthKey));
    for (const m of out) {
      const days = [...m.days.values()].sort((a, b) => a.dayKey.localeCompare(b.dayKey));
      for (const d of days) {
        d.jobs.sort((a, b) => new Date(a.date_time).getTime() - new Date(b.date_time).getTime());
      }
      (m as any).daysSorted = days;
    }
    return out as Array<typeof out[number] & { daysSorted: { dayKey: string; dayLabel: string; jobs: any[] }[] }>;
  }, [filtered]);

  // Jump to a month: expand it and scroll into view.
  const jumpToMonth = useCallback((monthKey: string) => {
    setCollapsedMonths(prev => ({ ...prev, [monthKey]: false }));
    setActiveJump(monthKey);
    // Scroll after state settles
    requestAnimationFrame(() => {
      const el = monthRefs.current.get(monthKey);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, []);

  // Short chip label: "Jun" within same year, "Jun '26" when crossing a year boundary
  const thisYear = new Date().getFullYear();
  const chipLabel = (monthKey: string) => {
    const [y, m] = monthKey.split("-").map(Number);
    const d = new Date(y, m - 1, 1);
    return y === thisYear ? format(d, "MMM") : format(d, "MMM ''yy");
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <h1 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <Calendar className="w-5 h-5 text-primary" /> Upcoming
          </h1>
          <p className="text-xs text-muted-foreground">
            {filtered.length} job{filtered.length !== 1 ? "s" : ""} from {format(horizon, "MMMM yyyy")} onward
          </p>
        </div>
        <Button
          className="shadow-[0_0_15px_rgba(201,168,76,0.25)] hover:shadow-[0_0_25px_rgba(201,168,76,0.4)]"
          onClick={() => setLocation("/bookings/new")}
        >
          <Plus className="w-4 h-4 mr-2" /> New Booking
        </Button>
      </div>

      {/* Cross-link strip */}
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <Link href="/jobs" className="underline hover:text-primary">← {format(new Date(), "MMMM")} jobs</Link>
        <span>·</span>
        <Link href="/bookings" className="underline hover:text-primary">All bookings (archive)</Link>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search TVL ref, client, driver, route…"
          className="pl-8 pr-8 h-9 text-sm bg-card border-border"
          data-testid="input-upcoming-search"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => setSearchQuery("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            aria-label="Clear search"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Month jump strip — shown only when 2+ months exist and no active search */}
      {!searchQuery && grouped.length >= 2 && (
        <div
          className="flex items-center gap-1.5 overflow-x-auto pb-0.5 scrollbar-none -mx-1 px-1"
          data-testid="month-jump-strip"
          aria-label="Jump to month"
        >
          <span className="text-[10px] text-muted-foreground flex-shrink-0 mr-0.5">Jump:</span>
          {grouped.map((month) => {
            const isActive = activeJump === month.monthKey;
            const isFirst = month.monthKey === grouped[0].monthKey;
            return (
              <button
                key={month.monthKey}
                type="button"
                onClick={() => jumpToMonth(month.monthKey)}
                data-testid={`jump-chip-${month.monthKey}`}
                className={`flex-shrink-0 text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-all ${
                  isActive
                    ? "bg-primary text-primary-foreground border-primary shadow-[0_0_8px_rgba(201,168,76,0.35)]"
                    : isFirst && activeJump === null
                      ? "bg-primary/15 text-primary border-primary/40"
                      : "bg-muted/40 text-muted-foreground border-border hover:bg-muted hover:text-foreground"
                }`}
              >
                {chipLabel(month.monthKey)}
              </button>
            );
          })}
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-28" />)}
        </div>
      ) : grouped.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center" data-testid="empty-upcoming">
          <Calendar className="w-12 h-12 text-muted-foreground/30 mb-4" />
          <p className="text-muted-foreground font-medium">No upcoming jobs</p>
          <p className="text-sm text-muted-foreground/70 mt-1 mb-6">
            Nothing scheduled beyond {format(endOfMonth(new Date()), "d MMM")}.
          </p>
          <Button onClick={() => setLocation("/bookings/new")}>
            <Plus className="w-4 h-4 mr-2" /> New Booking
          </Button>
        </div>
      ) : (
        <div className="space-y-5">
          {grouped.map((month) => {
            // First future month opens by default; later months collapsed.
            const defaultCollapsed = month.monthKey !== grouped[0].monthKey;
            const monthCollapsed = collapsedMonths[month.monthKey] ?? defaultCollapsed;
            const monthJobCount = month.daysSorted.reduce((sum, d) => sum + d.jobs.length, 0);
            return (
              <div
                key={month.monthKey}
                className="space-y-2"
                ref={(el) => {
                  if (el) monthRefs.current.set(month.monthKey, el);
                  else monthRefs.current.delete(month.monthKey);
                }}
              >
                <button
                  type="button"
                  onClick={() => setCollapsedMonths(prev => ({ ...prev, [month.monthKey]: !monthCollapsed }))}
                  className="w-full flex items-center gap-2 sticky top-0 bg-background/95 backdrop-blur-sm py-2 z-10 hover:bg-secondary/20 rounded-md px-2 transition-colors border-b border-border"
                  data-testid={`upcoming-month-toggle-${month.monthKey}`}
                >
                  {monthCollapsed ? <ChevronRight className="w-4 h-4 text-primary" /> : <ChevronDown className="w-4 h-4 text-primary" />}
                  <h2 className="text-sm font-bold text-primary uppercase tracking-widest text-left">{month.monthLabel}</h2>
                  <div className="flex-1 h-px bg-border" />
                  <Badge variant="outline" className="text-[10px] text-muted-foreground border-border">
                    {monthJobCount} job{monthJobCount !== 1 ? "s" : ""}
                  </Badge>
                </button>
                {!monthCollapsed && month.daysSorted.map((day) => (
                  <div key={day.dayKey} className="space-y-1.5 ml-2">
                    <div className="flex items-center gap-2 py-1">
                      <h3 className="text-[11px] font-bold text-primary/80 uppercase tracking-wider">{day.dayLabel}</h3>
                      <div className="flex-1 h-px bg-border/50" />
                      <Badge variant="outline" className="text-[10px] text-muted-foreground border-border">{day.jobs.length}</Badge>
                    </div>
                    {day.jobs.map(job => (
                      <JobCard
                        key={job.id}
                        job={job}
                        driversById={driversById}
                        suppliersById={suppliersById}
                        extras={vehiclesByBooking.get(job.id) ?? []}
                        canDelete={canDelete}
                        onDelete={(id) => deleteBookingMut.mutate({ id })}
                      />
                    ))}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
