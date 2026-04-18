import { useGetFinanceSummary, getGetFinanceSummaryQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PoundSterling, TrendingUp, CreditCard, XCircle } from "lucide-react";

export default function Finance() {
  const { data: summary, isLoading } = useGetFinanceSummary(
    {}, 
    { query: { enabled: true, queryKey: getGetFinanceSummaryQueryKey({}) } }
  );

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-48" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-32" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Finance Dashboard</h1>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="border-border bg-card">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Revenue</CardTitle>
            <TrendingUp className="w-4 h-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-foreground">£{summary?.total_revenue.toLocaleString() || 0}</div>
          </CardContent>
        </Card>
        
        <Card className="border-border bg-card">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">TVL Commission</CardTitle>
            <PoundSterling className="w-4 h-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-primary">£{summary?.total_commission.toLocaleString() || 0}</div>
            <p className="text-xs text-muted-foreground mt-1">Total company profit</p>
          </CardContent>
        </Card>

        <Card className="border-border bg-card">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">Driver Payouts</CardTitle>
            <CreditCard className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-foreground">£{summary?.total_driver_payouts.toLocaleString() || 0}</div>
            <p className="text-xs text-muted-foreground mt-1">Paid or owed to drivers</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
        <Card className="border-primary/10">
          <CardHeader>
            <CardTitle className="text-lg flex justify-between items-center">
              <span>Outstanding Client Payments</span>
              <Badge variant="outline" className="text-amber-500 border-amber-500/20">{summary?.outstanding_payments?.length || 0}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {summary?.outstanding_payments?.map((booking) => (
                <div key={booking.id} className="flex justify-between items-center p-3 rounded border border-border bg-background/50">
                  <div>
                    <div className="font-medium text-sm">{booking.client_name}</div>
                    <div className="text-xs text-muted-foreground font-mono">{booking.tvl_ref}</div>
                  </div>
                  <div className="text-right">
                    <span className="text-primary font-bold">£{booking.price.toLocaleString()}</span>
                  </div>
                </div>
              ))}
              {!summary?.outstanding_payments?.length && (
                <div className="text-center py-4 text-muted-foreground text-sm">All clients paid up.</div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="border-primary/10">
          <CardHeader>
            <CardTitle className="text-lg">Operator Performance</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {summary?.operator_performance?.map((op) => (
                <div key={op.operator_id} className="flex justify-between items-center">
                  <span className="font-medium">{op.operator_name}</span>
                  <div className="flex gap-4 text-sm text-muted-foreground text-right">
                    <span className="w-20">{op.total_bookings} bookings</span>
                    <span className="text-primary w-24">£{op.total_revenue.toLocaleString()}</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Badge({ children, className, variant }: any) {
  return <div className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 ${className}`}>{children}</div>;
}
