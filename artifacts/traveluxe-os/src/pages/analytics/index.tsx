import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line, CartesianGrid, Legend
} from "recharts";
import {
  TrendingUp, TrendingDown, Minus, CalendarRange,
  PoundSterling, Users, Award, AlertTriangle, ChevronDown
} from "lucide-react";

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
  byService: Record<string, number>;
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
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());

  useEffect(() => {
    const yearStart = `${selectedYear}-01-01T00:00:00`;
    const yearEnd   = `${selectedYear}-12-31T23:59:59`;

    supabase
      .from("bookings")
      .select("id, service_type, price, date_time, status, client_id, clients(name)")
      .gte("date_time", yearStart)
      .lte("date_time", yearEnd)
      .not("status", "eq", "Cancelled")
      .order("date_time", { ascending: true })
      .then(({ data }) => {
        setBookings((data ?? []) as Booking[]);
        setLoading(false);
      });
  }, [selectedYear]);

  // ── Build monthly data ──────────────────────────────────────────────────
  const monthlyData: MonthData[] = MONTHS.map((month, idx) => {
    const monthBookings = bookings.filter(b => {
      if (!b.date_time) return false;
      return new Date(b.date_time).getMonth() === idx;
    });
    const byService: Record<string, number> = {};
    monthBookings.forEach(b => {
      const svc = b.service_type || "Other";
      byService[svc] = (byService[svc] || 0) + (b.price || 0);
    });
    return {
      month,
      revenue: monthBookings.reduce((s, b) => s + (b.price || 0), 0),
      bookings: monthBookings.length,
      byService,
    };
  });

  // ── Service breakdown ───────────────────────────────────────────────────
  const serviceMap: Record<string, ServiceSummary> = {};
  bookings.forEach(b => {
    const svc = b.service_type || "Other";
    if (!serviceMap[svc]) serviceMap[svc] = { service: svc, revenue: 0, bookings: 0 };
    serviceMap[svc].revenue += b.price || 0;
    serviceMap[svc].bookings += 1;
  });
  const serviceSummaries = Object.values(serviceMap).sort((a, b) => b.revenue - a.revenue);
  const totalRevenue = bookings.reduce((s, b) => s + (b.price || 0), 0);
  const totalBookings = bookings.length;
  const avgBookingValue = totalBookings > 0 ? totalRevenue / totalBookings : 0;

  // ── Top clients ─────────────────────────────────────────────────────────
  const clientMap: Record<string, ClientSummary> = {};
  bookings.forEach(b => {
    const cid = b.client_id || "unknown";
    const name = (b.clients as any)?.name || "Unknown";
    if (!clientMap[cid]) clientMap[cid] = { client_id: cid, name, total: 0, count: 0 };
    clientMap[cid].total += b.price || 0;
    clientMap[cid].count += 1;
  });
  const topClients = Object.values(clientMap).sort((a, b) => b.total - a.total).slice(0, 5);

  // ── Best & worst months ─────────────────────────────────────────────────
  const filledMonths = monthlyData.filter(m => m.bookings > 0);
  const bestMonth = filledMonths.length > 0
    ? filledMonths.reduce((a, b) => b.revenue > a.revenue ? b : a)
    : null;
  const worstMonth = filledMonths.length > 0
    ? filledMonths.reduce((a, b) => b.revenue < a.revenue ? b : a)
    : null;

  // ── YoY trend (current vs prev month) ──────────────────────────────────
  const currentMonthIdx = new Date().getMonth();
  const currentMonthRevenue = monthlyData[currentMonthIdx]?.revenue ?? 0;
  const prevMonthRevenue = monthlyData[Math.max(0, currentMonthIdx - 1)]?.revenue ?? 0;
  const trend = prevMonthRevenue === 0
    ? null
    : ((currentMonthRevenue - prevMonthRevenue) / prevMonthRevenue) * 100;

  const availableYears = [selectedYear - 1, selectedYear, selectedYear + 1];

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="bg-card border border-border rounded-xl p-3 shadow-xl text-xs">
        <p className="font-semibold text-foreground mb-2">{label}</p>
        {payload.map((p: any) => (
          <div key={p.dataKey} className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full" style={{ background: p.fill || p.color }} />
            <span className="text-muted-foreground">{p.dataKey}:</span>
            <span className="font-semibold">£{(p.value as number).toLocaleString()}</span>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Monthly Intel</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Operations, trends & revenue breakdown</p>
        </div>
        <div className="flex gap-1">
          {availableYears.map(y => (
            <button
              key={y}
              onClick={() => { setLoading(true); setSelectedYear(y); }}
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

      {loading ? (
        <div className="space-y-4">
          {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-32 w-full" />)}
        </div>
      ) : (
        <>
          {/* KPI Strip */}
          <div className="grid grid-cols-3 gap-3">
            <Card className="border-primary/10">
              <CardContent className="p-4">
                <PoundSterling className="w-4 h-4 text-primary mb-1" />
                <div className="text-xl font-bold text-primary">£{totalRevenue.toLocaleString()}</div>
                <div className="text-xs text-muted-foreground">Total Revenue</div>
                {trend !== null && (
                  <div className={`flex items-center gap-0.5 text-xs mt-1 ${trend >= 0 ? "text-green-400" : "text-destructive"}`}>
                    {trend > 0 ? <TrendingUp className="w-3 h-3" /> : trend < 0 ? <TrendingDown className="w-3 h-3" /> : <Minus className="w-3 h-3" />}
                    {Math.abs(trend).toFixed(0)}% vs last month
                  </div>
                )}
              </CardContent>
            </Card>
            <Card className="border-primary/10">
              <CardContent className="p-4">
                <CalendarRange className="w-4 h-4 text-blue-400 mb-1" />
                <div className="text-xl font-bold text-foreground">{totalBookings}</div>
                <div className="text-xs text-muted-foreground">Bookings</div>
                <div className="text-xs text-muted-foreground mt-1">
                  Avg £{avgBookingValue.toFixed(0)}
                </div>
              </CardContent>
            </Card>
            <Card className="border-primary/10">
              <CardContent className="p-4">
                <Users className="w-4 h-4 text-purple-400 mb-1" />
                <div className="text-xl font-bold text-foreground">{Object.keys(clientMap).length}</div>
                <div className="text-xs text-muted-foreground">Active Clients</div>
                <div className="text-xs text-muted-foreground mt-1">in {selectedYear}</div>
              </CardContent>
            </Card>
          </div>

          {/* Revenue by Month — Bar Chart */}
          <Card className="border-primary/10">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">Revenue by Month {selectedYear}</CardTitle>
            </CardHeader>
            <CardContent className="pt-0 px-2">
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={monthlyData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="month" tick={{ fontSize: 10, fill: "#6b7280" }} />
                  <YAxis tick={{ fontSize: 9, fill: "#6b7280" }} tickFormatter={v => `£${v >= 1000 ? `${(v/1000).toFixed(0)}k` : v}`} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="revenue" fill="#C9A84C" radius={[4,4,0,0]} name="Revenue" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Bookings Volume by Month */}
          <Card className="border-primary/10">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">Booking Volume Trend</CardTitle>
            </CardHeader>
            <CardContent className="pt-0 px-2">
              <ResponsiveContainer width="100%" height={150}>
                <LineChart data={monthlyData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="month" tick={{ fontSize: 10, fill: "#6b7280" }} />
                  <YAxis tick={{ fontSize: 9, fill: "#6b7280" }} allowDecimals={false} />
                  <Tooltip />
                  <Line type="monotone" dataKey="bookings" stroke="#C9A84C" strokeWidth={2} dot={{ r: 3, fill: "#C9A84C" }} name="Bookings" />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Revenue by Department */}
          <Card className="border-primary/10">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">Revenue by Department</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="flex items-start gap-4">
                <div className="w-36 h-36 flex-shrink-0">
                  <ResponsiveContainer width="100%" height={144}>
                    <PieChart>
                      <Pie
                        data={serviceSummaries}
                        dataKey="revenue"
                        nameKey="service"
                        cx="50%"
                        cy="50%"
                        innerRadius={38}
                        outerRadius={60}
                        paddingAngle={3}
                      >
                        {serviceSummaries.map(s => (
                          <Cell key={s.service} fill={SERVICE_COLORS[s.service] || "#6B7280"} />
                        ))}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex-1 space-y-2 py-1">
                  {serviceSummaries.map(s => {
                    const pct = totalRevenue > 0 ? (s.revenue / totalRevenue * 100) : 0;
                    return (
                      <div key={s.service}>
                        <div className="flex items-center justify-between text-xs mb-1">
                          <div className="flex items-center gap-1.5">
                            <div className="w-2.5 h-2.5 rounded-sm" style={{ background: SERVICE_COLORS[s.service] || "#6B7280" }} />
                            <span className="text-foreground font-medium truncate max-w-[120px]">{s.service}</span>
                          </div>
                          <span className="font-semibold text-foreground ml-1">£{s.revenue.toLocaleString()}</span>
                        </div>
                        <div className="w-full h-1.5 rounded-full bg-muted overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: SERVICE_COLORS[s.service] || "#6B7280" }} />
                        </div>
                        <div className="text-[10px] text-muted-foreground mt-0.5">{s.bookings} bookings · {pct.toFixed(0)}%</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Best & Worst Months */}
          {(bestMonth || worstMonth) && (
            <div className="grid grid-cols-2 gap-3">
              {bestMonth && (
                <Card className="border-green-500/20 bg-green-500/5">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Award className="w-4 h-4 text-green-400" />
                      <span className="text-xs font-semibold text-green-400 uppercase tracking-wider">Best Month</span>
                    </div>
                    <div className="text-lg font-bold text-foreground">{bestMonth.month}</div>
                    <div className="text-sm text-primary font-semibold">£{bestMonth.revenue.toLocaleString()}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{bestMonth.bookings} bookings</div>
                  </CardContent>
                </Card>
              )}
              {worstMonth && worstMonth.month !== bestMonth?.month && (
                <Card className="border-destructive/20 bg-destructive/5">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <AlertTriangle className="w-4 h-4 text-destructive" />
                      <span className="text-xs font-semibold text-destructive uppercase tracking-wider">Needs Focus</span>
                    </div>
                    <div className="text-lg font-bold text-foreground">{worstMonth.month}</div>
                    <div className="text-sm text-foreground font-semibold">£{worstMonth.revenue.toLocaleString()}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{worstMonth.bookings} bookings</div>
                  </CardContent>
                </Card>
              )}
            </div>
          )}

          {/* Monthly breakdown table */}
          <Card className="border-primary/10">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">Month-by-Month Breakdown</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="space-y-1">
                {monthlyData.map(m => {
                  const pct = totalRevenue > 0 ? (m.revenue / totalRevenue * 100) : 0;
                  const isBest = m.month === bestMonth?.month;
                  return (
                    <div key={m.month} className={`flex items-center gap-3 px-3 py-2.5 rounded-xl ${isBest ? "bg-primary/8 border border-primary/20" : ""}`}>
                      <span className="text-xs font-semibold text-muted-foreground w-7">{m.month}</span>
                      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                        <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-xs font-bold text-foreground w-20 text-right">
                        {m.revenue > 0 ? `£${m.revenue.toLocaleString()}` : "—"}
                      </span>
                      <Badge variant="outline" className="text-[10px] w-16 justify-center">
                        {m.bookings} job{m.bookings !== 1 ? "s" : ""}
                      </Badge>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Top Clients */}
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

          {/* Insights */}
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
