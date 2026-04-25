import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { parseISO, format } from "date-fns";
import { useLocation } from "wouter";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  TrendingUp, Globe, CalendarDays, Activity, AlertTriangle, Users,
} from "lucide-react";
import {
  PieChart, Pie, Cell, Tooltip as RechartsTip, ResponsiveContainer,
  LineChart, Line, XAxis, YAxis, CartesianGrid,
} from "recharts";

// ── Constants ─────────────────────────────────────────────────────────────────
const API_BASE = `${import.meta.env.VITE_API_URL ?? ""}/api`;
const STATS_CUTOFF_ISO = "2026-04-20T00:00:00";

const SERVICE_COLORS: Record<string, string> = {
  "Airport Transfer": "#C9A84C",
  "Tour":             "#8B5CF6",
  "As Directed":      "#3B82F6",
  "Apartment":        "#F59E0B",
  "Hotel":            "#10B981",
  "Other":            "#6B7280",
};
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

const PHONE_CODES = [
  { code: "+971", flag: "🇦🇪", country: "UAE" },
  { code: "+966", flag: "🇸🇦", country: "Saudi Arabia" },
  { code: "+974", flag: "🇶🇦", country: "Qatar" },
  { code: "+965", flag: "🇰🇼", country: "Kuwait" },
  { code: "+968", flag: "🇴🇲", country: "Oman" },
  { code: "+973", flag: "🇧🇭", country: "Bahrain" },
  { code: "+44",  flag: "🇬🇧", country: "United Kingdom" },
  { code: "+1",   flag: "🇺🇸", country: "United States" },
];

const NAT_COLORS = [
  "#C9A84C","#8B5CF6","#3B82F6","#F59E0B","#10B981",
  "#EF4444","#EC4899","#14B8A6","#F97316","#6366F1",
];

// ── Interfaces ────────────────────────────────────────────────────────────────
interface ForecastResponse {
  next_7_days_revenue:  number;
  next_30_days_revenue: number;
  next_7_days_count?:   number;
  next_30_days_count?:  number;
  by_service_type: { service_type: string; revenue: number; count: number }[];
  by_day:          { date: string; revenue: number; count: number }[];
}
interface Booking {
  id: string;
  service_type: string;
  price: number;
  date_time: string | null;
  status: string;
  client_id: string | null;
  clients?: { name: string } | null;
}
interface ClientRecord {
  id: string;
  name: string;
  nationality: string | null;
  phone: string | null;
  whatsapp: string | null;
}
interface DemandWeek { weekOf: string; score: number; }
interface DemandResponse { weeks: DemandWeek[]; isSimulated: boolean; cachedAt: string; }

type EventType = "gulf-holiday" | "gulf-national-day" | "london-peak" | "school-holiday";
interface CalEvent {
  name: string;
  startDate: Date;
  endDate: Date;
  type: EventType;
  tag: string;
  approximate?: boolean;
}

// ── Hijri → Gregorian conversion (Tabular Islamic Calendar) ──────────────────
function hijriToGregorian(hy: number, hm: number, hd: number): Date {
  const jd =
    Math.floor((11 * hy + 3) / 30) +
    Math.floor(354 * hy) +
    Math.floor(30 * hm) -
    Math.floor((hm - 1) / 2) +
    hd + 1948440 - 385;
  let l = jd + 68569;
  const n = Math.floor((4 * l) / 146097);
  l = l - Math.floor((146097 * n + 3) / 4);
  const i = Math.floor((4000 * (l + 1)) / 1461001);
  l = l - Math.floor((1461 * i) / 4) + 31;
  const j = Math.floor((80 * l) / 2447);
  const day = l - Math.floor((2447 * j) / 80);
  l = Math.floor(j / 11);
  const month = j + 2 - 12 * l;
  const year = 100 * (n - 49) + i + l;
  return new Date(year, month - 1, day);
}

