import { useState, useEffect } from "react";
import { useGetDashboardSummary, getGetDashboardSummaryQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Briefcase, ChevronRight, Layers, CalendarRange, Search, Users, Receipt, Calculator, Clock, MessageCircle, Plus, BellRing, Car, Plane } from "lucide-react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { getVipPillClass } from "@/lib/vip";

function getFlightBadgeClass(status?: string) {
  switch (status) {
    case "Delayed":   return "bg-amber-500/15 text-amber-400 border-amber-500/40";
    case "Early":     return "bg-emerald-500/15 text-emerald-400 border-emerald-500/40";
    case "Cancelled": return "bg-red-500/15 text-red-400 border-red-500/40";
    case "Landed":    return "bg-blue-500/15 text-blue-400 border-blue-500/30";
    case "On Time":   return "bg-green-500/15 text-green-400 border-green-500/30";
    default:          return "bg-muted/30 text-muted-foreground border-border";
  }
}

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
  const followUpsPending: number = s?.follow_ups_pending ?? 0;
  const followUpsOverdue: number = s?.follow_ups_overdue ?? 0;
  const todaysJobs: any[] = s?.todays_jobs ?? [];
  // Suppress unused warnings — qc/toast still wired for future handlers
  void qc; void toast;

  // Ticking clock for the starting-soon strip (60 s granularity is fine)
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const startingSoon = todaysJobs.filter(j => {
    if (!j.date_time) return false;
    if (j.status === "Cancelled" || j.status === "Active" || j.status === "Completed") return false;
    const t = new Date(j.date_time).getTime();
    return t >= nowMs && t <= nowMs + 60 * 60 * 1000;
  });

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

      {/* Starting-soon strip — each row individually tappable */}
      {startingSoon.length > 0 && (
        <div className="border border-amber-500/40 bg-amber-500/5 rounded-xl overflow-hidden">
          {/* Header */}
          <div className="flex items-center gap-2 px-4 py-2.5 border-b border-amber-500/20">
            <Clock className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
            <span className="text-xs font-semibold text-amber-400 flex-1">
              Starting within 1 hour
            </span>
            <Badge className="bg-amber-500/20 text-amber-300 border-amber-500/40 text-[10px] mr-2">
              {startingSoon.length}
            </Badge>
            <Link href="/jobs">
              <span className="text-[11px] text-amber-400/70 hover:text-amber-400 transition-colors cursor-pointer">
                View all →
              </span>
            </Link>
          </div>
          {/* Rows — each taps to the booking */}
          {startingSoon.map((j, i) => {
            const minsAway = Math.round((new Date(j.date_time).getTime() - nowMs) / 60000);
            return (
              <Link key={j.id} href={`/bookings/${j.id}`}>
                <div className={`flex items-center gap-3 px-4 py-2.5 hover:bg-amber-500/10 transition-colors cursor-pointer${i < startingSoon.length - 1 ? " border-b border-amber-500/10" : ""}`}>
                  {/* Countdown */}
                  <span className="text-sm font-bold text-amber-400 w-9 flex-shrink-0 text-right">{minsAway}m</span>
                  {/* Ref + client */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] font-mono text-muted-foreground">{j.tvl_ref}</span>
                      <span className="text-xs font-semibold text-foreground truncate">{j.client_name ?? "—"}</span>
                    </div>
                    {j.driver_name
                      ? <p className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-1">
                          <Car className="w-3 h-3" />{j.driver_name}
                        </p>
                      : <p className="text-[10px] text-destructive font-medium mt-0.5">No driver assigned</p>}
                  </div>
                  <ChevronRight className="w-3.5 h-3.5 text-amber-400/50 flex-shrink-0" />
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {/* Follow-Ups summary — count only, links to /follow-ups */}
      {(followUpsPending > 0 || followUpsOverdue > 0) && (
        <Link href="/follow-ups">
          <Card
            className={`cursor-pointer transition-colors hover:bg-amber-500/10 ${
              followUpsOverdue > 0
                ? "border-red-500/40 bg-red-500/5"
                : "border-amber-500/30 bg-amber-500/5"
            }`}
            data-testid="dashboard-followups-card"
          >
            <CardContent className="p-4 flex items-center gap-4">
              <div className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${
                followUpsOverdue > 0 ? "bg-red-500/15 text-red-400" : "bg-amber-500/15 text-amber-400"
              }`}>
                <BellRing className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="text-base font-bold text-foreground">
                    {followUpsPending} follow-up{followUpsPending === 1 ? "" : "s"} pending
                  </span>
                  {followUpsOverdue > 0 && (
                    <Badge variant="outline" className="text-[11px] bg-red-500/15 text-red-400 border-red-500/40">
                      {followUpsOverdue} overdue
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Tap to open the Follow-Ups workspace
                </p>
              </div>
              <ChevronRight className="w-5 h-5 text-muted-foreground flex-shrink-0" />
            </CardContent>
          </Card>
        </Link>
      )}

      {/* Pending Requests — separate workflow (awaiting first-touch confirmation) */}
      {pendingRequests.length > 0 && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="w-4 h-4 text-amber-400" />
              Pending Requests
              <span className="text-xs font-normal text-muted-foreground ml-1">
                ({pendingRequests.length})
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
                              <span className={getVipPillClass(b.client.vip_tier)}>{b.client.vip_tier}</span>
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

          </CardContent>
        </Card>
      )}

      {/* Today's Jobs — next 5 upcoming today (server-ordered by pickup time) */}
      {todaysJobs.length > 0 && (
        <Card className="border-border bg-card">
          <CardHeader className="pb-3 flex flex-row items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Briefcase className="w-4 h-4 text-primary" />
              Today's Jobs
              <span className="text-xs font-normal text-muted-foreground ml-1">
                ({todaysJobs.length})
              </span>
            </CardTitle>
            <Link href="/jobs?time=today">
              <span className="text-xs text-primary hover:underline cursor-pointer">View all →</span>
            </Link>
          </CardHeader>
          <CardContent className="pt-0 space-y-2">
            {todaysJobs.map((j) => {
              const isActive = j.status === "Active";
              return (
                <Link key={j.id} href={`/bookings/${j.id}`}>
                  <div className={`rounded-lg border transition-colors p-2.5 flex items-center gap-3 cursor-pointer ${
                    isActive
                      ? "border-green-500/40 bg-green-500/5 hover:bg-green-500/10"
                      : "border-border bg-background/40 hover:bg-secondary/20"
                  }`}>
                    {/* Time column */}
                    <div className="flex flex-col items-center justify-center w-12 flex-shrink-0">
                      <Clock className={`w-3 h-3 mb-0.5 ${isActive ? "text-green-400" : "text-primary"}`} />
                      <span className={`text-xs font-bold ${isActive ? "text-green-400" : "text-foreground"}`}>
                        {j.date_time ? new Date(j.date_time).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }) : "—"}
                      </span>
                    </div>
                    {/* Client + route */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-foreground truncate">{j.client_name ?? "Unknown"}</span>
                        {j.client_vip_tier && j.client_vip_tier !== "Standard" && (
                          <span className={getVipPillClass(j.client_vip_tier)}>{j.client_vip_tier}</span>
                        )}
                        <span className="text-[10px] font-mono text-muted-foreground">{j.tvl_ref}</span>
                      </div>
                      <div className="text-[11px] text-muted-foreground truncate mt-0.5">
                        {j.service_type}{j.direction ? ` · ${j.direction}` : ""} · {j.pickup ?? "—"} → {j.dropoff ?? "—"}
                      </div>
                      {/* Flight status badge — shown for Airport Transfer jobs with a cached status */}
                      {j.flight_number && (() => {
                        const fs = j.flight_status;
                        const st = fs?.status as string | undefined;
                        const delayMins = fs?.delay_minutes ?? 0;
                        const note = st === "Delayed" && delayMins > 0 ? ` +${delayMins}m`
                                   : st === "Early"   && delayMins < 0 ? ` ${Math.abs(delayMins)}m early` : "";
                        return (
                          <div className="mt-1">
                            <Badge variant="outline" className={`text-[10px] py-0 px-1.5 inline-flex items-center gap-0.5 ${getFlightBadgeClass(st)}`}>
                              <Plane className="w-2.5 h-2.5 flex-shrink-0" />
                              <span className="font-mono font-medium">{j.flight_number}</span>
                              {st && st !== "Unknown" && (
                                <span className="ml-0.5 font-normal opacity-90">{st}{note}</span>
                              )}
                              {!st && (
                                <span className="ml-0.5 font-normal opacity-60">tracking</span>
                              )}
                            </Badge>
                          </div>
                        );
                      })()}
                    </div>
                    {/* Right side: active bell OR driver/no-driver */}
                    <div className="flex flex-col items-end gap-1 flex-shrink-0">
                      {isActive ? (
                        <div className="flex items-center gap-1.5">
                          <span className="relative flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
                          </span>
                          <BellRing className="w-3.5 h-3.5 text-green-400" />
                        </div>
                      ) : j.driver_name ? (
                        <span className="text-[10px] text-foreground flex items-center gap-1">
                          <Car className="w-3 h-3 text-muted-foreground" /> {j.driver_name}
                        </span>
                      ) : (
                        <span className="text-[10px] text-destructive flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" /> No driver
                        </span>
                      )}
                    </div>
                  </div>
                </Link>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* Urgent: jobs without driver. If there's exactly one, deep-link
          straight into that booking's profile. Otherwise jump to the Jobs
          board pre-filtered to "needs driver". */}
      {s?.jobs_without_driver ? (
        <Link
          href={
            s.jobs_without_driver === 1 && s.jobs_without_driver_first_id
              ? `/bookings/${s.jobs_without_driver_first_id}`
              : "/jobs?filter=needs-driver"
          }
        >
          {/* Impossible-to-miss alert — pulse animation, larger surface,
              uppercase label. Admins also receive a WhatsApp notification
              via the no_driver_3h / no_driver_24h scheduler jobs. */}
          <div
            className="relative bg-destructive/15 border-2 border-destructive rounded-xl p-5 flex items-center gap-4 cursor-pointer hover:bg-destructive/20 transition-colors shadow-lg shadow-destructive/20 animate-pulse"
            data-testid="banner-no-driver"
          >
            <div className="w-12 h-12 rounded-full bg-destructive/25 flex items-center justify-center flex-shrink-0">
              <AlertTriangle className="w-6 h-6 text-destructive" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-wider text-destructive/80">
                Driver assignment required
              </p>
              <p className="text-base font-bold text-destructive mt-0.5">
                {s.jobs_without_driver} job{s.jobs_without_driver !== 1 ? "s" : ""} without a driver
              </p>
              <p className="text-[11px] text-destructive/80 mt-0.5">
                Tap to assign — admin has been notified on WhatsApp
              </p>
            </div>
            <ChevronRight className="w-5 h-5 text-destructive flex-shrink-0" />
          </div>
        </Link>
      ) : null}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-3">
        {/* Follow-Ups */}
        <Link href="/follow-ups">
          <Card className="border-border bg-card hover:border-primary/30 transition-colors cursor-pointer">
            <CardHeader className="flex flex-row items-center justify-between pb-1 pt-4 px-4 space-y-0">
              <CardTitle className="text-xs font-medium text-muted-foreground">Follow-Ups</CardTitle>
              <div className="flex items-center gap-1.5">
                {followUpsPending > 0 && (
                  <span className="text-[11px] font-bold text-destructive leading-none">⚠️</span>
                )}
                <BellRing className={`w-4 h-4 ${followUpsPending > 0 ? "text-destructive" : "text-primary"}`} />
              </div>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <div className={`text-2xl font-bold ${followUpsPending > 0 ? "text-destructive" : "text-foreground"}`}>
                {followUpsPending}
              </div>
              <p className="text-[11px] text-muted-foreground mt-0.5">Due Today / Overdue</p>
            </CardContent>
          </Card>
        </Link>

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
        <Link href="/commissions" data-testid="link-commission-card">
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
              <p className="text-[11px] text-muted-foreground mt-0.5">Drivers + suppliers owing TVL</p>
              <div data-testid="text-drivers-with-pending" className="text-[11px] text-muted-foreground mt-1">
                {(s as any)?.drivers_with_pending ?? 0} driver{((s as any)?.drivers_with_pending ?? 0) === 1 ? "" : "s"}
                {" · "}
                {(s as any)?.suppliers_with_pending ?? 0} supplier{((s as any)?.suppliers_with_pending ?? 0) === 1 ? "" : "s"}
              </div>
              {(((s as any)?.drivers_with_overdue ?? 0) + ((s as any)?.suppliers_with_overdue ?? 0)) > 0 && (
                <div data-testid="text-commission-overdue" className="text-[11px] text-destructive mt-0.5">
                  {((s as any)?.drivers_with_overdue ?? 0) + ((s as any)?.suppliers_with_overdue ?? 0)} overdue 30d+
                </div>
              )}
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
