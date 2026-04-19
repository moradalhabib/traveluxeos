import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";
import {
  ArrowLeft, ArrowRight, PlaneTakeoff, Car, Map, Building2, Hotel,
  CalendarRange, TrendingUp, Clock, CheckCircle2, Plus
} from "lucide-react";
import { Link } from "wouter";

// Fixed canonical service definitions — always exactly these 5
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
    icon: <Map className="w-6 h-6" />,
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

// Legacy DB name → canonical key (handles pre-migration DB state)
const LEGACY_MAP: Record<string, ServiceKey> = {
  "City Tour":                "Tour",
  "Chauffeur Tour":           "Tour",
  "Event Transfer":           "Airport Transfer",
  "Apartment / Accommodation":"Apartment",
};

const STATUS_COLORS: Record<string, string> = {
  "Confirmed":   "bg-blue-500/20 text-blue-400 border-blue-500/30",
  "Completed":   "bg-green-500/20 text-green-400 border-green-500/30",
  "Pending":     "bg-amber-500/20 text-amber-400 border-amber-500/30",
  "Cancelled":   "bg-destructive/20 text-destructive border-destructive/30",
  "Invoiced":    "bg-purple-500/20 text-purple-400 border-purple-500/30",
  "In Progress": "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
};

const STATUS_FILTERS = ["All", "Pending", "Confirmed", "In Progress", "Completed", "Invoiced", "Cancelled"];

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
}

function canonicalKey(raw: string): ServiceKey {
  if (LEGACY_MAP[raw]) return LEGACY_MAP[raw];
  return raw as ServiceKey;
}

