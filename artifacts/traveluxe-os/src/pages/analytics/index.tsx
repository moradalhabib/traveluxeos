import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { parseISO, format } from "date-fns";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp } from "lucide-react";

const API_BASE = `${import.meta.env.VITE_API_URL ?? ""}/api`;

interface ForecastResponse {
  next_7_days_revenue: number;
  next_30_days_revenue: number;
  next_7_days_count?: number;
  next_30_days_count?: number;
  by_service_type: { service_type: string; revenue: number; count: number }[];
  by_day: { date: string; revenue: number; count: number }[];
}

const SERVICE_COLORS: Record<string, string> = {
  "Airport Transfer": "#C9A84C",
  "Tour":             "#8B5CF6",
  "As Directed":      "#3B82F6",
  "Apartment":        "#F59E0B",
  "Hotel":            "#10B981",
  "Other":            "#6B7280",
};

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

interface Booking {
  id: string;
  service_type: string;
  price: number;
  date_time: string | null;
  status: string;
  client_id: string | null;
  clients?: { name: string } | null;
}

interface MonthData {
  month: string;
  revenue: number;
  bookings: number;
}

interface ServiceSummary {
  service: string;
  revenue: number;
  bookings: number;
}

interface ClientSummary {
  client_id: string;
  name: string;
  total: number;
  count: number;
}

