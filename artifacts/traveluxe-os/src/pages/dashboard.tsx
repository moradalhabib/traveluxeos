import { useGetDashboardSummary, getGetDashboardSummaryQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, Briefcase, PoundSterling, Users, Plus, ChevronRight, Layers } from "lucide-react";
import { Link } from "wouter";

export default function Dashboard() {
  const { data: summary, isLoading } = useGetDashboardSummary({
    query: {
      queryKey: getGetDashboardSummaryQueryKey()
    }
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-16 w-full" />
        <div className="grid grid-cols-2 gap-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-28" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
        </div>
      </div>

      {/* New Booking CTA */}
      <Link href="/bookings/new">
        <div className="relative overflow-hidden rounded-2xl bg-primary p-5 cursor-pointer shadow-[0_0_30px_rgba(201,168,76,0.3)] hover:shadow-[0_0_40px_rgba(201,168,76,0.5)] transition-all active:scale-[0.99]">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-primary-foreground/80 text-sm font-medium mb-1">Ready to take a booking?</p>
              <p className="text-primary-foreground font-bold text-xl">New Booking</p>
            </div>
            <div className="w-14 h-14 rounded-full bg-white/20 flex items-center justify-center">
              <Plus className="w-7 h-7 text-primary-foreground" />
            </div>
          </div>
          {/* decorative circles */}
          <div className="absolute -right-6 -bottom-6 w-28 h-28 rounded-full bg-white/10" />
          <div className="absolute -right-2 -bottom-10 w-20 h-20 rounded-full bg-white/5" />
        </div>
      </Link>

      {/* Urgent alert */}
      {summary?.jobs_without_driver ? (
        <Link href="/jobs">
          <div className="bg-destructive/10 border border-destructive/30 rounded-xl p-4 flex items-center gap-3 cursor-pointer hover:bg-destructive/15 transition-colors">
            <AlertTriangle className="w-5 h-5 text-destructive flex-shrink-0" />
            <div className="flex-1">
              <p className="font-semibold text-destructive text-sm">{summary.jobs_without_driver} jobs need a driver assigned</p>
            </div>
            <ChevronRight className="w-4 h-4 text-destructive" />
          </div>
        </Link>
      ) : null}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-3">
        <Card className="border-border bg-card">
          <CardHeader className="flex flex-row items-center justify-between pb-1 pt-4 px-4 space-y-0">
            <CardTitle className="text-xs font-medium text-muted-foreground">Today's Revenue</CardTitle>
            <PoundSterling className="w-4 h-4 text-primary" />
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="text-2xl font-bold text-foreground">£{(summary?.revenue_today || 0).toLocaleString()}</div>
          </CardContent>
        </Card>

        <Card className="border-border bg-card">
          <CardHeader className="flex flex-row items-center justify-between pb-1 pt-4 px-4 space-y-0">
            <CardTitle className="text-xs font-medium text-muted-foreground">Active Jobs</CardTitle>
            <Briefcase className="w-4 h-4 text-primary" />
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="text-2xl font-bold text-foreground">{summary?.active_jobs || 0}</div>
          </CardContent>
        </Card>

        <Card className="border-border bg-card">
          <CardHeader className="flex flex-row items-center justify-between pb-1 pt-4 px-4 space-y-0">
            <CardTitle className="text-xs font-medium text-muted-foreground">Pending Payouts</CardTitle>
            <PoundSterling className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="text-2xl font-bold text-foreground">£{(summary?.pending_payouts || 0).toLocaleString()}</div>
          </CardContent>
        </Card>

        <Card className="border-border bg-card">
          <CardHeader className="flex flex-row items-center justify-between pb-1 pt-4 px-4 space-y-0">
            <CardTitle className="text-xs font-medium text-muted-foreground">Bookings Today</CardTitle>
            <Users className="w-4 h-4 text-primary" />
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="text-2xl font-bold text-foreground">{summary?.bookings_today || 0}</div>
          </CardContent>
        </Card>
      </div>

      {/* Quick links */}
      <div className="grid grid-cols-2 gap-3">
        <Link href="/jobs">
          <div className="rounded-xl border border-border bg-card p-4 text-center hover:border-primary/50 hover:bg-secondary/20 transition-all cursor-pointer">
            <Briefcase className="w-5 h-5 text-primary mx-auto mb-2" />
            <span className="text-xs font-medium text-foreground">Jobs Board</span>
          </div>
        </Link>
        <Link href="/services">
          <div className="rounded-xl border border-border bg-card p-4 text-center hover:border-primary/50 hover:bg-secondary/20 transition-all cursor-pointer">
            <Layers className="w-5 h-5 text-primary mx-auto mb-2" />
            <span className="text-xs font-medium text-foreground">Services</span>
          </div>
        </Link>
        <Link href="/clients">
          <div className="rounded-xl border border-border bg-card p-4 text-center hover:border-primary/50 hover:bg-secondary/20 transition-all cursor-pointer">
            <Users className="w-5 h-5 text-primary mx-auto mb-2" />
            <span className="text-xs font-medium text-foreground">Clients</span>
          </div>
        </Link>
        <Link href="/drivers">
          <div className="rounded-xl border border-border bg-card p-4 text-center hover:border-primary/50 hover:bg-secondary/20 transition-all cursor-pointer">
            <svg className="w-5 h-5 text-primary mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
            <span className="text-xs font-medium text-foreground">Drivers</span>
          </div>
        </Link>
      </div>

      {/* Top Clients & Drivers */}
      <div className="grid grid-cols-1 gap-4">
        {summary?.top_clients && summary.top_clients.length > 0 && (
          <Card className="border-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Top Clients</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="space-y-3">
                {summary.top_clients.map((client) => (
                  <div key={client.id} className="flex justify-between items-center">
                    <span className="font-medium text-sm">{client.name}</span>
                    <span className="text-primary text-sm font-semibold">£{client.total_spent.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {summary?.top_drivers && summary.top_drivers.length > 0 && (
          <Card className="border-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Top Drivers</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="space-y-3">
                {summary.top_drivers.map((driver) => (
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
