import { useGetDashboardSummary, getGetDashboardSummaryQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, Briefcase, ChevronRight, Layers, CalendarRange, Search, Users, Receipt, Calculator, Clock, MessageCircle, PlaneLanding, X, Plus } from "lucide-react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { supabase as supabaseClient } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";

const FOLLOWUP_BASE = `${import.meta.env.VITE_API_URL ?? ""}/api`;

function whatsappLink(num?: string | null, message?: string) {
  if (!num) return null;
  const clean = num.replace(/[^0-9]/g, "");
  if (!clean) return null;
  const text = message ? `?text=${encodeURIComponent(message)}` : "";
  return `https://wa.me/${clean}${text}`;
}

export default function Dashboard() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const isSuperAdmin = user?.role === "super_admin";

  const { data: summary, isLoading } = useGetDashboardSummary({
    query: { queryKey: getGetDashboardSummaryQueryKey() }
  });

  const s = summary as any;
  const pendingRequests: any[] = s?.pending_requests ?? [];
  const awaitingReturn: any[] = s?.awaiting_return ?? [];

  const logReturn = async (bookingId: string, ref: string) => {
    if (!confirm(`Create a return Departure booking from ${ref}?\n\nA new Confirmed booking will be created with pickup/dropoff swapped. You'll be taken to it next to set the date/time.`)) return;
    try {
      const { data: { session } } = await supabaseClient.auth.getSession();
      const res = await fetch(`${FOLLOWUP_BASE}/bookings/${bookingId}/return`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session?.access_token ?? ""}`, "Content-Type": "application/json" },
        body: "{}",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed");
      toast({ title: "Return created", description: `${json.tvl_ref} — set the departure date next.` });
      qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
      navigate(`/bookings/${json.id}`);
    } catch (e: any) {
      toast({ title: "Could not create return", description: e.message, variant: "destructive" });
    }
  };

  const dismissReturn = async (bookingId: string, ref: string) => {
    if (!confirm(`Mark ${ref} as not needing a return trip? It will disappear from this list.`)) return;
    try {
      const { data: { session } } = await supabaseClient.auth.getSession();
      const res = await fetch(`${FOLLOWUP_BASE}/bookings/${bookingId}/dismiss-return-followup`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session?.access_token ?? ""}` },
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed");
      toast({ title: "Removed", description: `${ref} cleared from follow-ups.` });
      qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
    } catch (e: any) {
      toast({ title: "Could not dismiss", description: e.message, variant: "destructive" });
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-48" />
        <div className="grid grid-cols-2 gap-3">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
        <div className="grid grid-cols-3 gap-3">
          {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-20" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
        </p>
      </div>

      {/* Follow-Up Section */}
      {(pendingRequests.length > 0 || awaitingReturn.length > 0) && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="w-4 h-4 text-amber-400" />
              Follow-Up
              <span className="text-xs font-normal text-muted-foreground ml-1">
                ({pendingRequests.length + awaitingReturn.length})
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 space-y-5">

            {/* Pending Requests */}
            {pendingRequests.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-amber-400 flex items-center gap-1.5">
                    <Plus className="w-3 h-3" /> Pending Requests ({pendingRequests.length})
                  </h3>
                  <span className="text-[10px] text-muted-foreground">awaiting confirmation</span>
                </div>
                <div className="space-y-2">
                  {pendingRequests.slice(0, 6).map((b) => {
                    const wa = whatsappLink(b.client?.whatsapp,
                      `Hi ${b.client?.name ?? ""} — confirming your booking ${b.tvl_ref}: ${b.pickup} → ${b.dropoff}. Shall we proceed?`);
                    return (
                      <div key={b.id} className="rounded-lg border border-border bg-card p-2.5 flex items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Link href={`/bookings/${b.id}`}>
                              <span className="text-sm font-semibold text-primary hover:underline cursor-pointer">{b.tvl_ref}</span>
                            </Link>
                            <span className="text-xs text-muted-foreground">·</span>
                            <span className="text-xs text-foreground truncate">{b.client?.name ?? "—"}</span>
                            {b.client?.vip_tier && b.client.vip_tier !== "Standard" && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded bg-primary/15 text-primary uppercase">{b.client.vip_tier}</span>
                            )}
                            <span className="text-[10px] text-amber-400 ml-auto">
                              {b.days_waiting === 0 ? "today" : `${b.days_waiting}d waiting`}
                            </span>
                          </div>
                          <div className="text-[11px] text-muted-foreground truncate mt-0.5">
                            {b.service_type}{b.direction ? ` · ${b.direction}` : ""} · {b.pickup} → {b.dropoff}
                          </div>
                        </div>
                        <div className="flex gap-1 flex-shrink-0">
                          {wa && (
                            <a href={wa} target="_blank" rel="noreferrer">
                              <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]">
                                <MessageCircle className="w-3 h-3 mr-1" /> Message
                              </Button>
                            </a>
                          )}
                          <Button size="sm" className="h-7 px-2 text-[11px]" onClick={() => navigate(`/bookings/${b.id}`)}>
                            Review
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                  {pendingRequests.length > 6 && (
                    <Link href="/bookings?status=Pending">
                      <p className="text-xs text-amber-400 hover:underline cursor-pointer text-center pt-1">
                        + {pendingRequests.length - 6} more pending →
                      </p>
                    </Link>
                  )}
                </div>
              </div>
            )}

            {/* Awaiting Return Trip */}
            {awaitingReturn.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-amber-400 flex items-center gap-1.5">
                    <PlaneLanding className="w-3 h-3" /> Awaiting Return Trip ({awaitingReturn.length})
                  </h3>
                  <span className="text-[10px] text-muted-foreground">arrived, no departure logged</span>
                </div>
                <div className="space-y-2">
                  {awaitingReturn.slice(0, 6).map((b) => {
                    const wa = whatsappLink(b.client?.whatsapp,
                      `Hi ${b.client?.name ?? ""} — hope your stay in London is going well. When you'd like to plan your return airport transfer, just reply here and we'll arrange it. — Traveluxe`);
                    return (
                      <div key={b.id} className="rounded-lg border border-border bg-card p-2.5 flex items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Link href={`/bookings/${b.id}`}>
                              <span className="text-sm font-semibold text-primary hover:underline cursor-pointer">{b.tvl_ref}</span>
                            </Link>
                            <span className="text-xs text-muted-foreground">·</span>
                            <span className="text-xs text-foreground truncate">{b.client?.name ?? "—"}</span>
                            {b.client?.vip_tier && b.client.vip_tier !== "Standard" && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded bg-primary/15 text-primary uppercase">{b.client.vip_tier}</span>
                            )}
                            <span className="text-[10px] text-amber-400 ml-auto">
                              arrived {b.days_since_arrival}d ago
                            </span>
                          </div>
                          <div className="text-[11px] text-muted-foreground truncate mt-0.5">
                            Arrival: {b.pickup} → {b.dropoff}
                          </div>
                        </div>
                        <div className="flex gap-1 flex-shrink-0">
                          {wa && (
                            <a href={wa} target="_blank" rel="noreferrer">
                              <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]">
                                <MessageCircle className="w-3 h-3 mr-1" /> Message
                              </Button>
                            </a>
                          )}
                          <Button size="sm" className="h-7 px-2 text-[11px]"
                            onClick={() => navigate(`/bookings/new?return_from=${b.id}`)}>
                            Log Return
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0"
                            onClick={() => dismissReturn(b.id, b.tvl_ref)}
                            title="Mark as not needing return trip">
                            <X className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

          </CardContent>
        </Card>
      )}

      {/* Urgent: jobs without driver */}
      {s?.jobs_without_driver ? (
        <Link href="/jobs">
          <div className="bg-destructive/10 border border-destructive/30 rounded-xl p-4 flex items-center gap-3 cursor-pointer hover:bg-destructive/15 transition-colors">
            <AlertTriangle className="w-5 h-5 text-destructive flex-shrink-0" />
            <div className="flex-1">
              <p className="font-semibold text-destructive text-sm">
                {s.jobs_without_driver} job{s.jobs_without_driver !== 1 ? "s" : ""} need a driver assigned
              </p>
            </div>
            <ChevronRight className="w-4 h-4 text-destructive" />
          </div>
        </Link>
      ) : null}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-3">
        {/* Active Jobs */}
        <Link href="/jobs?status=Active">
          <Card className="border-border bg-card hover:border-primary/30 transition-colors cursor-pointer">
            <CardHeader className="flex flex-row items-center justify-between pb-1 pt-4 px-4 space-y-0">
              <CardTitle className="text-xs font-medium text-muted-foreground">Active Jobs</CardTitle>
              <Briefcase className="w-4 h-4 text-primary" />
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <div className="text-2xl font-bold text-foreground">{s?.active_jobs ?? 0}</div>
              <p className="text-[11px] text-muted-foreground mt-0.5">Currently running</p>
            </CardContent>
          </Card>
        </Link>

        {/* Upcoming Bookings */}
        <Link href="/bookings?upcoming=1">
          <Card className="border-border bg-card hover:border-primary/30 transition-colors cursor-pointer">
            <CardHeader className="flex flex-row items-center justify-between pb-1 pt-4 px-4 space-y-0">
              <CardTitle className="text-xs font-medium text-muted-foreground">Upcoming Bookings</CardTitle>
              <CalendarRange className="w-4 h-4 text-primary" />
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <div className="text-2xl font-bold text-foreground">{s?.upcoming_bookings ?? 0}</div>
              <p className="text-[11px] text-muted-foreground mt-0.5">From today onwards</p>
            </CardContent>
          </Card>
        </Link>

        {/* Commission to Collect */}
        <Link href="/commissions">
          <Card className="border-border bg-card hover:border-amber-500/20 transition-colors cursor-pointer">
            <CardHeader className="flex flex-row items-center justify-between pb-1 pt-4 px-4 space-y-0">
              <CardTitle className="text-xs font-medium text-muted-foreground">Commission to Collect</CardTitle>
              <Calculator className="w-4 h-4 text-amber-400" />
            </CardHeader>
            <CardContent className="px-4 pb-4">
              {isSuperAdmin ? (
                <div className="text-2xl font-bold text-amber-400">
                  £{(s?.outstanding_commissions ?? 0).toLocaleString()}
                </div>
              ) : (
                <div className="text-2xl font-bold text-amber-400">
                  {s?.outstanding_commissions > 0 ? "Outstanding" : "Clear"}
                </div>
              )}
              <p className="text-[11px] text-muted-foreground mt-0.5">Outstanding from cash jobs</p>
            </CardContent>
          </Card>
        </Link>

        {/* Unpaid Invoices */}
        <Link href="/invoices">
          <Card className="border-border bg-card hover:border-primary/30 transition-colors cursor-pointer">
            <CardHeader className="flex flex-row items-center justify-between pb-1 pt-4 px-4 space-y-0">
              <CardTitle className="text-xs font-medium text-muted-foreground">Unpaid Invoices</CardTitle>
              <Receipt className="w-4 h-4 text-primary" />
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <div className="text-2xl font-bold text-foreground">{s?.unpaid_invoices_count ?? 0}</div>
              <p className="text-[11px] text-muted-foreground mt-0.5">Awaiting payment</p>
            </CardContent>
          </Card>
        </Link>
      </div>

      {/* Quick links — 3×2 grid */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { href: "/jobs",      icon: <Briefcase className="w-5 h-5 text-primary mx-auto mb-2" />,      label: "Jobs Board" },
          { href: "/bookings",  icon: <CalendarRange className="w-5 h-5 text-primary mx-auto mb-2" />,  label: "Bookings" },
          { href: "/services",  icon: <Layers className="w-5 h-5 text-primary mx-auto mb-2" />,         label: "Services" },
          { href: "/clients",   icon: <Users className="w-5 h-5 text-primary mx-auto mb-2" />,          label: "Clients" },
          { href: "/search",    icon: <Search className="w-5 h-5 text-primary mx-auto mb-2" />,         label: "Search" },
          { href: "/invoices",  icon: <Receipt className="w-5 h-5 text-primary mx-auto mb-2" />,        label: "Invoices" },
        ].map(({ href, icon, label }) => (
          <Link key={href} href={href}>
            <div className="rounded-xl border border-border bg-card p-3.5 text-center hover:border-primary/50 hover:bg-secondary/20 transition-all cursor-pointer">
              {icon}
              <span className="text-[11px] font-medium text-foreground">{label}</span>
            </div>
          </Link>
        ))}
      </div>

      {/* Top Clients & Drivers */}
      <div className="space-y-4">
        {s?.top_clients && s.top_clients.length > 0 && (
          <Card className="border-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Top Clients</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="space-y-3">
                {s.top_clients.map((client: any) => (
                  <div key={client.id} className="flex justify-between items-center">
                    <span className="font-medium text-sm">{client.name}</span>
                    {isSuperAdmin ? (
                      <span className="text-primary text-sm font-semibold">£{client.total_spent.toLocaleString()}</span>
                    ) : (
                      <span className="text-muted-foreground text-xs">{client.total_bookings} booking{client.total_bookings !== 1 ? "s" : ""}</span>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {s?.top_drivers && s.top_drivers.length > 0 && (
          <Card className="border-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Top Drivers</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="space-y-3">
                {s.top_drivers.map((driver: any) => (
                  <div key={driver.id} className="flex justify-between items-center">
                    <span className="font-medium text-sm">{driver.name}</span>
                    <div className="flex gap-3 text-xs text-muted-foreground">
                      <span>{driver.total_jobs} jobs</span>
                      <span className="text-primary">{driver.avg_rating.toFixed(1)} ★</span>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
