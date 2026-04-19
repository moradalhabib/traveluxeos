import { useListCommissions, getListCommissionsQueryKey, useCreateSettlement, useCreatePayout } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Calculator, Check, Hotel, Home, MessageSquare } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/use-auth";
import { format } from "date-fns";

export default function Commissions() {
  const { data: summary, isLoading, refetch } = useListCommissions(
    { query: { enabled: true, queryKey: getListCommissionsQueryKey() } }
  );

  const settle = useCreateSettlement();
  const payout = useCreatePayout();
  const { toast } = useToast();
  const { user } = useAuth();
  const isSuperAdmin = user?.role === "super_admin";

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-48" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-32" />)}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const s = summary as any;

  const handleSettle = (driverId: string) => {
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

  const handleArrangementFeeToggle = async (bookingId: string, currentStatus: string) => {
    const newStatus = currentStatus === "Outstanding" ? "Collected" : "Outstanding";
    const { error } = await supabase
      .from("bookings")
      .update({ arrangement_fee_status: newStatus })
      .eq("id", bookingId);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: newStatus === "Collected" ? "Fee marked as Collected" : "Fee reset to Outstanding" });
      refetch();
    }
  };

  const arrangementFees: any[] = s?.arrangement_fees ?? [];
  const outstandingFees = arrangementFees.filter((f: any) => (f.arrangement_fee_status ?? "Outstanding") === "Outstanding");
  const collectedFees = arrangementFees.filter((f: any) => f.arrangement_fee_status === "Collected");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Commissions</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Track driver commissions and arrangement fees</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="border-border bg-card">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">Owed to TVL (Cash)</CardTitle>
            <Calculator className="w-4 h-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-400">
              {isSuperAdmin ? `£${(s?.total_outstanding ?? 0).toLocaleString()}` : (s?.total_outstanding > 0 ? "Outstanding" : "Clear")}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Drivers owe TVL from cash jobs</p>
          </CardContent>
        </Card>

        <Card className="border-border bg-card">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">Owed to Drivers</CardTitle>
            <Calculator className="w-4 h-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-400">
              {isSuperAdmin ? `£${(s?.total_pending_payouts ?? 0).toLocaleString()}` : (s?.total_pending_payouts > 0 ? "Pending" : "Clear")}
            </div>
            <p className="text-xs text-muted-foreground mt-1">TVL owes drivers (bank/card jobs)</p>
          </CardContent>
        </Card>

        <Card className="border-border bg-card">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">Arrangement Fees</CardTitle>
            <Hotel className="w-4 h-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-primary">
              {isSuperAdmin ? `£${(s?.total_arrangement_outstanding ?? 0).toLocaleString()}` : (outstandingFees.length > 0 ? `${outstandingFees.length} pending` : "All collected")}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Hotel &amp; Apartment fees outstanding</p>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="outstanding" className="w-full">
        <TabsList className="grid w-full grid-cols-3 max-w-[500px]">
          <TabsTrigger value="outstanding">
            Owed to TVL
            {s?.driver_breakdown?.some((d: any) => d.outstanding_amount > 0) && (
              <span className="ml-1.5 h-1.5 w-1.5 rounded-full bg-amber-400 inline-block" />
            )}
          </TabsTrigger>
          <TabsTrigger value="payouts">
            Owed to Drivers
            {s?.driver_breakdown?.some((d: any) => d.pending_payout > 0) && (
              <span className="ml-1.5 h-1.5 w-1.5 rounded-full bg-green-400 inline-block" />
            )}
          </TabsTrigger>
          <TabsTrigger value="arrangement">
            Fees
            {outstandingFees.length > 0 && (
              <span className="ml-1.5 h-1.5 w-1.5 rounded-full bg-primary inline-block" />
            )}
          </TabsTrigger>
        </TabsList>

        {/* Owed to TVL — Cash jobs */}
        <TabsContent value="outstanding" className="mt-4 space-y-4">
          {s?.driver_breakdown?.filter((d: any) => d.outstanding_amount > 0).map((driver: any) => (
            <Card key={driver.driver_id} className="border-amber-500/10" data-staff-no={driver.driver_staff_no || ''}>
              <CardContent className="p-4 sm:p-6 flex flex-col sm:flex-row justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <h3 className="font-bold text-lg">{driver.driver_name}</h3>
                    {driver.driver_staff_no && (
                      <span className="font-mono text-xs px-2 py-0.5 rounded bg-primary/10 text-primary border border-primary/30 font-semibold">
                        {driver.driver_staff_no}
                      </span>
                    )}
                  </div>
                  <div className="text-2xl font-bold text-amber-400">
                    {isSuperAdmin ? `£${driver.outstanding_amount.toLocaleString()}` : "Outstanding"}
                  </div>
                  <div className="text-sm text-muted-foreground mt-2">
                    {driver.jobs.filter((j: any) => j.payment_method === "Cash" && j.commission_status !== "Settled").length} pending jobs
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
          {!s?.driver_breakdown?.some((d: any) => d.outstanding_amount > 0) && (
            <div className="py-12 text-center text-muted-foreground border border-dashed rounded-lg">
              No outstanding commissions owed to TVL.
            </div>
          )}
        </TabsContent>

        {/* Owed to Drivers — Bank/Card jobs */}
        <TabsContent value="payouts" className="mt-4 space-y-4">
          {s?.driver_breakdown?.filter((d: any) => d.pending_payout > 0).map((driver: any) => (
            <Card key={`payout-${driver.driver_id}`} className="border-green-500/10" data-staff-no={driver.driver_staff_no || ''}>
              <CardContent className="p-4 sm:p-6 flex flex-col sm:flex-row justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <h3 className="font-bold text-lg">{driver.driver_name}</h3>
                    {driver.driver_staff_no && (
                      <span className="font-mono text-xs px-2 py-0.5 rounded bg-primary/10 text-primary border border-primary/30 font-semibold">
                        {driver.driver_staff_no}
                      </span>
                    )}
                  </div>
                  <div className="text-2xl font-bold text-green-400">
                    {isSuperAdmin ? `£${driver.pending_payout.toLocaleString()}` : "Pending"}
                  </div>
                  <div className="text-sm text-muted-foreground mt-2">
                    {driver.jobs.filter((j: any) => j.payment_method !== "Cash" && j.payout_status !== "Paid").length} pending jobs
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
          {!s?.driver_breakdown?.some((d: any) => d.pending_payout > 0) && (
            <div className="py-12 text-center text-muted-foreground border border-dashed rounded-lg">
              No pending payouts owed to drivers.
            </div>
          )}
        </TabsContent>

        {/* Hotel & Apartment arrangement fees */}
        <TabsContent value="arrangement" className="mt-4 space-y-4">
          {outstandingFees.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Outstanding</h3>
              {outstandingFees.map((fee: any) => (
                <Card key={fee.booking_id} className="border-primary/10">
                  <CardContent className="p-4 flex flex-col sm:flex-row justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5">
                        {fee.service_type === "Hotel" ? (
                          <Hotel className="w-4 h-4 text-primary" />
                        ) : (
                          <Home className="w-4 h-4 text-primary" />
                        )}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-sm">{fee.tvl_ref}</span>
                          <Badge variant="outline" className="text-[10px] px-1.5">{fee.service_type}</Badge>
                        </div>
                        <div className="text-sm text-muted-foreground">{fee.client_name ?? "Unknown client"}</div>
                        {fee.date && (
                          <div className="text-xs text-muted-foreground">
                            {format(new Date(fee.date), "d MMM yyyy")}
                          </div>
                        )}
                        {fee.commission_notes && (
                          <div className="text-xs text-muted-foreground mt-1 italic">{fee.commission_notes}</div>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-2 min-w-[120px]">
                      <div className="text-xl font-bold text-primary">
                        {isSuperAdmin ? `£${(fee.commission_amount ?? 0).toLocaleString()}` : "Pending"}
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-green-500 hover:bg-green-500/10 text-xs"
                        onClick={() => handleArrangementFeeToggle(fee.booking_id, fee.arrangement_fee_status ?? "Outstanding")}
                      >
                        <Check className="w-3 h-3 mr-1" /> Mark Collected
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {collectedFees.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Collected</h3>
              {collectedFees.map((fee: any) => (
                <Card key={fee.booking_id} className="border-border opacity-60">
                  <CardContent className="p-4 flex flex-col sm:flex-row justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5">
                        {fee.service_type === "Hotel" ? (
                          <Hotel className="w-4 h-4 text-muted-foreground" />
                        ) : (
                          <Home className="w-4 h-4 text-muted-foreground" />
                        )}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-sm">{fee.tvl_ref}</span>
                          <Badge variant="outline" className="text-[10px] px-1.5 text-green-500 border-green-500/30">Collected</Badge>
                        </div>
                        <div className="text-sm text-muted-foreground">{fee.client_name ?? "Unknown client"}</div>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <div className="text-xl font-bold text-muted-foreground">
                        {isSuperAdmin ? `£${(fee.commission_amount ?? 0).toLocaleString()}` : "—"}
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-muted-foreground text-xs"
                        onClick={() => handleArrangementFeeToggle(fee.booking_id, fee.arrangement_fee_status)}
                      >
                        Reset
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {arrangementFees.length === 0 && (
            <div className="py-12 text-center text-muted-foreground border border-dashed rounded-lg">
              No Hotel or Apartment bookings with arrangement fees recorded.
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
