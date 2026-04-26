import { useState, useEffect } from "react";
import { useGetDashboardSummary, getGetDashboardSummaryQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Briefcase, ChevronRight, Layers, CalendarRange, Search, Users, Receipt, Calculator, Clock, MessageCircle, BellRing, Car, Plane, Bell, X, Inbox } from "lucide-react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { getVipPillClass } from "@/lib/vip";
import { requestPushPermission, getPushPermission } from "@/hooks/use-notifications";

const PUSH_DISMISSED_KEY = "tvl_push_prompt_dismissed";

function PushPromptBanner() {
  const [perm, setPerm] = useState<string>(() => getPushPermission());
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try { return localStorage.getItem(PUSH_DISMISSED_KEY) === "1"; } catch { return false; }
  });
  const [busy, setBusy] = useState(false);

  if (perm === "granted" || perm === "unsupported" || dismissed) return null;

  const handleEnable = async () => {
    setBusy(true);
    const result = await requestPushPermission();
    setPerm(result);
    setBusy(false);
  };

  const handleDismiss = () => {
    setDismissed(true);
    try { localStorage.setItem(PUSH_DISMISSED_KEY, "1"); } catch {}
  };

  return (
    <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 flex items-center gap-3">
      <div className="w-8 h-8 rounded-lg bg-primary/15 flex items-center justify-center flex-shrink-0">
        <Bell className="w-4 h-4 text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-foreground leading-tight">Enable phone alerts</p>
        <p className="text-[10px] text-muted-foreground mt-0.5">
          {perm === "denied"
            ? "Notifications blocked — allow them in your browser settings"
            : "Get instant alerts for new bookings & requests, even when the app is closed"}
        </p>
      </div>
      {perm !== "denied" && (
        <Button size="sm" className="h-7 px-3 text-[11px] flex-shrink-0" onClick={handleEnable} disabled={busy}>
          {busy ? "…" : "Enable"}
        </Button>
      )}
      <button
        className="p-1 rounded hover:bg-secondary/60 flex-shrink-0"
        onClick={handleDismiss}
        aria-label="Dismiss"
      >
        <X className="w-3.5 h-3.5 text-muted-foreground" />
      </button>
    </div>
  );
}

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
  void qc; void toast;

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
      <div className="space-y-3">
        <Skeleton className="h-8 w-40" />
        <div className="grid grid-cols-2 gap-2">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-20" />)}
        </div>
        <div className="grid grid-cols-3 gap-2">
          {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-16" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Header — compact row */}
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-bold tracking-tight text-foreground">Dashboard</h1>
        <p className="text-xs text-muted-foreground">
          {new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
        </p>
      </div>

      {/* Push notification opt-in — shows once until dismissed or granted */}
      <PushPromptBanner />

      {/* Starting-soon strip */}
      {startingSoon.length > 0 && (
        <div className="border border-amber-500/40 bg-amber-500/5 rounded-xl overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-amber-500/20">
            <Clock className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
            <span className="text-xs font-semibold text-amber-400 flex-1">Starting within 1 hour</span>
            <Badge className="bg-amber-500/20 text-amber-300 border-amber-500/40 text-[10px]">
              {startingSoon.length}
            </Badge>
            <Link href="/jobs">
              <span className="text-[11px] text-amber-400/70 hover:text-amber-400 transition-colors cursor-pointer ml-2">
                View all →
              </span>
            </Link>
          </div>
          {startingSoon.map((j, i) => {
            const minsAway = Math.round((new Date(j.date_time).getTime() - nowMs) / 60000);
            return (
              <Link key={j.id} href={`/bookings/${j.id}`}>
                <div className={`flex items-center gap-3 px-3 py-2 hover:bg-amber-500/10 transition-colors cursor-pointer${i < startingSoon.length - 1 ? " border-b border-amber-500/10" : ""}`}>
                  <span className="text-sm font-bold text-amber-400 w-9 flex-shrink-0 text-right">{minsAway}m</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] font-mono text-muted-foreground">{j.tvl_ref}</span>
                      <span className="text-xs font-semibold text-foreground truncate">{j.client_name ?? "—"}</span>
                    </div>
                    {j.driver_name
                      ? <p className="text-[10px] text-muted-foreground flex items-center gap-1"><Car className="w-3 h-3" />{j.driver_name}</p>
                      : <p className="text-[10px] text-destructive font-medium">No driver assigned</p>}
                  </div>
                  <ChevronRight className="w-3.5 h-3.5 text-amber-400/50 flex-shrink-0" />
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {/* No-driver urgent alert */}
      {s?.jobs_without_driver ? (
        <Link
          href={
            s.jobs_without_driver === 1 && s.jobs_without_driver_first_id
              ? `/bookings/${s.jobs_without_driver_first_id}`
              : "/jobs?filter=needs-driver"
          }
        >
          <div
            className="bg-destructive/15 border-2 border-destructive rounded-xl p-3.5 flex items-center gap-3 cursor-pointer hover:bg-destructive/20 transition-colors animate-pulse"
            data-testid="banner-no-driver"
          >
            <div className="w-9 h-9 rounded-full bg-destructive/25 flex items-center justify-center flex-shrink-0">
              <AlertTriangle className="w-5 h-5 text-destructive" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-wider text-destructive/80">Driver assignment required</p>
              <p className="text-sm font-bold text-destructive">
                {s.jobs_without_driver} job{s.jobs_without_driver !== 1 ? "s" : ""} without a driver
              </p>
              <p className="text-[10px] text-destructive/70">Tap to assign — admin notified on WhatsApp</p>
            </div>
            <ChevronRight className="w-4 h-4 text-destructive flex-shrink-0" />
          </div>
        </Link>
      ) : null}

      {/* Follow-Ups banner */}
      {(followUpsPending > 0 || followUpsOverdue > 0) && (
        <Link href="/follow-ups">
          <Card
            className={`cursor-pointer transition-colors hover:bg-amber-500/10 ${
              followUpsOverdue > 0 ? "border-red-500/40 bg-red-500/5" : "border-amber-500/30 bg-amber-500/5"
            }`}
            data-testid="dashboard-followups-card"
          >
            <CardContent className="p-3 flex items-center gap-3">
              <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${
                followUpsOverdue > 0 ? "bg-red-500/15 text-red-400" : "bg-amber-500/15 text-amber-400"
              }`}>
                <BellRing className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-foreground">
                    {followUpsPending} follow-up{followUpsPending === 1 ? "" : "s"} pending
                  </span>
                  {followUpsOverdue > 0 && (
                    <Badge variant="outline" className="text-[10px] bg-red-500/15 text-red-400 border-red-500/40">
                      {followUpsOverdue} overdue
                    </Badge>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground">Tap to open Follow-Ups workspace</p>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
            </CardContent>
          </Card>
        </Link>
      )}

      {/* Pending Requests */}
      {pendingRequests.length > 0 && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardHeader className="pb-2 pt-3 px-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Clock className="w-3.5 h-3.5 text-amber-400" />
              Pending Requests
              <span className="text-xs font-normal text-muted-foreground">({pendingRequests.length}) awaiting confirmation</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 px-3 pb-3 space-y-1.5">
            {pendingRequests.slice(0, 6).map((b) => {
              const wa = whatsappLink(b.client?.whatsapp,
                `Hi ${b.client?.name ?? ""} — confirming your booking ${b.tvl_ref}: ${b.pickup} → ${b.dropoff}. Shall we proceed?`);
              return (
                <div key={b.id} className="rounded-lg border border-border bg-card p-2 flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <Link href={`/bookings/${b.id}`}>
                        <span className="text-xs font-semibold text-primary hover:underline cursor-pointer">{b.tvl_ref}</span>
                      </Link>
                      <span className="text-xs text-foreground truncate">{b.client?.name ?? "—"}</span>
                      {b.client?.vip_tier && b.client.vip_tier !== "Standard" && (
                        <span className={getVipPillClass(b.client.vip_tier)}>{b.client.vip_tier}</span>
                      )}
                      <span className="text-[10px] text-amber-400 ml-auto">
                        {b.days_waiting === 0 ? "today" : `${b.days_waiting}d`}
                      </span>
                    </div>
                    <div className="text-[10px] text-muted-foreground truncate">
                      {b.service_type}{b.direction ? ` · ${b.direction}` : ""} · {b.pickup} → {b.dropoff}
                    </div>
                  </div>
                  <div className="flex gap-1 flex-shrink-0">
                    {wa && (
                      <a href={wa} target="_blank" rel="noreferrer">
                        <Button size="sm" variant="outline" className="h-6 px-1.5 text-[10px]">
                          <MessageCircle className="w-3 h-3" />
                        </Button>
                      </a>
                    )}
                    <Button size="sm" className="h-6 px-2 text-[10px]" onClick={() => navigate(`/bookings/${b.id}`)}>
                      Review
                    </Button>
                  </div>
                </div>
              );
            })}
            {pendingRequests.length > 6 && (
              <Link href="/bookings?status=Pending">
                <p className="text-xs text-amber-400 hover:underline cursor-pointer text-center pt-0.5">
                  + {pendingRequests.length - 6} more →
                </p>
              </Link>
            )}
          </CardContent>
        </Card>
      )}

      {/* Today's Jobs */}
      {todaysJobs.length > 0 && (
        <Card className="border-border bg-card">
          <CardHeader className="pb-2 pt-3 px-3 flex flex-row items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <Briefcase className="w-3.5 h-3.5 text-primary" />
              Today's Jobs
              <span className="text-xs font-normal text-muted-foreground">({todaysJobs.length})</span>
            </CardTitle>
            <Link href="/jobs?time=today">
              <span className="text-xs text-primary hover:underline cursor-pointer">View all →</span>
            </Link>
          </CardHeader>
          <CardContent className="pt-0 px-3 pb-3 space-y-1.5">
            {todaysJobs.map((j) => {
              const isActive = j.status === "Active";
              return (
                <Link key={j.id} href={`/bookings/${j.id}`}>
                  <div className={`rounded-lg border transition-colors p-2 flex items-center gap-2.5 cursor-pointer ${
                    isActive
                      ? "border-green-500/40 bg-green-500/5 hover:bg-green-500/10"
                      : "border-border bg-background/40 hover:bg-secondary/20"
                  }`}>
                    <div className="flex flex-col items-center justify-center w-10 flex-shrink-0">
                      <Clock className={`w-3 h-3 mb-0.5 ${isActive ? "text-green-400" : "text-primary"}`} />
                      <span className={`text-xs font-bold ${isActive ? "text-green-400" : "text-foreground"}`}>
                        {j.date_time ? new Date(j.date_time).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }) : "—"}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-xs font-semibold text-foreground truncate">{j.client_name ?? "Unknown"}</span>
                        {j.client_vip_tier && j.client_vip_tier !== "Standard" && (
                          <span className={getVipPillClass(j.client_vip_tier)}>{j.client_vip_tier}</span>
                        )}
                        <span className="text-[10px] font-mono text-muted-foreground">{j.tvl_ref}</span>
                      </div>
                      <div className="text-[10px] text-muted-foreground truncate">
                        {j.service_type}{j.direction ? ` · ${j.direction}` : ""} · {j.pickup ?? "—"} → {j.dropoff ?? "—"}
                      </div>
                      {j.flight_number && (() => {
                        const fs = j.flight_status;
                        const st = fs?.status as string | undefined;
                        const delayMins = fs?.delay_minutes ?? 0;
                        const note = st === "Delayed" && delayMins > 0 ? ` +${delayMins}m`
                                   : st === "Early" && delayMins < 0 ? ` ${Math.abs(delayMins)}m early` : "";
                        return (
                          <div className="mt-0.5">
                            <Badge variant="outline" className={`text-[10px] py-0 px-1.5 inline-flex items-center gap-0.5 ${getFlightBadgeClass(st)}`}>
                              <Plane className="w-2.5 h-2.5 flex-shrink-0" />
                              <span className="font-mono font-medium">{j.flight_number}</span>
                              {st && st !== "Unknown" && <span className="ml-0.5 font-normal opacity-90">{st}{note}</span>}
                              {!st && <span className="ml-0.5 font-normal opacity-60">tracking</span>}
                            </Badge>
                          </div>
                        );
                      })()}
                    </div>
                    <div className="flex flex-col items-end gap-1 flex-shrink-0">
                      {isActive ? (
                        <div className="flex items-center gap-1">
                          <span className="relative flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
                          </span>
                          <BellRing className="w-3 h-3 text-green-400" />
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

      {/* KPI Cards — 2-col grid, tighter */}
      <div className="grid grid-cols-2 gap-2">
        <Link href="/follow-ups">
          <Card className="border-border bg-card hover:border-primary/30 transition-colors cursor-pointer">
            <CardHeader className="flex flex-row items-center justify-between pb-0 pt-3 px-3 space-y-0">
              <CardTitle className="text-[11px] font-medium text-muted-foreground">Follow-Ups</CardTitle>
              <div className="flex items-center gap-1">
                {followUpsPending > 0 && <span className="text-[11px] font-bold text-destructive leading-none">⚠️</span>}
                <BellRing className={`w-3.5 h-3.5 ${followUpsPending > 0 ? "text-destructive" : "text-primary"}`} />
              </div>
            </CardHeader>
            <CardContent className="px-3 pb-3 pt-1">
              <div className={`text-xl font-bold ${followUpsPending > 0 ? "text-destructive" : "text-foreground"}`}>
                {followUpsPending}
              </div>
              <p className="text-[10px] text-muted-foreground">Due today / overdue</p>
            </CardContent>
          </Card>
        </Link>

        <Link href="/jobs?status=Active">
          <Card className="border-border bg-card hover:border-primary/30 transition-colors cursor-pointer">
            <CardHeader className="flex flex-row items-center justify-between pb-0 pt-3 px-3 space-y-0">
              <CardTitle className="text-[11px] font-medium text-muted-foreground">Active Jobs</CardTitle>
              <Briefcase className="w-3.5 h-3.5 text-primary" />
            </CardHeader>
            <CardContent className="px-3 pb-3 pt-1">
              <div className="text-xl font-bold text-foreground">{s?.active_jobs ?? 0}</div>
              <p className="text-[10px] text-muted-foreground">Currently running</p>
            </CardContent>
          </Card>
        </Link>

        <Link href="/bookings?upcoming=1">
          <Card className="border-border bg-card hover:border-primary/30 transition-colors cursor-pointer">
            <CardHeader className="flex flex-row items-center justify-between pb-0 pt-3 px-3 space-y-0">
              <CardTitle className="text-[11px] font-medium text-muted-foreground">Upcoming Bookings</CardTitle>
              <CalendarRange className="w-3.5 h-3.5 text-primary" />
            </CardHeader>
            <CardContent className="px-3 pb-3 pt-1">
              <div className="text-xl font-bold text-foreground">{s?.upcoming_bookings ?? 0}</div>
              <p className="text-[10px] text-muted-foreground">From today onwards</p>
            </CardContent>
          </Card>
        </Link>

        <Link href="/commissions" data-testid="link-commission-card">
          <Card className="border-border bg-card hover:border-amber-500/20 transition-colors cursor-pointer">
            <CardHeader className="flex flex-row items-center justify-between pb-0 pt-3 px-3 space-y-0">
              <CardTitle className="text-[11px] font-medium text-muted-foreground">Commission Due</CardTitle>
              <Calculator className="w-3.5 h-3.5 text-amber-400" />
            </CardHeader>
            <CardContent className="px-3 pb-3 pt-1">
              {isSuperAdmin ? (
                <div className="text-xl font-bold text-amber-400">
                  £{(s?.outstanding_commissions ?? 0).toLocaleString()}
                </div>
              ) : (
                <div className="text-xl font-bold text-amber-400">
                  {s?.outstanding_commissions > 0 ? "Outstanding" : "Clear"}
                </div>
              )}
              <div data-testid="text-drivers-with-pending" className="text-[10px] text-muted-foreground">
                {(s as any)?.drivers_with_pending ?? 0} driver{((s as any)?.drivers_with_pending ?? 0) === 1 ? "" : "s"}
                {" · "}
                {(s as any)?.suppliers_with_pending ?? 0} supplier{((s as any)?.suppliers_with_pending ?? 0) === 1 ? "" : "s"}
              </div>
              {(((s as any)?.drivers_with_overdue ?? 0) + ((s as any)?.suppliers_with_overdue ?? 0)) > 0 && (
                <div data-testid="text-commission-overdue" className="text-[10px] text-destructive">
                  {((s as any)?.drivers_with_overdue ?? 0) + ((s as any)?.suppliers_with_overdue ?? 0)} overdue 30d+
                </div>
              )}
            </CardContent>
          </Card>
        </Link>

        <Link href="/invoices">
          <Card className="border-border bg-card hover:border-primary/30 transition-colors cursor-pointer">
            <CardHeader className="flex flex-row items-center justify-between pb-0 pt-3 px-3 space-y-0">
              <CardTitle className="text-[11px] font-medium text-muted-foreground">Unpaid Invoices</CardTitle>
              <Receipt className="w-3.5 h-3.5 text-primary" />
            </CardHeader>
            <CardContent className="px-3 pb-3 pt-1">
              <div className="text-xl font-bold text-foreground">{s?.unpaid_invoices_count ?? 0}</div>
              <p className="text-[10px] text-muted-foreground">Awaiting payment</p>
            </CardContent>
          </Card>
        </Link>

        <Link href="/bookings?status=Pending">
          <Card className="border-border bg-card hover:border-primary/30 transition-colors cursor-pointer">
            <CardHeader className="flex flex-row items-center justify-between pb-0 pt-3 px-3 space-y-0">
              <CardTitle className="text-[11px] font-medium text-muted-foreground">Pending Requests</CardTitle>
              <Inbox className={`w-3.5 h-3.5 ${(s?.pending_requests?.length ?? 0) > 0 ? "text-amber-400" : "text-primary"}`} />
            </CardHeader>
            <CardContent className="px-3 pb-3 pt-1">
              <div className={`text-xl font-bold ${(s?.pending_requests?.length ?? 0) > 0 ? "text-amber-400" : "text-foreground"}`}>
                {s?.pending_requests?.length ?? 0}
              </div>
              <p className="text-[10px] text-muted-foreground">Awaiting confirmation</p>
            </CardContent>
          </Card>
        </Link>
      </div>

      {/* Quick links — 3-col grid, compact */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { href: "/jobs",      icon: <Briefcase className="w-4 h-4 text-primary mx-auto mb-1" />,      label: "Jobs Board" },
          { href: "/bookings",  icon: <CalendarRange className="w-4 h-4 text-primary mx-auto mb-1" />,  label: "Bookings" },
          { href: "/services",  icon: <Layers className="w-4 h-4 text-primary mx-auto mb-1" />,         label: "Services" },
          { href: "/clients",   icon: <Users className="w-4 h-4 text-primary mx-auto mb-1" />,          label: "Clients" },
          { href: "/search",    icon: <Search className="w-4 h-4 text-primary mx-auto mb-1" />,         label: "Search" },
          { href: "/invoices",  icon: <Receipt className="w-4 h-4 text-primary mx-auto mb-1" />,        label: "Invoices" },
        ].map(({ href, icon, label }) => (
          <Link key={href} href={href}>
            <div className="rounded-xl border border-border bg-card p-2.5 text-center hover:border-primary/50 hover:bg-secondary/20 transition-all cursor-pointer">
              {icon}
              <span className="text-[10px] font-medium text-foreground">{label}</span>
            </div>
          </Link>
        ))}
      </div>

      {/* Top Clients & Drivers — side by side if both present */}
      {(s?.top_clients?.length > 0 || s?.top_drivers?.length > 0) && (
        <div className={`grid gap-2 ${s?.top_clients?.length > 0 && s?.top_drivers?.length > 0 ? "grid-cols-2" : "grid-cols-1"}`}>
          {s?.top_clients?.length > 0 && (
            <Card className="border-border">
              <CardHeader className="pb-2 pt-3 px-3">
                <CardTitle className="text-xs font-semibold">Top Clients</CardTitle>
              </CardHeader>
              <CardContent className="px-3 pb-3 pt-0 space-y-1.5">
                {s.top_clients.map((client: any) => (
                  <div key={client.id} className="flex justify-between items-center">
                    <span className="text-xs text-foreground truncate mr-2">{client.name}</span>
                    {isSuperAdmin ? (
                      <span className="text-primary text-xs font-semibold flex-shrink-0">£{client.total_spent.toLocaleString()}</span>
                    ) : (
                      <span className="text-muted-foreground text-[10px] flex-shrink-0">{client.total_bookings} bkgs</span>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {s?.top_drivers?.length > 0 && (
            <Card className="border-border">
              <CardHeader className="pb-2 pt-3 px-3">
                <CardTitle className="text-xs font-semibold">Top Drivers</CardTitle>
              </CardHeader>
              <CardContent className="px-3 pb-3 pt-0 space-y-1.5">
                {s.top_drivers.map((driver: any) => (
                  <div key={driver.id} className="flex justify-between items-center">
                    <span className="text-xs text-foreground truncate mr-2">{driver.name}</span>
                    <span className="text-[10px] text-muted-foreground flex-shrink-0">{driver.total_jobs} jobs</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
