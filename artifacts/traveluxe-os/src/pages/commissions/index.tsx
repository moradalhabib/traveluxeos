import { useListCommissions, getListCommissionsQueryKey, useCreateSettlement, useCreatePayout } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Calculator, Check, MessageSquare } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function Commissions() {
  const { data: summary, isLoading, refetch } = useListCommissions(
    { query: { enabled: true, queryKey: getListCommissionsQueryKey() } }
  );

  const settle = useCreateSettlement();
  const payout = useCreatePayout();
  const { toast } = useToast();

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-48" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[...Array(2)].map((_, i) => <Skeleton key={i} className="h-32" />)}
        </div>
      </div>
    );
  }

  const handleSettle = (driverId: string) => {
    // In a real app we'd pass week_start and week_end explicitly
    settle.mutate({ data: { driver_id: driverId, week_start: "2024-01-01", week_end: "2024-01-07", booking_ids: [] } }, {
      onSuccess: () => {
        toast({ title: "Marked as Settled" });
        refetch();
      }
    });
  };

  const handlePayout = (driverId: string) => {
    payout.mutate({ data: { driver_id: driverId, week_start: "2024-01-01", week_end: "2024-01-07", booking_ids: [] } }, {
      onSuccess: () => {
        toast({ title: "Marked as Paid" });
        refetch();
      }
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Commissions</h1>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <Card className="border-border bg-card">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">Outstanding (Cash Jobs)</CardTitle>
            <Calculator className="w-4 h-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">£{summary?.total_outstanding.toLocaleString() || 0}</div>
            <p className="text-xs text-muted-foreground mt-1">Owed by drivers to TVL</p>
          </CardContent>
        </Card>
        <Card className="border-border bg-card">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">Pending Payouts (Bank/Card Jobs)</CardTitle>
            <Calculator className="w-4 h-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">£{summary?.total_pending_payouts.toLocaleString() || 0}</div>
            <p className="text-xs text-muted-foreground mt-1">Owed by TVL to drivers</p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="outstanding" className="w-full">
        <TabsList className="grid w-full grid-cols-2 max-w-[400px]">
          <TabsTrigger value="outstanding">Owed to TVL</TabsTrigger>
          <TabsTrigger value="payouts">Owed to Drivers</TabsTrigger>
        </TabsList>
        
        <TabsContent value="outstanding" className="mt-4 space-y-4">
          {summary?.driver_breakdown?.filter(d => d.outstanding_amount > 0).map((driver) => (
            <Card key={driver.driver_id} className="border-primary/10">
              <CardContent className="p-4 sm:p-6 flex flex-col sm:flex-row justify-between gap-4">
                <div>
                  <h3 className="font-bold text-lg mb-1">{driver.driver_name}</h3>
                  <div className="text-2xl font-bold text-primary">£{driver.outstanding_amount.toLocaleString()}</div>
                  <div className="text-sm text-muted-foreground mt-2">
                    {driver.jobs.filter(j => j.payment_method === 'Cash' && j.commission_status !== 'Settled').length} pending jobs
                  </div>
                </div>
                <div className="flex flex-col gap-2 min-w-[200px]">
                  <Button className="w-full bg-green-900/20 text-green-500 hover:bg-green-900/40 border border-green-900/50">
                    <MessageSquare className="w-4 h-4 mr-2" /> Send Statement
                  </Button>
                  <Button variant="outline" className="w-full text-green-500 hover:bg-green-500/10" onClick={() => handleSettle(driver.driver_id)}>
                    <Check className="w-4 h-4 mr-2" /> Mark as Settled
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
          {!summary?.driver_breakdown?.some(d => d.outstanding_amount > 0) && (
            <div className="py-12 text-center text-muted-foreground border border-dashed rounded-lg">
              No outstanding commissions owed to TVL.
            </div>
          )}
        </TabsContent>

        <TabsContent value="payouts" className="mt-4 space-y-4">
          {summary?.driver_breakdown?.filter(d => d.pending_payout > 0).map((driver) => (
            <Card key={`payout-${driver.driver_id}`} className="border-primary/10">
              <CardContent className="p-4 sm:p-6 flex flex-col sm:flex-row justify-between gap-4">
                <div>
                  <h3 className="font-bold text-lg mb-1">{driver.driver_name}</h3>
                  <div className="text-2xl font-bold text-green-500">£{driver.pending_payout.toLocaleString()}</div>
                  <div className="text-sm text-muted-foreground mt-2">
                    {driver.jobs.filter(j => j.payment_method !== 'Cash' && j.payout_status !== 'Paid').length} pending jobs
                  </div>
                </div>
                <div className="flex flex-col gap-2 min-w-[200px]">
                  <Button variant="outline" className="w-full text-green-500 hover:bg-green-500/10" onClick={() => handlePayout(driver.driver_id)}>
                    <Check className="w-4 h-4 mr-2" /> Mark as Paid
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
          {!summary?.driver_breakdown?.some(d => d.pending_payout > 0) && (
            <div className="py-12 text-center text-muted-foreground border border-dashed rounded-lg">
              No pending payouts owed to drivers.
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
