import { useState, useMemo } from "react";
import { useListBookings, getListBookingsQueryKey, useDeleteBooking } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, Briefcase, Home, X, StickyNote, Trash2, CheckSquare, MapPin, Car, MessageCircle, Clock, AlertTriangle, Plane } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useBulkSelect } from "@/hooks/use-bulk-select";
import { BulkActionBar } from "@/components/bulk-action-bar";
import { supabase } from "@/lib/supabase";
import { Skeleton } from "@/components/ui/skeleton";
import { Link, useSearch, useLocation } from "wouter";
import { format, startOfDay, isBefore } from "date-fns";
import { Input } from "@/components/ui/input";
import { FilterDropdown, useFilterState } from "@/components/ui/filter-dropdown";
import { ActiveFilterChips, type ActiveFilter } from "@/components/ui/active-filter-chips";
import { useAuth } from "@/hooks/use-auth";

// Sort + Group controls (Fix 3). Default sort is Most Recent (created_at desc)
// across all list pages in the app; bookings additionally exposes Group By
// Service Type so operators can scan bookings clustered by service.
type SortKey = "date_asc" | "date_desc" | "recent" | "oldest" | "service" | "status" | "price";
type GroupKey = "none" | "service";
const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "date_asc",  label: "By Date (Soonest)" },
  { value: "date_desc", label: "By Date (Latest)" },
  { value: "recent",    label: "Most Recent (created)" },
  { value: "oldest",    label: "Oldest (created)" },
  { value: "service",   label: "By Service Type" },
  { value: "status",    label: "By Status" },
  { value: "price",     label: "By Price" },
];
const STATUS_ORDER: Record<string, number> = {
  Pending: 0, Confirmed: 1, Active: 2, Completed: 3, Cancelled: 4,
};

const STATUS_COLORS: Record<string, string> = {
  Pending:   "bg-amber-500/20 text-amber-400 border-amber-500/50",
  Confirmed: "bg-blue-500/20 text-blue-400 border-blue-500/50",
  Active:    "bg-green-500/20 text-green-400 border-green-500/50",
  Completed: "bg-gray-500/20 text-gray-400 border-gray-500/50",
  Cancelled: "bg-destructive/20 text-destructive border-destructive/50",
};

const PAYMENT_COLORS: Record<string, string> = {
  Paid:    "bg-green-500/20 text-green-400 border-green-500/40",
  Partial: "bg-amber-500/20 text-amber-400 border-amber-500/40",
  Unpaid:  "bg-orange-500/15 text-orange-400 border-orange-500/40",
};

function getVipBadgeColor(tier?: string) {
  switch (tier) {
    case "VVIP":    return "border-yellow-500/50 text-yellow-400 bg-yellow-500/10";
    case "VIP":     return "border-purple-500/50 text-purple-400 bg-purple-500/10";
    case "Regular": return "border-blue-500/40 text-blue-400 bg-blue-500/10";
    default:        return "border-border text-muted-foreground";
  }
}

function getFlightBadgeClass(status?: string) {
  switch (status) {
    case "Delayed":   return "bg-amber-500/15 text-amber-400 border-amber-500/40";
    case "Early":     return "bg-emerald-500/15 text-emerald-400 border-emerald-500/40";
    case "Cancelled": return "bg-destructive/15 text-destructive border-destructive/40";
    case "Landed":    return "bg-blue-500/15 text-blue-400 border-blue-500/30";
    case "On Time":   return "bg-green-500/15 text-green-400 border-green-500/30";
    default:          return "bg-blue-500/10 text-blue-400 border-blue-500/30";
  }
}