// ── Nationality detection ─────────────────────────────────────────────────────
function detectNat(phone: string | null, whatsapp: string | null, nationality: string | null): { flag: string; country: string } {
  if (nationality) {
    const m = PHONE_CODES.find(c => c.country.toLowerCase() === nationality.toLowerCase());
    return m ? { flag: m.flag, country: m.country } : { flag: "🌍", country: nationality };
  }
  const raw = (phone || whatsapp || "").replace(/[\s\-\(\)\.]/g, "");
  const sorted = [...PHONE_CODES].sort((a, b) => b.code.length - a.code.length);
  for (const c of sorted) {
    if (raw.startsWith(c.code)) return { flag: c.flag, country: c.country };
  }
  return { flag: "🌍", country: "Other" };
}

// ── Calendar events builder ───────────────────────────────────────────────────
function buildCalEvents(): CalEvent[] {
  const events: CalEvent[] = [];
  const today = new Date();
  const yr = today.getFullYear();

  function addFixed(name: string, type: EventType, tag: string, mm: number, dd: number, dur: number, approx = false) {
    for (const y of [yr - 1, yr, yr + 1]) {
      const s = new Date(y, mm - 1, dd);
      const e = new Date(y, mm - 1, dd + dur - 1);
      events.push({ name, startDate: s, endDate: e, type, tag, approximate: approx });
    }
  }

  // Gulf National Days (fixed)
  addFixed("Saudi National Day 🇸🇦", "gulf-national-day", "Gulf National Day", 9, 23, 1);
  addFixed("UAE National Day 🇦🇪",   "gulf-national-day", "Gulf National Day", 12, 2, 2);
  addFixed("Kuwait National Day 🇰🇼", "gulf-national-day", "Gulf National Day", 2, 25, 1);
  addFixed("Qatar National Day 🇶🇦",  "gulf-national-day", "Gulf National Day", 12, 18, 1);
  addFixed("Bahrain National Day 🇧🇭", "gulf-national-day", "Gulf National Day", 12, 16, 1);
  addFixed("Oman National Day 🇴🇲",   "gulf-national-day", "Gulf National Day", 11, 18, 1);

  // Gulf School Holiday Windows (approximate)
  addFixed("Gulf Winter Break",  "school-holiday", "School Holiday", 12, 15, 21, true);
  addFixed("Gulf Spring Break",  "school-holiday", "School Holiday",  3, 25, 12, true);
  addFixed("Gulf Summer Break",  "school-holiday", "School Holiday",  6, 20, 87, true);

  // London Peak Seasons
  addFixed("London Summer Season",    "london-peak", "London Peak",  6,  1, 107);
  addFixed("London Festive Season",   "london-peak", "London Peak", 11, 15, 52);
  addFixed("Chelsea Flower Show",     "london-peak", "London Peak",  5, 23,  5);
  addFixed("Wimbledon",               "london-peak", "London Peak",  6, 28, 14);
  addFixed("Harrods January Sale",    "london-peak", "London Peak",  1,  2, 10);
  addFixed("Harrods Summer Sale",     "london-peak", "London Peak",  7,  1, 14);

  // Islamic holidays via Hijri calendar
  const seen = new Set<string>();
  for (const y of [yr - 1, yr, yr + 1]) {
    const approxHY = Math.floor((y - 622) * 33 / 32);
    for (const hy of [approxHY - 1, approxHY, approxHY + 1]) {
      const islamicPairs: [string, Date, number][] = [
        ["Ramadan Start",  hijriToGregorian(hy,     9,  1), 30],
        ["Eid al-Fitr",    hijriToGregorian(hy,    10,  1),  3],
        ["Eid al-Adha",    hijriToGregorian(hy,    12, 10),  4],
        ["Islamic New Year", hijriToGregorian(hy + 1, 1, 1), 1],
      ];
      for (const [name, start, dur] of islamicPairs) {
        const key = `${name}-${start.toISOString()}`;
        if (!seen.has(key)) {
          seen.add(key);
          const end = new Date(start);
          end.setDate(end.getDate() + dur - 1);
          events.push({ name, startDate: start, endDate: end, type: "gulf-holiday", tag: "Gulf Holiday" });
        }
      }
    }
  }

  return events;
}