export default function Analytics() {
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());

  const forecastQuery = useQuery<ForecastResponse>({
    queryKey: ["dashboard-forecast"],
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token ?? "";
      const res = await fetch(`${API_BASE}/dashboard/forecast`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load forecast");
      return res.json();
    },
  });
  const forecast = forecastQuery.data;
  const sortedServices = [...(forecast?.by_service_type ?? [])].sort((a, b) => b.revenue - a.revenue);

  const STATS_CUTOFF_ISO = "2026-04-20T00:00:00";
  const bookingsQuery = useQuery<Booking[]>({
    queryKey: ["analytics-bookings", selectedYear],
    queryFn: async () => {
      const yearStart = `${selectedYear}-01-01T00:00:00`;
      const yearEnd   = `${selectedYear}-12-31T23:59:59`;
      const effectiveStart = yearStart < STATS_CUTOFF_ISO ? STATS_CUTOFF_ISO : yearStart;
      const { data } = await supabase
        .from("bookings")
        .select("id, service_type, price, date_time, status, client_id, clients(name)")
        .gte("date_time", effectiveStart)
        .lte("date_time", yearEnd)
        .not("status", "eq", "Cancelled")
        .order("date_time", { ascending: true });
      return (data ?? []) as unknown as Booking[];
    },
  });
  const bookings = bookingsQuery.data ?? [];
  const loading = bookingsQuery.isLoading;

  // ── Monthly data (for bestMonth in Intel Summary) ──────────────────────────
  const monthlyData: MonthData[] = MONTHS.map((month, idx) => {
    const mb = bookings.filter(b => b.date_time && new Date(b.date_time).getMonth() === idx);
    return {
      month,
      revenue: mb.reduce((s, b) => s + (b.price || 0), 0),
      bookings: mb.length,
    };
  });

  // ── Service breakdown (for Intel Summary) ──────────────────────────────────
  const serviceMap: Record<string, ServiceSummary> = {};
  bookings.forEach(b => {
    const svc = b.service_type || "Other";
    if (!serviceMap[svc]) serviceMap[svc] = { service: svc, revenue: 0, bookings: 0 };
    serviceMap[svc].revenue += b.price || 0;
    serviceMap[svc].bookings += 1;
  });
  const serviceSummaries = Object.values(serviceMap).sort((a, b) => b.revenue - a.revenue);
  const totalRevenue  = bookings.reduce((s, b) => s + (b.price || 0), 0);
  const totalBookings = bookings.length;
  const avgBookingValue = totalBookings > 0 ? totalRevenue / totalBookings : 0;

  // ── Top clients ─────────────────────────────────────────────────────────────
  const clientMap: Record<string, ClientSummary> = {};
  bookings.forEach(b => {
    const cid  = b.client_id || "unknown";
    const name = (b.clients as any)?.name || "Unknown";
    if (!clientMap[cid]) clientMap[cid] = { client_id: cid, name, total: 0, count: 0 };
    clientMap[cid].total += b.price || 0;
    clientMap[cid].count += 1;
  });
  const topClients = Object.values(clientMap).sort((a, b) => b.total - a.total).slice(0, 5);

  // ── Best & worst months (for Intel Summary) ─────────────────────────────────
  const filledMonths = monthlyData.filter(m => m.bookings > 0);
  const bestMonth  = filledMonths.length > 0 ? filledMonths.reduce((a, b) => b.revenue > a.revenue ? b : a) : null;
  const worstMonth = filledMonths.length > 0 ? filledMonths.reduce((a, b) => b.revenue < a.revenue ? b : a) : null;

  const availableYears = [selectedYear - 1, selectedYear, selectedYear + 1];

  return (
    <div className="space-y-5">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Intel</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Morning briefing — what's coming, who matters, what to act on
          </p>
        </div>
        <div className="flex gap-1">
          {availableYears.map(y => (
            <button
              key={y}
              onClick={() => setSelectedYear(y)}
              className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-all ${
                y === selectedYear
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-muted-foreground hover:text-foreground"
              }`}
            >
              {y}
            </button>
          ))}
        </div>
      </div>

      {/* ── 1. Revenue Forecast ─────────────────────────────────────────────── */}
      <Card className="border-primary/20" data-testid="card-revenue-forecast">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-primary" />
            Revenue Forecast
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0 space-y-4">
          {forecastQuery.isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : forecastQuery.isError || !forecast ? (
            <div className="text-xs text-destructive">Failed to load forecast.</div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-primary/20 bg-primary/5 p-4" data-testid="text-forecast-7d">
                  <div className="text-xs text-muted-foreground uppercase tracking-wider">Next 7 days</div>
                  <div className="text-2xl font-bold text-primary mt-1">
                    £{(Number(forecast.next_7_days_revenue) || 0).toLocaleString()}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {(() => {
                      const direct = Number(forecast.next_7_days_count);
                      if (Number.isFinite(direct)) return direct;
                      const fallback = (forecast.by_day ?? []).slice(0, 7)
                        .reduce((s, d) => s + (Number(d?.count) || 0), 0);
                      return Number.isFinite(fallback) ? fallback : 0;
                    })()} bookings
                  </div>
                </div>
                <div className="rounded-xl border border-primary/20 bg-primary/5 p-4" data-testid="text-forecast-30d">
                  <div className="text-xs text-muted-foreground uppercase tracking-wider">Next 30 days</div>
                  <div className="text-2xl font-bold text-primary mt-1">
                    £{(Number(forecast.next_30_days_revenue) || 0).toLocaleString()}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {(() => {
                      const direct = Number(forecast.next_30_days_count);
                      if (Number.isFinite(direct)) return direct;
                      const fallback = (forecast.by_day ?? [])
                        .reduce((s, d) => s + (Number(d?.count) || 0), 0);
                      return Number.isFinite(fallback) ? fallback : 0;
                    })()} bookings
                  </div>
                </div>
              </div>

              {sortedServices.length > 0 && (
                <div>
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                    By Service Type
                  </div>
                  <div className="space-y-1">
                    {sortedServices.map(s => (
                      <div key={s.service_type} className="flex items-center justify-between text-xs px-3 py-2 rounded-lg bg-muted/30">
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full" style={{ background: SERVICE_COLORS[s.service_type] || "#6B7280" }} />
                          <span className="font-medium text-foreground">{s.service_type}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-muted-foreground">{s.count} job{s.count !== 1 ? "s" : ""}</span>
                          <span className="font-semibold text-primary w-20 text-right">£{s.revenue.toLocaleString()}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  Next 30 Days
                </div>
                <div className="space-y-0.5 max-h-[400px] overflow-y-auto">
                  {forecast.by_day.map(d => {
                    const isEmpty = d.count === 0;
                    return (
                      <div
                        key={d.date}
                        data-testid={`row-forecast-day-${d.date}`}
                        className={`flex items-center justify-between text-xs px-3 py-2 rounded-lg ${isEmpty ? "bg-muted/20" : ""}`}
                      >
                        <span className={`font-medium ${isEmpty ? "text-muted-foreground" : ""}`}>
                          {format(parseISO(d.date), "EEE dd MMM")}
                        </span>
                        <div className="flex items-center gap-3">
                          <span className="text-muted-foreground">{d.count} job{d.count !== 1 ? "s" : ""}</span>
                          <span className={`font-semibold w-20 text-right ${isEmpty ? "text-muted-foreground" : "text-foreground"}`}>
                            {d.revenue > 0 ? `£${d.revenue.toLocaleString()}` : "—"}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* ── Year-scoped data (Top Clients + Intel Summary) ──────────────────── */}
      {loading ? (
        <div className="space-y-4">
          {[...Array(2)].map((_, i) => <Skeleton key={i} className="h-32 w-full" />)}
        </div>
      ) : (
        <>
          {/* ── 2. Top Clients ──────────────────────────────────────────────── */}
          {topClients.length > 0 && (
            <Card className="border-primary/10">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">Top Clients in {selectedYear}</CardTitle>
              </CardHeader>
              <CardContent className="pt-0 space-y-2">
                {topClients.map((c, i) => (
                  <div key={c.client_id} className="flex items-center gap-3 p-3 rounded-xl border border-border bg-background/50">
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 ${
                      i === 0 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                    }`}>
                      {i + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-foreground truncate">{c.name}</div>
                      <div className="text-xs text-muted-foreground">{c.count} booking{c.count !== 1 ? "s" : ""}</div>
                    </div>
                    <div className="text-sm font-bold text-primary flex-shrink-0">£{c.total.toLocaleString()}</div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* ── 3. Intel Summary ────────────────────────────────────────────── */}
          <Card className="border-primary/20 bg-primary/3">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">Intel Summary — {selectedYear}</CardTitle>
            </CardHeader>
            <CardContent className="pt-0 text-xs text-muted-foreground space-y-2">
              {totalBookings === 0 ? (
                <p>No bookings recorded for {selectedYear} yet. Start creating bookings to generate intelligence here.</p>
              ) : (
                <>
                  <p>
                    • Total revenue of <span className="text-primary font-semibold">£{totalRevenue.toLocaleString()}</span> across{" "}
                    <span className="text-foreground font-semibold">{totalBookings}</span> bookings with an average value of{" "}
                    <span className="text-primary font-semibold">£{avgBookingValue.toFixed(0)}</span>.
                  </p>
                  {bestMonth && (
                    <p>
                      • <span className="text-green-400 font-semibold">{bestMonth.month}</span> was your strongest month at{" "}
                      <span className="text-primary font-semibold">£{bestMonth.revenue.toLocaleString()}</span> — lean into whatever drove that month.
                    </p>
                  )}
                  {worstMonth && worstMonth.revenue < bestMonth!.revenue * 0.5 && (
                    <p>
                      • <span className="text-destructive font-semibold">{worstMonth.month}</span> underperformed — consider targeted promotions or outreach to existing clients in that period.
                    </p>
                  )}
                  {serviceSummaries[0] && (
                    <p>
                      • <span className="text-foreground font-semibold">{serviceSummaries[0].service}</span> is your top revenue department ({Math.round(serviceSummaries[0].revenue / totalRevenue * 100)}% of total).
                      {serviceSummaries[1] ? ` Second is ${serviceSummaries[1].service}.` : ""}
                    </p>
                  )}
                  {topClients[0] && (
                    <p>
                      • Top client <span className="text-foreground font-semibold">{topClients[0].name}</span> generated{" "}
                      <span className="text-primary font-semibold">£{topClients[0].total.toLocaleString()}</span> — prioritise retention.
                    </p>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
