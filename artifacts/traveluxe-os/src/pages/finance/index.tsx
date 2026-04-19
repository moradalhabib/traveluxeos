import { useState } from "react";
import { useGetFinanceSummary, getGetFinanceSummaryQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  PoundSterling, TrendingUp, CreditCard, AlertCircle,
  Car, LayoutDashboard, ChevronRight, CheckCircle2, Clock
} from "lucide-react";
import { Link } from "wouter";

const SERVICE_ICONS: Record<string, string> = {
  "Airport Transfer": "✈",
  "Tour": "🗺",
  "City Tour": "🏛",
  "Chauffeur Tour": "🏰",
  "As Directed": "🕐",
  "Event Transfer": "🎭",
  "Apartment / Accommodation": "🏠",
};

export default function Finance() {
  const [tab, setTab] = useState("overview");

  const { data: summary, isLoading } = useGetFinanceSummary(
    {},
    { query: { enabled: true, queryKey: getGetFinanceSummaryQueryKey({}) } }
  );

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-48" />
        <div className="grid grid-cols-2 gap-3">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-28" />)}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const s = summary as any;
  const driverBreakdown: any[] = s?.driver_commission_breakdown ?? [];
  const serviceBreakdown: any[] = s?.service_breakdown ?? [];
  const outstanding: any[] = s?.outstanding_payments ?? [];
  const operators: any[] = s?.operator_performance ?? [];

  const totalOutstandingCommission = driverBreakdown.reduce((acc: number, d: any) => acc + (d.commission_outstanding ?? 0), 0);
  const totalPendingPayout = driverBreakdown.reduce((acc: number, d: any) => acc + (d.payout_pending ?? 0), 0);

  return (
    <div className="space-y-5 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Finance</h1>
        <Link href="/">
          <Button variant="outline" size="sm" className="border-primary/30 text-primary hover:bg-primary/10">
            <LayoutDashboard className="w-4 h-4 mr-2" />
            Dashboard
          </Button>
        </Link>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl border border-border bg-card p-4">
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp className="w-4 h-4 text-primary" />
            <span className="text-xs text-muted-foreground">Total Revenue</span>
          </div>
          <div className="text-2xl font-bold text-foreground">£{(s?.total_revenue ?? 0).toLocaleString()}</div>
        </div>
        <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4">
          <div className="flex items-center gap-2 mb-1">
            <PoundSterling className="w-4 h-4 text-primary" />
            <span className="text-xs text-muted-foreground">TVL Commission</span>
          </div>
          <div className="text-2xl font-bold text-primary">£{(s?.total_commission ?? 0).toLocaleString()}</div>
        </div>
        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4">
          <div className="flex items-center gap-2 mb-1">
            <AlertCircle className="w-4 h-4 text-amber-500" />
            <span className="text-xs text-muted-foreground">Outstanding Commissions</span>
          </div>
          <div className="text-2xl font-bold text-amber-500">£{totalOutstandingCommission.toLocaleString()}</div>
          <div className="text-[10px] text-muted-foreground mt-0.5">To collect from drivers</div>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4">
          <div className="flex items-center gap-2 mb-1">
            <CreditCard className="w-4 h-4 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Pending Payouts</span>
          </div>
          <div className="text-2xl font-bold text-foreground">£{totalPendingPayout.toLocaleString()}</div>
          <div className="text-[10px] text-muted-foreground mt-0.5">Owed to drivers</div>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="w-full grid grid-cols-4 bg-card border border-border">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="services">Services</TabsTrigger>
          <TabsTrigger value="drivers">Drivers</TabsTrigger>
          <TabsTrigger value="clients">Clients</TabsTrigger>
        </TabsList>

        {/* OVERVIEW */}
        <TabsContent value="overview" className="space-y-4 mt-4">
          {/* Cancellation fees */}
          {(s?.cancellation_fees ?? 0) > 0 && (
            <div className="flex items-center justify-between p-4 rounded-xl border border-border bg-card">
              <span className="text-sm font-medium">Cancellation Fees</span>
              <span className="text-primary font-bold">£{(s?.cancellation_fees ?? 0).toLocaleString()}</span>
            </div>
          )}

          {/* Operator performance */}
          <Card className="border-primary/10">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Operator Performance</CardTitle>
            </CardHeader>
            <CardContent className="pt-0 space-y-3">
              {operators.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">No data yet</p>
              )}
              {operators.map((op: any) => (
                <div key={op.operator_id} className="flex items-center justify-between p-3 rounded-xl border border-border bg-background/50">
                  <div>
                    <div className="font-medium text-sm">{op.operator_name}</div>
                    <div className="text-xs text-muted-foreground">{op.total_bookings} bookings</div>
                  </div>
                  <div className="text-primary font-bold">£{(op.total_revenue ?? 0).toLocaleString()}</div>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        {/* SERVICES BREAKDOWN */}
        <TabsContent value="services" className="space-y-4 mt-4">
          <p className="text-xs text-muted-foreground">Revenue and commission broken down by service type.</p>
          {serviceBreakdown.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">No bookings yet</div>
          ) : (
            <div className="space-y-3">
              {serviceBreakdown.map((svc: any) => (
                <div key={svc.service_type} className="p-4 rounded-2xl border border-border bg-card hover:border-primary/30 transition-colors">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xl">{SERVICE_ICONS[svc.service_type] ?? "📋"}</span>
                      <div>
                        <div className="font-semibold text-sm text-foreground">{svc.service_type}</div>
                        <div className="text-xs text-muted-foreground">{svc.count} {svc.count === 1 ? "booking" : "bookings"}</div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-bold text-foreground">£{(svc.revenue ?? 0).toLocaleString()}</div>
                      <div className="text-xs text-muted-foreground">revenue</div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between pt-3 border-t border-border">
                    <span className="text-xs text-muted-foreground">TVL Commission</span>
                    <span className="text-primary font-semibold text-sm">£{(svc.commission ?? 0).toLocaleString()}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        {/* DRIVER COMMISSIONS */}
        <TabsContent value="drivers" className="space-y-4 mt-4">
          <p className="text-xs text-muted-foreground">
            Commission owed to Traveluxe and payouts owed to each driver.
          </p>
          {driverBreakdown.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">No driver data yet</div>
          ) : (
            <div className="space-y-3">
              {driverBreakdown.map((d: any) => (
                <div key={d.driver_id} className="rounded-2xl border border-border bg-card overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                        <Car className="w-4 h-4 text-primary" />
                      </div>
                      <div>
                        <div className="font-semibold text-sm">{d.driver_name}</div>
                        <div className="text-xs text-muted-foreground">{d.jobs} {d.jobs === 1 ? "job" : "jobs"}</div>
                      </div>
                    </div>
                    <Link href={`/commissions?driver=${d.driver_id}`}>
                      <Button variant="ghost" size="sm" className="text-xs text-primary h-7 px-2">
                        View <ChevronRight className="w-3 h-3 ml-1" />
                      </Button>
                    </Link>
                  </div>
                  <div className="grid grid-cols-2 divide-x divide-border">
                    <div className="px-4 py-3">
                      <div className="text-xs text-muted-foreground mb-1">Commission Owed to TVL</div>
                      <div className="font-bold text-foreground">£{(d.commission_owed ?? 0).toLocaleString()}</div>
                      {(d.commission_outstanding ?? 0) > 0 ? (
                        <div className="flex items-center gap-1 mt-1">
                          <Clock className="w-3 h-3 text-amber-500" />
                          <span className="text-[10px] text-amber-500">£{(d.commission_outstanding ?? 0).toLocaleString()} outstanding</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 mt-1">
                          <CheckCircle2 className="w-3 h-3 text-green-500" />
                          <span className="text-[10px] text-green-500">All settled</span>
                        </div>
                      )}
                    </div>
                    <div className="px-4 py-3">
                      <div className="text-xs text-muted-foreground mb-1">Driver Payout</div>
                      <div className="font-bold text-foreground">£{(d.driver_payout ?? 0).toLocaleString()}</div>
                      {(d.payout_pending ?? 0) > 0 ? (
                        <div className="flex items-center gap-1 mt-1">
                          <Clock className="w-3 h-3 text-amber-500" />
                          <span className="text-[10px] text-amber-500">£{(d.payout_pending ?? 0).toLocaleString()} pending</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 mt-1">
                          <CheckCircle2 className="w-3 h-3 text-green-500" />
                          <span className="text-[10px] text-green-500">All paid</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        {/* OUTSTANDING CLIENT PAYMENTS */}
        <TabsContent value="clients" className="space-y-4 mt-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">Bookings with unpaid or partially paid invoices.</p>
            {outstanding.length > 0 && (
              <Badge variant="outline" className="text-amber-500 border-amber-500/30">
                £{outstanding.reduce((s: number, b: any) => s + (b.price ?? 0), 0).toLocaleString()} total
              </Badge>
            )}
          </div>
          {outstanding.length === 0 ? (
            <div className="text-center py-12">
              <CheckCircle2 className="w-10 h-10 text-green-500/50 mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">All clients are paid up</p>
            </div>
          ) : (
            <div className="space-y-2">
              {outstanding.map((booking: any) => (
                <Link key={booking.id} href={`/bookings/${booking.id}`}>
                  <div className="flex items-center justify-between p-3 rounded-xl border border-border bg-card hover:border-primary/30 transition-colors cursor-pointer">
                    <div>
                      <div className="font-medium text-sm">{booking.client_name}</div>
                      <div className="text-xs text-muted-foreground font-mono">{booking.tvl_ref}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">{booking.service_type}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-primary font-bold">£{(booking.price ?? 0).toLocaleString()}</div>
                      <Badge variant="outline" className="text-[10px] mt-1 text-amber-500 border-amber-500/30">
                        {booking.payment_status}
                      </Badge>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
