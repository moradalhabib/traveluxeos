import { useState } from "react";
import { useListCommissions, getListCommissionsQueryKey, useCreateSettlement, useCreatePayout } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Calculator, Check, Hotel, Home, MessageSquare, ChevronRight, ExternalLink, Info, CheckCircle2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/use-auth";
import { format } from "date-fns";
import { Link } from "wouter";

type Job = {
  booking_id: string;
  tvl_ref: string | null;
  date: string | null;
  client_name: string | null;
  service_type: string | null;
  total_fare: number;
  tvl_commission: number;
  driver_receives: number;
  payment_method: string | null;
  commission_status: string | null;
  payout_status: string | null;
};

type Driver = {
  driver_id: string;
  driver_name: string;
  driver_staff_no: string | null;
  driver_whatsapp: string | null;
  outstanding_amount: number;
  pending_payout: number;
  jobs: Job[];
  settled_jobs: Job[];
  paid_jobs: Job[];
};

type DialogMode = "owed_to_tvl" | "owed_to_driver";

const fmtMoney = (n: number) => `£${(n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const fmtDate = (d: string | null) => (d ? format(new Date(d), "d MMM yy") : "—");

function buildWhatsappUrl(driver: Driver, mode: DialogMode): string | null {
  if (!driver.driver_whatsapp) return null;
  const phone = driver.driver_whatsapp.replace(/[^0-9]/g, "");
  if (!phone) return null;

  const today = format(new Date(), "d MMM yyyy");
  const isOwedToTvl = mode === "owed_to_tvl";
  const pending = isOwedToTvl
    ? driver.jobs.filter((j) => j.payment_method === "Cash" && j.commission_status !== "Settled")
    : driver.jobs.filter((j) => j.payment_method !== "Cash" && j.payout_status !== "Paid");

  const total = pending.reduce(
    (s, j) => s + (isOwedToTvl ? j.tvl_commission : j.driver_receives),
    0
  );

  const lines: string[] = [];
  lines.push(`*Traveluxe — Statement (${today})*`);
  lines.push("");
  lines.push(`Hi ${driver.driver_name.split(" ")[0]},`);
  lines.push("");
  lines.push(
    isOwedToTvl
      ? `Below is your *cash commission statement*. Please settle by Sunday/Monday.`
      : `Below is your *pending payout statement*. We will transfer the total below to you.`
  );
  lines.push("");

  pending.forEach((j) => {
    const amt = isOwedToTvl ? j.tvl_commission : j.driver_receives;
    lines.push(`• ${j.tvl_ref ?? "—"} | ${fmtDate(j.date)} | ${j.client_name ?? "Client"} — ${fmtMoney(amt)}`);
  });

  lines.push("");
  lines.push(`*Total ${isOwedToTvl ? "owed to TVL" : "owed to you"}: ${fmtMoney(total)}*`);
  lines.push("");
  lines.push(`Reply here to confirm. Thanks!`);

  const text = encodeURIComponent(lines.join("\n"));
  return `https://wa.me/${phone}?text=${text}`;
}

