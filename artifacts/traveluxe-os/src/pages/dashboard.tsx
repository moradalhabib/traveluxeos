import { useGetDashboardSummary, getGetDashboardSummaryQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Briefcase, ChevronRight, Layers, CalendarRange, Search, Users, Receipt, Calculator, Clock, MessageCircle, Plus, BellRing, Car } from "lucide-react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";

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
            {todaysJobs.map((j) => (
              <Link key={j.id} href={`/bookings/${j.id}`}>
                <div className="rounded-lg border border-border bg-background/40 hover:bg-secondary/20 transition-colors p-2.5 flex items-center gap-3 cursor-pointer">
                  <div className="flex flex-col items-center justify-center w-12 flex-shrink-0">
                    <Clock className="w-3 h-3 text-primary mb-0.5" />
                    <span className="text-xs font-bold text-foreground">
                      {j.date_time ? new Date(j.date_time).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }) : "—"}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-foreground truncate">{j.client_name ?? "Unknown"}</span>
                      {j.client_vip_tier && j.client_vip_tier !== "Standard" && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-primary/15 text-primary uppercase">{j.client_vip_tier}</span>
                      )}
                      <span className="text-[10px] font-mono text-muted-foreground">{j.tvl_ref}</span>
                    </div>
                    <div className="text-[11px] text-muted-foreground truncate mt-0.5">
                      {j.service_type}{j.direction ? ` · ${j.direction}` : ""} · {j.pickup ?? "—"} → {j.dropoff ?? "—"}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    {j.driver_name ? (
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
            ))}
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
