import { useEffect, useMemo, useState } from "react";
import { useGetFinanceSummary, getGetFinanceSummaryQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  PoundSterling, TrendingUp, CreditCard, AlertCircle, ArrowUpDown,
  Car, LayoutDashboard, ChevronRight, CheckCircle2, Clock, CalendarRange,
  Plane, Map, Home, Wallet, TrendingDown
} from "lucide-react";
import { Link } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/lib/supabase";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip as RTooltip, Cell } from "recharts";

type Period = "today" | "week" | "month" | "year" | "all" | "custom";

function periodRange(p: Period, customFrom?: string, customTo?: string): { from?: string; to?: string; label: string } {
  const now = new Date();
  const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0,0,0,0); return x; };
  const endOfDay = (d: Date) => { const x = new Date(d); x.setHours(23,59,59,999); return x; };

  if (p === "today") {
    return { from: startOfDay(now).toISOString(), to: endOfDay(now).toISOString(), label: "Today" };
  }
  if (p === "week") {
    const day = now.getDay() || 7;
    const monday = new Date(now); monday.setDate(now.getDate() - (day - 1));
    return { from: startOfDay(monday).toISOString(), to: endOfDay(now).toISOString(), label: "This Week" };
  }
  if (p === "month") {
    const first = new Date(now.getFullYear(), now.getMonth(), 1);
    return { from: startOfDay(first).toISOString(), to: endOfDay(now).toISOString(), label: "This Month" };
  }
  if (p === "year") {
    const first = new Date(now.getFullYear(), 0, 1);
    return { from: startOfDay(first).toISOString(), to: endOfDay(now).toISOString(), label: "This Year" };
  }
  if (p === "custom" && (customFrom || customTo)) {
    const fromIso = customFrom ? startOfDay(new Date(customFrom)).toISOString() : undefined;
    const toIso = customTo ? endOfDay(new Date(customTo)).toISOString() : undefined;
    const label = `${customFrom ?? "…"} → ${customTo ?? "…"}`;
    return { from: fromIso, to: toIso, label };
  }
  return { label: "All Time" };
}

const SERVICE_ICONS: Record<string, string> = {
  "Airport Transfer": "✈",
  "Tour": "🗺",
  "City Tour": "🏛",
  "Chauffeur Tour": "🏰",
  "As Directed": "🕐",
  "Event Transfer": "🎭",
  "Apartment / Accommodation": "🏠",
};