export default function Bookings() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
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

  const bulk = useBulkSelect();

  const handleBulkDelete = async () => {
    const ids = bulk.ids;
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    // ?silent=1 suppresses the per-row staff broadcast; we emit ONE
    // aggregated notification at the end so the bell doesn't show 10
    // duplicate "Booking Deleted" entries for a single bulk action.
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
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          type: "booking_cancelled",
          title: "Bookings Deleted",
          message: `${ok} booking${ok === 1 ? "" : "s"} permanently removed in a bulk action`,
          link: "/bookings",
          severity: "warning",
        }),
      }).catch(() => {});
    }
    toast({
      title: fail === 0 ? "Bookings deleted" : `${ok} deleted, ${fail} failed`,
      description: fail === 0 ? `${ok} booking${ok === 1 ? "" : "s"} permanently removed` : "Some deletions failed — check audit log",
      variant: fail === 0 ? undefined : "destructive",
    });
    // Bulk delete touches bookings, invoices, follow-ups, dashboard
    // forecasts, analytics rollups and audit log — invalidate everything
    // so every counter on every page re-derives from the new truth.
    queryClient.invalidateQueries();
    bulk.exitSelectMode();
  };

  // URL-backed filters so a refresh / shared link restores the same view.
  const [status, setStatus] = useFilterState<string>("status", "");
  const [search, setSearch] = useFilterState<string>("q", "");
  const [source, setSource] = useFilterState<"active" | "imported">("source", "active");
  const [sortKey, setSortKey] = useFilterState<SortKey>("sort", "date_asc");
  const [groupKey, setGroupKey] = useFilterState<GroupKey>("group", "none");
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

  // Sort the filtered list by the selected key. Defaults to By Date Ascending
  // (date_time asc) so the soonest upcoming booking always appears first.
  const sortedBookings = useMemo(() => {
    const arr = [...bookings];
    const ts = (v: any) => (v ? new Date(v).getTime() : 0);
    // For date sorts, items with no date_time are pushed to the end.
    const NO_DATE = 9_999_999_999_999;
    switch (sortKey) {
      case "date_asc":
        arr.sort((a, b) => {
          const da = a.date_time ? ts(a.date_time) : NO_DATE;
          const db = b.date_time ? ts(b.date_time) : NO_DATE;
          return da - db;
        });
        break;
      case "date_desc":
        arr.sort((a, b) => {
          const da = a.date_time ? ts(a.date_time) : -1;
          const db = b.date_time ? ts(b.date_time) : -1;
          return db - da;
        });
        break;
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
                  <Plus className="w-4 h-4 mr-2" />
                  New Booking
                </Button>
              </Link>
            )}
          </div>
        )}
      </div>

      {/* Search + filter row */}
      <div className="flex flex-col md:flex-row md:items-center gap-3">
        <Input
          placeholder="Search by client, ref, pickup…"
          className="md:w-64"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="flex flex-wrap items-center gap-2">
          {!isResidenceManager && isSuperAdmin && (
            <FilterDropdown
              label="Source:"
              value={source}
              onChange={(v) => {
                if (v === "active" || v === "imported") setSource(v);
              }}
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
          <FilterDropdown
            label="Sort:"
            value={sortKey}
            onChange={(v) => setSortKey(v as SortKey)}
            options={SORT_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            widthClass="w-44"
            testId="filter-bookings-sort"
          />
          <FilterDropdown
            label="Group by:"
            value={groupKey}
            onChange={(v) => {
              if (v === "none" || v === "service") setGroupKey(v);
            }}
            options={[
              { value: "none",    label: "None" },
              { value: "service", label: "Service Type" },
            ]}
            widthClass="w-44"
            testId="filter-bookings-group"
          />
        </div>
      </div>

      {(() => {
        const chips: ActiveFilter[] = [];
        if (isSuperAdmin && !isResidenceManager && source !== "active") {
          chips.push({ key: "source", label: "Source", value: "Imported (Odoo)", onClear: () => setSource("active") });
        }
        if (status !== "") chips.push({ key: "status", label: "Status", value: status, onClear: () => setStatus("") });
        return <ActiveFilterChips filters={chips} onClearAll={() => { if (isSuperAdmin && !isResidenceManager) setSource("active"); setStatus(""); }} />;
      })()}

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
                {group.items.map((booking: any) => {
          const selected = bulk.isSelected(booking.id);
          return (
          <Card
            key={booking.id}
            className={`border-border hover:border-primary/40 hover:bg-secondary/10 transition-all bg-card overflow-hidden ${
              bulk.selectMode
                ? (selected ? "ring-2 ring-primary border-primary cursor-pointer" : "cursor-pointer")
                : "cursor-pointer"
            }`}
            onClick={bulk.selectMode ? () => bulk.toggle(booking.id) : () => setLocation(`/bookings/${booking.id}`)}
            data-testid={bulk.selectMode ? `select-booking-${booking.id}` : undefined}
          >
            <CardContent className="p-4">
              {/* Top row: ref + badges | status badge + time */}
              <div className="flex items-start justify-between mb-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {bulk.selectMode && (
                      <div className={`flex-shrink-0 w-4 h-4 rounded border-2 flex items-center justify-center ${selected ? "bg-primary border-primary" : "border-muted-foreground/40"}`}>
                        {selected && <CheckSquare className="w-2.5 h-2.5 text-primary-foreground" />}
                      </div>
                    )}
                    <span className="text-xs text-muted-foreground font-mono">{booking.tvl_ref}</span>
                    {booking.service_type && (
                      <Badge variant="outline" className="text-[10px] py-0 px-1.5 bg-secondary/40 text-foreground border-border">
                        {booking.service_type}{(booking as any).direction ? ` · ${(booking as any).direction}` : ""}
                      </Badge>
                    )}
                    {/* Flight badge with live status colour */}
                    {(booking as any).flight_number && (() => {
                      const fs = (booking as any).flight_status;
                      const st = fs?.status as string | undefined;
                      const delayMins = fs?.delay_minutes ?? 0;
                      const note = st === "Delayed" && delayMins > 0 ? ` +${delayMins}m`
                                 : st === "Early"   && delayMins < 0 ? ` ${Math.abs(delayMins)}m early` : "";
                      return (
                        <Badge variant="outline" className={`text-[10px] py-0 px-1.5 flex items-center gap-0.5 ${getFlightBadgeClass(st)}`}>
                          <Plane className="w-2.5 h-2.5" />
                          {(booking as any).flight_number}
                          {st && st !== "Unknown" && <span className="ml-0.5 font-normal opacity-80">{st}{note}</span>}
                        </Badge>
                      );
                    })()}
                    {/* Email status */}
                    {(booking as any).last_email_status === "sent" && (
                      <Badge variant="outline" className="text-[10px] py-0 px-1.5 bg-emerald-500/10 text-emerald-300 border-emerald-500/30"
                        title={`Email sent${(booking as any).last_email_kind ? ` · ${(booking as any).last_email_kind.replace(/_/g, " ")}` : ""}`}>
                        ✓ Email
                      </Badge>
                    )}
                    {(booking as any).last_email_status === "failed" && (
                      <Badge variant="outline" className="text-[10px] py-0 px-1.5 bg-destructive/10 text-destructive border-destructive/40"
                        title="Last email failed — open booking to retry">
                        ⚠ Email failed
                      </Badge>
                    )}
                    {/* Notes */}
                    {((booking as any).notes || (booking as any).special_requests) && (
                      <Badge variant="outline" className="text-[10px] py-0 px-1.5 bg-amber-500/10 text-amber-300 border-amber-500/40 gap-1"
                        title={(booking as any).special_requests || (booking as any).notes}
                        data-testid={`badge-notes-${booking.id}`}>
                        <StickyNote className="w-2.5 h-2.5" /> Notes
                      </Badge>
                    )}
                  </div>

                  {/* Client name + VIP */}
                  <div className="flex items-center gap-2 mt-1">
                    {booking.client_id ? (
                      <span
                        className="font-bold text-base text-primary hover:underline"
                        onClick={(e) => { e.stopPropagation(); setLocation(`/clients/${booking.client_id}`); }}
                      >
                        {booking.client_name || "Unknown Client"}
                      </span>
                    ) : (
                      <span className="font-bold text-base text-foreground">{booking.client_name || "Unknown Client"}</span>
                    )}
                    {(booking as any).client_vip_tier && (booking as any).client_vip_tier !== "Standard" && (
                      <Badge variant="outline" className={`text-[10px] py-0 px-1.5 ${getVipBadgeColor((booking as any).client_vip_tier)}`}>
                        {(booking as any).client_vip_tier}
                      </Badge>
                    )}
                  </div>
                </div>

                {/* Right: status + time */}
                <div className="flex flex-col items-end gap-1 ml-3 flex-shrink-0">
                  <Badge variant="outline" className={`text-[11px] font-semibold ${STATUS_COLORS[booking.status] ?? "bg-secondary text-secondary-foreground border-border"}`}>
                    {booking.status}
                  </Badge>
                  {booking.date_time && (
                    <div className="flex flex-col items-end gap-0">
                      <div className="flex items-center gap-1 text-sm font-semibold text-foreground">
                        <Clock className="w-3 h-3 text-primary" />
                        {format(new Date(booking.date_time), "HH:mm")}
                      </div>
                      <span className="text-[10px] text-muted-foreground">
                        {format(new Date(booking.date_time), "EEE d MMM yyyy")}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Route */}
              {(booking.pickup || (booking as any).dropoff || (booking as any).destination) && (
                <div className="flex items-start gap-2 text-sm mb-2">
                  <MapPin className="w-3.5 h-3.5 mt-0.5 text-primary flex-shrink-0" />
                  <span className="text-muted-foreground line-clamp-1">
                    <span className="text-foreground">{booking.pickup || "—"}</span>
                    <span className="mx-1.5 text-muted-foreground">→</span>
                    <span className="text-foreground">{(booking as any).dropoff || (booking as any).destination || "—"}</span>
                  </span>
                </div>
              )}

              {/* Driver + price row */}
              {!isResidenceManager && (
                <div className="flex items-center justify-between pt-2.5 border-t border-border/60">
                  <div className="flex items-center gap-2 text-sm">
                    <Car className="w-3.5 h-3.5 text-muted-foreground" />
                    {booking.driver_name ? (
                      <span className="font-medium text-primary flex items-center gap-1.5">
                        {(booking as any).driver_staff_no && (
                          <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-primary/15 text-primary border border-primary/30">
                            {(booking as any).driver_staff_no}
                          </span>
                        )}
                        {booking.driver_name}
                      </span>
                    ) : (
                      <span className="text-destructive font-medium flex items-center gap-1 text-xs">
                        <AlertTriangle className="w-3 h-3" /> No Driver
                      </span>
                    )}
                    {(booking as any).driver_whatsapp && booking.driver_name && (() => {
                      const phone = ((booking as any).driver_whatsapp || "").replace(/[^0-9+]/g, "");
                      if (!phone) return null;
                      const msg = `Hi ${booking.driver_name}, I've just sent you booking ${booking.tvl_ref}. Please confirm receipt. Thanks.`;
                      return (
                        <a href={`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`}
                          target="_blank" rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="text-green-500 hover:text-green-400" title="WhatsApp Driver">
                          <MessageCircle className="w-3.5 h-3.5" />
                        </a>
                      );
                    })()}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-foreground text-sm">£{Number(booking.price ?? 0).toLocaleString()}</span>
                    <Badge variant="outline" className={`text-[10px] py-0 px-1.5 ${PAYMENT_COLORS[booking.payment_status ?? "Unpaid"] ?? PAYMENT_COLORS.Unpaid}`}>
                      {booking.payment_status || "Unpaid"}
                    </Badge>
                  </div>
                </div>
              )}

              {/* Residence manager: simplified pickup */}
              {isResidenceManager && (
                <div className="flex items-center gap-2 pt-2.5 border-t border-border/60 text-sm">
                  <span className="text-xs uppercase text-muted-foreground opacity-70">Check-in</span>
                  <span className="font-medium text-foreground">
                    {booking.date_time ? format(new Date(booking.date_time), "d MMM") : "—"}
                  </span>
                </div>
              )}

              {/* Action row — stop propagation so card click (navigate) doesn't fire */}
              <div className="flex gap-2 mt-3 pt-3 border-t border-border/50" onClick={(e) => e.stopPropagation()}>
                <Link href={`/bookings/${booking.id}`} className="flex-1">
                  <Button variant="outline" className="w-full h-9 text-sm">
                    <Briefcase className="w-4 h-4 mr-2" />
                    {isResidenceManager ? "View Details" : "Job Sheet"}
                  </Button>
                </Link>
                {canDeleteBookings && !bulk.selectMode && (
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
                  );
                })}
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

      <BulkActionBar
        count={bulk.count}
        noun="booking"
        onClear={bulk.clear}
        onDelete={handleBulkDelete}
      />
    </div>
  );
}