// ── Demand insight text ───────────────────────────────────────────────────────
function buildInsight(weeks: DemandWeek[], isSimulated: boolean): string {
  if (!weeks.length) return "No demand data available.";
  const last = weeks[weeks.length - 1].score;
  const avg4 = weeks.slice(-4).reduce((s, w) => s + w.score, 0) / Math.min(4, weeks.length);
  const pct  = avg4 > 0 ? ((last - avg4) / avg4) * 100 : 0;
  if (isSimulated) return `Estimated seasonal demand index: ${last}/100. Live data will sync weekly from Google Trends when available.`;
  if (pct > 25)  return `Search interest is up ${Math.round(pct)}% this week — Gulf clients are actively planning London trips. Good time to activate follow-ups.`;
  if (pct < -20) return `Demand is down ${Math.round(Math.abs(pct))}% from the 4-week average — a quieter period may be ahead. Consider proactive outreach.`;
  if (last > 75) return `Search interest is strong at ${last}/100 — sustained Gulf→London demand. Capacity management is key right now.`;
  if (last < 45) return `Demand at ${last}/100 is relatively low. Consider targeted outreach highlighting upcoming London events.`;
  return `Search interest is stable at ${last}/100. Consistent Gulf→London demand with no major shifts this week.`;
}

// ── Colour helpers ────────────────────────────────────────────────────────────
const EVENT_TAG_STYLE: Record<EventType, string> = {
  "gulf-holiday":      "bg-amber-500/20 text-amber-300 border-amber-500/30",
  "gulf-national-day": "bg-yellow-500/20 text-yellow-300 border-yellow-500/30",
  "london-peak":       "bg-blue-500/20 text-blue-300 border-blue-500/30",
  "school-holiday":    "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
};

