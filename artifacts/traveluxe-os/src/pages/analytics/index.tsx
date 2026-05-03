import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { parseISO, format } from "date-fns";
import { useLocation } from "wouter";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  TrendingUp, Globe, CalendarDays, Activity, AlertTriangle, Users, X, Info,
  XCircle,
} from "lucide-react";
import { useLostLeadStats, type LostLeadPeriod } from "@/lib/requests-api";
import {
  PieChart, Pie, Cell, Tooltip as RechartsTip, ResponsiveContainer,
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  BarChart, Bar,
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
  description?: string;
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
  if (!raw) return { flag: "🌍", country: "Other" };
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

  function addFixed(name: string, type: EventType, tag: string, mm: number, dd: number, dur: number, approx = false, description = "") {
    for (const y of [yr - 1, yr, yr + 1]) {
      const s = new Date(y, mm - 1, dd);
      const e = new Date(y, mm - 1, dd + dur - 1);
      events.push({ name, startDate: s, endDate: e, type, tag, approximate: approx, description });
    }
  }

  // Gulf National Days (fixed)
  addFixed("Saudi National Day 🇸🇦", "gulf-national-day", "Gulf National Day", 9, 23, 1, false, "Major national holiday. Expect high inbound demand from Saudi clients.");
  addFixed("UAE National Day 🇦🇪",   "gulf-national-day", "Gulf National Day", 12, 2, 2, false, "UAE national celebration. Strong travel demand from UAE clients.");
  addFixed("Kuwait National Day 🇰🇼", "gulf-national-day", "Gulf National Day", 2, 25, 1, false, "Kuwait national holiday. Activate Kuwaiti client follow-ups.");
  addFixed("Qatar National Day 🇶🇦",  "gulf-national-day", "Gulf National Day", 12, 18, 1, false, "Qatar national holiday. Expect Qatar-based travel enquiries.");
  addFixed("Bahrain National Day 🇧🇭", "gulf-national-day", "Gulf National Day", 12, 16, 1, false, "Bahrain national day. Good window for outreach to Bahraini clients.");
  addFixed("Oman National Day 🇴🇲",   "gulf-national-day", "Gulf National Day", 11, 18, 1, false, "Oman national holiday. Activate Omani client follow-ups.");

  // Gulf School Holiday Windows (operator-aligned approximate dates)
  addFixed("Gulf Winter Break",  "school-holiday", "School Holiday", 12, 15, 22, true, "Gulf school winter holidays (≈Dec 15 – Jan 5). Peak family travel to London — ensure fleet availability.");
  addFixed("Gulf Spring Break",  "school-holiday", "School Holiday",  3, 20, 17, true, "Gulf spring half-term (≈Mar 20 – Apr 5). Families travelling to London for shopping and leisure.");
  addFixed("Gulf Summer Break",  "school-holiday", "School Holiday",  6, 15, 79, true, "Long Gulf summer break (≈Jun 15 – Sep 1). Highest volume period — many Gulf families relocate to London for 2–3 months.");

  // London Peak Seasons & Marquee Events
  addFixed("London Summer Season",     "london-peak", "London Peak",  6,  1, 107, false, "Peak luxury travel season in London. High demand for airport transfers, shopping trips and as-directed services.");
  addFixed("London Festive Season",    "london-peak", "London Peak", 11, 15,  52, false, "Christmas and New Year in London. Strong demand for Harrods, West End, and New Year's Eve services.");
  addFixed("Chelsea Flower Show",      "london-peak", "London Peak",  5, 19,   6, false, "Royal Horticultural Society event (May). Attracts high-net-worth clients. Expect demand for Belgravia / Chelsea area transfers.");
  addFixed("Wimbledon",                "london-peak", "London Peak",  6, 29,  14, false, "Annual tennis championship (late June – early July). High demand for SW19 transfers and as-directed services for the fortnight.");
  addFixed("Harrods January Sale",     "london-peak", "London Peak",  1,  2,  10, false, "Harrods post-Christmas sale — extremely popular with Gulf clients. High demand for Knightsbridge transfers.");
  addFixed("Harrods Summer Sale",      "london-peak", "London Peak",  6, 26,  14, false, "Harrods summer sale (late June). Gulf clients visiting London often prioritise this. Key period for shopping trip services.");
  addFixed("Harrods Christmas Window", "london-peak", "London Peak", 11,  1,  60, false, "Harrods festive window unveiling through Christmas (Nov–Dec). Very strong shopping-trip demand from Gulf clients.");
  addFixed("Frieze London",            "london-peak", "London Peak", 10, 15,   5, false, "Frieze London art fair (October). Attracts art-collector and HNW visitors — Mayfair / Regent's Park area transfers.");
  addFixed("Art Basel London",         "london-peak", "London Peak",  3,  1,   5, false, "Art Basel London week (March). Strong HNW arrivals — gallery and hotel-circuit transfer demand.");
  addFixed("F1 British Grand Prix",    "london-peak", "London Peak",  7,  3,   3, false, "Silverstone race weekend (early July). High demand for chauffeur transfers to/from Silverstone and helipads.");
  addFixed("New Year's Eve London",    "london-peak", "London Peak", 12, 31,   1, false, "NYE celebrations across London. Very high demand for evening as-directed services and post-fireworks transfers.");
  addFixed("Premier League Opening",   "london-peak", "London Peak",  8, 16,   3, false, "Premier League opening weekend (mid August). Stadium and post-match transfers in demand.");
  addFixed("Premier League Final Day", "london-peak", "London Peak",  5, 24,   2, false, "Premier League final-day fixtures (late May). Stadium transfer demand peaks.");

  // Islamic holidays via Hijri calendar
  const seen = new Set<string>();
  const islamicDescriptions: Record<string, string> = {
    "Ramadan Start":    "Holy month. Gulf travel to London may dip mid-Ramadan but surges around Eid. Plan capacity accordingly.",
    "Eid al-Fitr":      "Celebration at end of Ramadan. High travel demand — one of the busiest periods for Gulf→London luxury travel.",
    "Eid al-Adha":      "Major Islamic festival. Very strong inbound travel from Gulf. Activate all client follow-ups 2 weeks before.",
    "Islamic New Year": "Islamic new year. Moderate travel uplift from Gulf clients.",
  };
  for (const y of [yr - 1, yr, yr + 1]) {
    const approxHY = Math.floor((y - 622) * 33 / 32);
    for (const hy of [approxHY - 1, approxHY, approxHY + 1]) {
      const islamicPairs: [string, Date, number][] = [
        ["Ramadan Start",    hijriToGregorian(hy,     9,  1), 30],
        ["Eid al-Fitr",      hijriToGregorian(hy,    10,  1),  3],
        ["Eid al-Adha",      hijriToGregorian(hy,    12, 10),  4],
        ["Islamic New Year", hijriToGregorian(hy + 1, 1,  1),  1],
      ];
      for (const [name, start, dur] of islamicPairs) {
        const key = `${name}-${start.toISOString()}`;
        if (!seen.has(key)) {
          seen.add(key);
          const end = new Date(start);
          end.setDate(end.getDate() + dur - 1);
          events.push({ name, startDate: start, endDate: end, type: "gulf-holiday", tag: "Gulf Holiday", description: islamicDescriptions[name] ?? "" });
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
  if (isSimulated) return `Seasonal demand index: ${last}/100 for Gulf luxury chauffeur & London travel. Live search data will sync weekly from Google Trends when available.`;
  if (pct > 25)  return `Gulf client searches for London luxury travel & chauffeur are up ${Math.round(pct)}% this week — high intent signal. Activate your follow-up list now.`;
  if (pct < -20) return `Search demand for Gulf→London luxury travel is down ${Math.round(Math.abs(pct))}% from the 4-week average — quieter period ahead. Proactive outreach recommended.`;
  if (last > 75) return `Demand signal strong at ${last}/100 — sustained interest in Gulf luxury chauffeur & London services. Capacity management is key.`;
  if (last < 45) return `Demand at ${last}/100 is relatively low for Gulf luxury travel. Consider targeted outreach highlighting upcoming London events.`;
  return `Gulf luxury chauffeur & London travel demand is stable at ${last}/100. No major directional shift this week.`;
}

// ── Colour helpers ────────────────────────────────────────────────────────────
const EVENT_TAG_STYLE: Record<EventType, string> = {
  "gulf-holiday":      "bg-amber-500/20 text-amber-300 border-amber-500/30",
  "gulf-national-day": "bg-yellow-500/20 text-yellow-300 border-yellow-500/30",
  "london-peak":       "bg-blue-500/20 text-blue-300 border-blue-500/30",
  "school-holiday":    "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
};
const EVENT_TAG_LABEL: Record<EventType, string> = {
  "gulf-holiday":      "Gulf Holiday",
  "gulf-national-day": "Gulf National Day",
  "london-peak":       "London Peak",
  "school-holiday":    "School Holiday",
};
const EVENT_TYPE_ACTIVE: Record<EventType, string> = {
  "gulf-holiday":      "bg-amber-500/40 text-amber-200 border-amber-400",
  "gulf-national-day": "bg-yellow-500/40 text-yellow-200 border-yellow-400",
  "london-peak":       "bg-blue-500/40 text-blue-200 border-blue-400",
  "school-holiday":    "bg-emerald-500/40 text-emerald-200 border-emerald-400",
};

// ── Event Detail Sheet ────────────────────────────────────────────────────────
function EventDetailSheet({ event, onClose, daysUntil }: { event: CalEvent | null; onClose: () => void; daysUntil: (d: Date) => number }) {
  if (!event) return null;
  const du = daysUntil(event.startDate);
  // Day-level comparison so an event on its final day reads "Ongoing" all day
  // (matches the Market Signals card logic above which uses midnight `today`).
  const todayMidnight = new Date(); todayMidnight.setHours(0, 0, 0, 0);
  const ongoing = du <= 0 && event.endDate >= todayMidnight;
  const ended   = event.endDate < todayMidnight;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-md mx-auto bg-background border border-border/80 rounded-t-2xl sm:rounded-2xl shadow-2xl p-4 space-y-3 z-10"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1.5">
            <span className={`text-[11px] px-2.5 py-1 rounded-full border font-semibold ${EVENT_TAG_STYLE[event.type]}`}>
              {event.tag}
            </span>
            <h2 className="text-xl font-bold text-foreground leading-tight">{event.name}</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg bg-muted/60 hover:bg-muted transition-colors flex-shrink-0 mt-0.5">
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        {/* Date + countdown */}
        <div className="flex items-center justify-between rounded-xl bg-muted/30 border border-border/50 px-4 py-3">
          <div>
            <div className="text-xs text-muted-foreground uppercase tracking-wide">Dates</div>
            <div className="text-sm font-semibold text-foreground mt-0.5">
              {format(event.startDate, "d MMM yyyy")}
              {event.endDate.toDateString() !== event.startDate.toDateString() && (
                <span className="text-muted-foreground"> – {format(event.endDate, "d MMM yyyy")}</span>
              )}
              {event.approximate && <span className="text-xs text-muted-foreground ml-1">(approx.)</span>}
            </div>
          </div>
          <div className={`text-2xl font-black leading-none ${ongoing ? "text-emerald-400" : ended ? "text-muted-foreground" : "text-primary"}`}>
            {ended ? "Ended" : ongoing ? "Ongoing" : `${du}d`}
          </div>
        </div>

        {/* Description */}
        {event.description && (
          <div className="flex items-start gap-2.5 rounded-xl bg-primary/5 border border-primary/20 px-4 py-3">
            <Info className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
            <p className="text-xs text-muted-foreground leading-relaxed">{event.description}</p>
          </div>
        )}

        {/* Action hint */}
        {!ended && (event.type === "gulf-holiday" || event.type === "gulf-national-day") && (
          <p className="text-xs text-amber-300/80 font-medium">
            💡 Consider sending WhatsApp follow-ups to Gulf clients now.
          </p>
        )}
        {!ended && event.type === "london-peak" && (
          <p className="text-xs text-blue-300/80 font-medium">
            💡 Ensure fleet capacity is ready — peak London demand window.
          </p>
        )}
        {!ended && event.type === "school-holiday" && (
          <p className="text-xs text-emerald-300/80 font-medium">
            💡 Expect family bookings — airport transfers and as-directed services will be in high demand.
          </p>
        )}
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function Analytics() {
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [, navigate] = useLocation();
  const availableYears = [selectedYear - 1, selectedYear, selectedYear + 1];

  // Event calendar state
  const [lostLeadPeriod, setLostLeadPeriod] = useState<LostLeadPeriod>("this_month");
  const lostLeadStats = useLostLeadStats(lostLeadPeriod);

  const [activeFilters, setActiveFilters] = useState<Set<EventType>>(new Set());
  const [selectedEvent, setSelectedEvent] = useState<CalEvent | null>(null);
  const [showAllEvents, setShowAllEvents] = useState(false);

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
  const forecast   = forecastQuery.data;
  const sortedSvcs = [...(forecast?.by_service_type ?? [])].sort((a, b) => b.revenue - a.revenue);

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

  // ── Clients (nationality detection) — use neq to include null/unset rows ────
  const clientsQuery = useQuery<ClientRecord[]>({
    queryKey: ["intel-clients-nat"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clients")
        .select("id, name, nationality, whatsapp")
        .neq("inactive", true);
      if (error) throw error;
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
  const demandWeeks   = demandQuery.data?.weeks ?? [];
  const isSimulated   = demandQuery.data?.isSimulated ?? true;
  const lastScore     = demandWeeks.at(-1)?.score ?? 0;
  const avg4          = demandWeeks.length >= 4
    ? demandWeeks.slice(-4).reduce((s, w) => s + w.score, 0) / 4
    : lastScore;
  const demandSurge   = demandWeeks.length >= 4 && lastScore > avg4 * 1.25;
  const demandInsight = buildInsight(demandWeeks, isSimulated);

  // ── Client revenue map (year-scoped, used for Top Clients + Intel Summary) ─
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

  // ── Lifetime completed-booking revenue per client ──────────────────────────
  // Fix #2: Nationality revenue must sum ALL completed bookings for clients of
  // that nationality, not be year-scoped (which made e.g. UAE show £100 across
  // 190 clients because only one 2026 booking happened to belong to a UAE
  // client). We respect STATS_CUTOFF_ISO (project-wide rule excluding pre-OS
  // legacy data) and additional_charges so it matches Finance per-client totals.
  const lifetimeCompletedRevQuery = useQuery<Record<string, number>>({
    queryKey: ["intel-lifetime-completed-rev-by-client"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bookings")
        .select("client_id, price, additional_charges")
        .eq("status", "Completed")
        .gte("date_time", STATS_CUTOFF_ISO);
      if (error) throw error;
      const map: Record<string, number> = {};
      (data ?? []).forEach((b: any) => {
        const id = b.client_id;
        if (!id) return;
        map[id] = (map[id] ?? 0) + (Number(b.price) || 0) + (Number(b.additional_charges) || 0);
      });
      return map;
    },
    staleTime: 10 * 60 * 1000,
  });
  const lifetimeRevByClient = lifetimeCompletedRevQuery.data ?? {};

  // ── Nationality stats ───────────────────────────────────────────────────────
  const natMap: Record<string, { flag: string; country: string; ids: Set<string>; revenue: number }> = {};
  (clientsQuery.data ?? []).forEach(cl => {
    const { flag, country } = detectNat(null, cl.whatsapp, cl.nationality);
    if (!natMap[country]) natMap[country] = { flag, country, ids: new Set(), revenue: 0 };
    natMap[country].ids.add(cl.id);
    if (lifetimeRevByClient[cl.id]) natMap[country].revenue += lifetimeRevByClient[cl.id];
  });
  const natStats = Object.values(natMap)
    .filter(n => n.ids.size > 0)
    .sort((a, b) => b.revenue - a.revenue)
    .map(n => ({ flag: n.flag, country: n.country, count: n.ids.size, revenue: n.revenue }));

  // Year-scoped nationality revenue for the Intel Summary bullet so the
  // year-labeled section ("Intel Summary — {selectedYear}") stays internally
  // consistent. The Nationality CARD itself uses the lifetime number above.
  const natMapYear: Record<string, { revenue: number }> = {};
  (clientsQuery.data ?? []).forEach(cl => {
    const { country } = detectNat(null, cl.whatsapp, cl.nationality);
    if (!natMapYear[country]) natMapYear[country] = { revenue: 0 };
    if (clientRevMap[cl.id]) natMapYear[country].revenue += clientRevMap[cl.id].total;
  });
  const topNatYearRevenue = (country: string) => natMapYear[country]?.revenue ?? 0;
  const totalNatClients = natStats.reduce((s, n) => s + n.count, 0);
  const natPieData = natStats.map(n => ({ name: n.country, value: n.count }));

  // ── Intel Summary ───────────────────────────────────────────────────────────
  const totalRevenue  = bookings.reduce((s, b) => s + (b.price || 0), 0);
  const totalBookings = bookings.length;
  const avgVal        = totalBookings > 0 ? totalRevenue / totalBookings : 0;
  const monthlyData   = MONTHS.map((month, idx) => {
    const mb = bookings.filter(b => b.date_time && new Date(b.date_time).getMonth() === idx);
    return { month, revenue: mb.reduce((s, b) => s + (b.price || 0), 0), bookings: mb.length };
  });
  const filledMonths = monthlyData.filter(m => m.bookings > 0);
  const bestMonth    = filledMonths.length > 0 ? filledMonths.reduce((a, b) => b.revenue > a.revenue ? b : a) : null;
  const worstMonth   = filledMonths.length > 0 ? filledMonths.reduce((a, b) => b.revenue < a.revenue ? b : a) : null;
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
    }, []);

  // Filtered events (by active filter chips)
  const filteredEvents = activeFilters.size === 0
    ? upcomingEvents
    : upcomingEvents.filter(e => activeFilters.has(e.type));

  const nextEvent    = upcomingEvents[0];
  const shownEvents  = showAllEvents ? filteredEvents : filteredEvents.slice(0, 3);
  const topNat       = natStats[0];

  const daysUntil = (d: Date) => {
    const diff = d.getTime() - today.getTime();
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  };

  const holidayAlert = upcomingEvents.find(e => {
    const d = daysUntil(e.startDate);
    return (e.type === "gulf-holiday" || e.type === "gulf-national-day") && d >= 0 && d <= 14;
  });

  const toggleFilter = (type: EventType) => {
    setActiveFilters(prev => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type); else next.add(type);
      return next;
    });
    setShowAllEvents(false);
  };

  // ── Demand XAxis formatter (robust) ────────────────────────────────────────
  function fmtWeekOf(v: unknown): string {
    if (typeof v !== "string") return "";
    const d = new Date(v);
    if (isNaN(d.getTime())) return String(v);
    return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-3">

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
            <span className="font-semibold">Gulf luxury travel demand is surging</span> — up {Math.round(((lastScore - avg4) / avg4) * 100)}% above the 4-week average. Activate your follow-up list now.
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
      {/* 1. INTEL SUMMARY (moved first)                                         */}
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
              {topNat && topNat.count > 0 && (() => {
                const yrRev = topNatYearRevenue(topNat.country);
                return (
                  <p>
                    • Nationality intelligence: <span className="text-foreground font-semibold">{topNat.flag} {topNat.country}</span> leads with{" "}
                    {topNat.count} client{topNat.count !== 1 ? "s" : ""}
                    {yrRev > 0 ? ` and £${yrRev.toLocaleString()} in ${selectedYear} revenue` : ""}.
                    {natStats.length > 1 ? ` ${natStats[1].flag} ${natStats[1].country} follows with ${natStats[1].count} client${natStats[1].count !== 1 ? "s" : ""}.` : ""}
                  </p>
                );
              })()}
              {nextEvent && (
                <p>
                  • Next key event:{" "}
                  <span className="text-foreground font-semibold">{nextEvent.name}</span>{" "}
                  {daysUntil(nextEvent.startDate) <= 0 ? "is underway" : `in ${daysUntil(nextEvent.startDate)} days`}
                  {(nextEvent.type === "gulf-holiday" || nextEvent.type === "gulf-national-day")
                    ? " — Gulf clients may be planning London travel. Activate follow-up sequences."
                    : nextEvent.type === "london-peak"
                      ? " — London peak demand window. Ensure fleet capacity is ready."
                      : " — School holiday window. Expect family travel enquiries."}
                </p>
              )}
              {demandWeeks.length > 0 && (
                <p>
                  • Gulf luxury travel demand signal:{" "}
                  <span className={`font-semibold ${lastScore >= 70 ? "text-emerald-400" : lastScore >= 50 ? "text-primary" : "text-muted-foreground"}`}>
                    {lastScore}/100
                  </span>{" "}
                  {isSimulated ? "(seasonal estimate)" : ""}{" "}
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

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* ─── MARKET SIGNALS ──────────────────────────────────────────────────  */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-border/60" />
        <div className="flex items-center gap-2 px-2">
          <Activity className="w-3.5 h-3.5 text-primary" />
          <span className="text-xs font-semibold text-primary uppercase tracking-widest">Market Signals</span>
        </div>
        <div className="h-px flex-1 bg-border/60" />
      </div>

      {/* 2A — London Peak Events Calendar (next 6, colour-coded countdown) */}
      {(() => {
        const peak = upcomingEvents
          .filter(e => e.type === "london-peak")
          .slice(0, 6);
        return (
          <Card className="border-primary/10">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <CalendarDays className="w-4 h-4 text-primary" />
                London Peak Events
                <span className="text-[10px] text-muted-foreground font-normal ml-auto">Next {peak.length}</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0 space-y-2">
              {peak.length === 0 ? (
                <p className="text-xs text-muted-foreground">No upcoming London peak events.</p>
              ) : peak.map(ev => {
                const du = daysUntil(ev.startDate);
                const ongoing = du <= 0 && ev.endDate >= today;
                // Operator-spec colour bands: red <14, yellow 14–30, green 30+
                const band =
                  ongoing            ? { dot: "bg-emerald-400", ring: "border-emerald-500/40 bg-emerald-500/10", txt: "text-emerald-300", label: "Active now" }
                  : du < 14          ? { dot: "bg-rose-500",    ring: "border-rose-500/40 bg-rose-500/10",       txt: "text-rose-300",    label: `${du}d` }
                  : du <= 30         ? { dot: "bg-amber-400",   ring: "border-amber-500/40 bg-amber-500/10",     txt: "text-amber-300",   label: `${du}d` }
                                     : { dot: "bg-emerald-500", ring: "border-emerald-500/30 bg-emerald-500/5",  txt: "text-emerald-300", label: `${du}d` };
                return (
                  <button
                    key={`${ev.name}-${ev.startDate.toISOString()}`}
                    onClick={() => setSelectedEvent(ev)}
                    className={`w-full text-left rounded-xl border ${band.ring} px-3 py-2.5 hover:brightness-110 transition-all`}
                    data-testid={`peak-event-${ev.name.replace(/\s+/g, "-").toLowerCase()}`}
                  >
                    <div className="flex items-center gap-3">
                      <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${band.dot}`} />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-foreground truncate">{ev.name}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {format(ev.startDate, "EEE d MMM yyyy")}
                          {ev.endDate.toDateString() !== ev.startDate.toDateString() && (
                            <span> – {format(ev.endDate, "d MMM")}</span>
                          )}
                          <span className="opacity-70"> · High transfer demand expected</span>
                        </div>
                      </div>
                      <div className={`text-base font-black leading-none flex-shrink-0 ${band.txt}`}>{band.label}</div>
                    </div>
                  </button>
                );
              })}
            </CardContent>
          </Card>
        );
      })()}

      {/* 2B — Gulf & Saudi School Holidays (Active now / countdown) */}
      {(() => {
        // Operator-spec: school holidays + Eids (Eid drives school closures too)
        const gulfHols = upcomingEvents
          .filter(e =>
            e.type === "school-holiday" ||
            (e.type === "gulf-holiday" && (e.name.startsWith("Eid") || e.name === "Ramadan Start"))
          )
          .slice(0, 6);
        // Country flags for the holiday card — Gulf school calendars track
        // closely across SA/UAE/KW/QA, so we surface the same flag strip on
        // each window rather than per-country variants.
        const flags = "🇸🇦 🇦🇪 🇰🇼 🇶🇦";
        return (
          <Card className="border-primary/10">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <CalendarDays className="w-4 h-4 text-primary" />
                Gulf School Holidays
                <span className="text-[10px] text-muted-foreground font-normal ml-auto">{flags}</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0 space-y-2">
              {gulfHols.length === 0 ? (
                <p className="text-xs text-muted-foreground">No upcoming Gulf school holidays.</p>
              ) : gulfHols.map(ev => {
                const startD = daysUntil(ev.startDate);
                const active = startD <= 0 && ev.endDate >= today;
                const endD   = Math.ceil((ev.endDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
                return (
                  <button
                    key={`${ev.name}-${ev.startDate.toISOString()}`}
                    onClick={() => setSelectedEvent(ev)}
                    className={`w-full text-left rounded-xl border px-3 py-2.5 transition-all hover:brightness-110 ${
                      active
                        ? "border-primary/60 bg-primary/10 shadow-[0_0_12px_rgba(201,168,76,0.2)]"
                        : "border-border/40 bg-muted/30"
                    }`}
                    data-testid={`gulf-holiday-${ev.name.replace(/\s+/g, "-").toLowerCase()}`}
                  >
                    <div className="flex items-center gap-3">
                      {active ? (
                        <span className="relative flex h-2.5 w-2.5 flex-shrink-0">
                          <span className="absolute inline-flex h-full w-full rounded-full bg-primary opacity-60 animate-ping" />
                          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-primary" />
                        </span>
                      ) : (
                        <span className="w-2.5 h-2.5 rounded-full bg-muted-foreground/50 flex-shrink-0" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className={`text-sm font-semibold truncate ${active ? "text-primary" : "text-foreground"}`}>
                          {ev.name}
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          {format(ev.startDate, "d MMM")} – {format(ev.endDate, "d MMM yyyy")}
                          {ev.approximate && <span className="ml-1 opacity-60">(approx.)</span>}
                        </div>
                      </div>
                      <div className={`text-xs font-bold leading-tight flex-shrink-0 text-right ${active ? "text-primary" : "text-muted-foreground"}`}>
                        {active
                          ? <>Active now<br/><span className="font-medium opacity-80">Ends in {endD}d</span></>
                          : <>Starts in<br/><span className="text-base">{startD}d</span></>}
                      </div>
                    </div>
                  </button>
                );
              })}
            </CardContent>
          </Card>
        );
      })()}

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
        <CardContent className="pt-0 space-y-3">
          {/* Countdown to most imminent event */}
          {nextEvent && (
            <button
              className="w-full text-left rounded-xl border border-primary/30 bg-primary/5 p-3 hover:border-primary/50 hover:bg-primary/8 transition-all"
              onClick={() => setSelectedEvent(nextEvent)}
            >
              <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Coming up next — tap for detail</div>
              <div className="text-base font-bold text-foreground">{nextEvent.name}</div>
              <div className="flex items-end justify-between mt-1">
                <div className="text-xs text-muted-foreground">
                  {format(nextEvent.startDate, "EEE d MMM yyyy")}
                  {nextEvent.approximate && <span className="ml-1 opacity-60">(approx.)</span>}
                </div>
                <div className="text-2xl font-black text-primary leading-none">
                  {daysUntil(nextEvent.startDate) <= 0 ? "Ongoing" : `${daysUntil(nextEvent.startDate)}d`}
                </div>
              </div>
            </button>
          )}

          {/* Filter chips (interactive) */}
          <div className="space-y-1.5">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Filter by type</div>
            <div className="flex flex-wrap gap-2">
              {(["gulf-holiday","gulf-national-day","london-peak","school-holiday"] as EventType[]).map(type => {
                const active = activeFilters.has(type);
                return (
                  <button
                    key={type}
                    onClick={() => toggleFilter(type)}
                    className={`text-[10px] px-2.5 py-1 rounded-full border font-semibold transition-all ${
                      active ? EVENT_TYPE_ACTIVE[type] : EVENT_TAG_STYLE[type] + " opacity-60 hover:opacity-100"
                    }`}
                  >
                    {active && <span className="mr-1">✓</span>}
                    {EVENT_TAG_LABEL[type]}
                  </button>
                );
              })}
              {activeFilters.size > 0 && (
                <button
                  onClick={() => { setActiveFilters(new Set()); setShowAllEvents(false); }}
                  className="text-[10px] px-2.5 py-1 rounded-full border border-border/60 text-muted-foreground hover:text-foreground transition-colors font-medium"
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          {/* Filtered event list */}
          {filteredEvents.length === 0 ? (
            <div className="text-xs text-muted-foreground py-4 text-center">No events match the selected filters.</div>
          ) : (
            <div className="space-y-2">
              {shownEvents.map((ev, i) => {
                const du = daysUntil(ev.startDate);
                const ongoing = du < 0;
                return (
                  <button
                    key={`${ev.name}-${i}`}
                    onClick={() => setSelectedEvent(ev)}
                    className="w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-xl bg-muted/30 border border-border/50 hover:border-primary/30 hover:bg-primary/5 transition-all"
                  >
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
                  </button>
                );
              })}

              {filteredEvents.length > 3 && (
                <button
                  onClick={() => setShowAllEvents(v => !v)}
                  className="w-full text-xs text-muted-foreground hover:text-foreground transition-colors py-1 select-none"
                >
                  {showAllEvents
                    ? "▲ Show fewer"
                    : `▼ Show all ${filteredEvents.length} upcoming events ▼`}
                </button>
              )}
            </div>
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
            Gulf Luxury Travel Demand
            {isSimulated && (
              <span className="ml-auto text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-normal">
                Seasonal estimate
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0 space-y-3">
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
                      tickFormatter={fmtWeekOf}
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
                      formatter={(v: any) => [v, "Demand Score"]}
                    />
                    <Line
                      type="monotone"
                      dataKey="score"
                      stroke="#C9A84C"
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 4, fill: "#C9A84C" }}
                    />
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
              <div className="flex items-center gap-4 text-[10px] text-muted-foreground flex-wrap">
                <div className="flex items-center gap-1.5">
                  <div className="w-4 h-0.5 bg-primary" />
                  <span>Gulf luxury chauffeur & London travel interest (0–100)</span>
                </div>
                {demandWeeks.length >= 4 && (
                  <div className="flex items-center gap-1.5">
                    <div className="w-4 h-0.5 border-t border-dashed border-muted-foreground" />
                    <span>4-week avg</span>
                  </div>
                )}
              </div>

              {/* Score badges */}
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
      {/* 4. NATIONALITY CHART                                                   */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      <Card className="border-primary/10">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Globe className="w-4 h-4 text-primary" />
            Client Nationality
            {clientsQuery.isLoading && <span className="text-[10px] text-muted-foreground font-normal ml-auto">Loading…</span>}
            {!clientsQuery.isLoading && (clientsQuery.data?.length ?? 0) > 0 && (
              <span className="text-[10px] text-muted-foreground font-normal ml-auto">{clientsQuery.data!.length} clients</span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0 space-y-3">
          {clientsQuery.isLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : clientsQuery.isError ? (
            <p className="text-xs text-destructive">Failed to load client data.</p>
          ) : natStats.length === 0 ? (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                No nationality data detected yet.
                {(clientsQuery.data?.length ?? 0) > 0
                  ? ` Found ${clientsQuery.data!.length} client${clientsQuery.data!.length !== 1 ? "s" : ""} — add phone numbers with country codes (e.g. +971, +966, +44) or fill in the Nationality field to see this chart.`
                  : " Add clients with phone numbers or nationality to see this chart."}
              </p>
            </div>
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
                  <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    <div className="text-2xl font-black text-foreground">{totalNatClients}</div>
                    <div className="text-[10px] text-muted-foreground">clients</div>
                  </div>
                </div>
              </div>

              {/* Nationality list */}
              <div className="space-y-1.5">
                {natStats.map((n, i) => (
                  <button
                    key={n.country}
                    onClick={() => navigate(`/clients?nationality=${encodeURIComponent(n.country)}`)}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl bg-muted/30 border border-border/40 hover:border-primary/30 hover:bg-primary/5 transition-all text-left"
                  >
                    <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: NAT_COLORS[i % NAT_COLORS.length] }} />
                    <span className="text-base leading-none flex-shrink-0">{n.flag}</span>
                    <span className="text-sm font-semibold text-foreground flex-1">{n.country}</span>
                    <span className="text-xs text-muted-foreground flex-shrink-0">{n.count} client{n.count !== 1 ? "s" : ""}</span>
                    {n.revenue > 0 && (
                      <span className="text-sm font-bold text-primary flex-shrink-0">£{n.revenue.toLocaleString()}</span>
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
      {/* 5. TOP CLIENTS                                                         */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {bkLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : topClients.length > 0 && (
        <Card className="border-primary/10">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Top Clients — {selectedYear}</CardTitle>
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
      {/* 6. LOST LEADS — why cancellations happened                             */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      <Card className="border-primary/10" data-testid="card-lost-leads">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <XCircle className="w-4 h-4 text-primary" />
            Lost Leads — Why
            {!lostLeadStats.isLoading && lostLeadStats.data && (
              <span className="ml-auto text-[10px] text-muted-foreground font-normal">
                {lostLeadStats.data.total_all} cancelled
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0 space-y-3">
          {/* Period toggle */}
          <div className="flex flex-wrap gap-1.5">
            {([
              ["this_month", "This month"],
              ["last_30",    "Last 30 days"],
              ["this_year",  "This year"],
              ["all",        "All time"],
            ] as [LostLeadPeriod, string][]).map(([val, label]) => (
              <button
                key={val}
                onClick={() => setLostLeadPeriod(val)}
                className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-all ${
                  lostLeadPeriod === val
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-muted/30 text-muted-foreground border-border/60 hover:text-foreground hover:border-primary/40"
                }`}
                data-testid={`button-lostlead-period-${val}`}
              >
                {label}
              </button>
            ))}
          </div>

          {lostLeadStats.isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : lostLeadStats.isError ? (
            <p className="text-xs text-destructive">Failed to load lost-lead stats.</p>
          ) : !lostLeadStats.data || lostLeadStats.data.rows.length === 0 ? (
            <div className="rounded-xl border border-border/40 bg-muted/20 p-4 text-center">
              <p className="text-xs text-muted-foreground">
                No cancellations in this window — nothing lost yet.
              </p>
            </div>
          ) : (
            <>
              {/* Source-split summary */}
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg bg-muted/30 border border-border/40 px-3 py-2">
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wider">From requests</div>
                  <div className="text-lg font-bold text-foreground mt-0.5">{lostLeadStats.data.total_request}</div>
                </div>
                <div className="rounded-lg bg-muted/30 border border-border/40 px-3 py-2">
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wider">From follow-ups</div>
                  <div className="text-lg font-bold text-foreground mt-0.5">{lostLeadStats.data.total_follow_up}</div>
                </div>
              </div>

              {/* Horizontal bar chart — taller when more reasons */}
              <div style={{ height: Math.max(140, lostLeadStats.data.rows.length * 32 + 20) }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={lostLeadStats.data.rows}
                    layout="vertical"
                    margin={{ top: 4, right: 16, left: 0, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" horizontal={false} />
                    <XAxis
                      type="number"
                      tick={{ fontSize: 10, fill: "#9CA3AF" }}
                      tickLine={false}
                      axisLine={false}
                      allowDecimals={false}
                    />
                    <YAxis
                      type="category"
                      dataKey="reason"
                      tick={{ fontSize: 11, fill: "#E5E7EB" }}
                      tickLine={false}
                      axisLine={false}
                      width={130}
                    />
                    <RechartsTip
                      cursor={{ fill: "rgba(201,168,76,0.06)" }}
                      contentStyle={{ background: "#1a1a1a", border: "1px solid rgba(201,168,76,0.2)", borderRadius: 8, fontSize: 11 }}
                      formatter={(_v: any, _n: any, p: any) => {
                        const r = p.payload;
                        return [
                          `${r.total} (${r.request_count} req · ${r.follow_up_count} f/u)`,
                          "Cancelled",
                        ];
                      }}
                    />
                    <Bar dataKey="total" fill="#C9A84C" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Tap-to-drill list — mobile-friendly alternative to clicking thin bars.
                   Note for operators: opens the cancelled *requests* list only —
                   it is not filtered down to the specific reason yet. */}
              <div className="space-y-1">
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider">
                  Tap a row to open all cancelled requests
                </div>
                {lostLeadStats.data.rows.map((r) => (
                  <button
                    key={r.reason}
                    onClick={() => navigate("/requests?status=Cancelled")}
                    className="w-full flex items-center gap-3 px-3 py-2 rounded-lg bg-muted/20 border border-border/40 hover:border-primary/30 hover:bg-primary/5 transition-all text-left"
                    data-testid={`button-lostlead-row-${r.reason.replace(/\s+/g,"-").toLowerCase()}`}
                  >
                    <span className="text-sm font-medium text-foreground flex-1 truncate">{r.reason}</span>
                    <span className="text-[10px] text-muted-foreground flex-shrink-0">
                      {r.request_count} req · {r.follow_up_count} f/u
                    </span>
                    <span className="text-sm font-bold text-primary w-7 text-right flex-shrink-0">{r.total}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* ─── REVENUE & FORECAST (moved to bottom) ────────────────────────────  */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-border/60" />
        <div className="flex items-center gap-2 px-2">
          <TrendingUp className="w-3.5 h-3.5 text-primary" />
          <span className="text-xs font-semibold text-primary uppercase tracking-widest">Revenue & Forecast</span>
        </div>
        <div className="h-px flex-1 bg-border/60" />
      </div>

      {/* Monthly Revenue Bar Chart */}
      {!bkLoading && filledMonths.length > 0 && (
        <Card className="border-primary/10">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-primary" />
              Monthly Revenue — {selectedYear}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlyData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey="month" tick={{ fontSize: 10, fill: "#9CA3AF" }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: "#9CA3AF" }} tickLine={false} axisLine={false} tickFormatter={v => `£${(v/1000).toFixed(0)}k`} />
                  <RechartsTip
                    contentStyle={{ background: "#1a1a1a", border: "1px solid rgba(201,168,76,0.2)", borderRadius: 8, fontSize: 11 }}
                    formatter={(v: any) => [`£${Number(v).toLocaleString()}`, "Revenue"]}
                  />
                  <Bar dataKey="revenue" fill="#C9A84C" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Revenue Forecast */}
      <Card className="border-primary/20" data-testid="card-revenue-forecast">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-primary" />
            Revenue Forecast — Next 30 Days
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0 space-y-3">
          {forecastQuery.isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : forecastQuery.isError || !forecast ? (
            <div className="text-xs text-destructive">Failed to load forecast.</div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-primary/20 bg-primary/5 p-3" data-testid="text-forecast-7d">
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
                <div className="rounded-xl border border-primary/20 bg-primary/5 p-3" data-testid="text-forecast-30d">
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
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Day by Day</div>
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

      {/* ── Event Detail Sheet ────────────────────────────────────────────────── */}
      <EventDetailSheet
        event={selectedEvent}
        onClose={() => setSelectedEvent(null)}
        daysUntil={daysUntil}
      />

    </div>
  );
}
