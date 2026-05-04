import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/use-auth";
import { useListBookings, getListBookingsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";
import {
  ArrowRight, PlaneTakeoff, Car, Map as MapIcon, Building2, Hotel,
  CalendarRange, Clock, CheckCircle2, Plus, Package, Tag, CheckSquare, Check
} from "lucide-react";
import { isSupplierDrivenJob } from "@/lib/supplierDriven";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { FilterDropdown, useFilterState } from "@/components/ui/filter-dropdown";
import { ActiveFilterChips } from "@/components/ui/active-filter-chips";
import { useBulkSelect } from "@/hooks/use-bulk-select";
import { BulkActionBar } from "@/components/bulk-action-bar";

const SERVICES = [
  {
    key: "Airport Transfer",
    label: "Airport Transfer",
    icon: <PlaneTakeoff className="w-6 h-6" />,
    color: "from-blue-500/20 to-blue-600/10 border-blue-500/30",
    iconColor: "text-blue-400 bg-blue-500/10",
  },
  {
    key: "Tour",
    label: "Tours",
    icon: <MapIcon className="w-6 h-6" />,
    color: "from-emerald-500/20 to-emerald-600/10 border-emerald-500/30",
    iconColor: "text-emerald-400 bg-emerald-500/10",
  },
  {
    key: "As Directed",
    label: "As Directed",
    icon: <Car className="w-6 h-6" />,
    color: "from-amber-500/20 to-amber-600/10 border-amber-500/30",
    iconColor: "text-amber-400 bg-amber-500/10",
  },
  {
    key: "Apartment",
    label: "Apartment",
    icon: <Building2 className="w-6 h-6" />,
    color: "from-indigo-500/20 to-indigo-600/10 border-indigo-500/30",
    iconColor: "text-indigo-400 bg-indigo-500/10",
  },
  {
    key: "Hotel",
    label: "Hotel",
    icon: <Hotel className="w-6 h-6" />,
    color: "from-purple-500/20 to-purple-600/10 border-purple-500/30",
    iconColor: "text-purple-400 bg-purple-500/10",
  },
] as const;

type ServiceKey = typeof SERVICES[number]["key"];

const LEGACY_MAP: Record<string, ServiceKey> = {
  "City Tour":                "Tour",
  "Chauffeur Tour":           "Tour",
  "Event Transfer":           "Airport Transfer",
  "Apartment / Accommodation":"Apartment",
};

const STATUS_COLORS: Record<string, string> = {
  "Pending":   "bg-amber-500/20 text-amber-400 border-amber-500/30",
  "Confirmed": "bg-blue-500/20 text-blue-400 border-blue-500/30",
  "Active":    "bg-green-500/20 text-green-400 border-green-500/30",
  "Completed": "bg-gray-500/20 text-gray-400 border-gray-500/30",
  "Cancelled": "bg-destructive/20 text-destructive border-destructive/30",
};

const STATUS_FILTERS = ["All", "Pending", "Confirmed", "Active", "Completed", "Cancelled"];

interface Booking {
  id: string;
  tvl_ref: string;
  client_name: string;
  service_type: string;
  date_time: string | null;
  status: string;
  price: number;
  driver_name: string | null;
  payment_status: string | null;
  pickup: string | null;
  dropoff: string | null;
  // W3: supplier-driven cards on the per-service drilldown should show the
  // supplier name instead of an empty "🚘 —" line. These three columns
  // power isSupplierDrivenJob() and the Building2 swap below.
  supplier_id: string | null;
  supplier_name: string | null;
  as_directed_supplier_driver: boolean;
  driver_id: string | null;
  vehicle_type: string | null;
}

interface Product {
  id: string;
  name: string;
  category: string;
  unit_price: number;
  description: string | null;
  service_types: string[] | null;
  active: boolean;
}

function canonicalKey(raw: string): ServiceKey {
  if (LEGACY_MAP[raw]) return LEGACY_MAP[raw];
  return raw as ServiceKey;
}

export default function Services() {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === "super_admin";
  const [products, setProducts] = useState<Product[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);
  // URL-backed filters so a refresh / shared link restores the same view.
  // `selectedKey` is stored as a string with empty = unselected (back to grid).
  const [selectedKeyRaw, setSelectedKeyRaw] = useFilterState<string>("svc", "");
  const selectedKey = (selectedKeyRaw || null) as ServiceKey | null;
  const setSelectedKey = (v: ServiceKey | null) => setSelectedKeyRaw((v ?? "") as string);
  const [statusFilter, setStatusFilter] = useFilterState("status", "All");
  const [activeTab, setActiveTab] = useFilterState<"bookings" | "catalogue" | "imported">("tab", "bookings");

  // Bulk select / bulk delete on the per-service bookings list. Mirrors the
  // exact pattern from /bookings — same hook, same fan-out endpoint, same
  // global query invalidation so deleting bookings here cascades to
  // dashboard, finance, intel, drivers, follow-ups, audit etc.
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const canDelete = user?.role === "admin" || user?.role === "super_admin";
  const bulk = useBulkSelect();

  const handleBulkDelete = async () => {
    const ids = bulk.ids;
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    // Single server round-trip — bookings/bulk-delete handles cascade and
    // emits one aggregated staff notification instead of N individual ones.
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

  // Exit select mode whenever the operator changes service or tab so a stale
  // selection from one service can never be deleted under another service.
  useEffect(() => { bulk.exitSelectMode(); }, [selectedKey, activeTab]);

  // Active (non-Odoo) bookings — drives all overview cards, stats and the
  // primary "Bookings" sub-tab. Imported Odoo bookings are pulled separately
  // and only appear in the dedicated "Imported (Odoo)" sub-tab to avoid
  // polluting day-to-day operational counts.
  const activeParams = { imported: "exclude" as const };
  const { data: rawBookings, isLoading: loadingBookings } = useListBookings(
    activeParams,
    { query: { enabled: true, queryKey: getListBookingsQueryKey(activeParams) } }
  );

  const importedParams = { imported: "only" as const };
  const { data: rawImported, isLoading: loadingImported } = useListBookings(
    importedParams,
    {
      query: {
        enabled: activeTab === "imported" && !!selectedKey,
        queryKey: getListBookingsQueryKey(importedParams),
      },
    }
  );

  const mapBooking = (b: any): Booking => ({
    id: b.id,
    tvl_ref: b.tvl_ref ?? "",
    client_name: b.client_name ?? b.clients?.name ?? "—",
    service_type: (b.service_type ?? "").toString().trim(),
    date_time: b.date_time ?? null,
    status: b.status ?? "",
    price: Number(b.price ?? 0),
    driver_name: b.driver_name ?? b.drivers?.name ?? null,
    payment_status: b.payment_status ?? null,
    pickup: b.pickup ?? null,
    dropoff: b.dropoff ?? null,
    // Supplier-driven enrichment — see Booking interface for context.
    supplier_id: b.supplier_id ?? null,
    supplier_name: b.supplier_name ?? b.suppliers?.name ?? null,
    as_directed_supplier_driver: !!b.as_directed_supplier_driver,
    driver_id: b.driver_id ?? null,
    vehicle_type: b.vehicle_type ?? null,
  });

  const bookings: Booking[] = useMemo(
    () => ((rawBookings ?? []) as any[]).map(mapBooking),
    [rawBookings]
  );
  const importedBookings: Booking[] = useMemo(
    () => ((rawImported ?? []) as any[]).map(mapBooking),
    [rawImported]
  );

  useEffect(() => {
    if (!selectedKey) return;
    setLoadingProducts(true);
    supabase
      .from("products")
      .select("id, name, category, unit_price, description, service_types, active")
      .eq("active", true)
      .order("category")
      .order("name")
      .then(({ data }) => {
        setProducts(data ?? []);
        setLoadingProducts(false);
      });
  }, [selectedKey]);

  // "Active" = truly upcoming jobs (today onwards) in a working status.
  // Imported Odoo bookings with stale Confirmed/Pending status from past
  // dates are excluded so the count reflects what actually needs attention.
  const startOfToday = useMemo(() => {
    const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime();
  }, []);
  const ACTIVE_STATUSES = ["Pending", "Confirmed", "Active"];
  const isUpcoming = (b: Booking) =>
    !!b.date_time && new Date(b.date_time).getTime() >= startOfToday;

  // Stats reflect ACTIVE (non-Odoo) bookings only. Fix 4 — operators asked for
  // a richer per-service view: revenue, average ticket, busiest month and top
  // client are derived client-side from non-Cancelled bookings so we don't
  // pollute the totals with voided rows.
  const MONTH_FMT = (iso: string) => {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  };
  const statsFor = (key: ServiceKey) => {
    const svcBookings = bookings.filter(b => canonicalKey(b.service_type) === key);
    const active = svcBookings.filter(b =>
      ACTIVE_STATUSES.includes(b.status) && isUpcoming(b)
    ).length;
    const completed = svcBookings.filter(b => b.status === "Completed").length;

    const revenueSet = svcBookings.filter(b => b.status !== "Cancelled");
    const revenue = revenueSet.reduce((s, b) => s + Number(b.price || 0), 0);
    const avg = revenueSet.length ? revenue / revenueSet.length : 0;

    // Busiest month — uses date_time (the actual job date). Bookings without
    // a date are skipped rather than bucketed under "Unknown".
    const monthly = new Map<string, number>();
    for (const b of revenueSet) {
      if (!b.date_time) continue;
      const m = MONTH_FMT(b.date_time);
      monthly.set(m, (monthly.get(m) ?? 0) + 1);
    }
    let busiestMonth = "—";
    let busiestCount = 0;
    for (const [m, c] of monthly) {
      if (c > busiestCount) { busiestMonth = m; busiestCount = c; }
    }
    if (busiestMonth !== "—") {
      const [yy, mm] = busiestMonth.split("-");
      busiestMonth = format(new Date(Number(yy), Number(mm) - 1, 1), "MMM yyyy");
    }

    // Top client by booking count (ties broken by who appears first in the
    // sorted list — fine for an at-a-glance tile).
    const clientCount = new Map<string, number>();
    for (const b of revenueSet) {
      const n = (b.client_name || "").trim();
      if (!n || n === "—") continue;
      clientCount.set(n, (clientCount.get(n) ?? 0) + 1);
    }
    let topClient = "—";
    let topCount = 0;
    for (const [n, c] of clientCount) {
      if (c > topCount) { topClient = n; topCount = c; }
    }

    return {
      total: svcBookings.length,
      active,
      completed,
      revenue,
      avg,
      busiestMonth,
      topClient,
      topCount,
    };
  };

  // Sort upcoming first (earliest → latest), then past (most recent → oldest)
  const sortByUpcomingThenRecent = (list: Booking[]) => {
    return [...list].sort((a, b) => {
      const ta = a.date_time ? new Date(a.date_time).getTime() : 0;
      const tb = b.date_time ? new Date(b.date_time).getTime() : 0;
      const aUp = ta >= startOfToday;
      const bUp = tb >= startOfToday;
      if (aUp && !bUp) return -1;
      if (!aUp && bUp) return 1;
      if (aUp && bUp) return ta - tb;       // upcoming: soonest first
      return tb - ta;                       // past: most recent first
    });
  };

  const filteredBookings = useMemo(() => {
    if (!selectedKey) return [];
    const list = bookings
      .filter(b => canonicalKey(b.service_type) === selectedKey)
      .filter(b => statusFilter === "All" || b.status === statusFilter);
    return sortByUpcomingThenRecent(list);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey, bookings, statusFilter, startOfToday]);

  const filteredImported = useMemo(() => {
    if (!selectedKey) return [];
    return [...importedBookings]
      .filter(b => canonicalKey(b.service_type) === selectedKey)
      .sort((a, b) => {
        const ta = a.date_time ? new Date(a.date_time).getTime() : 0;
        const tb = b.date_time ? new Date(b.date_time).getTime() : 0;
        return tb - ta;   // most recent first
      });
  }, [selectedKey, importedBookings]);

  const catalogueProducts = useMemo(() => {
    if (!selectedKey) return [];
    return products.filter(p => {
      if (!p.service_types || p.service_types.length === 0) return false;
      return p.service_types.includes(selectedKey);
    });
  }, [selectedKey, products]);

  const allStats = useMemo(() => {
    const nonCancelled = bookings.filter(b => b.status !== "Cancelled");
    return { total: nonCancelled.length };
  }, [bookings]);

  // ─── Detail view for a selected service ────────────────────────────────────
  if (selectedKey) {
    const svc = SERVICES.find(s => s.key === selectedKey)!;
    const stats = statsFor(selectedKey);

    return (
      <div className="space-y-5">
        {/* Service header — title + a compact "Service:" dropdown so operators
            can hop between service categories without going back to the
            overview. Replaces the previous large category-tile navigation
            with the same compact filter chrome used everywhere else. */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className={`w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0 ${svc.iconColor}`}>
            {svc.icon}
          </div>
          <h1 className="text-2xl font-bold text-foreground">{svc.label}</h1>
          <FilterDropdown
            label="Service:"
            value={selectedKey}
            onChange={(v) => {
              setStatusFilter("All");
              setActiveTab("bookings");
              if (v === "__all__") {
                setSelectedKey(null);
              } else {
                setSelectedKey(v as ServiceKey);
              }
            }}
            options={[
              { value: "__all__", label: "All services" },
              ...SERVICES.map((s) => ({
                value: s.key,
                label: s.label,
                count: bookings.filter(b => canonicalKey(b.service_type) === s.key).length,
              })),
            ]}
            widthClass="w-44"
            testId="filter-services-category"
          />
          <Link href="/bookings/new" className="ml-auto">
            <Button size="sm" className="h-9">
              <Plus className="w-3.5 h-3.5 mr-1.5" /> New Booking
            </Button>
          </Link>
        </div>

        {/* Stats strip — Fix 4 adds revenue / avg / busiest month / top client */}
        <div className="grid gap-3 grid-cols-3">
          {[
            { label: "Total",     value: stats.total,     icon: <CalendarRange className="w-4 h-4" /> },
            { label: "Active",    value: stats.active,    icon: <Clock className="w-4 h-4 text-amber-400" /> },
            { label: "Completed", value: stats.completed, icon: <CheckCircle2 className="w-4 h-4 text-green-400" /> },
          ].map(item => (
            <div key={item.label} className="bg-card border border-border rounded-xl p-3 text-center">
              <div className="flex justify-center mb-1 text-muted-foreground">{item.icon}</div>
              <div className="text-lg font-bold text-foreground">{item.value}</div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{item.label}</div>
            </div>
          ))}
        </div>
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
          <div className="bg-card border border-border rounded-xl p-3" data-testid="tile-svc-revenue">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Revenue</div>
            <div className="text-lg font-bold text-foreground mt-1">
              £{Math.round(stats.revenue).toLocaleString()}
            </div>
          </div>
          <div className="bg-card border border-border rounded-xl p-3" data-testid="tile-svc-avg">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Avg Booking</div>
            <div className="text-lg font-bold text-foreground mt-1">
              £{Math.round(stats.avg).toLocaleString()}
            </div>
          </div>
          <div className="bg-card border border-border rounded-xl p-3" data-testid="tile-svc-busiest">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Busiest Month</div>
            <div className="text-base font-bold text-foreground mt-1 truncate">{stats.busiestMonth}</div>
          </div>
          <div className="bg-card border border-border rounded-xl p-3" data-testid="tile-svc-top-client">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Top Client</div>
            <div className="text-base font-bold text-foreground mt-1 truncate" title={stats.topClient}>
              {stats.topClient}
              {stats.topCount > 0 && (
                <span className="ml-1 text-xs font-normal text-muted-foreground">×{stats.topCount}</span>
              )}
            </div>
          </div>
        </div>

        {/* Tab bar */}
        <div className="flex gap-1 border border-border rounded-xl p-1 bg-secondary/20">
          <button
            onClick={() => setActiveTab("bookings")}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-medium rounded-lg transition-all ${
              activeTab === "bookings"
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
            data-testid="tab-svc-bookings"
          >
            <CalendarRange className="w-3.5 h-3.5" />
            Bookings
            <span className={`text-xs ml-0.5 ${activeTab === "bookings" ? "text-primary" : "text-muted-foreground"}`}>
              {stats.total}
            </span>
          </button>
          <button
            onClick={() => setActiveTab("catalogue")}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-medium rounded-lg transition-all ${
              activeTab === "catalogue"
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
            data-testid="tab-svc-catalogue"
          >
            <Package className="w-3.5 h-3.5" />
            Catalogue
            {!loadingProducts && (
              <span className={`text-xs ml-0.5 ${activeTab === "catalogue" ? "text-primary" : "text-muted-foreground"}`}>
                {catalogueProducts.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab("imported")}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-medium rounded-lg transition-all ${
              activeTab === "imported"
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
            data-testid="tab-svc-imported"
          >
            <CalendarRange className="w-3.5 h-3.5" />
            Imported
          </button>
        </div>

        {/* ── Bookings tab ────────────────────────────────────────────────────── */}
        {activeTab === "bookings" && (
          <>
            {/* Select / Select All / Cancel — only Admin + Super Admin */}
            {canDelete && filteredBookings.length > 0 && (
              <div className="flex items-center justify-between gap-2">
                {!bulk.selectMode ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs"
                    onClick={bulk.enterSelectMode}
                    data-testid="button-enter-select-mode"
                  >
                    <CheckSquare className="w-3.5 h-3.5 mr-1.5" />
                    Select
                  </Button>
                ) : (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs"
                      onClick={() => bulk.selectAll(filteredBookings.map(b => b.id))}
                      data-testid="button-select-all"
                    >
                      Select all {filteredBookings.length}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 text-xs"
                      onClick={bulk.exitSelectMode}
                      data-testid="button-exit-select-mode"
                    >
                      Cancel
                    </Button>
                  </>
                )}
              </div>
            )}

            {/* Status filter — compact dropdown with live counts. */}
            <FilterDropdown
              label="Status:"
              value={statusFilter}
              onChange={setStatusFilter}
              options={STATUS_FILTERS.map((s) => ({
                value: s,
                label: s,
                count: s === "All"
                  ? bookings.filter(b => canonicalKey(b.service_type) === selectedKey).length
                  : bookings.filter(b => canonicalKey(b.service_type) === selectedKey && b.status === s).length,
              }))}
              testId="filter-services-status"
            />

            {/* Active filter chips for the per-service detail view's Status
                dropdown. Same chrome as every other list page. */}
            <ActiveFilterChips
              filters={
                statusFilter !== "All"
                  ? [{ key: "status", label: "Status", value: statusFilter, onClear: () => setStatusFilter("All") }]
                  : []
              }
            />

            {loadingBookings ? (
              <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-20" />)}</div>
            ) : filteredBookings.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 border border-dashed border-border rounded-2xl text-center">
                <CalendarRange className="w-10 h-10 text-muted-foreground/30 mb-3" />
                <p className="text-muted-foreground font-medium">No bookings found</p>
                <p className="text-sm text-muted-foreground/60 mt-1">
                  {statusFilter !== "All" ? `No ${statusFilter.toLowerCase()} ${svc.label} bookings` : `No ${svc.label} bookings yet`}
                </p>
                <Link href="/bookings/new" className="mt-4">
                  <Button size="sm" variant="outline"><Plus className="w-3.5 h-3.5 mr-1.5" /> Create Booking</Button>
                </Link>
              </div>
            ) : (
              <div className="space-y-2">
                {filteredBookings.map(booking => {
                  // Select mode: clicking the row toggles selection instead of
                  // navigating, and a checkbox lights up on the left. Out of
                  // select mode the original Link → /bookings/:id navigation
                  // is preserved unchanged.
                  const isSelected = bulk.isSelected(booking.id);
                  const cardInner = (
                    <Card className={`border-border transition-all cursor-pointer bg-card hover:bg-secondary/5 ${
                      bulk.selectMode && isSelected
                        ? "border-primary ring-2 ring-primary/40"
                        : "hover:border-primary/40"
                    }`}>
                      <CardContent className="p-0">
                        <div className="flex items-stretch">
                          {bulk.selectMode && (
                            <div className="flex items-center pl-3 pr-1">
                              <div
                                className={`w-5 h-5 rounded-md border flex items-center justify-center transition-all ${
                                  isSelected
                                    ? "bg-primary border-primary"
                                    : "border-border bg-card"
                                }`}
                                data-testid={`checkbox-booking-${booking.id}`}
                              >
                                {isSelected && <Check className="w-3.5 h-3.5 text-primary-foreground" />}
                              </div>
                            </div>
                          )}
                          <div className={`w-1 rounded-l-xl flex-shrink-0 ${
                            booking.status === "Confirmed"  ? "bg-blue-500"  :
                            booking.status === "Active"     ? "bg-green-400" :
                            booking.status === "Completed"  ? "bg-gray-400"  :
                            booking.status === "Cancelled"  ? "bg-red-500"   :
                            "bg-amber-500"
                          }`} />
                          <div className="flex-1 px-4 py-3">
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-mono text-xs font-bold text-primary">{booking.tvl_ref}</span>
                                  <span className="text-sm font-semibold text-foreground">{booking.client_name}</span>
                                </div>
                                <div className="flex items-center gap-3 mt-1 flex-wrap">
                                  {booking.date_time && (
                                    <span className="text-xs text-muted-foreground">
                                      📅 {format(new Date(booking.date_time), "dd MMM yyyy, HH:mm")}
                                    </span>
                                  )}
                                  {booking.pickup && (
                                    <span className="text-xs text-muted-foreground truncate max-w-[180px]">
                                      📍 {booking.pickup}{booking.dropoff ? ` → ${booking.dropoff}` : ""}
                                    </span>
                                  )}
                                </div>
                                {(() => {
                                  // W3: prefer the supplier company on
                                  // supplier-driven jobs; fall back to the
                                  // TVL driver line on driver-led jobs.
                                  if (isSupplierDrivenJob(booking)) {
                                    return (
                                      <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                                        <Building2 className="w-3 h-3 text-primary" />
                                        <span className="truncate">{booking.supplier_name ?? "Supplier"}</span>
                                        {booking.vehicle_type ? <span> · {booking.vehicle_type}</span> : null}
                                      </div>
                                    );
                                  }
                                  return booking.driver_name
                                    ? <div className="text-xs text-muted-foreground mt-1">🚘 {booking.driver_name}</div>
                                    : null;
                                })()}
                              </div>
                              <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                                <Badge variant="outline" className={`text-[10px] ${STATUS_COLORS[booking.status] ?? "border-border text-muted-foreground"}`}>
                                  {booking.status}
                                </Badge>
                                <span className="text-base font-bold text-foreground">
                                  £{Number(booking.price || 0).toLocaleString()}
                                </span>
                                {booking.payment_status && (
                                  <span className={`text-[10px] font-medium ${booking.payment_status === "Paid" ? "text-green-400" : "text-amber-400"}`}>
                                    {booking.payment_status}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                          {!bulk.selectMode && (
                            <div className="flex items-center pr-3">
                              <ArrowRight className="w-4 h-4 text-muted-foreground/40" />
                            </div>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  );
                  return bulk.selectMode ? (
                    <div
                      key={booking.id}
                      onClick={() => bulk.toggle(booking.id)}
                      data-testid={`row-booking-${booking.id}`}
                    >
                      {cardInner}
                    </div>
                  ) : (
                    <Link key={booking.id} href={`/bookings/${booking.id}`}>
                      {cardInner}
                    </Link>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* Bulk action bar — fixed bottom of viewport, only shown when ≥1 selected */}
        <BulkActionBar
          count={bulk.count}
          noun="booking"
          onClear={bulk.exitSelectMode}
          onDelete={handleBulkDelete}
          warning="This permanently deletes the selected bookings, their invoices, follow-ups and amendments. Cannot be undone."
        />

        {/* ── Catalogue tab ───────────────────────────────────────────────────── */}
        {activeTab === "catalogue" && (
          <>
            {loadingProducts ? (
              <div className="space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
            ) : catalogueProducts.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 border border-dashed border-border rounded-2xl text-center">
                <Package className="w-10 h-10 text-muted-foreground/30 mb-3" />
                <p className="text-muted-foreground font-medium">No products linked</p>
                <p className="text-sm text-muted-foreground/60 mt-1">
                  Go to Admin → Products and tag items for "{svc.label}"
                </p>
                <Link href="/admin" className="mt-4">
                  <Button size="sm" variant="outline"><Plus className="w-3.5 h-3.5 mr-1.5" /> Manage Products</Button>
                </Link>
              </div>
            ) : (
              (() => {
                const grouped = catalogueProducts.reduce<Record<string, Product[]>>((acc, p) => {
                  (acc[p.category] = acc[p.category] ?? []).push(p);
                  return acc;
                }, {});
                return (
                  <div className="space-y-5">
                    {Object.entries(grouped).map(([category, items]) => (
                      <div key={category}>
                        <div className="flex items-center gap-2 mb-3">
                          <Tag className="w-3.5 h-3.5 text-muted-foreground" />
                          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{category}</span>
                        </div>
                        <div className="space-y-2">
                          {items.map(product => (
                            <Card key={product.id} className="border-border bg-card">
                              <CardContent className="p-4">
                                <div className="flex items-start justify-between gap-3">
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                      <span className="font-semibold text-sm text-foreground">{product.name}</span>
                                    </div>
                                    {product.description && (
                                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{product.description}</p>
                                    )}
                                    <div className="flex flex-wrap gap-1.5 mt-2">
                                      {(product.service_types ?? []).map(st => (
                                        <span
                                          key={st}
                                          className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${
                                            st === selectedKey
                                              ? "bg-primary/20 text-primary border-primary/40"
                                              : "border-border text-muted-foreground"
                                          }`}
                                        >
                                          {st}
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                  <div className="text-right flex-shrink-0">
                                    <div className="text-base font-bold text-foreground">
                                      {product.unit_price > 0 ? `£${Number(product.unit_price).toLocaleString()}` : "Incl."}
                                    </div>
                                  </div>
                                </div>
                              </CardContent>
                            </Card>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()
            )}
          </>
        )}

        {/* ── Imported (Odoo) tab ─────────────────────────────────────────────── */}
        {activeTab === "imported" && (
          <>
            <div className="flex items-start gap-2 p-3 rounded-xl border border-amber-500/20 bg-amber-500/5">
              <CalendarRange className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-muted-foreground">
                Archived bookings imported from Odoo (refs starting with <span className="font-mono text-foreground">S</span>).
                These records are read-only and excluded from active stats and revenue figures.
              </p>
            </div>

            {loadingImported ? (
              <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-20" />)}</div>
            ) : filteredImported.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 border border-dashed border-border rounded-2xl text-center">
                <CalendarRange className="w-10 h-10 text-muted-foreground/30 mb-3" />
                <p className="text-muted-foreground font-medium">No imported {svc.label} bookings</p>
              </div>
            ) : (
              <div className="space-y-2">
                {filteredImported.map(booking => (
                  <Link key={booking.id} href={`/bookings/${booking.id}`}>
                    <Card className="border-border hover:border-primary/40 transition-all cursor-pointer bg-card/60 hover:bg-secondary/5 opacity-90">
                      <CardContent className="p-0">
                        <div className="flex items-stretch">
                          <div className="w-1 rounded-l-xl flex-shrink-0 bg-muted-foreground/30" />
                          <div className="flex-1 px-4 py-3">
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-mono text-xs font-bold text-muted-foreground">{booking.tvl_ref}</span>
                                  <Badge variant="outline" className="text-[9px] border-amber-500/30 text-amber-400/80">
                                    Odoo
                                  </Badge>
                                  <span className="text-sm font-semibold text-foreground">{booking.client_name}</span>
                                </div>
                                <div className="flex items-center gap-3 mt-1 flex-wrap">
                                  {booking.date_time && (
                                    <span className="text-xs text-muted-foreground">
                                      📅 {format(new Date(booking.date_time), "dd MMM yyyy")}
                                    </span>
                                  )}
                                  {booking.pickup && (
                                    <span className="text-xs text-muted-foreground truncate max-w-[180px]">
                                      📍 {booking.pickup}{booking.dropoff ? ` → ${booking.dropoff}` : ""}
                                    </span>
                                  )}
                                </div>
                              </div>
                              <Badge variant="outline" className={`text-[10px] ${STATUS_COLORS[booking.status] ?? "border-border text-muted-foreground"}`}>
                                {booking.status}
                              </Badge>
                            </div>
                          </div>
                          <div className="flex items-center pr-3">
                            <ArrowRight className="w-4 h-4 text-muted-foreground/40" />
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  // ─── Overview ──────────────────────────────────────────────────────────────
  // The previous large category tile grid has been replaced with a single
  // compact "Service:" dropdown to match the filter chrome used app-wide.
  // Selecting a category drops the operator straight into the per-service
  // detail view (which has its own dropdown to swap categories without
  // returning here).
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Services</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {allStats.total} active bookings
          </p>
        </div>
        <Link href="/bookings/new">
          <Button className="h-11 shadow-[0_0_10px_rgba(201,168,76,0.2)]">
            <Plus className="w-4 h-4 mr-2" /> New Booking
          </Button>
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <FilterDropdown
          label="Service:"
          value="__placeholder__"
          onChange={(v) => {
            if (v && v !== "__placeholder__") setSelectedKey(v as ServiceKey);
          }}
          options={[
            { value: "__placeholder__", label: "Choose a service…" },
            ...SERVICES.map((s) => ({
              value: s.key,
              label: s.label,
              count: bookings.filter(b => canonicalKey(b.service_type) === s.key).length,
            })),
          ]}
          widthClass="w-56"
          testId="filter-services-overview-category"
        />
        {loadingBookings && (
          <span className="text-xs text-muted-foreground">Loading…</span>
        )}
      </div>

      {/* Compact summary list — one row per service category with active +
          total counts. Replaces the large tile grid; tapping any row opens
          the same per-service detail view. */}
      {loadingBookings ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12" />)}
        </div>
      ) : (
        <div className="border border-border rounded-2xl bg-card divide-y divide-border overflow-hidden">
          {SERVICES.map(svc => {
            const stats = statsFor(svc.key);
            return (
              <button
                key={svc.key}
                onClick={() => setSelectedKey(svc.key)}
                className="w-full flex items-center justify-between gap-3 px-4 py-3 hover:bg-secondary/20 transition-colors text-left"
                data-testid={`row-service-${svc.key}`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${svc.iconColor}`}>
                    {svc.icon}
                  </div>
                  <div className="min-w-0">
                    <div className="font-semibold text-sm text-foreground truncate">{svc.label}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {stats.total} total · <span className={stats.active > 0 ? "text-amber-400" : ""}>{stats.active} active</span>
                    </div>
                  </div>
                </div>
                <ArrowRight className="w-4 h-4 text-muted-foreground/60 flex-shrink-0" />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