// ── Main Component ────────────────────────────────────────────────────────────
export default function Analytics() {
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [, navigate] = useLocation();
  const availableYears = [selectedYear - 1, selectedYear, selectedYear + 1];

  // ── Revenue Forecast ────────────────────────────────────────────────────────
  const forecastQuery = useQuery<ForecastResponse>({
    queryKey: ["dashboard-forecast"],
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${API_BASE}/dashboard/forecast`, {
        headers: { Authorization: `Bearer ${session?.access_token ?? ""}` },
      });
      if (!res.ok) throw new Error("Forecast failed");
      return res.json();
    },
  });
  const forecast      = forecastQuery.data;
  const sortedSvcs    = [...(forecast?.by_service_type ?? [])].sort((a, b) => b.revenue - a.revenue);

  // ── Year-scoped bookings ────────────────────────────────────────────────────
  const bookingsQuery = useQuery<Booking[]>({
    queryKey: ["analytics-bookings", selectedYear],
    queryFn: async () => {
      const yearStart = `${selectedYear}-01-01T00:00:00`;
      const yearEnd   = `${selectedYear}-12-31T23:59:59`;
      const effStart  = yearStart < STATS_CUTOFF_ISO ? STATS_CUTOFF_ISO : yearStart;
      const { data } = await supabase
        .from("bookings")
        .select("id, service_type, price, date_time, status, client_id, clients(name)")
        .gte("date_time", effStart)
        .lte("date_time", yearEnd)
        .not("status", "eq", "Cancelled")
        .order("date_time", { ascending: true });
      return (data ?? []) as unknown as Booking[];
    },
  });
  const bookings  = bookingsQuery.data ?? [];
  const bkLoading = bookingsQuery.isLoading;

  // ── Clients (nationality detection) ─────────────────────────────────────────
  const clientsQuery = useQuery<ClientRecord[]>({
    queryKey: ["intel-clients-nat"],
    queryFn: async () => {
      const { data } = await supabase
        .from("clients")
        .select("id, name, nationality, phone, whatsapp")
        .eq("inactive", false)
        .is("merged_into", null);
      return (data ?? []) as ClientRecord[];
    },
    staleTime: 10 * 60 * 1000,
  });

  // ── Demand tracker ──────────────────────────────────────────────────────────
  const demandQuery = useQuery<DemandResponse>({
    queryKey: ["intel-demand"],
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${API_BASE}/intel/demand`, {
        headers: { Authorization: `Bearer ${session?.access_token ?? ""}` },
      });
      if (!res.ok) throw new Error("Demand fetch failed");
      return res.json();
    },
    staleTime: 60 * 60 * 1000,
    retry: 1,
  });
  const demandWeeks     = demandQuery.data?.weeks ?? [];
  const isSimulated     = demandQuery.data?.isSimulated ?? true;
  const lastScore       = demandWeeks.at(-1)?.score ?? 0;
  const avg4            = demandWeeks.length >= 4
    ? demandWeeks.slice(-4).reduce((s, w) => s + w.score, 0) / 4
    : lastScore;
  const demandSurge     = demandWeeks.length >= 4 && lastScore > avg4 * 1.25;
  const demandInsight   = buildInsight(demandWeeks, isSimulated);

  // ── Client revenue map ──────────────────────────────────────────────────────
  const clientRevMap: Record<string, { name: string; total: number; count: number }> = {};
  bookings.forEach(b => {
    const cid  = b.client_id || "unknown";
    const name = (b.clients as any)?.name || "Unknown";
    if (!clientRevMap[cid]) clientRevMap[cid] = { name, total: 0, count: 0 };
    clientRevMap[cid].total += b.price || 0;
    clientRevMap[cid].count += 1;
  });
  const topClients = Object.entries(clientRevMap)
    .map(([client_id, v]) => ({ client_id, ...v }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);

  // ── Nationality stats ───────────────────────────────────────────────────────
  const natMap: Record<string, { flag: string; country: string; ids: Set<string>; revenue: number }> = {};
  (clientsQuery.data ?? []).forEach(cl => {
    const { flag, country } = detectNat(cl.phone, cl.whatsapp, cl.nationality);
    if (!natMap[country]) natMap[country] = { flag, country, ids: new Set(), revenue: 0 };
    natMap[country].ids.add(cl.id);
    if (clientRevMap[cl.id]) natMap[country].revenue += clientRevMap[cl.id].total;
  });
  const natStats = Object.values(natMap)
    .filter(n => n.ids.size > 0)
    .sort((a, b) => b.revenue - a.revenue)
    .map(n => ({ flag: n.flag, country: n.country, count: n.ids.size, revenue: n.revenue }));
  const totalNatClients = natStats.reduce((s, n) => s + n.count, 0);
  const natPieData = natStats.map(n => ({ name: n.country, value: n.count }));

  // ── Intel Summary derived ───────────────────────────────────────────────────
  const totalRevenue  = bookings.reduce((s, b) => s + (b.price || 0), 0);
  const totalBookings = bookings.length;
  const avgVal        = totalBookings > 0 ? totalRevenue / totalBookings : 0;
  const monthlyData   = MONTHS.map((month, idx) => {
    const mb = bookings.filter(b => b.date_time && new Date(b.date_time).getMonth() === idx);
    return { month, revenue: mb.reduce((s, b) => s + (b.price || 0), 0), bookings: mb.length };
  });
  const filledMonths  = monthlyData.filter(m => m.bookings > 0);
  const bestMonth     = filledMonths.length > 0 ? filledMonths.reduce((a, b) => b.revenue > a.revenue ? b : a) : null;
  const worstMonth    = filledMonths.length > 0 ? filledMonths.reduce((a, b) => b.revenue < a.revenue ? b : a) : null;
  const svcMap: Record<string, { service: string; revenue: number; bookings: number }> = {};
  bookings.forEach(b => {
    const s = b.service_type || "Other";
    if (!svcMap[s]) svcMap[s] = { service: s, revenue: 0, bookings: 0 };
    svcMap[s].revenue += b.price || 0;
    svcMap[s].bookings += 1;
  });
  const svcList = Object.values(svcMap).sort((a, b) => b.revenue - a.revenue);

  // ── Calendar events ─────────────────────────────────────────────────────────
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const allEvents = buildCalEvents();
  const upcomingEvents = allEvents
    .filter(e => e.endDate >= today)
    .sort((a, b) => a.startDate.getTime() - b.startDate.getTime())
    .reduce<CalEvent[]>((acc, ev) => {
      if (!acc.find(x => x.name === ev.name && x.startDate.getFullYear() === ev.startDate.getFullYear())) acc.push(ev);
      return acc;
    }, [])
    .slice(0, 12);

  const nextEvent = upcomingEvents[0];
  const next3     = upcomingEvents.slice(0, 3);

  const daysUntil = (d: Date) => {
    const diff = d.getTime() - today.getTime();
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  };

  const holidayAlert = upcomingEvents.find(e => {
    const d = daysUntil(e.startDate);
    return (e.type === "gulf-holiday" || e.type === "gulf-national-day") && d >= 0 && d <= 14;
  });

  // ── Top nationality for summary ─────────────────────────────────────────────
  const topNat = natStats[0];

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">

      {/* ── Alert banners ────────────────────────────────────────────────────── */}
      {holidayAlert && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3">
          <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-amber-300 leading-relaxed">
            <span className="font-semibold">{holidayAlert.name}</span> in{" "}
            <span className="font-bold">{daysUntil(holidayAlert.startDate)} days</span> — consider activating client follow-ups.
          </p>
        </div>
      )}
      {demandSurge && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3">
          <Activity className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-amber-300 leading-relaxed">
            <span className="font-semibold">Gulf→London searches are surging</span> — up {Math.round(((lastScore - avg4) / avg4) * 100)}% above the 4-week average. Activate your follow-up list now.
          </p>
        </div>
      )}

      {/* ── Header ───────────────────────────────────────────────────────────── */}
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

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* 1. REVENUE FORECAST                                                    */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
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
                      const d = Number(forecast.next_7_days_count);
                      if (Number.isFinite(d)) return d;
                      return (forecast.by_day ?? []).slice(0, 7).reduce((s, x) => s + (Number(x?.count) || 0), 0);
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
                      const d = Number(forecast.next_30_days_count);
                      if (Number.isFinite(d)) return d;
                      return (forecast.by_day ?? []).reduce((s, x) => s + (Number(x?.count) || 0), 0);
                    })()} bookings
                  </div>
                </div>
              </div>

              {sortedSvcs.length > 0 && (
                <div>
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">By Service Type</div>
                  <div className="space-y-1">
                    {sortedSvcs.map(s => (
                      <div key={s.service_type} className="flex items-center justify-between text-xs px-3 py-2 rounded-lg bg-muted/30">
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: SERVICE_COLORS[s.service_type] || "#6B7280" }} />
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
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Next 30 Days</div>
                <div className="space-y-0.5 max-h-[400px] overflow-y-auto">
                  {forecast.by_day.map(d => {
                    const empty = d.count === 0;
                    return (
                      <div key={d.date} className={`flex items-center justify-between text-xs px-3 py-2 rounded-lg ${empty ? "bg-muted/20" : ""}`}>
                        <span className={`font-medium ${empty ? "text-muted-foreground" : ""}`}>
                          {format(parseISO(d.date), "EEE dd MMM")}
                        </span>
                        <div className="flex items-center gap-3">
                          <span className="text-muted-foreground">{d.count} job{d.count !== 1 ? "s" : ""}</span>
                          <span className={`font-semibold w-20 text-right ${empty ? "text-muted-foreground" : "text-foreground"}`}>
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

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* ─── MARKET INTELLIGENCE ─────────────────────────────────────────────  */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-border/60" />
        <div className="flex items-center gap-2 px-2">
          <Globe className="w-3.5 h-3.5 text-primary" />
          <span className="text-xs font-semibold text-primary uppercase tracking-widest">Market Intelligence</span>
        </div>
        <div className="h-px flex-1 bg-border/60" />
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* 2. GULF & SEASON CALENDAR                                              */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      <Card className="border-primary/10">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <CalendarDays className="w-4 h-4 text-primary" />
            Gulf & Season Calendar
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0 space-y-4">
          {/* Countdown to most imminent event */}
          {nextEvent && (
            <div className="rounded-xl border border-primary/30 bg-primary/5 p-4">
              <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Coming up next</div>
              <div className="text-lg font-bold text-foreground">{nextEvent.name}</div>
              <div className="flex items-end justify-between mt-1">
                <div className="text-xs text-muted-foreground">
                  {format(nextEvent.startDate, "EEE d MMM yyyy")}
                  {nextEvent.approximate && <span className="ml-1 opacity-60">(approx.)</span>}
                </div>
                <div className="text-2xl font-black text-primary leading-none">
                  {daysUntil(nextEvent.startDate) <= 0
                    ? "Ongoing"
                    : `${daysUntil(nextEvent.startDate)}d`}
                </div>
              </div>
            </div>
          )}

          {/* Colour legend */}
          <div className="flex flex-wrap gap-2">
            {(["gulf-holiday","gulf-national-day","london-peak","school-holiday"] as EventType[]).map(type => (
              <span key={type} className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${EVENT_TAG_STYLE[type]}`}>
                {{
                  "gulf-holiday":      "Gulf Holiday",
                  "gulf-national-day": "Gulf National Day",
                  "london-peak":       "London Peak",
                  "school-holiday":    "School Holiday",
                }[type]}
              </span>
            ))}
          </div>

          {/* Next events list */}
          <div className="space-y-2">
            {next3.map((ev, i) => {
              const du = daysUntil(ev.startDate);
              const ongoing = du < 0;
              return (
                <div key={`${ev.name}-${i}`} className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-muted/30 border border-border/50">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-foreground truncate">{ev.name}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {format(ev.startDate, "d MMM")}
                      {ev.endDate.toDateString() !== ev.startDate.toDateString() && ` – ${format(ev.endDate, "d MMM")}`}
                      {ev.approximate && <span className="ml-1 opacity-50">(approx.)</span>}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1.5">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${EVENT_TAG_STYLE[ev.type]}`}>
                      {ev.tag}
                    </span>
                    <span className="text-xs font-bold text-foreground">
                      {ongoing ? "Now" : `${du}d`}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Full scrollable list */}
          {upcomingEvents.length > 3 && (
            <details className="group">
              <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground transition-colors select-none">
                Show all {upcomingEvents.length} upcoming events ▾
              </summary>
              <div className="mt-2 space-y-1.5">
                {upcomingEvents.slice(3).map((ev, i) => {
                  const du = daysUntil(ev.startDate);
                  return (
                    <div key={`detail-${ev.name}-${i}`} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/20 text-xs">
                      <span className={`px-1.5 py-0.5 rounded-full border text-[10px] font-medium flex-shrink-0 ${EVENT_TAG_STYLE[ev.type]}`}>{ev.tag}</span>
                      <span className="text-foreground font-medium flex-1 truncate">{ev.name}</span>
                      <span className="text-muted-foreground flex-shrink-0">{format(ev.startDate, "d MMM")}</span>
                      <span className="text-foreground font-bold flex-shrink-0 w-8 text-right">{du <= 0 ? "Now" : `${du}d`}</span>
                    </div>
                  );
                })}
              </div>
            </details>
          )}
        </CardContent>
      </Card>

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* 3. DEMAND TRACKER                                                      */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      <Card className="border-primary/10">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Activity className="w-4 h-4 text-primary" />
            Demand Tracker
            {isSimulated && (
              <span className="ml-auto text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-normal">
                Seasonal estimate
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0 space-y-4">
          {demandQuery.isLoading ? (
            <Skeleton className="h-44 w-full" />
          ) : demandWeeks.length === 0 ? (
            <div className="text-xs text-muted-foreground">Demand data unavailable. Will retry automatically.</div>
          ) : (
            <>
              {/* Line chart */}
              <div className="h-44">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={demandWeeks} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                    <XAxis
                      dataKey="weekOf"
                      tick={{ fontSize: 10, fill: "#9CA3AF" }}
                      tickFormatter={v => {
                        const d = new Date(v);
                        return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
                      }}
                      tickLine={false}
                      axisLine={false}
                      interval={2}
                    />
                    <YAxis
                      domain={[0, 100]}
                      tick={{ fontSize: 10, fill: "#9CA3AF" }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <RechartsTip
                      contentStyle={{ background: "#1a1a1a", border: "1px solid rgba(201,168,76,0.2)", borderRadius: 8, fontSize: 11 }}
                      labelFormatter={v => `Week of ${v}`}
                      formatter={(v: any) => [v, "Interest Score"]}
                    />
                    <Line
                      type="monotone"
                      dataKey="score"
                      stroke="#C9A84C"
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 4, fill: "#C9A84C" }}
                    />
                    {/* 4-week average reference */}
                    {demandWeeks.length >= 4 && (
                      <Line
                        type="monotone"
                        data={demandWeeks.map(() => ({ score: Math.round(avg4) }))}
                        dataKey="score"
                        stroke="#6B7280"
                        strokeWidth={1}
                        strokeDasharray="4 4"
                        dot={false}
                      />
                    )}
                  </LineChart>
                </ResponsiveContainer>
              </div>
              {/* Label row */}
              <div className="flex items-center gap-4 text-[10px] text-muted-foreground">
                <div className="flex items-center gap-1.5">
                  <div className="w-4 h-0.5 bg-primary" />
                  <span>Gulf→London interest (EN + AR, 0–100)</span>
                </div>
                {demandWeeks.length >= 4 && (
                  <div className="flex items-center gap-1.5">
                    <div className="w-4 h-0.5 border-t border-dashed border-muted-foreground" />
                    <span>4-week avg</span>
                  </div>
                )}
              </div>

              {/* Current score badge */}
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="rounded-lg bg-muted/40 px-3 py-2 text-center min-w-[60px]">
                    <div className="text-2xl font-black text-primary leading-none">{lastScore}</div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">this week</div>
                  </div>
                  <div className="rounded-lg bg-muted/40 px-3 py-2 text-center min-w-[60px]">
                    <div className="text-2xl font-black text-foreground leading-none">{Math.round(avg4)}</div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">4-wk avg</div>
                  </div>
                </div>
                {demandWeeks.length >= 4 && (
                  <div className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
                    lastScore > avg4 * 1.1
                      ? "bg-emerald-500/20 text-emerald-400"
                      : lastScore < avg4 * 0.9
                        ? "bg-red-500/20 text-red-400"
                        : "bg-muted text-muted-foreground"
                  }`}>
                    {lastScore > avg4 * 1.1
                      ? `↑ +${Math.round(((lastScore - avg4) / avg4) * 100)}%`
                      : lastScore < avg4 * 0.9
                        ? `↓ ${Math.round(((lastScore - avg4) / avg4) * 100)}%`
                        : "→ Stable"}
                  </div>
                )}
              </div>

              {/* Insight */}
              <p className="text-xs text-muted-foreground leading-relaxed border-t border-border/40 pt-3">
                💡 {demandInsight}
              </p>
            </>
          )}
        </CardContent>
      </Card>

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* ─── CLIENT INTELLIGENCE ─────────────────────────────────────────────  */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-border/60" />
        <div className="flex items-center gap-2 px-2">
          <Users className="w-3.5 h-3.5 text-primary" />
          <span className="text-xs font-semibold text-primary uppercase tracking-widest">Client Intelligence</span>
        </div>
        <div className="h-px flex-1 bg-border/60" />
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* 4a. NATIONALITY CHART                                                  */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      <Card className="border-primary/10">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Globe className="w-4 h-4 text-primary" />
            Client Nationality
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0 space-y-4">
          {clientsQuery.isLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : natStats.length === 0 ? (
            <p className="text-xs text-muted-foreground">No client nationality data available. Add phone numbers or nationality to client profiles.</p>
          ) : (
            <>
              {/* Donut chart */}
              <div className="flex flex-col items-center">
                <div className="relative h-48 w-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={natPieData}
                        cx="50%"
                        cy="50%"
                        innerRadius={52}
                        outerRadius={80}
                        paddingAngle={2}
                        dataKey="value"
                      >
                        {natPieData.map((_, i) => (
                          <Cell key={i} fill={NAT_COLORS[i % NAT_COLORS.length]} />
                        ))}
                      </Pie>
                      <RechartsTip
                        contentStyle={{ background: "#1a1a1a", border: "1px solid rgba(201,168,76,0.2)", borderRadius: 8, fontSize: 11 }}
                        formatter={(v: any, _: any, props: any) => {
                          const pct = totalNatClients > 0 ? Math.round((v / totalNatClients) * 100) : 0;
                          return [`${v} clients (${pct}%)`, props.name];
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  {/* Centre label */}
                  <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    <div className="text-2xl font-black text-foreground">{totalNatClients}</div>
                    <div className="text-[10px] text-muted-foreground">clients</div>
                  </div>
                </div>
              </div>

              {/* Nationality list — sorted by revenue, tappable */}
              <div className="space-y-1.5">
                {natStats.map((n, i) => (
                  <button
                    key={n.country}
                    onClick={() => navigate(`/clients?nationality=${encodeURIComponent(n.country)}`)}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl bg-muted/30 border border-border/40 hover:border-primary/30 hover:bg-primary/5 transition-all text-left"
                  >
                    <div
                      className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                      style={{ background: NAT_COLORS[i % NAT_COLORS.length] }}
                    />
                    <span className="text-base leading-none flex-shrink-0">{n.flag}</span>
                    <span className="text-sm font-semibold text-foreground flex-1">{n.country}</span>
                    <span className="text-xs text-muted-foreground flex-shrink-0">{n.count} client{n.count !== 1 ? "s" : ""}</span>
                    {n.revenue > 0 && (
                      <span className="text-sm font-bold text-primary flex-shrink-0">
                        £{n.revenue.toLocaleString()}
                      </span>
                    )}
                    <svg className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* 4b. TOP CLIENTS                                                         */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {bkLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : topClients.length > 0 && (
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

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* 5. INTEL SUMMARY                                                       */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      <Card className="border-primary/20 bg-primary/3">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">Intel Summary — {selectedYear}</CardTitle>
        </CardHeader>
        <CardContent className="pt-0 text-xs text-muted-foreground space-y-2">
          {bkLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : totalBookings === 0 ? (
            <p>No bookings recorded for {selectedYear} yet. Start creating bookings to generate intelligence here.</p>
          ) : (
            <>
              <p>
                • Total revenue of{" "}
                <span className="text-primary font-semibold">£{totalRevenue.toLocaleString()}</span>{" "}
                across <span className="text-foreground font-semibold">{totalBookings}</span> bookings — average value{" "}
                <span className="text-primary font-semibold">£{avgVal.toFixed(0)}</span>.
              </p>
              {topNat && topNat.count > 0 && (
                <p>
                  • Nationality intelligence: <span className="text-foreground font-semibold">{topNat.flag} {topNat.country}</span> leads with{" "}
                  {topNat.count} client{topNat.count !== 1 ? "s" : ""}
                  {topNat.revenue > 0 ? ` and £${topNat.revenue.toLocaleString()} in revenue` : ""}.
                  {natStats.length > 1 ? ` ${natStats[1].flag} ${natStats[1].country} follows with ${natStats[1].count} client${natStats[1].count !== 1 ? "s" : ""}.` : ""}
                </p>
              )}
              {nextEvent && (
                <p>
                  • Next key event:{" "}
                  <span className="text-foreground font-semibold">{nextEvent.name}</span>{" "}
                  in {daysUntil(nextEvent.startDate) <= 0 ? "progress" : `${daysUntil(nextEvent.startDate)} days`}
                  {(nextEvent.type === "gulf-holiday" || nextEvent.type === "gulf-national-day")
                    ? " — Gulf clients may be planning travel. Activate follow-up sequences."
                    : nextEvent.type === "london-peak"
                      ? " — London peak demand window. Ensure capacity is ready."
                      : " — School holiday window. Expect family travel enquiries."}
                </p>
              )}
              {!isSimulated && demandWeeks.length > 0 && (
                <p>
                  • Demand signal: Gulf→London search interest at{" "}
                  <span className={`font-semibold ${lastScore >= 70 ? "text-emerald-400" : lastScore >= 50 ? "text-primary" : "text-muted-foreground"}`}>
                    {lastScore}/100
                  </span>{" "}
                  {lastScore > avg4 * 1.1 ? "— trending up, good time to engage" : lastScore < avg4 * 0.9 ? "— below average, consider proactive outreach" : "— stable"}.
                </p>
              )}
              {bestMonth && (
                <p>
                  • <span className="text-emerald-400 font-semibold">{bestMonth.month}</span> was your strongest month at{" "}
                  <span className="text-primary font-semibold">£{bestMonth.revenue.toLocaleString()}</span>.
                  {worstMonth && worstMonth.revenue < bestMonth.revenue * 0.5
                    ? ` ${worstMonth.month} underperformed — consider targeted promotions in that window.`
                    : " Monthly performance has been consistent."}
                </p>
              )}
              {svcList[0] && (
                <p>
                  • <span className="text-foreground font-semibold">{svcList[0].service}</span> is your top revenue department ({Math.round(svcList[0].revenue / totalRevenue * 100)}% of total).
                  {svcList[1] ? ` ${svcList[1].service} follows.` : ""}
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

    </div>
  );
}