export default function Finance() {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === "super_admin";
  const [tab, setTab] = useState("overview");
  const [period, setPeriod] = useState<Period>("month");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const range = useMemo(() => periodRange(period, customFrom, customTo), [period, customFrom, customTo]);
  const params = useMemo(() => {
    const p: Record<string, string> = {};
    if (range.from) p.date_from = range.from;
    if (range.to) p.date_to = range.to;
    return p as any;
  }, [range.from, range.to]);

  const { data: summary, isLoading, isFetching } = useGetFinanceSummary(
    params,
    { query: { queryKey: getGetFinanceSummaryQueryKey(params) } }
  );

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-48" />
        <div className="grid grid-cols-2 gap-3">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-28" />)}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const s = summary as any;
  const driverBreakdown: any[] = s?.driver_commission_breakdown ?? [];
  const serviceBreakdown: any[] = s?.service_breakdown ?? [];
  const outstanding: any[] = s?.outstanding_payments ?? [];
  const operators: any[] = s?.operator_performance ?? [];

  const totalOutstandingCommission = driverBreakdown.reduce((acc: number, d: any) => acc + (d.commission_outstanding ?? 0), 0);
  const totalPendingPayout = driverBreakdown.reduce((acc: number, d: any) => acc + (d.payout_pending ?? 0), 0);

  return (
    <div className="space-y-5 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Finance</h1>
          <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1.5">
            <CalendarRange className="w-3 h-3" />
            Showing: <span className="text-foreground font-medium">{range.label}</span>
            {isFetching && <span className="text-primary animate-pulse">· refreshing</span>}
          </p>
        </div>
        <Link href="/">
          <Button variant="outline" size="sm" className="border-primary/30 text-primary hover:bg-primary/10">
            <LayoutDashboard className="w-4 h-4 mr-2" />
            Dashboard
          </Button>
        </Link>
      </div>

      {/* Period filter */}
      <div className="rounded-2xl border border-border bg-card p-3 space-y-3">
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
          {([
            { k: "today", label: "Today" },
            { k: "week", label: "Week" },
            { k: "month", label: "Month" },
            { k: "year", label: "Year" },
            { k: "all", label: "All Time" },
            { k: "custom", label: "Custom" },
          ] as { k: Period; label: string }[]).map(opt => (
            <button
              key={opt.k}
              onClick={() => setPeriod(opt.k)}
              data-testid={`finance-period-${opt.k}`}
              className={`px-2 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                period === opt.k
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-muted-foreground hover:text-foreground"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        {period === "custom" && (
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <label className="text-[10px] text-muted-foreground uppercase tracking-wider">From</label>
              <Input
                type="date"
                value={customFrom}
                onChange={e => setCustomFrom(e.target.value)}
                className="h-8 text-xs"
                data-testid="finance-custom-from"
              />
            </div>
            <div className="flex-1">
              <label className="text-[10px] text-muted-foreground uppercase tracking-wider">To</label>
              <Input
                type="date"
                value={customTo}
                onChange={e => setCustomTo(e.target.value)}
                className="h-8 text-xs"
                data-testid="finance-custom-to"
              />
            </div>
          </div>
        )}
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl border border-border bg-card p-4">
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp className="w-4 h-4 text-primary" />
            <span className="text-xs text-muted-foreground">Total Revenue</span>
          </div>
          <div className="text-2xl font-bold text-foreground">£{(s?.total_revenue ?? 0).toLocaleString()}</div>
        </div>
        <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4">
          <div className="flex items-center gap-2 mb-1">
            <PoundSterling className="w-4 h-4 text-primary" />
            <span className="text-xs text-muted-foreground">TVL Commission</span>
          </div>
          <div className="text-2xl font-bold text-primary">£{(s?.total_commission ?? 0).toLocaleString()}</div>
        </div>
        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4">
          <div className="flex items-center gap-2 mb-1">
            <AlertCircle className="w-4 h-4 text-amber-500" />
            <span className="text-xs text-muted-foreground">Outstanding Commissions</span>
          </div>
          <div className="text-2xl font-bold text-amber-500">£{totalOutstandingCommission.toLocaleString()}</div>
          <div className="text-[10px] text-muted-foreground mt-0.5">To collect from drivers</div>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4">
          <div className="flex items-center gap-2 mb-1">
            <CreditCard className="w-4 h-4 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Pending Payouts</span>
          </div>
          <div className="text-2xl font-bold text-foreground">£{totalPendingPayout.toLocaleString()}</div>
          <div className="text-[10px] text-muted-foreground mt-0.5">Owed to drivers</div>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className={`w-full grid ${isSuperAdmin ? "grid-cols-5" : "grid-cols-4"} bg-card border border-border`}>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="services">Services</TabsTrigger>
          <TabsTrigger value="drivers">Drivers</TabsTrigger>
          <TabsTrigger value="clients">Clients</TabsTrigger>
          {isSuperAdmin && (
            <TabsTrigger value="profit" className="bg-primary/5 text-primary data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
              Profit
            </TabsTrigger>
          )}
        </TabsList>

        {/* OVERVIEW */}
        <TabsContent value="overview" className="space-y-4 mt-4">
          {/* Cancellation fees */}
          {(s?.cancellation_fees ?? 0) > 0 && (
            <div className="flex items-center justify-between p-4 rounded-xl border border-border bg-card">
              <span className="text-sm font-medium">Cancellation Fees</span>
              <span className="text-primary font-bold">£{(s?.cancellation_fees ?? 0).toLocaleString()}</span>
            </div>
          )}

          {/* Operator performance */}
          <Card className="border-primary/10">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Operator Performance</CardTitle>
            </CardHeader>
            <CardContent className="pt-0 space-y-3">
              {operators.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">No data yet</p>
              )}
              {operators.map((op: any) => (
                <div key={op.operator_id} className="flex items-center justify-between p-3 rounded-xl border border-border bg-background/50">
                  <div>
                    <div className="font-medium text-sm">{op.operator_name}</div>
                    <div className="text-xs text-muted-foreground">{op.total_bookings} bookings</div>
                  </div>
                  <div className="text-primary font-bold">£{(op.total_revenue ?? 0).toLocaleString()}</div>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        {/* SERVICES BREAKDOWN */}
        <TabsContent value="services" className="space-y-4 mt-4">
          <p className="text-xs text-muted-foreground">Revenue and commission broken down by service type.</p>
          {serviceBreakdown.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">No bookings yet</div>
          ) : (
            <div className="space-y-3">
              {serviceBreakdown.map((svc: any) => (
                <div key={svc.service_type} className="p-4 rounded-2xl border border-border bg-card hover:border-primary/30 transition-colors">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xl">{SERVICE_ICONS[svc.service_type] ?? "📋"}</span>
                      <div>
                        <div className="font-semibold text-sm text-foreground">{svc.service_type}</div>
                        <div className="text-xs text-muted-foreground">{svc.count} {svc.count === 1 ? "booking" : "bookings"}</div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-bold text-foreground">£{(svc.revenue ?? 0).toLocaleString()}</div>
                      <div className="text-xs text-muted-foreground">revenue</div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between pt-3 border-t border-border">
                    <span className="text-xs text-muted-foreground">TVL Commission</span>
                    <span className="text-primary font-semibold text-sm">£{(svc.commission ?? 0).toLocaleString()}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        {/* DRIVER COMMISSIONS */}
        <TabsContent value="drivers" className="space-y-4 mt-4">
          <p className="text-xs text-muted-foreground">
            Commission owed to Traveluxe and payouts owed to each driver.
          </p>
          {driverBreakdown.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">No driver data yet</div>
          ) : (
            <div className="space-y-3">
              {driverBreakdown.map((d: any) => (
                <div key={d.driver_id} className="rounded-2xl border border-border bg-card overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                        <Car className="w-4 h-4 text-primary" />
                      </div>
                      <div>
                        <div className="font-semibold text-sm">{d.driver_name}</div>
                        <div className="text-xs text-muted-foreground">{d.jobs} {d.jobs === 1 ? "job" : "jobs"}</div>
                      </div>
                    </div>
                    <Link href={`/commissions?driver=${d.driver_id}`}>
                      <Button variant="ghost" size="sm" className="text-xs text-primary h-7 px-2">
                        View <ChevronRight className="w-3 h-3 ml-1" />
                      </Button>
                    </Link>
                  </div>
                  <div className="grid grid-cols-2 divide-x divide-border">
                    <div className="px-4 py-3">
                      <div className="text-xs text-muted-foreground mb-1">Commission Owed to TVL</div>
                      <div className="font-bold text-foreground">£{(d.commission_owed ?? 0).toLocaleString()}</div>
                      {(d.commission_outstanding ?? 0) > 0 ? (
                        <div className="flex items-center gap-1 mt-1">
                          <Clock className="w-3 h-3 text-amber-500" />
                          <span className="text-[10px] text-amber-500">£{(d.commission_outstanding ?? 0).toLocaleString()} outstanding</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 mt-1">
                          <CheckCircle2 className="w-3 h-3 text-green-500" />
                          <span className="text-[10px] text-green-500">All settled</span>
                        </div>
                      )}
                    </div>
                    <div className="px-4 py-3">
                      <div className="text-xs text-muted-foreground mb-1">Driver Payout</div>
                      <div className="font-bold text-foreground">£{(d.driver_payout ?? 0).toLocaleString()}</div>
                      {(d.payout_pending ?? 0) > 0 ? (
                        <div className="flex items-center gap-1 mt-1">
                          <Clock className="w-3 h-3 text-amber-500" />
                          <span className="text-[10px] text-amber-500">£{(d.payout_pending ?? 0).toLocaleString()} pending</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 mt-1">
                          <CheckCircle2 className="w-3 h-3 text-green-500" />
                          <span className="text-[10px] text-green-500">All paid</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        {/* OUTSTANDING CLIENT PAYMENTS */}
        <TabsContent value="clients" className="space-y-4 mt-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">Bookings with unpaid or partially paid invoices.</p>
            {outstanding.length > 0 && (
              <Badge variant="outline" className="text-amber-500 border-amber-500/30">
                £{outstanding.reduce((s: number, b: any) => s + (b.price ?? 0), 0).toLocaleString()} total
              </Badge>
            )}
          </div>
          {outstanding.length === 0 ? (
            <div className="text-center py-12">
              <CheckCircle2 className="w-10 h-10 text-green-500/50 mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">All clients are paid up</p>
            </div>
          ) : (
            <div className="space-y-2">
              {outstanding.map((booking: any) => (
                <Link key={booking.id} href={`/bookings/${booking.id}`}>
                  <div className="flex items-center justify-between p-3 rounded-xl border border-border bg-card hover:border-primary/30 transition-colors cursor-pointer">
                    <div>
                      <div className="font-medium text-sm">{booking.client_name}</div>
                      <div className="text-xs text-muted-foreground font-mono">{booking.tvl_ref}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">{booking.service_type}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-primary font-bold">£{(booking.price ?? 0).toLocaleString()}</div>
                      <Badge variant="outline" className="text-[10px] mt-1 text-amber-500 border-amber-500/30">
                        {booking.payment_status}
                      </Badge>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </TabsContent>
        {/* PROFIT — Super Admin only */}
        {isSuperAdmin && (
          <TabsContent value="profit" className="space-y-4 mt-4">
            <ProfitTab dateFrom={range.from} dateTo={range.to} periodLabel={range.label} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

// ─── Profit Tab (Super Admin only) ──────────────────────────────────────────

const PROFIT_BUCKETS = ["Airport Transfer", "Tour", "Car Rental", "Apartment"] as const;
const BUCKET_ICONS: Record<string, any> = {
  "Airport Transfer": Plane,
  "Tour": Map,
  "Car Rental": Car,
  "Apartment": Home,
};
const BUCKET_COLORS: Record<string, string> = {
  "Airport Transfer": "#c9a84c",
  "Tour": "#4c8fc9",
  "Car Rental": "#7d4cc9",
  "Apartment": "#4cc99e",
  "Other": "#888888",
};

type SortKey = "date" | "service" | "commission";

function ProfitTab({ dateFrom, dateTo, periodLabel }: { dateFrom?: string; dateTo?: string; periodLabel: string }) {
  const [data, setData] = useState<{ summary: Record<string, number>; total_profit: number; breakdown: any[]; booking_count: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        if (!token) throw new Error("Not authenticated");
        const baseUrl = import.meta.env.BASE_URL.replace(/\/$/, "");
        const qs = new URLSearchParams();
        if (dateFrom) qs.set("date_from", dateFrom);
        if (dateTo)   qs.set("date_to", dateTo);
        const res = await fetch(`${baseUrl}/api/finance/profit?${qs.toString()}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j?.error ?? `Request failed (${res.status})`);
        }
        const json = await res.json();
        if (!cancelled) setData(json);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Failed to load profit data");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [dateFrom, dateTo]);

  const sorted = useMemo(() => {
    if (!data) return [];
    const arr = [...data.breakdown];
    arr.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "date")        cmp = new Date(a.date_time ?? 0).getTime() - new Date(b.date_time ?? 0).getTime();
      else if (sortKey === "service") cmp = String(a.bucket).localeCompare(String(b.bucket));
      else if (sortKey === "commission") cmp = (a.tvl_commission ?? 0) - (b.tvl_commission ?? 0);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [data, sortKey, sortDir]);

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(k); setSortDir("desc"); }
  };

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-6 text-center">
        <AlertCircle className="w-8 h-8 text-destructive mx-auto mb-2" />
        <p className="text-sm font-semibold text-destructive">Access Denied</p>
        <p className="text-xs text-muted-foreground mt-1">{error}</p>
      </div>
    );
  }

  if (!data) return null;

  const chartData = PROFIT_BUCKETS.map(b => ({
    name: b,
    profit: Math.round(data.summary[b] ?? 0),
  }));

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/10 to-primary/5 p-5">
        <div className="flex items-center gap-2 text-primary mb-1">
          <Wallet className="w-5 h-5" />
          <span className="text-xs font-semibold uppercase tracking-wider">Total TVL Profit · {periodLabel}</span>
        </div>
        <div className="text-4xl font-bold text-primary">£{data.total_profit.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
        <div className="text-xs text-muted-foreground mt-1">
          From {data.booking_count} completed / invoiced {data.booking_count === 1 ? "booking" : "bookings"} · TVL commission only
        </div>
      </div>

      {/* Per-service summary cards */}
      <div className="grid grid-cols-2 gap-3">
        {PROFIT_BUCKETS.map(b => {
          const Icon = BUCKET_ICONS[b];
          const value = data.summary[b] ?? 0;
          const pct = data.total_profit > 0 ? (value / data.total_profit) * 100 : 0;
          return (
            <div key={b} className="rounded-2xl border border-border bg-card p-4">
              <div className="flex items-center gap-2 mb-1.5">
                <Icon className="w-4 h-4" style={{ color: BUCKET_COLORS[b] }} />
                <span className="text-xs text-muted-foreground">{b}</span>
              </div>
              <div className="text-xl font-bold text-foreground">£{value.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">{pct.toFixed(1)}% of profit</div>
            </div>
          );
        })}
      </div>

      {/* Bar chart */}
      <Card className="border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Profit per Service</CardTitle>
        </CardHeader>
        <CardContent>
          {data.total_profit === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No profit data for this period</p>
          ) : (
            <div className="w-full h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} layout="vertical" margin={{ left: 20, right: 30, top: 10, bottom: 10 }}>
                  <XAxis type="number" stroke="#888" fontSize={11} tickFormatter={(v) => `£${v.toLocaleString()}`} />
                  <YAxis type="category" dataKey="name" stroke="#888" fontSize={11} width={110} />
                  <RTooltip
                    cursor={{ fill: "rgba(201,168,76,0.08)" }}
                    contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                    formatter={(v: any) => [`£${Number(v).toLocaleString()}`, "Profit"]}
                  />
                  <Bar dataKey="profit" radius={[0, 6, 6, 0]}>
                    {chartData.map((entry, i) => (
                      <Cell key={i} fill={BUCKET_COLORS[entry.name] ?? "#888"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Breakdown table */}
      <Card className="border-border">
        <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Booking Breakdown</CardTitle>
          <Badge variant="outline" className="text-[10px]">Completed / Invoiced only</Badge>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          {sorted.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No bookings in this period</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-secondary/30 text-muted-foreground uppercase tracking-wider">
                  <tr>
                    <th className="text-left px-3 py-2 font-semibold">TVL Ref</th>
                    <th className="text-left px-3 py-2 font-semibold">
                      <button onClick={() => toggleSort("date")} className="flex items-center gap-1 hover:text-foreground">
                        Date <ArrowUpDown className="w-3 h-3" />
                      </button>
                    </th>
                    <th className="text-left px-3 py-2 font-semibold">
                      <button onClick={() => toggleSort("service")} className="flex items-center gap-1 hover:text-foreground">
                        Service <ArrowUpDown className="w-3 h-3" />
                      </button>
                    </th>
                    <th className="text-left px-3 py-2 font-semibold">Client</th>
                    <th className="text-right px-3 py-2 font-semibold">Fare</th>
                    <th className="text-right px-3 py-2 font-semibold">
                      <button onClick={() => toggleSort("commission")} className="flex items-center gap-1 ml-auto hover:text-foreground">
                        TVL Commission <ArrowUpDown className="w-3 h-3" />
                      </button>
                    </th>
                    <th className="text-left px-3 py-2 font-semibold">Payment</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((row: any) => (
                    <tr key={row.booking_id} className="border-t border-border hover:bg-secondary/20">
                      <td className="px-3 py-2 font-mono text-primary">
                        <Link href={`/bookings/${row.booking_id}`}><span className="hover:underline cursor-pointer">{row.tvl_ref}</span></Link>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {row.date_time ? new Date(row.date_time).toLocaleDateString() : "—"}
                      </td>
                      <td className="px-3 py-2">
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium" style={{ background: `${BUCKET_COLORS[row.bucket] ?? "#888"}22`, color: BUCKET_COLORS[row.bucket] ?? "#888" }}>
                          {row.bucket}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-foreground truncate max-w-[140px]">{row.client_name}</td>
                      <td className="px-3 py-2 text-right text-muted-foreground">£{Number(row.price).toLocaleString()}</td>
                      <td className="px-3 py-2 text-right font-semibold text-primary">£{Number(row.tvl_commission).toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                      <td className="px-3 py-2">
                        <Badge variant="outline" className={`text-[10px] ${row.payment_status === "Paid" ? "border-green-500/30 text-green-500" : "border-amber-500/30 text-amber-500"}`}>
                          {row.payment_status ?? "—"}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