export default function Commissions() {
  const { data: summary, isLoading, refetch } = useListCommissions(
    { query: { enabled: true, queryKey: getListCommissionsQueryKey() } }
  );

  const settle = useCreateSettlement();
  const payout = useCreatePayout();
  const { toast } = useToast();
  const { user } = useAuth();
  const isSuperAdmin = user?.role === "super_admin";

  const [dialogDriver, setDialogDriver] = useState<Driver | null>(null);
  const [dialogMode, setDialogMode] = useState<DialogMode>("owed_to_tvl");

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
  const drivers: Driver[] = s?.driver_breakdown ?? [];

  const handleSettleAll = (driver: Driver) => {
    const ids = driver.jobs
      .filter((j) => j.payment_method === "Cash" && j.commission_status !== "Settled")
      .map((j) => j.booking_id);
    if (ids.length === 0) {
      toast({ title: "Nothing to settle", description: "No outstanding cash jobs for this driver." });
      return;
    }
    const today = new Date();
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - 7);
    settle.mutate(
      {
        data: {
          driver_id: driver.driver_id,
          week_start: weekStart.toISOString().slice(0, 10),
          week_end: today.toISOString().slice(0, 10),
          booking_ids: ids,
        },
      },
      {
        onSuccess: () => {
          toast({ title: "Marked as Settled", description: `${ids.length} job(s) settled for ${driver.driver_name}` });
          setDialogDriver(null);
          refetch();
        },
        onError: (err: any) => {
          toast({ title: "Error", description: err?.message ?? "Failed to settle", variant: "destructive" });
        },
      }
    );
  };

  const handlePayoutAll = (driver: Driver) => {
    const ids = driver.jobs
      .filter((j) => j.payment_method !== "Cash" && j.payout_status !== "Paid")
      .map((j) => j.booking_id);
    if (ids.length === 0) {
      toast({ title: "Nothing to pay out", description: "No pending bank/card jobs for this driver." });
      return;
    }
    const today = new Date();
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - 7);
    payout.mutate(
      {
        data: {
          driver_id: driver.driver_id,
          week_start: weekStart.toISOString().slice(0, 10),
          week_end: today.toISOString().slice(0, 10),
          booking_ids: ids,
        },
      },
      {
        onSuccess: () => {
          toast({ title: "Marked as Paid", description: `${ids.length} job(s) paid out to ${driver.driver_name}` });
          setDialogDriver(null);
          refetch();
        },
        onError: (err: any) => {
          toast({ title: "Error", description: err?.message ?? "Failed to record payout", variant: "destructive" });
        },
      }
    );
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

  const openDriver = (d: Driver, mode: DialogMode) => {
    setDialogDriver(d);
    setDialogMode(mode);
  };

  const arrangementFees: any[] = s?.arrangement_fees ?? [];
  const outstandingFees = arrangementFees.filter((f: any) => (f.arrangement_fee_status ?? "Outstanding") === "Outstanding");
  const collectedFees = arrangementFees.filter((f: any) => f.arrangement_fee_status === "Collected");

  const owedToTvlDrivers = drivers.filter((d) => d.outstanding_amount > 0);
  const owedToDriverDrivers = drivers.filter((d) => d.pending_payout > 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Commissions</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Track driver commissions and arrangement fees. Drivers settle weekly (Sun/Mon).
        </p>
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
              {isSuperAdmin ? fmtMoney(s?.total_outstanding ?? 0) : (s?.total_outstanding > 0 ? "Outstanding" : "Clear")}
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
              {isSuperAdmin ? fmtMoney(s?.total_pending_payouts ?? 0) : (s?.total_pending_payouts > 0 ? "Pending" : "Clear")}
            </div>
            <p className="text-xs text-muted-foreground mt-1">TVL owes drivers (bank/card jobs)</p>
          </CardContent>
        </Card>

      </div>

      {/* Tabs */}
      <Tabs defaultValue="outstanding" className="w-full">
        <TabsList className="grid w-full grid-cols-2 max-w-[400px]">
          <TabsTrigger value="outstanding">
            Owed to TVL
            {owedToTvlDrivers.length > 0 && (
              <span className="ml-1.5 h-1.5 w-1.5 rounded-full bg-amber-400 inline-block" />
            )}
          </TabsTrigger>
          <TabsTrigger value="payouts">
            Owed to Drivers
            {owedToDriverDrivers.length > 0 && (
              <span className="ml-1.5 h-1.5 w-1.5 rounded-full bg-green-400 inline-block" />
            )}
          </TabsTrigger>
        </TabsList>

        {/* Owed to TVL — Cash jobs */}
        <TabsContent value="outstanding" className="mt-4 space-y-3">
          <p className="text-xs text-muted-foreground">
            One row per driver. Click any driver to view their full job history, send a WhatsApp statement, or mark commissions as settled.
          </p>
          {owedToTvlDrivers.map((driver) => {
            const pendingCount = driver.jobs.filter(
              (j) => j.payment_method === "Cash" && j.commission_status !== "Settled"
            ).length;
            return (
              <Card
                key={driver.driver_id}
                className="border-amber-500/10 hover:border-amber-500/40 hover:bg-amber-500/5 cursor-pointer transition-colors"
                onClick={() => openDriver(driver, "owed_to_tvl")}
                data-testid={`commission-driver-card-${driver.driver_id}`}
              >
                <CardContent className="p-4 sm:p-5 flex items-center justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <h3 className="font-bold text-base sm:text-lg truncate">{driver.driver_name}</h3>
                      {driver.driver_staff_no && (
                        <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/30 font-semibold">
                          {driver.driver_staff_no}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {pendingCount} pending cash {pendingCount === 1 ? "job" : "jobs"}
                      {driver.settled_jobs.length > 0 && ` · ${driver.settled_jobs.length} settled (last 90d)`}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-bold text-amber-400">
                      {isSuperAdmin ? fmtMoney(driver.outstanding_amount) : "Outstanding"}
                    </div>
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wider">total owed</div>
                  </div>
                  <ChevronRight className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                </CardContent>
              </Card>
            );
          })}
          {owedToTvlDrivers.length === 0 && (
            <div className="py-12 text-center text-muted-foreground border border-dashed rounded-lg">
              No outstanding commissions owed to TVL.
            </div>
          )}
        </TabsContent>

        {/* Owed to Drivers — Bank/Card jobs */}
        <TabsContent value="payouts" className="mt-4 space-y-3">
          <p className="text-xs text-muted-foreground">
            One row per driver. Click any driver to view their full job history, send a WhatsApp statement, or mark payouts as paid.
          </p>
          {owedToDriverDrivers.map((driver) => {
            const pendingCount = driver.jobs.filter(
              (j) => j.payment_method !== "Cash" && j.payout_status !== "Paid"
            ).length;
            return (
              <Card
                key={`payout-${driver.driver_id}`}
                className="border-green-500/10 hover:border-green-500/40 hover:bg-green-500/5 cursor-pointer transition-colors"
                onClick={() => openDriver(driver, "owed_to_driver")}
                data-testid={`payout-driver-card-${driver.driver_id}`}
              >
                <CardContent className="p-4 sm:p-5 flex items-center justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <h3 className="font-bold text-base sm:text-lg truncate">{driver.driver_name}</h3>
                      {driver.driver_staff_no && (
                        <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/30 font-semibold">
                          {driver.driver_staff_no}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {pendingCount} pending bank/card {pendingCount === 1 ? "job" : "jobs"}
                      {driver.paid_jobs.length > 0 && ` · ${driver.paid_jobs.length} paid (last 90d)`}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-bold text-green-400">
                      {isSuperAdmin ? fmtMoney(driver.pending_payout) : "Pending"}
                    </div>
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wider">total to pay</div>
                  </div>
                  <ChevronRight className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                </CardContent>
              </Card>
            );
          })}
          {owedToDriverDrivers.length === 0 && (
            <div className="py-12 text-center text-muted-foreground border border-dashed rounded-lg">
              No pending payouts owed to drivers.
            </div>
          )}
        </TabsContent>

        {/* Arrangement Fees tab removed — Hotel/Apartment now use supplier_cost / client_price markup model */}
        {false && (
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
                          <Link href={`/bookings/${fee.booking_id}`}>
                            <a className="font-semibold text-sm text-primary hover:underline">{fee.tvl_ref}</a>
                          </Link>
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
                        {isSuperAdmin ? fmtMoney(fee.commission_amount ?? 0) : "Pending"}
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
                          <Link href={`/bookings/${fee.booking_id}`}>
                            <a className="font-semibold text-sm text-primary hover:underline">{fee.tvl_ref}</a>
                          </Link>
                          <Badge variant="outline" className="text-[10px] px-1.5 text-green-500 border-green-500/30">Collected</Badge>
                        </div>
                        <div className="text-sm text-muted-foreground">{fee.client_name ?? "Unknown client"}</div>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <div className="text-xl font-bold text-muted-foreground">
                        {isSuperAdmin ? fmtMoney(fee.commission_amount ?? 0) : "—"}
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
        )}
      </Tabs>

      {/* Driver detail dialog (history + actions) */}
      <DriverHistoryDialog
        driver={dialogDriver}
        mode={dialogMode}
        isSuperAdmin={isSuperAdmin}
        onClose={() => setDialogDriver(null)}
        onSettleAll={handleSettleAll}
        onPayoutAll={handlePayoutAll}
        actionPending={settle.isPending || payout.isPending}
      />
    </div>
  );
}

function DriverHistoryDialog({
  driver,
  mode,
  isSuperAdmin,
  onClose,
  onSettleAll,
  onPayoutAll,
  actionPending,
}: {
  driver: Driver | null;
  mode: DialogMode;
  isSuperAdmin: boolean;
  onClose: () => void;
  onSettleAll: (d: Driver) => void;
  onPayoutAll: (d: Driver) => void;
  actionPending: boolean;
}) {
  const open = !!driver;
  if (!driver) return null;

  const isOwedToTvl = mode === "owed_to_tvl";

  // Pending = jobs in the relevant pending bucket
  const pendingJobs = isOwedToTvl
    ? driver.jobs.filter((j) => j.payment_method === "Cash" && j.commission_status !== "Settled")
    : driver.jobs.filter((j) => j.payment_method !== "Cash" && j.payout_status !== "Paid");

  // Settled = historical settled/paid jobs
  const settledJobs = isOwedToTvl ? driver.settled_jobs : driver.paid_jobs;

  // Sort: most recent first
  const sortByDateDesc = (a: Job, b: Job) =>
    new Date(b.date ?? 0).getTime() - new Date(a.date ?? 0).getTime();

  const pendingSorted = [...pendingJobs].sort(sortByDateDesc);
  const settledSorted = [...settledJobs].sort(sortByDateDesc);

  const pendingTotal = pendingJobs.reduce(
    (s, j) => s + (isOwedToTvl ? j.tvl_commission : j.driver_receives),
    0
  );
  const settledTotal = settledJobs.reduce(
    (s, j) => s + (isOwedToTvl ? j.tvl_commission : j.driver_receives),
    0
  );

  const wa = buildWhatsappUrl(driver, mode);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            <span>{driver.driver_name}</span>
            {driver.driver_staff_no && (
              <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/30">
                {driver.driver_staff_no}
              </span>
            )}
            <Badge variant="outline" className={isOwedToTvl ? "text-amber-400 border-amber-400/30" : "text-green-400 border-green-400/30"}>
              {isOwedToTvl ? "Cash commission (driver → TVL)" : "Bank/Card payout (TVL → driver)"}
            </Badge>
          </DialogTitle>
          <DialogDescription>
            Job-by-job history. Click any reference to open the job sheet.
          </DialogDescription>
        </DialogHeader>

        {/* Totals strip */}
        <div className="grid grid-cols-2 gap-3 my-2">
          <Card className={isOwedToTvl ? "border-amber-500/30" : "border-green-500/30"}>
            <CardContent className="p-3">
              <div className="text-xs text-muted-foreground uppercase tracking-wider">Pending</div>
              <div className={`text-xl font-bold ${isOwedToTvl ? "text-amber-400" : "text-green-400"}`}>
                {isSuperAdmin ? fmtMoney(pendingTotal) : (pendingTotal > 0 ? "Pending" : "Clear")}
              </div>
              <div className="text-[10px] text-muted-foreground">{pendingJobs.length} job(s)</div>
            </CardContent>
          </Card>
          <Card className="border-emerald-500/30 bg-emerald-500/5">
            <CardContent className="p-3">
              <div className="text-xs text-muted-foreground uppercase tracking-wider">Settled (last 90d)</div>
              <div className="text-xl font-bold text-emerald-400">
                {isSuperAdmin ? fmtMoney(settledTotal) : "—"}
              </div>
              <div className="text-[10px] text-muted-foreground">{settledJobs.length} job(s)</div>
            </CardContent>
          </Card>
        </div>

        {/* Pending list */}
        <div className="space-y-1">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Pending</h4>
          {pendingSorted.length === 0 ? (
            <div className="py-4 text-center text-xs text-muted-foreground border border-dashed rounded">
              Nothing pending.
            </div>
          ) : (
            <ul className="border border-border rounded divide-y divide-border">
              {pendingSorted.map((j) => (
                <JobRow key={j.booking_id} job={j} mode={mode} settled={false} isSuperAdmin={isSuperAdmin} />
              ))}
            </ul>
          )}
        </div>

        {/* Settled history */}
        {settledSorted.length > 0 && (
          <div className="space-y-1">
            <h4 className="text-xs font-semibold text-emerald-500 uppercase tracking-wider flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5" /> Settled history (last 90 days)
            </h4>
            <ul className="border border-emerald-500/20 rounded divide-y divide-emerald-500/10">
              {settledSorted.map((j) => (
                <JobRow key={j.booking_id} job={j} mode={mode} settled={true} isSuperAdmin={isSuperAdmin} />
              ))}
            </ul>
          </div>
        )}

        <DialogFooter className="flex-col sm:flex-row gap-2 mt-4">
          <Button variant="outline" onClick={onClose} className="w-full sm:w-auto">
            Close
          </Button>
          {wa ? (
            <a href={wa} target="_blank" rel="noopener noreferrer" className="w-full sm:w-auto">
              <Button className="w-full bg-green-700 hover:bg-green-600 text-white">
                <MessageSquare className="w-4 h-4 mr-2" /> Send Statement via WhatsApp
              </Button>
            </a>
          ) : (
            <Button disabled variant="outline" className="w-full sm:w-auto" title="No WhatsApp number on driver profile">
              <MessageSquare className="w-4 h-4 mr-2" /> No WhatsApp on file
            </Button>
          )}
          {pendingJobs.length > 0 && (
            <Button
              className={isOwedToTvl ? "w-full sm:w-auto bg-amber-600 hover:bg-amber-500 text-white" : "w-full sm:w-auto bg-green-700 hover:bg-green-600 text-white"}
              disabled={actionPending}
              onClick={() => (isOwedToTvl ? onSettleAll(driver) : onPayoutAll(driver))}
            >
              <Check className="w-4 h-4 mr-2" />
              {isOwedToTvl ? `Mark all ${pendingJobs.length} as Settled` : `Mark all ${pendingJobs.length} as Paid`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function JobRow({
  job,
  mode,
  settled,
  isSuperAdmin,
}: {
  job: Job;
  mode: DialogMode;
  settled: boolean;
  isSuperAdmin: boolean;
}) {
  const isOwedToTvl = mode === "owed_to_tvl";
  const amount = isOwedToTvl ? job.tvl_commission : job.driver_receives;

  return (
    <li className={`p-3 flex items-center justify-between gap-3 ${settled ? "bg-emerald-500/5" : ""}`}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <Link href={`/bookings/${job.booking_id}`}>
            <a className="font-semibold text-sm text-primary hover:underline inline-flex items-center gap-1" data-testid={`job-link-${job.tvl_ref}`}>
              {job.tvl_ref ?? "—"}
              <ExternalLink className="w-3 h-3" />
            </a>
          </Link>
          {job.service_type && (
            <Badge variant="outline" className="text-[10px] px-1.5">{job.service_type}</Badge>
          )}
          {job.payment_method && (
            <Badge variant="outline" className="text-[10px] px-1.5 text-muted-foreground">{job.payment_method}</Badge>
          )}
        </div>
        <div className="text-xs text-muted-foreground mt-0.5">
          {fmtDate(job.date)} · {job.client_name ?? "Client"}
        </div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <div className={`text-sm font-bold ${settled ? "text-emerald-400" : (isOwedToTvl ? "text-amber-400" : "text-green-400")}`}>
          {isSuperAdmin ? fmtMoney(amount) : (settled ? "Paid" : "Pending")}
        </div>
        {settled && <CheckCircle2 className="w-4 h-4 text-emerald-500" data-testid="settled-tick" />}
      </div>
    </li>
  );
}