export default function Services() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loadingBookings, setLoadingBookings] = useState(true);
  const [selectedKey, setSelectedKey] = useState<ServiceKey | null>(null);
  const [statusFilter, setStatusFilter] = useState("All");

  useEffect(() => {
    supabase
      .from("bookings")
      .select("id, tvl_ref, client_name, service_type, date_time, status, price, driver_name, payment_status, pickup, dropoff")
      .order("date_time", { ascending: false })
      .then(({ data }) => {
        setBookings(data ?? []);
        setLoadingBookings(false);
      });
  }, []);

  const statsFor = (key: ServiceKey) => {
    const svcBookings = bookings.filter(b => canonicalKey(b.service_type) === key);
    const active = svcBookings.filter(b => ["Confirmed", "Pending", "In Progress"].includes(b.status)).length;
    const revenue = svcBookings.filter(b => b.status !== "Cancelled").reduce((s, b) => s + Number(b.price || 0), 0);
    const completed = svcBookings.filter(b => b.status === "Completed" || b.status === "Invoiced").length;
    return { total: svcBookings.length, active, revenue, completed };
  };

  const filteredBookings = useMemo(() => {
    if (!selectedKey) return [];
    return bookings
      .filter(b => canonicalKey(b.service_type) === selectedKey)
      .filter(b => statusFilter === "All" || b.status === statusFilter);
  }, [selectedKey, bookings, statusFilter]);

  const allStats = useMemo(() => {
    const nonCancelled = bookings.filter(b => b.status !== "Cancelled");
    return {
      total: nonCancelled.length,
      revenue: nonCancelled.reduce((s, b) => s + Number(b.price || 0), 0),
    };
  }, [bookings]);

  // ─── Detail view for a selected service ───────────────────────────────────
  if (selectedKey) {
    const svc = SERVICES.find(s => s.key === selectedKey)!;
    const stats = statsFor(selectedKey);

    return (
      <div className="space-y-5">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => { setSelectedKey(null); setStatusFilter("All"); }} className="-ml-2 text-muted-foreground">
            <ArrowLeft className="w-4 h-4 mr-1.5" /> Services
          </Button>
        </div>

        {/* Service header */}
        <div className="flex items-center gap-4">
          <div className={`w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0 ${svc.iconColor}`}>
            {svc.icon}
          </div>
          <h1 className="text-2xl font-bold text-foreground">{svc.label}</h1>
          <Link href="/bookings/new" className="ml-auto">
            <Button size="sm" className="h-9">
              <Plus className="w-3.5 h-3.5 mr-1.5" /> New Booking
            </Button>
          </Link>
        </div>

        {/* Stats strip */}
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: "Total",     value: stats.total,                              icon: <CalendarRange className="w-4 h-4" /> },
            { label: "Active",    value: stats.active,                             icon: <Clock className="w-4 h-4 text-amber-400" /> },
            { label: "Completed", value: stats.completed,                          icon: <CheckCircle2 className="w-4 h-4 text-green-400" /> },
            { label: "Revenue",   value: `£${stats.revenue.toLocaleString()}`,     icon: <TrendingUp className="w-4 h-4 text-primary" /> },
          ].map(item => (
            <div key={item.label} className="bg-card border border-border rounded-xl p-3 text-center">
              <div className="flex justify-center mb-1 text-muted-foreground">{item.icon}</div>
              <div className="text-lg font-bold text-foreground">{item.value}</div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{item.label}</div>
            </div>
          ))}
        </div>

        {/* Status filter */}
        <div className="flex overflow-x-auto gap-2 pb-1">
          {STATUS_FILTERS.map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap border flex-shrink-0 transition-all ${
                statusFilter === s
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
              }`}
            >
              {s}
              {s !== "All" && (
                <span className="ml-1.5 opacity-70">
                  {bookings.filter(b => canonicalKey(b.service_type) === selectedKey && b.status === s).length}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Booking list */}
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
            {filteredBookings.map(booking => (
              <Link key={booking.id} href={`/bookings/${booking.id}`}>
                <Card className="border-border hover:border-primary/40 transition-all cursor-pointer bg-card hover:bg-secondary/5">
                  <CardContent className="p-0">
                    <div className="flex items-stretch">
                      <div className={`w-1 rounded-l-xl flex-shrink-0 ${
                        booking.status === "Confirmed"  ? "bg-blue-500" :
                        booking.status === "Completed" || booking.status === "Invoiced" ? "bg-green-500" :
                        booking.status === "Cancelled"  ? "bg-red-500" :
                        booking.status === "In Progress"? "bg-cyan-500" :
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
                            {booking.driver_name && (
                              <div className="text-xs text-muted-foreground mt-1">🚘 {booking.driver_name}</div>
                            )}
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
      </div>
    );
  }

  // ─── Overview grid ─────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Services</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {allStats.total} bookings · £{allStats.revenue.toLocaleString()} total revenue
          </p>
        </div>
        <Link href="/bookings/new">
          <Button className="h-11 shadow-[0_0_10px_rgba(201,168,76,0.2)]">
            <Plus className="w-4 h-4 mr-2" /> New Booking
          </Button>
        </Link>
      </div>

      {loadingBookings ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-36" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {SERVICES.map(svc => {
            const stats = statsFor(svc.key);
            return (
              <button
                key={svc.key}
                onClick={() => setSelectedKey(svc.key)}
                className={`text-left w-full rounded-2xl border bg-gradient-to-br ${svc.color} p-5 hover:shadow-[0_4px_20px_rgba(0,0,0,0.3)] transition-all group`}
              >
                <div className="flex items-start justify-between mb-4">
                  <div className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${svc.iconColor}`}>
                    {svc.icon}
                  </div>
                  <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground group-hover:translate-x-0.5 transition-all mt-1" />
                </div>

                <div className="font-bold text-lg text-foreground leading-tight">{svc.label}</div>

                <div className="grid grid-cols-3 gap-2 mt-4 pt-4 border-t border-white/10">
                  <div>
                    <div className="text-xs text-muted-foreground uppercase tracking-wide mb-0.5">Total</div>
                    <div className="font-bold text-foreground">{stats.total}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground uppercase tracking-wide mb-0.5">Active</div>
                    <div className={`font-bold ${stats.active > 0 ? "text-amber-400" : "text-muted-foreground"}`}>
                      {stats.active}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground uppercase tracking-wide mb-0.5">Revenue</div>
                    <div className="font-bold text-primary">
                      {stats.revenue > 0 ? `£${stats.revenue.toLocaleString()}` : "—"}
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
