import { useGetDashboardSummary, getGetDashboardSummaryQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, Briefcase, ChevronRight, Layers, CalendarRange, Search, Users, Receipt, Calculator } from "lucide-react";
import { Link } from "wouter";
import { useAuth } from "@/hooks/use-auth";

export default function Dashboard() {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === "super_admin";

  const { data: summary, isLoading } = useGetDashboardSummary({
    query: { queryKey: getGetDashboardSummaryQueryKey() }
  });

  const s = summary as any;

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
