import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { parseISO, format } from "date-fns";
import { useLocation } from "wouter";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  TrendingUp, Globe, CalendarDays, Activity, AlertTriangle, Users, X, Info,
  XCircle, ChevronDown, MessageCircle, Clock, Repeat, ArrowUp, ArrowDown,
  BarChart3, Building2, Route as RouteIcon, Car, Flame, Ban, Hourglass, RotateCcw,
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

// ── Section 4 address-normalisation helpers ────────────────────────────────
// Heuristic hotel detection from free-form pickup/dropoff text. We bucket by
// the first comma-separated segment, lowercased, with common noise stripped.
// "Hotel-like" means it either contains the word "hotel" / "residence" /
// "suites" / "the X", or matches a small known-luxury list. Everything else
// (airports, postcodes, generic addresses) is excluded from Top Hotels but
// still used as-is in Top Routes.
const KNOWN_HOTELS_RE = /\b(claridge'?s?|the savoy|the ritz|the dorchester|the connaught|the langham|the berkeley|corinthia|peninsula|four seasons|mandarin|shangri.?la|bvlgari|aman|raffles|st\.? regis|nobu|chiltern|edition|park lane|grosvenor|45 park lane|biltmore|rosewood|kimpton|ham yard|soho hotel|the lanesborough|the ned|nh london|sofitel|bulgari)\b/i;

function bucketKeyForAddress(raw: string | null | undefined): { key: string; display: string } | null {
  if (!raw || typeof raw !== "string") return null;
  const head = raw.split(",")[0]
    .replace(/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d?[A-Z]{0,2}\b/gi, "") // UK postcode
    .replace(/\b(suite|room|apt|apartment|no\.?)\s*\d+\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  if (head.length < 2) return null;
  const key = head.toLowerCase()
    .replace(/^the\s+/, "")
    .replace(/'s\b/g, "s")
    .replace(/[.,]/g, "")
    .replace(/\s+hotel$/, "")
    .trim();
  return { key, display: head };
}
function isHotelLikeAddress(raw: string | null | undefined): boolean {
  if (!raw || typeof raw !== "string") return false;
  if (KNOWN_HOTELS_RE.test(raw)) return true;
  return /\b(hotel|hôtel|residence|suites?|the\s+[A-Z])/i.test(raw);
}

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

  const [selectedEvent, setSelectedEvent] = useState<CalEvent | null>(null);

  // Section 3 Client Intelligence UI state
  const [natSortMode, setNatSortMode] = useState<"clients" | "avg">("clients");
  const [expandedNat, setExpandedNat] = useState<string | null>(null);
  const [repeatPeriod, setRepeatPeriod] = useState<"this_month" | "last_30" | "this_year">("this_month");

  // Section 4 Business Performance UI state
  const [serviceBreakPeriod, setServiceBreakPeriod] = useState<"this_month" | "this_year" | "all_time">("this_year");
  const [heatmapPeriod,      setHeatmapPeriod]      = useState<"this_month" | "last_90" | "this_year">("this_year");
  const [vehicleNatFilter,   setVehicleNatFilter]   = useState<string>(""); // "" = all
  const [showCxnByNat,       setShowCxnByNat]       = useState<boolean>(false);

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

  // ── Lifetime completed bookings (rich) ─────────────────────────────────────
  // Returns one row per Completed booking (post-STATS_CUTOFF). All Section 3
  // Client Intelligence features derive from this single query: per-client
  // totals, per-nationality avg booking value (3A), per-nationality service
  // breakdown (3B), repeat-vs-new ratio (3C), dormant detection (3D).
  // We also include any bookings WITHOUT a date_time (e.g. legacy data with
  // null date) for the dormant calc.
  const completedBookingsQuery = useQuery<Array<{ client_id: string | null; price: number | null; additional_charges: number | null; date_time: string | null; service_type: string | null }>>({
    queryKey: ["intel-completed-bookings-detail"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bookings")
        .select("client_id, price, additional_charges, date_time, service_type")
        .eq("status", "Completed")
        .gte("date_time", STATS_CUTOFF_ISO);
      if (error) throw error;
      return (data ?? []) as any;
    },
    staleTime: 10 * 60 * 1000,
  });
  const completedBookings = completedBookingsQuery.data ?? [];

  // Future-dated bookings (any non-cancelled status) — used by 3D Dormant
  // calc to exclude clients with upcoming activity. Year-INDEPENDENT so the
  // year toggle doesn't change who counts as dormant.
  const futureBookingsQuery = useQuery<Array<{ client_id: string | null; date_time: string | null }>>({
    queryKey: ["intel-future-bookings"],
    queryFn: async () => {
      const nowIso = new Date().toISOString();
      const { data, error } = await supabase
        .from("bookings")
        .select("client_id, date_time")
        .gt("date_time", nowIso)
        .not("status", "eq", "Cancelled");
      if (error) throw error;
      return (data ?? []) as any;
    },
    staleTime: 5 * 60 * 1000,
  });
  const futureBookings = futureBookingsQuery.data ?? [];

  // ── Section 4: rich all-status bookings dataset ────────────────────────────
  // ALL bookings since STATS_CUTOFF_ISO (no status filter — includes Cancelled
  // and No Show so 4F can compute ratios). Powers 4A–4H without extra queries.
  const businessBookingsQuery = useQuery<Array<{
    id: string;
    status: string | null;
    service_type: string | null;
    price: number | null;
    additional_charges: number | null;
    date_time: string | null;
    created_at: string | null;
    client_id: string | null;
    pickup: string | null;
    dropoff: string | null;
    vehicle_type: string | null;
    driver_id: string | null;
  }>>({
    queryKey: ["intel-business-bookings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bookings")
        .select("id, status, service_type, price, additional_charges, date_time, created_at, client_id, pickup, dropoff, vehicle_type, driver_id")
        .gte("date_time", STATS_CUTOFF_ISO);
      if (error) throw error;
      return (data ?? []) as any;
    },
    staleTime: 10 * 60 * 1000,
  });
  const businessBookings = businessBookingsQuery.data ?? [];

  // Drivers list for 4I Driver Utilisation
  const driversQuery = useQuery<Array<{ id: string; name: string | null }>>({
    queryKey: ["intel-drivers"],
    queryFn: async () => {
      const { data, error } = await supabase.from("drivers").select("id, name");
      if (error) throw error;
      return (data ?? []) as any;
    },
    staleTime: 10 * 60 * 1000,
  });

  // Per-client lifetime aggregates derived from the rich query
  const lifetimeRevByClient: Record<string, number> = {};
  const lifetimeCountByClient: Record<string, number> = {};
  const firstBookingByClient: Record<string, Date> = {};
  const lastBookingByClient: Record<string, Date> = {};
  // serviceByClient[clientId][serviceType] = { count, total }
  const serviceByClient: Record<string, Record<string, { count: number; total: number }>> = {};
  completedBookings.forEach(b => {
    const id = b.client_id;
    if (!id) return;
    const value = (Number(b.price) || 0) + (Number(b.additional_charges) || 0);
    lifetimeRevByClient[id] = (lifetimeRevByClient[id] ?? 0) + value;
    lifetimeCountByClient[id] = (lifetimeCountByClient[id] ?? 0) + 1;
    if (b.date_time) {
      const d = new Date(b.date_time);
      if (!isNaN(d.getTime())) {
        if (!firstBookingByClient[id] || d < firstBookingByClient[id]) firstBookingByClient[id] = d;
        if (!lastBookingByClient[id]  || d > lastBookingByClient[id])  lastBookingByClient[id]  = d;
      }
    }
    const svc = b.service_type || "Other";
    serviceByClient[id] ??= {};
    serviceByClient[id][svc] ??= { count: 0, total: 0 };
    serviceByClient[id][svc].count += 1;
    serviceByClient[id][svc].total += value;
  });

  // ── Nationality stats (Sections 3A + 3B) ───────────────────────────────────
  // Per-country aggregates: client count, revenue, booking count, avg value,
  // and a service-type breakdown for the expandable 3B view.
  type NatRollup = {
    flag: string; country: string;
    ids: Set<string>;
    revenue: number;
    bookings: number;
    services: Record<string, { count: number; total: number }>;
  };
  const natMap: Record<string, NatRollup> = {};
  (clientsQuery.data ?? []).forEach(cl => {
    const { flag, country } = detectNat(null, cl.whatsapp, cl.nationality);
    natMap[country] ??= { flag, country, ids: new Set(), revenue: 0, bookings: 0, services: {} };
    const n = natMap[country];
    n.ids.add(cl.id);
    n.revenue  += lifetimeRevByClient[cl.id] ?? 0;
    n.bookings += lifetimeCountByClient[cl.id] ?? 0;
    const svcs = serviceByClient[cl.id];
    if (svcs) {
      for (const [svc, agg] of Object.entries(svcs)) {
        n.services[svc] ??= { count: 0, total: 0 };
        n.services[svc].count += agg.count;
        n.services[svc].total += agg.total;
      }
    }
  });
  const natStats = Object.values(natMap)
    .filter(n => n.ids.size > 0)
    .sort((a, b) => b.revenue - a.revenue)
    .map(n => ({
      flag: n.flag,
      country: n.country,
      count: n.ids.size,
      revenue: n.revenue,
      bookings: n.bookings,
      avgBooking: n.bookings > 0 ? n.revenue / n.bookings : null,
      services: Object.entries(n.services)
        .map(([service, v]) => ({ service, count: v.count, total: v.total }))
        .sort((a, b) => b.total - a.total),
    }));

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

  // Sorted view for the nationality list (3A "By clients" / "By avg value").
  // Avg-value sort puts nationalities with no completed bookings (avgBooking=null)
  // at the bottom so the leaderboard isn't polluted by "—" rows.
  const natStatsSorted = [...natStats].sort((a, b) => {
    if (natSortMode === "avg") {
      const av = a.avgBooking ?? -1;
      const bv = b.avgBooking ?? -1;
      return bv - av;
    }
    return b.count - a.count;
  });

  // ── 3C: Repeat vs New client ratio ─────────────────────────────────────────
  // For the selected period, a client is COUNTED once (their newest booking in
  // the period). They are NEW if they have no completed booking before this
  // period; REPEAT if they have at least one earlier completed booking.
  const repeatVsNew = (() => {
    const now = new Date();
    let periodStart: Date;
    if (repeatPeriod === "this_month") {
      periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
    } else if (repeatPeriod === "last_30") {
      periodStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    } else {
      periodStart = new Date(now.getFullYear(), 0, 1);
    }
    // Previous period of equal length for trend arrow
    const periodMs = now.getTime() - periodStart.getTime();
    const prevStart = new Date(periodStart.getTime() - periodMs);
    const prevEnd = periodStart;

    const clientsInPeriod = new Set<string>();
    const clientsInPrev   = new Set<string>();
    let newCount = 0, repeatCount = 0;
    let prevNew = 0, prevRepeat = 0;

    completedBookings.forEach(b => {
      if (!b.client_id || !b.date_time) return;
      const d = new Date(b.date_time);
      if (isNaN(d.getTime())) return;
      const first = firstBookingByClient[b.client_id];
      if (d >= periodStart && d <= now && !clientsInPeriod.has(b.client_id)) {
        clientsInPeriod.add(b.client_id);
        if (first && first < periodStart) repeatCount += 1; else newCount += 1;
      }
      if (d >= prevStart && d < prevEnd && !clientsInPrev.has(b.client_id)) {
        clientsInPrev.add(b.client_id);
        if (first && first < prevStart) prevRepeat += 1; else prevNew += 1;
      }
    });
    const total = newCount + repeatCount;
    const prevTotal = prevNew + prevRepeat;
    const trend = prevTotal === 0 ? null : ((total - prevTotal) / prevTotal) * 100;
    return { newCount, repeatCount, total, prevTotal, trend };
  })();

  // ── 3D: Dormant clients (no activity in 60+ days) ──────────────────────────
  // A client is dormant when:
  //  - they have at least one completed booking, AND
  //  - their most recent completed booking is more than 60 days before today,
  //    AND
  //  - they have no future booking of any status (excluded so we don't pester
  //    clients who are actively booked).
  const dormantClients = (() => {
    const now = new Date();
    const cutoff = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
    const futureBookers = new Set<string>();
    futureBookings.forEach(b => {
      if (b.client_id) futureBookers.add(b.client_id);
    });
    type Dormant = {
      id: string; name: string; nationality: { flag: string; country: string };
      lastBooking: Date; daysSince: number; lifetimeSpend: number;
    };
    const out: Dormant[] = [];
    (clientsQuery.data ?? []).forEach(cl => {
      const last = lastBookingByClient[cl.id];
      if (!last) return;
      if (last >= cutoff) return;
      if (futureBookers.has(cl.id)) return;
      const daysSince = Math.floor((now.getTime() - last.getTime()) / (24 * 60 * 60 * 1000));
      out.push({
        id: cl.id,
        name: cl.name,
        nationality: detectNat(null, cl.whatsapp, cl.nationality),
        lastBooking: last,
        daysSince,
        lifetimeSpend: lifetimeRevByClient[cl.id] ?? 0,
      });
    });
    return out.sort((a, b) => b.daysSince - a.daysSince);
  })();

  // Build a WhatsApp deep link from a stored phone number. Strips +, spaces,
  // dashes; opens an empty chat (no pre-written message per spec).
  const whatsappLink = (whatsapp: string | null): string | null => {
    if (!whatsapp) return null;
    const digits = whatsapp.replace(/[^\d]/g, "");
    if (!digits) return null;
    return `https://wa.me/${digits}`;
  };

  // ── Section 4 helpers: nationality lookup per client ──────────────────────
  const natByClient = useMemo(() => {
    const m: Record<string, { flag: string; country: string }> = {};
    (clientsQuery.data ?? []).forEach(cl => {
      m[cl.id] = detectNat(null, cl.whatsapp, cl.nationality);
    });
    return m;
  }, [clientsQuery.data]);

  // ── 4A: Top Hotels (pickup OR dropoff appearances) ────────────────────────
  const topHotels = useMemo(() => {
    type Bucket = { display: string; count: number; revenue: number };
    const buckets: Record<string, Bucket> = {};
    businessBookings.forEach(b => {
      if (b.status === "Cancelled") return;
      const value = (Number(b.price) || 0) + (Number(b.additional_charges) || 0);
      const seenKeys = new Set<string>();
      for (const addr of [b.pickup, b.dropoff]) {
        if (!isHotelLikeAddress(addr)) continue;
        const bk = bucketKeyForAddress(addr);
        if (!bk) continue;
        if (seenKeys.has(bk.key)) continue; // don't double-count if same hotel both ends
        seenKeys.add(bk.key);
        buckets[bk.key] ??= { display: bk.display, count: 0, revenue: 0 };
        buckets[bk.key].count += 1;
        buckets[bk.key].revenue += value;
      }
    });
    return Object.values(buckets)
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }, [businessBookings]);

  // ── 4B: Top Routes (directional pickup → dropoff) ─────────────────────────
  const topRoutes = useMemo(() => {
    type Bucket = { from: string; to: string; count: number; total: number };
    const buckets: Record<string, Bucket> = {};
    businessBookings.forEach(b => {
      if (b.status === "Cancelled") return;
      const fromKey = bucketKeyForAddress(b.pickup);
      const toKey   = bucketKeyForAddress(b.dropoff);
      if (!fromKey || !toKey) return;
      const key = `${fromKey.key}→${toKey.key}`;
      const value = (Number(b.price) || 0) + (Number(b.additional_charges) || 0);
      buckets[key] ??= { from: fromKey.display, to: toKey.display, count: 0, total: 0 };
      buckets[key].count += 1;
      buckets[key].total += value;
    });
    return Object.values(buckets)
      .map(r => ({ ...r, avg: r.count > 0 ? r.total / r.count : 0 }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }, [businessBookings]);

  // ── Period helper for 4C / 4E ─────────────────────────────────────────────
  function periodStart(p: "this_month" | "last_30" | "last_90" | "this_year" | "all_time"): Date | null {
    const now = new Date();
    if (p === "this_month") return new Date(now.getFullYear(), now.getMonth(), 1);
    if (p === "last_30")    return new Date(now.getTime() - 30 * 86400_000);
    if (p === "last_90")    return new Date(now.getTime() - 90 * 86400_000);
    if (p === "this_year")  return new Date(now.getFullYear(), 0, 1);
    return null; // all_time
  }

  // ── 4C: Service Breakdown (revenue + bookings split by service_type) ──────
  const serviceBreakdown = useMemo(() => {
    const start = periodStart(serviceBreakPeriod);
    type Bucket = { service: string; count: number; revenue: number };
    const buckets: Record<string, Bucket> = {};
    let total = 0;
    businessBookings.forEach(b => {
      if (b.status !== "Completed") return;
      if (!b.date_time) return;
      const d = new Date(b.date_time);
      if (start && d < start) return;
      const value = (Number(b.price) || 0) + (Number(b.additional_charges) || 0);
      const svc = b.service_type || "Other";
      buckets[svc] ??= { service: svc, count: 0, revenue: 0 };
      buckets[svc].count += 1;
      buckets[svc].revenue += value;
      total += value;
    });
    const rows = Object.values(buckets)
      .map(b => ({ ...b, pct: total > 0 ? (b.revenue / total) * 100 : 0 }))
      .sort((a, b) => b.revenue - a.revenue);
    return { rows, total };
  }, [businessBookings, serviceBreakPeriod]);

  // ── 4D: Vehicle Type Demand (optional nationality filter) ─────────────────
  const vehicleDemand = useMemo(() => {
    const buckets: Record<string, number> = {};
    let total = 0;
    businessBookings.forEach(b => {
      if (b.status === "Cancelled") return;
      if (!b.vehicle_type) return;
      if (vehicleNatFilter) {
        if (!b.client_id) return;
        if (natByClient[b.client_id]?.country !== vehicleNatFilter) return;
      }
      buckets[b.vehicle_type] = (buckets[b.vehicle_type] ?? 0) + 1;
      total += 1;
    });
    const rows = Object.entries(buckets)
      .map(([vehicle, count]) => ({ vehicle, count, pct: total > 0 ? (count / total) * 100 : 0 }))
      .sort((a, b) => b.count - a.count);
    return { rows, total };
  }, [businessBookings, vehicleNatFilter, natByClient]);

  // Distinct list of nationalities present in bookings (for 4D filter dropdown)
  const bookingNationalities = useMemo(() => {
    const s = new Set<string>();
    businessBookings.forEach(b => {
      if (b.client_id && natByClient[b.client_id]) s.add(natByClient[b.client_id].country);
    });
    return [...s].sort();
  }, [businessBookings, natByClient]);

  // ── 4E: Peak Days & Hours Heatmap (day-of-week × hour, by job date_time) ──
  const heatmap = useMemo(() => {
    const start = periodStart(heatmapPeriod);
    // grid[day][hour] where day=0 is Monday
    const grid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
    const hourTotals: number[] = Array(24).fill(0);
    let max = 0;
    businessBookings.forEach(b => {
      if (b.status === "Cancelled") return;
      if (!b.date_time) return;
      const d = new Date(b.date_time);
      if (start && d < start) return;
      // Convert JS getDay (0=Sun..6=Sat) to Mon-first (0=Mon..6=Sun)
      const day = (d.getDay() + 6) % 7;
      const hour = d.getHours();
      grid[day][hour] += 1;
      hourTotals[hour] += 1;
      if (grid[day][hour] > max) max = grid[day][hour];
    });
    // Top 3 peak hours by total bookings across all days
    const peakHours = hourTotals
      .map((count, hour) => ({ hour, count }))
      .filter(x => x.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 3);
    const totalBookingsInPeriod = grid.flat().reduce((s, v) => s + v, 0);
    return { grid, max, peakHours, total: totalBookingsInPeriod };
  }, [businessBookings, heatmapPeriod]);

  // ── 4F: Cancellation & No-Show rates ──────────────────────────────────────
  const cancelStats = useMemo(() => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const calc = (start: Date, end: Date) => {
      let total = 0, cancelled = 0, noShow = 0;
      const byNat: Record<string, { total: number; cancelled: number; noShow: number; flag: string }> = {};
      businessBookings.forEach(b => {
        if (!b.date_time) return;
        const d = new Date(b.date_time);
        if (d < start || d >= end) return;
        if (d > now) return; // exclude future bookings from denominator
        total += 1;
        if (b.status === "Cancelled") cancelled += 1;
        if (b.status === "No Show")   noShow    += 1;
        if (b.client_id && natByClient[b.client_id]) {
          const nat = natByClient[b.client_id];
          byNat[nat.country] ??= { total: 0, cancelled: 0, noShow: 0, flag: nat.flag };
          byNat[nat.country].total += 1;
          if (b.status === "Cancelled") byNat[nat.country].cancelled += 1;
          if (b.status === "No Show")   byNat[nat.country].noShow    += 1;
        }
      });
      return { total, cancelled, noShow, byNat };
    };
    const cur  = calc(monthStart, now);
    const prev = calc(lastMonthStart, monthStart);
    const cancelRate = cur.total > 0 ? (cur.cancelled / cur.total) * 100 : 0;
    const noShowRate = cur.total > 0 ? (cur.noShow    / cur.total) * 100 : 0;
    const prevCancelRate = prev.total > 0 ? (prev.cancelled / prev.total) * 100 : 0;
    const prevNoShowRate = prev.total > 0 ? (prev.noShow    / prev.total) * 100 : 0;
    // Suppress trend pts if the previous-month window starts before our data
    // cutoff — partial baseline would produce misleading deltas.
    const cutoff = new Date(STATS_CUTOFF_ISO);
    const trendValid = lastMonthStart >= cutoff;
    const byNatRows = Object.entries(cur.byNat)
      .map(([country, v]) => ({
        country,
        flag: v.flag,
        total: v.total,
        cancelRate: v.total > 0 ? (v.cancelled / v.total) * 100 : 0,
        noShowRate: v.total > 0 ? (v.noShow / v.total) * 100 : 0,
      }))
      .sort((a, b) => b.cancelRate - a.cancelRate);
    return {
      cancelRate, noShowRate,
      cancelTrend: trendValid ? cancelRate - prevCancelRate : null,
      noShowTrend: trendValid ? noShowRate - prevNoShowRate : null,
      total: cur.total, cancelled: cur.cancelled, noShow: cur.noShow,
      byNat: byNatRows,
    };
  }, [businessBookings, natByClient]);

  // ── 4G: Booking Lead Time (created_at → date_time, in days) ──────────────
  const leadTime = useMemo(() => {
    type Acc = { sum: number; count: number };
    const overall: Acc = { sum: 0, count: 0 };
    const byNat:  Record<string, Acc & { flag: string }> = {};
    const byServ: Record<string, Acc> = {};
    businessBookings.forEach(b => {
      if (!b.created_at || !b.date_time) return;
      if (b.status === "Cancelled") return;
      const created = new Date(b.created_at);
      const job     = new Date(b.date_time);
      if (isNaN(created.getTime()) || isNaN(job.getTime())) return;
      const days = Math.max(0, Math.round((job.getTime() - created.getTime()) / 86400_000));
      overall.sum += days; overall.count += 1;
      if (b.client_id && natByClient[b.client_id]) {
        const nat = natByClient[b.client_id];
        byNat[nat.country] ??= { sum: 0, count: 0, flag: nat.flag };
        byNat[nat.country].sum += days; byNat[nat.country].count += 1;
      }
      const svc = b.service_type || "Other";
      byServ[svc] ??= { sum: 0, count: 0 };
      byServ[svc].sum += days; byServ[svc].count += 1;
    });
    const fmt = (a: Acc) => a.count > 0 ? a.sum / a.count : null;
    return {
      overall: fmt(overall),
      byNat: Object.entries(byNat)
        .map(([country, v]) => ({ country, flag: v.flag, avg: v.sum / v.count, count: v.count }))
        .sort((a, b) => b.count - a.count),
      byService: Object.entries(byServ)
        .map(([service, v]) => ({ service, avg: v.sum / v.count, count: v.count }))
        .sort((a, b) => b.count - a.count),
    };
  }, [businessBookings, natByClient]);

  // ── 4H: Repeat Booking Frequency (avg gap between bookings) ───────────────
  const repeatFreq = useMemo(() => {
    // Group completed bookings by client, sort dates ASC, compute gaps.
    const datesByClient: Record<string, number[]> = {};
    businessBookings.forEach(b => {
      if (b.status !== "Completed") return;
      if (!b.client_id || !b.date_time) return;
      const t = new Date(b.date_time).getTime();
      if (isNaN(t)) return;
      datesByClient[b.client_id] ??= [];
      datesByClient[b.client_id].push(t);
    });
    let totalGapSum = 0, totalGapCount = 0;
    const perClientAvg: Record<string, number> = {};
    Object.entries(datesByClient).forEach(([id, dates]) => {
      if (dates.length < 2) return;
      dates.sort((a, b) => a - b);
      let sum = 0;
      for (let i = 1; i < dates.length; i++) sum += (dates[i] - dates[i - 1]) / 86400_000;
      const gaps = dates.length - 1;
      perClientAvg[id] = sum / gaps;
      totalGapSum += sum;
      totalGapCount += gaps;
    });
    const overall = totalGapCount > 0 ? totalGapSum / totalGapCount : null;

    // By nationality (only countries with 2+ qualifying clients)
    const byNatAcc: Record<string, { sum: number; count: number; clients: number; flag: string }> = {};
    Object.entries(perClientAvg).forEach(([id, avg]) => {
      const nat = natByClient[id];
      if (!nat) return;
      byNatAcc[nat.country] ??= { sum: 0, count: 0, clients: 0, flag: nat.flag };
      byNatAcc[nat.country].sum += avg;
      byNatAcc[nat.country].count += 1;
      byNatAcc[nat.country].clients += 1;
    });
    const byNat = Object.entries(byNatAcc)
      .map(([country, v]) => ({
        country, flag: v.flag, clients: v.clients,
        avg: v.count > 0 ? v.sum / v.count : null,
        insufficient: v.clients < 2,
      }))
      .sort((a, b) => (a.avg ?? Infinity) - (b.avg ?? Infinity));

    // High-Frequency clients: per-client avg gap < overall * 0.6
    const highFreq = overall !== null
      ? Object.entries(perClientAvg)
          .filter(([_, avg]) => avg < overall * 0.6)
          .map(([id, avg]) => ({
            id,
            name: (clientsQuery.data ?? []).find(c => c.id === id)?.name ?? "Unknown",
            avg,
          }))
          .sort((a, b) => a.avg - b.avg)
          .slice(0, 5)
      : [];

    return { overall, byNat, highFreq };
  }, [businessBookings, natByClient, clientsQuery.data]);

  // ── 4I: Driver Utilisation (this calendar month vs last calendar month) ──
  const driverUtilisation = useMemo(() => {
    const now = new Date();
    const monthStart     = new Date(now.getFullYear(), now.getMonth(),     1);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const drivers = driversQuery.data ?? [];
    type Row = { id: string; name: string; thisMonth: number; lastMonth: number };
    const rows: Row[] = drivers.map(d => ({
      id: d.id,
      name: d.name ?? "Unnamed driver",
      thisMonth: 0,
      lastMonth: 0,
    }));
    const byId: Record<string, Row> = {};
    rows.forEach(r => { byId[r.id] = r; });
    businessBookings.forEach(b => {
      if (!b.driver_id || !b.date_time) return;
      if (b.status === "Cancelled") return;
      const r = byId[b.driver_id];
      if (!r) return;
      const d = new Date(b.date_time);
      if (d >= monthStart && d < new Date(now.getFullYear(), now.getMonth() + 1, 1)) {
        r.thisMonth += 1;
      } else if (d >= lastMonthStart && d < monthStart) {
        r.lastMonth += 1;
      }
    });
    rows.sort((a, b) => b.thisMonth - a.thisMonth);
    const maxThis = rows[0]?.thisMonth ?? 0;
    return {
      rows,
      maxThis,
      // honest baseline: only show last-month numbers when the previous
      // window starts at/after the data cutoff
      lastMonthValid: lastMonthStart >= new Date(STATS_CUTOFF_ISO),
    };
  }, [businessBookings, driversQuery.data]);
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

  const nextEvent    = upcomingEvents[0];
  const topNat       = natStats[0];

  const daysUntil = (d: Date) => {
    const diff = d.getTime() - today.getTime();
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  };

  const holidayAlert = upcomingEvents.find(e => {
    const d = daysUntil(e.startDate);
    return (e.type === "gulf-holiday" || e.type === "gulf-national-day") && d >= 0 && d <= 14;
  });

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

      {/* ── Gulf Luxury Travel Demand (moved under Market Signals) ────────────── */}
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
      {/* 4. NATIONALITY CHART (3A avg booking + 3B service breakdown)           */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      <Card className="border-primary/10" data-testid="card-nationality">
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

              {/* 3A — Sort toggle */}
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span>Sort by</span>
                <div className="flex rounded-lg border border-border/60 overflow-hidden">
                  {(["clients", "avg"] as const).map(mode => (
                    <button
                      key={mode}
                      onClick={() => setNatSortMode(mode)}
                      data-testid={`nat-sort-${mode}`}
                      className={`px-2.5 py-1 transition-colors ${
                        natSortMode === mode
                          ? "bg-primary/15 text-primary font-semibold"
                          : "text-muted-foreground hover:bg-muted/50"
                      }`}
                    >
                      {mode === "clients" ? "By clients" : "By avg value"}
                    </button>
                  ))}
                </div>
              </div>

              {/* Nationality list with expandable service breakdown */}
              <div className="space-y-1.5">
                {natStatsSorted.map((n, i) => {
                  const colorIdx = natStats.findIndex(s => s.country === n.country);
                  const isOpen = expandedNat === n.country;
                  const maxSvcTotal = n.services.reduce((m, s) => Math.max(m, s.total), 0);
                  return (
                    <div
                      key={n.country}
                      className="rounded-xl bg-muted/30 border border-border/40 overflow-hidden"
                      data-testid={`nat-row-${n.country}`}
                    >
                      <div className="flex items-stretch">
                        <button
                          onClick={() => navigate(`/clients?nationality=${encodeURIComponent(n.country)}`)}
                          className="flex items-center gap-3 px-3 py-2.5 flex-1 text-left hover:bg-primary/5 transition-colors"
                        >
                          <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: NAT_COLORS[colorIdx % NAT_COLORS.length] }} />
                          <span className="text-base leading-none flex-shrink-0">{n.flag}</span>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-semibold text-foreground truncate">{n.country}</div>
                            <div className="text-[10px] text-muted-foreground">
                              {n.count} client{n.count !== 1 ? "s" : ""}
                              {n.bookings > 0 && (
                                <> · {n.bookings} booking{n.bookings !== 1 ? "s" : ""}</>
                              )}
                            </div>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <div className="text-sm font-bold text-primary">
                              {n.avgBooking !== null ? `£${Math.round(n.avgBooking).toLocaleString()}` : "—"}
                            </div>
                            <div className="text-[9px] text-muted-foreground uppercase tracking-wide">avg / booking</div>
                          </div>
                        </button>
                        <button
                          onClick={() => setExpandedNat(isOpen ? null : n.country)}
                          aria-label={isOpen ? "Collapse breakdown" : "Expand service breakdown"}
                          data-testid={`nat-expand-${n.country}`}
                          className="px-2 flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-primary/5 transition-colors border-l border-border/40"
                        >
                          <ChevronDown className={`w-4 h-4 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                        </button>
                      </div>

                      {/* 3B — Service breakdown */}
                      {isOpen && (
                        <div className="px-3 pb-3 pt-1 border-t border-border/40 bg-background/30 space-y-2" data-testid={`nat-services-${n.country}`}>
                          {n.services.length === 0 ? (
                            <p className="text-[11px] text-muted-foreground py-1">No completed bookings yet for this nationality.</p>
                          ) : (
                            <>
                              <div className="text-[10px] uppercase tracking-wider text-muted-foreground pt-1.5">Service mix</div>
                              {n.services.map(s => {
                                const pctW = maxSvcTotal > 0 ? Math.max(4, Math.round((s.total / maxSvcTotal) * 100)) : 0;
                                return (
                                  <div key={s.service}>
                                    <div className="flex items-center justify-between text-[11px] mb-0.5">
                                      <span className="text-foreground font-medium truncate">
                                        {s.service}
                                        <span className="text-muted-foreground font-normal"> · {s.count} booking{s.count !== 1 ? "s" : ""}</span>
                                      </span>
                                      <span className="text-primary font-semibold flex-shrink-0">£{s.total.toLocaleString()}</span>
                                    </div>
                                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                                      <div
                                        className="h-full rounded-full"
                                        style={{
                                          width: `${pctW}%`,
                                          background: SERVICE_COLORS[s.service] ?? SERVICE_COLORS.Other,
                                        }}
                                      />
                                    </div>
                                  </div>
                                );
                              })}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* 4B. REPEAT vs NEW (Section 3C)                                         */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      <Card className="border-primary/10" data-testid="card-repeat-new">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Repeat className="w-4 h-4 text-primary" />
            Repeat vs New Clients
            {repeatVsNew.trend !== null && repeatVsNew.total > 0 && (
              <span
                className={`ml-auto text-[10px] font-semibold flex items-center gap-0.5 ${
                  repeatVsNew.trend >= 0 ? "text-emerald-400" : "text-red-400"
                }`}
                data-testid="repeat-trend"
              >
                {repeatVsNew.trend >= 0 ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
                {Math.abs(Math.round(repeatVsNew.trend))}% vs prev
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
            ] as const).map(([val, label]) => (
              <button
                key={val}
                onClick={() => setRepeatPeriod(val)}
                data-testid={`repeat-period-${val}`}
                className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all ${
                  repeatPeriod === val
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted/40 text-muted-foreground hover:bg-muted/70"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {completedBookingsQuery.isLoading ? (
            <Skeleton className="h-44 w-full" />
          ) : repeatVsNew.total === 0 ? (
            <div className="py-8 text-center text-xs text-muted-foreground">
              No completed bookings in this period yet.
            </div>
          ) : (
            <div className="flex items-center gap-4">
              <div className="relative h-36 w-36 flex-shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={[
                        { name: "Repeat", value: repeatVsNew.repeatCount },
                        { name: "New",    value: repeatVsNew.newCount },
                      ]}
                      cx="50%"
                      cy="50%"
                      innerRadius={42}
                      outerRadius={66}
                      paddingAngle={2}
                      dataKey="value"
                    >
                      <Cell fill="#C9A84C" />
                      <Cell fill="#4B5563" />
                    </Pie>
                    <RechartsTip
                      contentStyle={{ background: "#1a1a1a", border: "1px solid rgba(201,168,76,0.2)", borderRadius: 8, fontSize: 11 }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <div className="text-xl font-black text-foreground">
                    {repeatVsNew.total > 0 ? Math.round((repeatVsNew.repeatCount / repeatVsNew.total) * 100) : 0}%
                  </div>
                  <div className="text-[9px] text-muted-foreground uppercase tracking-wide">repeat</div>
                </div>
              </div>
              <div className="flex-1 space-y-2">
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary/10 border border-primary/20" data-testid="repeat-count">
                  <div className="w-2.5 h-2.5 rounded-full bg-primary" />
                  <div className="flex-1">
                    <div className="text-lg font-bold text-foreground">{repeatVsNew.repeatCount}</div>
                    <div className="text-[10px] text-muted-foreground">returning client{repeatVsNew.repeatCount !== 1 ? "s" : ""}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/30 border border-border/40" data-testid="new-count">
                  <div className="w-2.5 h-2.5 rounded-full bg-muted-foreground" />
                  <div className="flex-1">
                    <div className="text-lg font-bold text-foreground">{repeatVsNew.newCount}</div>
                    <div className="text-[10px] text-muted-foreground">new client{repeatVsNew.newCount !== 1 ? "s" : ""}</div>
                  </div>
                </div>
              </div>
            </div>
          )}
          {/* Plain-English insight — only shown when there is data */}
          {repeatVsNew.total > 0 && (
            <div className="rounded-xl border border-border/40 bg-muted/20 px-4 py-3">
              <p className="text-xs text-muted-foreground leading-relaxed">
                {(() => {
                  const pct = Math.round((repeatVsNew.repeatCount / repeatVsNew.total) * 100);
                  const label = repeatPeriod === "this_month" ? "this month" : repeatPeriod === "last_30" ? "in the last 30 days" : "this year";
                  if (pct === 100) return `Every booking ${label} came from a returning client — strong loyalty, but push to grow new clients too.`;
                  if (pct >= 70) return `${pct}% repeat rate ${label} — very healthy loyalty. Focus on selective new-client acquisition to keep growing.`;
                  if (pct >= 50) return `${pct}% of bookings ${label} are from returning clients — a solid base. Target the ${repeatVsNew.newCount} new client${repeatVsNew.newCount !== 1 ? "s" : ""} for follow-up to convert them into regulars.`;
                  if (pct >= 30) return `${pct}% repeat rate ${label} — you're bringing in new clients well. Work retention: follow up with the ${repeatVsNew.repeatCount} returning client${repeatVsNew.repeatCount !== 1 ? "s" : ""} to keep them engaged.`;
                  return `Only ${pct}% of bookings ${label} are from returning clients — prioritise retention outreach via WhatsApp to convert new clients into regulars.`;
                })()}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* 4C. DORMANT CLIENTS (Section 3D)                                       */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      <Card className="border-primary/10" data-testid="card-dormant">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Clock className="w-4 h-4 text-primary" />
            Dormant Clients
            <span className="text-[10px] text-muted-foreground font-normal">(60+ days quiet)</span>
            {dormantClients.length > 0 && (
              <span className="ml-auto text-[10px] font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-full" data-testid="dormant-badge">
                {dormantClients.length}
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {(completedBookingsQuery.isLoading || clientsQuery.isLoading || futureBookingsQuery.isLoading) ? (
            <Skeleton className="h-32 w-full" />
          ) : dormantClients.length === 0 ? (
            <div className="py-6 text-center text-xs text-muted-foreground" data-testid="dormant-empty">
              All clients active — none quiet for 60+ days.
            </div>
          ) : (
            <div className="space-y-1.5 max-h-96 overflow-y-auto pr-1" data-testid="dormant-list">
              {dormantClients.map(c => {
                const link = whatsappLink((clientsQuery.data ?? []).find(x => x.id === c.id)?.whatsapp ?? null);
                return (
                  <div
                    key={c.id}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-muted/30 border border-border/40"
                    data-testid={`dormant-row-${c.id}`}
                  >
                    <span className="text-base leading-none flex-shrink-0">{c.nationality.flag}</span>
                    <button
                      onClick={() => navigate(`/clients/${c.id}`)}
                      className="flex-1 min-w-0 text-left hover:text-primary transition-colors"
                    >
                      <div className="text-sm font-semibold text-foreground truncate">{c.name}</div>
                      <div className="text-[10px] text-muted-foreground">
                        Last booked {c.daysSince} day{c.daysSince !== 1 ? "s" : ""} ago
                        {c.lifetimeSpend > 0 && <> · £{c.lifetimeSpend.toLocaleString()} lifetime</>}
                      </div>
                    </button>
                    {link ? (
                      <a
                        href={link}
                        target="_blank"
                        rel="noopener noreferrer"
                        data-testid={`dormant-reach-${c.id}`}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-[11px] font-semibold hover:opacity-90 transition-opacity flex-shrink-0"
                      >
                        <MessageCircle className="w-3.5 h-3.5" />
                        Reach Out
                      </a>
                    ) : (
                      <span className="text-[10px] text-muted-foreground italic flex-shrink-0">no WhatsApp</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* ─── BUSINESS PERFORMANCE (Section 4) ─────────────────────────────────  */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-border/60" />
        <div className="flex items-center gap-2 px-2">
          <BarChart3 className="w-3.5 h-3.5 text-primary" />
          <span className="text-xs font-semibold text-primary uppercase tracking-widest">Business Performance</span>
        </div>
        <div className="h-px flex-1 bg-border/60" />
      </div>

      {/* 4A — Top Hotels */}
      <Card className="border-primary/10" data-testid="card-top-hotels">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Building2 className="w-4 h-4 text-primary" />
            Top Hotels
            <span className="text-[10px] text-muted-foreground font-normal">(pickup or dropoff)</span>
            {topHotels.length > 0 && <span className="ml-auto text-[10px] text-muted-foreground font-normal">Top {topHotels.length}</span>}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {businessBookingsQuery.isLoading ? <Skeleton className="h-32 w-full" /> : topHotels.length === 0 ? (
            <p className="text-xs text-muted-foreground py-4 text-center">No hotel-tagged pickups or dropoffs yet.</p>
          ) : (
            <div className="space-y-1.5">
              {topHotels.map((h, i) => (
                <button
                  key={h.display + i}
                  onClick={() => navigate(`/bookings?q=${encodeURIComponent(h.display)}`)}
                  data-testid={`hotel-row-${i}`}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl bg-muted/30 border border-border/40 hover:border-primary/30 hover:bg-primary/5 transition-all text-left"
                >
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 ${i === 0 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>{i + 1}</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-foreground truncate">{h.display}</div>
                    <div className="text-[10px] text-muted-foreground">{h.count} booking{h.count !== 1 ? "s" : ""}</div>
                  </div>
                  <div className="text-sm font-bold text-primary flex-shrink-0">£{h.revenue.toLocaleString()}</div>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 4B — Top Routes */}
      <Card className="border-primary/10" data-testid="card-top-routes">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <RouteIcon className="w-4 h-4 text-primary" />
            Top Routes
            <span className="text-[10px] text-muted-foreground font-normal">(directional)</span>
            {topRoutes.length > 0 && <span className="ml-auto text-[10px] text-muted-foreground font-normal">Top {topRoutes.length}</span>}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {businessBookingsQuery.isLoading ? <Skeleton className="h-32 w-full" /> : topRoutes.length === 0 ? (
            <p className="text-xs text-muted-foreground py-4 text-center">No routes recorded yet.</p>
          ) : (
            <div className="space-y-1.5">
              {topRoutes.map((r, i) => (
                <div key={i} className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-muted/30 border border-border/40" data-testid={`route-row-${i}`}>
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 ${i === 0 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>{i + 1}</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-foreground truncate">
                      {r.from} <span className="text-muted-foreground">→</span> {r.to}
                    </div>
                    <div className="text-[10px] text-muted-foreground">{r.count} trip{r.count !== 1 ? "s" : ""}</div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="text-sm font-bold text-primary">£{Math.round(r.avg).toLocaleString()}</div>
                    <div className="text-[9px] text-muted-foreground uppercase tracking-wide">avg</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 4C — Service Breakdown */}
      <Card className="border-primary/10" data-testid="card-service-breakdown">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-primary" />
            Service Breakdown
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0 space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {([
              ["this_month", "This month"],
              ["this_year",  "This year"],
              ["all_time",   "All time"],
            ] as const).map(([val, label]) => (
              <button
                key={val}
                onClick={() => setServiceBreakPeriod(val)}
                data-testid={`svc-period-${val}`}
                className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all ${
                  serviceBreakPeriod === val ? "bg-primary text-primary-foreground" : "bg-muted/40 text-muted-foreground hover:bg-muted/70"
                }`}
              >{label}</button>
            ))}
          </div>
          {businessBookingsQuery.isLoading ? <Skeleton className="h-40 w-full" /> : serviceBreakdown.rows.length === 0 ? (
            <p className="text-xs text-muted-foreground py-4 text-center">No completed bookings in this period.</p>
          ) : (
            <div className="flex items-center gap-4">
              <div className="relative h-32 w-32 flex-shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={serviceBreakdown.rows} cx="50%" cy="50%" innerRadius={36} outerRadius={60} paddingAngle={2} dataKey="revenue">
                      {serviceBreakdown.rows.map(r => (
                        <Cell key={r.service} fill={SERVICE_COLORS[r.service] ?? SERVICE_COLORS.Other} />
                      ))}
                    </Pie>
                    <RechartsTip contentStyle={{ background: "#1a1a1a", border: "1px solid rgba(201,168,76,0.2)", borderRadius: 8, fontSize: 11 }} formatter={(v: any) => [`£${Number(v).toLocaleString()}`, "Revenue"]} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex-1 space-y-1">
                {serviceBreakdown.rows.map(r => (
                  <div key={r.service} className="flex items-center gap-2 text-[11px]" data-testid={`svc-row-${r.service}`}>
                    <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: SERVICE_COLORS[r.service] ?? SERVICE_COLORS.Other }} />
                    <span className="text-foreground font-medium flex-1 truncate">{r.service}</span>
                    <span className="text-muted-foreground">{r.count}</span>
                    <span className="text-primary font-semibold">£{r.revenue.toLocaleString()}</span>
                    <span className="text-muted-foreground w-10 text-right">{r.pct.toFixed(0)}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 4D — Vehicle Type Demand */}
      <Card className="border-primary/10" data-testid="card-vehicle-demand">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Car className="w-4 h-4 text-primary" />
            Vehicle Type Demand
            {vehicleDemand.total > 0 && <span className="ml-auto text-[10px] text-muted-foreground font-normal">{vehicleDemand.total} total</span>}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0 space-y-3">
          {bookingNationalities.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-muted-foreground">Filter by nationality</span>
              <select
                value={vehicleNatFilter}
                onChange={e => setVehicleNatFilter(e.target.value)}
                data-testid="vehicle-nat-filter"
                className="text-[11px] bg-muted/40 border border-border/60 rounded-md px-2 py-1 text-foreground"
              >
                <option value="">All</option>
                {bookingNationalities.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          )}
          {businessBookingsQuery.isLoading ? <Skeleton className="h-32 w-full" /> : vehicleDemand.rows.length === 0 ? (
            <p className="text-xs text-muted-foreground py-4 text-center">No vehicle data for this filter.</p>
          ) : (
            <div className="space-y-1.5">
              {vehicleDemand.rows.map((v, i) => (
                <div key={v.vehicle} className="flex items-center gap-3 px-3 py-2 rounded-xl bg-muted/30 border border-border/40" data-testid={`vehicle-row-${i}`}>
                  <div className="text-[10px] font-bold text-muted-foreground w-5">{i + 1}</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-foreground truncate">{v.vehicle}</div>
                    <div className="h-1.5 mt-1 rounded-full bg-muted overflow-hidden">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${v.pct}%` }} />
                    </div>
                  </div>
                  <div className="text-[11px] text-muted-foreground flex-shrink-0">{v.count}</div>
                  <div className="text-sm font-bold text-primary flex-shrink-0 w-12 text-right">{v.pct.toFixed(0)}%</div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 4E — Peak Days & Hours Heatmap */}
      <Card className="border-primary/10" data-testid="card-heatmap">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Flame className="w-4 h-4 text-primary" />
            Peak Days & Hours
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0 space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {([
              ["this_month", "This month"],
              ["last_90",    "Last 90 days"],
              ["this_year",  "This year"],
            ] as const).map(([val, label]) => (
              <button
                key={val}
                onClick={() => setHeatmapPeriod(val)}
                data-testid={`heat-period-${val}`}
                className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all ${
                  heatmapPeriod === val ? "bg-primary text-primary-foreground" : "bg-muted/40 text-muted-foreground hover:bg-muted/70"
                }`}
              >{label}</button>
            ))}
          </div>
          {businessBookingsQuery.isLoading ? <Skeleton className="h-40 w-full" /> : heatmap.total === 0 ? (
            <p className="text-xs text-muted-foreground py-4 text-center">No bookings in this period.</p>
          ) : (
            <>
              <div className="overflow-x-auto" data-testid="heatmap-grid">
                <table className="w-full text-[9px] text-muted-foreground border-separate" style={{ borderSpacing: 1 }}>
                  <thead>
                    <tr>
                      <th className="text-left pr-1"></th>
                      {Array.from({ length: 24 }, (_, h) => (
                        <th key={h} className="text-center font-normal" style={{ minWidth: 14 }}>
                          {h % 6 === 0 ? `${h}` : ""}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map((day, di) => (
                      <tr key={day}>
                        <td className="pr-1 text-right font-semibold">{day}</td>
                        {heatmap.grid[di].map((count, h) => {
                          const intensity = heatmap.max > 0 ? count / heatmap.max : 0;
                          return (
                            <td
                              key={h}
                              title={`${day} ${h}:00 — ${count} booking${count !== 1 ? "s" : ""}`}
                              className="rounded-sm"
                              style={{
                                background: count > 0 ? `rgba(201,168,76,${0.15 + intensity * 0.85})` : "rgba(255,255,255,0.04)",
                                height: 18,
                              }}
                            />
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {heatmap.peakHours.length > 0 && (
                <div className="text-[11px] text-muted-foreground" data-testid="peak-hours">
                  <span className="font-semibold text-foreground">Peak hours:</span>{" "}
                  {heatmap.peakHours.map((p, i) => (
                    <span key={p.hour}>
                      {p.hour.toString().padStart(2, "0")}:00–{(p.hour + 1).toString().padStart(2, "0")}:00 ({p.count})
                      {i < heatmap.peakHours.length - 1 ? " · " : ""}
                    </span>
                  ))}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* 4F — Cancellation & No-Show Rate */}
      <Card className="border-primary/10" data-testid="card-cancel-stats">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Ban className="w-4 h-4 text-primary" />
            Cancellation & No-Show
            <span className="text-[10px] text-muted-foreground font-normal">(this month)</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0 space-y-3">
          {businessBookingsQuery.isLoading ? <Skeleton className="h-32 w-full" /> : cancelStats.total === 0 ? (
            <p className="text-xs text-muted-foreground py-4 text-center">No bookings recorded for this month yet.</p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-destructive/10 border border-destructive/30 p-3" data-testid="cancel-rate">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Cancellation</div>
                  <div className="flex items-baseline gap-2">
                    <div className="text-2xl font-black text-destructive">{cancelStats.cancelRate.toFixed(1)}%</div>
                    {cancelStats.cancelTrend !== null && (
                      <span className={`text-[10px] font-semibold flex items-center gap-0.5 ${cancelStats.cancelTrend > 0 ? "text-red-400" : cancelStats.cancelTrend < 0 ? "text-emerald-400" : "text-muted-foreground"}`}>
                        {cancelStats.cancelTrend > 0 ? <ArrowUp className="w-3 h-3" /> : cancelStats.cancelTrend < 0 ? <ArrowDown className="w-3 h-3" /> : null}
                        {Math.abs(cancelStats.cancelTrend).toFixed(1)}pt
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">{cancelStats.cancelled} of {cancelStats.total}</div>
                </div>
                <div className="rounded-xl bg-orange-500/10 border border-orange-500/30 p-3" data-testid="noshow-rate">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">No-Show</div>
                  <div className="flex items-baseline gap-2">
                    <div className="text-2xl font-black text-orange-400">{cancelStats.noShowRate.toFixed(1)}%</div>
                    {cancelStats.noShowTrend !== null && (
                      <span className={`text-[10px] font-semibold flex items-center gap-0.5 ${cancelStats.noShowTrend > 0 ? "text-red-400" : cancelStats.noShowTrend < 0 ? "text-emerald-400" : "text-muted-foreground"}`}>
                        {cancelStats.noShowTrend > 0 ? <ArrowUp className="w-3 h-3" /> : cancelStats.noShowTrend < 0 ? <ArrowDown className="w-3 h-3" /> : null}
                        {Math.abs(cancelStats.noShowTrend).toFixed(1)}pt
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">{cancelStats.noShow} of {cancelStats.total}</div>
                </div>
              </div>
              {cancelStats.byNat.length > 0 && (
                <button
                  onClick={() => setShowCxnByNat(v => !v)}
                  data-testid="cancel-by-nat-toggle"
                  className="w-full flex items-center justify-between text-[11px] text-muted-foreground hover:text-primary transition-colors"
                >
                  <span>Breakdown by nationality</span>
                  <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showCxnByNat ? "rotate-180" : ""}`} />
                </button>
              )}
              {showCxnByNat && (
                <div className="space-y-1" data-testid="cancel-by-nat-list">
                  {cancelStats.byNat.map(n => (
                    <div key={n.country} className="flex items-center gap-2 text-[11px] px-2 py-1.5 rounded-lg bg-muted/30">
                      <span className="text-base leading-none">{n.flag}</span>
                      <span className="flex-1 text-foreground font-medium">{n.country}</span>
                      <span className="text-destructive font-semibold w-14 text-right">{n.cancelRate.toFixed(0)}% cxn</span>
                      <span className="text-orange-400 font-semibold w-14 text-right">{n.noShowRate.toFixed(0)}% NS</span>
                      <span className="text-muted-foreground w-8 text-right">{n.total}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* 4G — Booking Lead Time */}
      <Card className="border-primary/10" data-testid="card-lead-time">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Hourglass className="w-4 h-4 text-primary" />
            Booking Lead Time
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0 space-y-3">
          {businessBookingsQuery.isLoading ? <Skeleton className="h-28 w-full" /> : leadTime.overall === null ? (
            <p className="text-xs text-muted-foreground py-4 text-center">No qualifying bookings to measure lead time.</p>
          ) : (
            <>
              <div className="text-center py-2">
                <div className="text-3xl font-black text-primary" data-testid="lead-overall">{leadTime.overall.toFixed(1)}</div>
                <div className="text-[11px] text-muted-foreground">days advance booking on average</div>
              </div>
              {leadTime.byNat.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">By nationality</div>
                  <div className="space-y-1">
                    {leadTime.byNat.map(n => (
                      <div key={n.country} className="flex items-center gap-2 text-[11px] px-2 py-1 rounded-lg bg-muted/30">
                        <span className="text-base leading-none">{n.flag}</span>
                        <span className="flex-1 text-foreground font-medium">{n.country}</span>
                        <span className="text-muted-foreground">{n.count}</span>
                        <span className="text-primary font-semibold w-16 text-right">{n.avg.toFixed(1)} days</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {leadTime.byService.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">By service</div>
                  <div className="space-y-1">
                    {leadTime.byService.map(s => (
                      <div key={s.service} className="flex items-center gap-2 text-[11px] px-2 py-1 rounded-lg bg-muted/30">
                        <div className="w-2 h-2 rounded-full" style={{ background: SERVICE_COLORS[s.service] ?? SERVICE_COLORS.Other }} />
                        <span className="flex-1 text-foreground font-medium">{s.service}</span>
                        <span className="text-muted-foreground">{s.count}</span>
                        <span className="text-primary font-semibold w-16 text-right">{s.avg.toFixed(1)} days</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* 4H — Repeat Booking Frequency */}
      <Card className="border-primary/10" data-testid="card-repeat-freq">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <RotateCcw className="w-4 h-4 text-primary" />
            Repeat Booking Frequency
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0 space-y-3">
          {businessBookingsQuery.isLoading ? <Skeleton className="h-28 w-full" /> : repeatFreq.overall === null ? (
            <p className="text-xs text-muted-foreground py-4 text-center">Not enough repeat bookings yet to measure cadence.</p>
          ) : (
            <>
              <div className="text-center py-2">
                <div className="text-3xl font-black text-primary" data-testid="repeat-overall">{repeatFreq.overall.toFixed(0)}</div>
                <div className="text-[11px] text-muted-foreground">days between bookings on average</div>
              </div>
              {repeatFreq.byNat.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">By nationality</div>
                  <div className="space-y-1">
                    {repeatFreq.byNat.map(n => (
                      <div key={n.country} className="flex items-center gap-2 text-[11px] px-2 py-1 rounded-lg bg-muted/30" data-testid={`repeat-nat-${n.country}`}>
                        <span className="text-base leading-none">{n.flag}</span>
                        <span className="flex-1 text-foreground font-medium">{n.country}</span>
                        {n.insufficient ? (
                          <span className="text-muted-foreground italic">insufficient data</span>
                        ) : (
                          <>
                            <span className="text-muted-foreground">{n.clients} clients</span>
                            <span className="text-primary font-semibold w-16 text-right">{n.avg!.toFixed(0)} days</span>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {repeatFreq.highFreq.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">High Frequency</div>
                  <div className="space-y-1">
                    {repeatFreq.highFreq.map(c => (
                      <button
                        key={c.id}
                        onClick={() => navigate(`/clients/${c.id}`)}
                        data-testid={`high-freq-${c.id}`}
                        className="w-full flex items-center gap-2 text-[11px] px-2 py-1 rounded-lg bg-primary/10 border border-primary/20 hover:bg-primary/15 transition-colors"
                      >
                        <span className="px-1.5 py-0.5 rounded-full bg-primary text-primary-foreground text-[9px] font-bold">HF</span>
                        <span className="flex-1 text-left text-foreground font-medium truncate">{c.name}</span>
                        <span className="text-primary font-semibold">every {c.avg.toFixed(0)} days</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* 4I — Driver Utilisation */}
      <Card className="border-primary/10" data-testid="card-driver-utilisation">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Users className="w-4 h-4 text-primary" />
            Driver Utilisation
            <span className="text-[10px] text-muted-foreground font-normal">(this month vs last)</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {(businessBookingsQuery.isLoading || driversQuery.isLoading) ? (
            <Skeleton className="h-32 w-full" />
          ) : driverUtilisation.rows.length === 0 ? (
            <p className="text-xs text-muted-foreground py-4 text-center">No drivers on file yet.</p>
          ) : (
            <div className="space-y-1.5">
              {driverUtilisation.rows.map((d, i) => {
                const isTop  = i === 0 && d.thisMonth > 0;
                const isZero = d.thisMonth === 0;
                const trend = d.thisMonth - d.lastMonth;
                return (
                  <div
                    key={d.id}
                    data-testid={`driver-row-${i}`}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-colors ${
                      isTop
                        ? "bg-primary/15 border-primary/40"
                        : isZero
                          ? "bg-destructive/5 border-destructive/30"
                          : "bg-muted/30 border-border/40"
                    }`}
                  >
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 ${
                      isTop ? "bg-primary text-primary-foreground" : isZero ? "bg-destructive/30 text-destructive" : "bg-muted text-muted-foreground"
                    }`}>{i + 1}</div>
                    <div className="flex-1 min-w-0">
                      <div className={`text-sm font-semibold truncate ${isTop ? "text-primary" : isZero ? "text-destructive" : "text-foreground"}`}>
                        {d.name}
                        {isZero && <span className="ml-2 text-[9px] uppercase tracking-wider">idle</span>}
                      </div>
                      {driverUtilisation.lastMonthValid && (
                        <div className="text-[10px] text-muted-foreground">last month: {d.lastMonth}</div>
                      )}
                    </div>
                    {driverUtilisation.lastMonthValid && trend !== 0 && (
                      <span className={`text-[10px] font-semibold flex items-center gap-0.5 ${
                        trend > 0 ? "text-emerald-400" : "text-red-400"
                      }`}>
                        {trend > 0 ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
                        {Math.abs(trend)}
                      </span>
                    )}
                    <div className={`text-right flex-shrink-0 ${isTop ? "text-primary" : isZero ? "text-destructive" : "text-foreground"}`}>
                      <div className="text-lg font-black leading-none">{d.thisMonth}</div>
                      <div className="text-[9px] uppercase tracking-wider text-muted-foreground">jobs</div>
                    </div>
                  </div>
                );
              })}
            </div>
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

              {forecast.by_day.some(d => d.count > 0) && (
                <div>
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                    Booked Days
                    <span className="ml-2 font-normal text-[10px]">({forecast.by_day.filter(d => d.count > 0).length} of 30)</span>
                  </div>
                  <div className="space-y-0.5">
                    {forecast.by_day.filter(d => d.count > 0).map(d => (
                      <div key={d.date} className="flex items-center justify-between text-xs px-3 py-2 rounded-lg bg-muted/20">
                        <span className="font-medium text-foreground">
                          {format(parseISO(d.date), "EEE dd MMM")}
                        </span>
                        <div className="flex items-center gap-3">
                          <span className="text-muted-foreground">{d.count} job{d.count !== 1 ? "s" : ""}</span>
                          <span className="font-semibold w-20 text-right text-primary">
                            £{d.revenue.toLocaleString()}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
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
