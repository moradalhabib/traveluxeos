import { useEffect, useMemo, useState } from "react";
import {
  useListCommissions,
  getListCommissionsQueryKey,
  useCreateSettlement,
  useCreatePayout,
  getGetDashboardSummaryQueryKey,
  getGetFinanceSummaryQueryKey,
} from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { FilterDropdown, useFilterState } from "@/components/ui/filter-dropdown";
import { ActiveFilterChips } from "@/components/ui/active-filter-chips";
import { Calculator, Check, Hotel, Home, MessageSquare, ChevronRight, ExternalLink, Info, CheckCircle2, AlertTriangle, Download, Truck, Undo2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/use-auth";
import { format, parseISO, startOfMonth } from "date-fns";
import { Link } from "wouter";
import * as XLSX from "xlsx";

const API_BASE = `${import.meta.env.VITE_API_URL ?? ""}/api`;

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
  // Set when this row represents an additional-vehicle leg of a multi-car booking.
  // Used to route settlement/payout to the booking_vehicles table instead of bookings.
  is_extra_vehicle?: boolean;
  booking_vehicle_id?: string;
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
  oldest_pending_age_days?: number | null;
  has_overdue?: boolean;
};

type SettlementHistoryEntry = {
  settlement_id?: string;
  kind?: "settlement" | "payout";
  driver_id?: string;
  driver_name: string;
  tvl_number?: string | null;
  settled_at: string;
  total_amount: number;
  booking_refs: string[];
  booking_ids?: string[];
  month: string;
  operator_name?: string | null;
  notes?: string | null;
};

type SettleConfirmState = {
  driver: Driver;
  jobsSettled: Job[];
  total: number;
};

type DialogMode = "owed_to_tvl" | "owed_to_driver";

type SupplierReceivableLine = {
  booking_id: string;
  tvl_ref: string | null;
  date: string | null;
  client_name: string | null;
  service_type: string | null;
  amount: number;
  collected_at: string | null;
  payment_ref: string | null;
};

type SupplierReceivable = {
  supplier_id: string;
  supplier_name: string;
  supplier_contact: string | null;
  supplier_email: string | null;
  supplier_phone: string | null;
  outstanding_amount: number;
  collected_amount: number;
  outstanding_jobs: SupplierReceivableLine[];
  collected_jobs: SupplierReceivableLine[];
  oldest_outstanding_age_days: number | null;
};

type SupplierReceivablesResponse = {
  suppliers: SupplierReceivable[];
  total_outstanding: number;
  total_collected: number;
  overdue_threshold_days: number;
};

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
  // Top-level query client so handleSupplierToggle (declared further down)
  // can fan-out invalidations to the dashboard / finance summaries after
  // a supplier-commission state change.
  const qc = useQueryClient();
  // Admin and Super Admin both see actual money figures and can settle.
  // Operator sees masked placeholders.
  const isSuperAdmin = user?.role === "super_admin" || user?.role === "admin";

  const [dialogDriver, setDialogDriver] = useState<Driver | null>(null);
  const [dialogMode, setDialogMode] = useState<DialogMode>("owed_to_tvl");
  const [settleNotesDriver, setSettleNotesDriver] = useState<Driver | null>(null);
  const [settleNotesText, setSettleNotesText] = useState("");
  const [settleConfirm, setSettleConfirm] = useState<SettleConfirmState | null>(null);
  // URL-backed so a refresh / shared link restores the same view.
  const [outstandingView, setOutstandingView] = useFilterState<"all-time" | "this-month">("view", "all-time");

  const historyQuery = useQuery<SettlementHistoryEntry[]>({
    queryKey: ["settlement-history"],
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${API_BASE}/commissions/settlements/history`, {
        headers: session?.access_token
          ? { Authorization: `Bearer ${session.access_token}` }
          : {},
      });
      if (!res.ok) throw new Error("Failed to load settlement history");
      const json = await res.json();
      return Array.isArray(json) ? json : (json?.settlements ?? []);
    },
  });

  const supplierReceivablesQuery = useQuery<SupplierReceivablesResponse>({
    queryKey: ["supplier-receivables"],
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${API_BASE}/commissions/supplier-receivables`, {
        headers: session?.access_token
          ? { Authorization: `Bearer ${session.access_token}` }
          : {},
      });
      if (!res.ok) throw new Error("Failed to load supplier receivables");
      return res.json();
    },
  });

  const [supplierDialog, setSupplierDialog] = useState<SupplierReceivable | null>(null);

  const handleSupplierToggle = async (
    bookingId: string,
    nextCollected: boolean,
    paymentRef?: string
  ) => {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`${API_BASE}/commissions/supplier-receivables/${bookingId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
      },
      body: JSON.stringify({ collected: nextCollected, payment_ref: paymentRef ?? null }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast({
        title: "Error",
        description: err?.error ?? "Failed to update supplier commission",
        variant: "destructive",
      });
      return;
    }
    toast({
      title: nextCollected ? "Marked Collected" : "Reverted to Outstanding",
      description: nextCollected
        ? "Supplier commission moved to Collected."
        : "Supplier commission moved back to Outstanding.",
    });
    // Re-fetch supplier receivables + headline KPIs (driver list refetch is
    // cheap and keeps the page consistent if the booking touches both).
    supplierReceivablesQuery.refetch();
    refetch();
    // Invalidate every cached query so any open page (bookings, suppliers,
    // etc.) picks up the new outstanding total in the same beat. Active
    // observers on the current page refetch automatically.
    qc.invalidateQueries();
    // The home dashboard and finance summary live behind their own keys,
    // and the operator is on /commissions when this fires — those queries
    // have NO active observer, so plain refetchQueries({ queryKey })
    // would no-op (default type is "active"). Pass type: "all" to force
    // an immediate background refetch on the inactive queries so the new
    // totals are already in the cache when the operator navigates to /
    // or /finance.
    qc.refetchQueries({ queryKey: getGetDashboardSummaryQueryKey(), type: "all" });
    qc.refetchQueries({ queryKey: getGetFinanceSummaryQueryKey(), type: "all" });
    // Keep the open dialog in sync — re-bind to the latest server payload
    // by supplier id once the refetch lands.
    if (supplierDialog) {
      const fresh = await fetch(`${API_BASE}/commissions/supplier-receivables`, {
        headers: session?.access_token
          ? { Authorization: `Bearer ${session.access_token}` }
          : {},
      });
      if (fresh.ok) {
        const json: SupplierReceivablesResponse = await fresh.json();
        const updated = json.suppliers.find((s) => s.supplier_id === supplierDialog.supplier_id);
        setSupplierDialog(updated ?? null);
      }
    }
  };

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
    const pendingCash = driver.jobs.filter(
      (j) => j.payment_method === "Cash" && j.commission_status !== "Settled"
    );
    if (pendingCash.length === 0) {
      toast({ title: "Nothing to settle", description: "No outstanding cash jobs for this driver." });
      return;
    }
    setSettleNotesDriver(driver);
    setSettleNotesText("");
  };

  const confirmSettle = () => {
    const driver = settleNotesDriver;
    if (!driver) return;
    const pendingCash = driver.jobs.filter(
      (j) => j.payment_method === "Cash" && j.commission_status !== "Settled"
    );
    // Split jobs into primary bookings and extra-vehicle legs so the API
    // can update the right table (bookings vs booking_vehicles) for each.
    const bookingIds = pendingCash.filter((j) => !j.is_extra_vehicle).map((j) => j.booking_id);
    const vehicleIds = pendingCash
      .filter((j) => j.is_extra_vehicle && j.booking_vehicle_id)
      .map((j) => j.booking_vehicle_id as string);
    const totalLegs = bookingIds.length + vehicleIds.length;
    if (totalLegs === 0) {
      setSettleNotesDriver(null);
      return;
    }
    const total = pendingCash.reduce((s, j) => s + (j.tvl_commission ?? 0), 0);
    const today = new Date();
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - 7);
    const notes = settleNotesText.trim();
    settle.mutate(
      {
        data: {
          driver_id: driver.driver_id,
          week_start: weekStart.toISOString().slice(0, 10),
          week_end: today.toISOString().slice(0, 10),
          booking_ids: bookingIds,
          booking_vehicle_ids: vehicleIds,
          ...(notes ? { notes } : {}),
        } as any,
      },
      {
        onSuccess: () => {
          toast({ title: "Marked as Settled", description: `${totalLegs} job(s) settled for ${driver.driver_name}` });
          setSettleNotesDriver(null);
          setDialogDriver(null);
          setSettleConfirm({ driver, jobsSettled: pendingCash, total });
          refetch();
          historyQuery.refetch();
        },
        onError: (err: any) => {
          toast({ title: "Error", description: err?.message ?? "Failed to settle", variant: "destructive" });
        },
      }
    );
  };

  const buildSettlementWaUrl = (state: SettleConfirmState): string | null => {
    if (!state.driver.driver_whatsapp) return null;
    const phone = state.driver.driver_whatsapp.replace(/[^0-9]/g, "");
    if (!phone) return null;
    const today = format(new Date(), "d MMM yyyy");
    const lines: string[] = [];
    lines.push("✅ Settlement Confirmed — Traveluxe London");
    lines.push("");
    lines.push(`Hi ${state.driver.driver_name.split(" ")[0]},`);
    lines.push("");
    lines.push(`This confirms your commission settlement on ${today}:`);
    lines.push("");
    lines.push(`Total settled: ${fmtMoney(state.total)}`);
    lines.push("");
    lines.push("Jobs covered:");
    state.jobsSettled.forEach((j) => {
      lines.push(`- ${j.tvl_ref ?? "—"} · ${fmtMoney(j.tvl_commission ?? 0)}`);
    });
    lines.push("");
    lines.push("Thank you for your continued partnership.");
    lines.push("");
    lines.push("— Traveluxe London Operations");
    return `https://wa.me/${phone}?text=${encodeURIComponent(lines.join("\n"))}`;
  };

  const handlePayoutAll = (driver: Driver) => {
    const pending = driver.jobs.filter(
      (j) => j.payment_method !== "Cash" && j.payout_status !== "Paid"
    );
    const bookingIds = pending.filter((j) => !j.is_extra_vehicle).map((j) => j.booking_id);
    const vehicleIds = pending
      .filter((j) => j.is_extra_vehicle && j.booking_vehicle_id)
      .map((j) => j.booking_vehicle_id as string);
    const totalLegs = bookingIds.length + vehicleIds.length;
    if (totalLegs === 0) {
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
          booking_ids: bookingIds,
          booking_vehicle_ids: vehicleIds,
        } as any,
      },
      {
        onSuccess: () => {
          toast({ title: "Marked as Paid", description: `${totalLegs} job(s) paid out to ${driver.driver_name}` });
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

  const supplierReceivables = supplierReceivablesQuery.data?.suppliers ?? [];
  const supplierOverdueThreshold = supplierReceivablesQuery.data?.overdue_threshold_days ?? 30;
  const supplierOutstandingTotal = supplierReceivablesQuery.data?.total_outstanding ?? 0;
  const suppliersOwedRows = supplierReceivables.filter((sup) => sup.outstanding_amount > 0);
  const suppliersWithDot = suppliersOwedRows.length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Commissions</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Track driver commissions from cash and bank transfer jobs. Drivers settle weekly.
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <Card className="border-border bg-card">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">Drivers owe TVL</CardTitle>
            <Calculator className="w-4 h-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-400">
              {isSuperAdmin ? fmtMoney(s?.total_outstanding ?? 0) : (s?.total_outstanding > 0 ? "Outstanding" : "Clear")}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Commission from cash jobs</p>
          </CardContent>
        </Card>

        <Card className="border-border bg-card">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">TVL owes Drivers</CardTitle>
            <Calculator className="w-4 h-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-400">
              {isSuperAdmin ? fmtMoney(s?.total_pending_payouts ?? 0) : (s?.total_pending_payouts > 0 ? "Pending" : "Clear")}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Driver share on bank/card jobs</p>
          </CardContent>
        </Card>

        <Card className="border-border bg-card" data-testid="kpi-suppliers-owe-tvl">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">Suppliers owe TVL</CardTitle>
            <Truck className="w-4 h-4 text-sky-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-sky-400">
              {isSuperAdmin
                ? fmtMoney(supplierOutstandingTotal)
                : (supplierOutstandingTotal > 0 ? "Outstanding" : "Clear")}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Markup on third-party supplier jobs
            </p>
          </CardContent>
        </Card>

      </div>

      {/* Tabs */}
      <Tabs defaultValue="outstanding" className="w-full">
        {/* Tabs: shrink the type on small screens so all three labels (incl.
            "Settlement History") fit without overlapping. Allow whitespace to
            wrap to two lines on the very narrowest viewports rather than
            clipping. */}
        <TabsList className="grid w-full grid-cols-4 h-auto gap-1">
          <TabsTrigger
            value="outstanding"
            data-testid="tab-outstanding"
            className="text-[10px] sm:text-sm whitespace-normal text-center leading-tight py-2 px-1 min-w-0"
          >
            <span className="sm:hidden">Drivers→TVL</span>
            <span className="hidden sm:inline">Drivers owe TVL</span>
            {owedToTvlDrivers.length > 0 && (
              <span className="ml-1.5 h-1.5 w-1.5 rounded-full bg-amber-400 inline-block" />
            )}
          </TabsTrigger>
          <TabsTrigger
            value="payouts"
            data-testid="tab-payouts"
            className="text-[10px] sm:text-sm whitespace-normal text-center leading-tight py-2 px-1 min-w-0"
          >
            <span className="sm:hidden">TVL→Drivers</span>
            <span className="hidden sm:inline">TVL owes Drivers</span>
            {owedToDriverDrivers.length > 0 && (
              <span className="ml-1.5 h-1.5 w-1.5 rounded-full bg-green-400 inline-block" />
            )}
          </TabsTrigger>
          <TabsTrigger
            value="suppliers"
            data-testid="tab-suppliers"
            className="text-[10px] sm:text-sm whitespace-normal text-center leading-tight py-2 px-1 min-w-0"
          >
            <span className="sm:hidden">Suppliers</span>
            <span className="hidden sm:inline">Suppliers owe TVL</span>
            {suppliersWithDot > 0 && (
              <span className="ml-1.5 h-1.5 w-1.5 rounded-full bg-sky-400 inline-block" />
            )}
          </TabsTrigger>
          <TabsTrigger
            value="history"
            data-testid="tab-history"
            className="text-[10px] sm:text-sm whitespace-normal text-center leading-tight py-2 px-1 min-w-0"
          >
            <span className="sm:hidden">History</span>
            <span className="hidden sm:inline">History</span>
          </TabsTrigger>
        </TabsList>

        {/* Owed to TVL — Cash jobs */}
        <TabsContent value="outstanding" className="mt-4 space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <p className="text-xs text-muted-foreground">
              One row per driver. Click any driver to view their full job history, send a WhatsApp statement, or mark commissions as settled.
            </p>
            <FilterDropdown
              label="Period:"
              value={outstandingView}
              onChange={(v) => setOutstandingView(v as "all-time" | "this-month")}
              options={[
                { value: "all-time",   label: "All time" },
                { value: "this-month", label: "This month" },
              ]}
              widthClass="w-36"
              testId="filter-commissions-period"
            />
          </div>
          {/* Chip mirroring the Period dropdown so the active filter is
              surfaced consistently with the rest of the app. */}
          <ActiveFilterChips
            filters={
              outstandingView !== "all-time"
                ? [{ key: "period", label: "Period", value: "This month", onClear: () => setOutstandingView("all-time") }]
                : []
            }
          />
          {owedToTvlDrivers.map((driver) => {
            const pendingCash = driver.jobs.filter(
              (j) => j.payment_method === "Cash" && j.commission_status !== "Settled"
            );
            const pendingCount = pendingCash.length;
            const now = new Date();
            const monthStart = startOfMonth(now);
            const prevMonthStart = startOfMonth(new Date(now.getFullYear(), now.getMonth() - 1, 1));
            let displayAmount = driver.outstanding_amount;
            let prevMonthTotal = 0;
            let olderTotal = 0;
            if (outstandingView === "this-month") {
              const thisMonth = pendingCash.filter((j) => j.date && new Date(j.date) >= monthStart);
              const prevMonth = pendingCash.filter((j) => j.date && new Date(j.date) >= prevMonthStart && new Date(j.date) < monthStart);
              const older = pendingCash.filter((j) => j.date && new Date(j.date) < prevMonthStart);
              displayAmount = thisMonth.reduce((s, j) => s + (j.tvl_commission ?? 0), 0);
              prevMonthTotal = prevMonth.reduce((s, j) => s + (j.tvl_commission ?? 0), 0);
              olderTotal = older.reduce((s, j) => s + (j.tvl_commission ?? 0), 0);
            }
            return (
              <Card
                key={driver.driver_id}
                className="border-amber-500/10 hover:border-amber-500/40 hover:bg-amber-500/5 cursor-pointer transition-colors"
                onClick={() => openDriver(driver, "owed_to_tvl")}
                data-testid={`commission-driver-card-${driver.driver_id}`}
              >
                <CardContent className="p-4 sm:p-5 flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <h3 className="font-bold text-base sm:text-lg truncate">{driver.driver_name}</h3>
                        {driver.driver_staff_no && (
                          <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/30 font-semibold">
                            {driver.driver_staff_no}
                          </span>
                        )}
                        {driver.has_overdue && (
                          <Badge
                            variant="outline"
                            className="bg-destructive/20 text-destructive border-destructive/50 text-[10px] px-1.5"
                            data-testid={`badge-overdue-${driver.driver_id}`}
                          >
                            <AlertTriangle className="w-3 h-3 mr-0.5" />
                            Overdue {driver.oldest_pending_age_days ?? 0}d
                          </Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {pendingCount} pending cash {pendingCount === 1 ? "job" : "jobs"}
                        {driver.settled_jobs.length > 0 && ` · ${driver.settled_jobs.length} settled (last 90d)`}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-2xl font-bold text-amber-400">
                        {isSuperAdmin ? fmtMoney(displayAmount) : "Outstanding"}
                      </div>
                      <div className="text-[10px] text-muted-foreground uppercase tracking-wider">
                        {outstandingView === "this-month" ? "this month" : "total owed"}
                      </div>
                    </div>
                    <ChevronRight className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                  </div>
                  {outstandingView === "this-month" && isSuperAdmin && (prevMonthTotal > 0 || olderTotal > 0) && (
                    <div className="flex items-center gap-3 text-[11px] pt-1 border-t border-border/40">
                      {prevMonthTotal > 0 && (
                        <span className="text-amber-300" data-testid={`text-prev-month-${driver.driver_id}`}>
                          Previous month: {fmtMoney(prevMonthTotal)}
                        </span>
                      )}
                      {olderTotal > 0 && (
                        <span className="text-destructive" data-testid={`text-older-${driver.driver_id}`}>
                          2+ months: {fmtMoney(olderTotal)}
                        </span>
                      )}
                    </div>
                  )}
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

        {/* Suppliers owe TVL — third-party supplier markup commission */}
        <TabsContent value="suppliers" className="mt-4 space-y-3">
          <p className="text-xs text-muted-foreground">
            One row per supplier. Click any supplier to see the breakdown and
            mark commission as collected when they pay TVL.
          </p>
          {supplierReceivablesQuery.isLoading && (
            <div className="space-y-3">
              {[...Array(3)].map((_, i) => (
                <Skeleton key={i} className="h-24" />
              ))}
            </div>
          )}
          {supplierReceivablesQuery.isError && (
            <div className="py-12 text-center text-destructive border border-dashed rounded-lg">
              Failed to load supplier receivables. Refresh the page to try again.
            </div>
          )}
          {!supplierReceivablesQuery.isLoading
            && !supplierReceivablesQuery.isError
            && suppliersOwedRows.length === 0 && (
            <div className="py-12 text-center text-muted-foreground border border-dashed rounded-lg">
              No supplier markup commission outstanding.
            </div>
          )}
          {suppliersOwedRows.map((sup) => {
            const overdue = (sup.oldest_outstanding_age_days ?? 0) >= supplierOverdueThreshold;
            return (
              <Card
                key={sup.supplier_id}
                className="border-sky-500/10 hover:border-sky-500/40 hover:bg-sky-500/5 cursor-pointer transition-colors"
                onClick={() => setSupplierDialog(sup)}
                data-testid={`supplier-receivable-card-${sup.supplier_id}`}
              >
                <CardContent className="p-4 sm:p-5 flex items-center justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <h3 className="font-bold text-base sm:text-lg truncate">{sup.supplier_name}</h3>
                      {overdue && (
                        <Badge
                          variant="outline"
                          className="bg-destructive/20 text-destructive border-destructive/50 text-[10px] px-1.5"
                        >
                          <AlertTriangle className="w-3 h-3 mr-0.5" />
                          Overdue {sup.oldest_outstanding_age_days ?? 0}d
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {sup.outstanding_jobs.length} outstanding {sup.outstanding_jobs.length === 1 ? "job" : "jobs"}
                      {sup.collected_jobs.length > 0 && ` · ${sup.collected_jobs.length} collected`}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-bold text-sky-400">
                      {isSuperAdmin ? fmtMoney(sup.outstanding_amount) : "Outstanding"}
                    </div>
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wider">total owed</div>
                  </div>
                  <ChevronRight className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                </CardContent>
              </Card>
            );
          })}
        </TabsContent>

        {/* Settlement History */}
        <TabsContent value="history" className="mt-4 space-y-4">
          <SettlementHistoryView
            entries={historyQuery.data ?? []}
            isLoading={historyQuery.isLoading}
            isError={historyQuery.isError}
            isSuperAdmin={isSuperAdmin}
          />
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

      {/* Supplier receivables dialog (per-booking mark-collected) */}
      <SupplierReceivableDialog
        supplier={supplierDialog}
        isSuperAdmin={isSuperAdmin}
        onClose={() => setSupplierDialog(null)}
        onToggle={handleSupplierToggle}
      />

      {/* Settlement notes dialog (Fix 5) */}
      <Dialog open={!!settleNotesDriver} onOpenChange={(o) => { if (!o) setSettleNotesDriver(null); }}>
        <DialogContent data-testid="dialog-settle-notes">
          <DialogHeader>
            <DialogTitle>Confirm settlement</DialogTitle>
            <DialogDescription>
              {settleNotesDriver && `Mark all pending cash commissions for ${settleNotesDriver.driver_name} as settled.`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Optional settlement note
            </label>
            <Textarea
              value={settleNotesText}
              onChange={(e) => setSettleNotesText(e.target.value)}
              placeholder="e.g. Cash received in person, counted with driver"
              rows={3}
              data-testid="input-settlement-notes"
            />
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={() => setSettleNotesDriver(null)} className="w-full sm:w-auto">
              Cancel
            </Button>
            <Button
              onClick={confirmSettle}
              disabled={settle.isPending}
              className="w-full sm:w-auto bg-amber-600 hover:bg-amber-500 text-white"
              data-testid="button-confirm-settle"
            >
              <Check className="w-4 h-4 mr-2" />
              {settle.isPending ? "Settling…" : "Confirm settlement"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Settlement WhatsApp confirmation dialog (Fix 1) */}
      <Dialog open={!!settleConfirm} onOpenChange={(o) => { if (!o) setSettleConfirm(null); }}>
        <DialogContent data-testid="dialog-settle-confirm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-emerald-500" />
              Settlement Confirmed
            </DialogTitle>
            <DialogDescription>
              {settleConfirm && `${settleConfirm.jobsSettled.length} job(s) settled for ${settleConfirm.driver.driver_name}.`}
            </DialogDescription>
          </DialogHeader>
          {settleConfirm && (
            <div className="space-y-3">
              <div className="flex items-center justify-between p-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5">
                <span className="text-sm text-muted-foreground">Total settled</span>
                <span className="text-xl font-bold text-emerald-400">{fmtMoney(settleConfirm.total)}</span>
              </div>
              <ul className="text-xs space-y-1 max-h-48 overflow-y-auto border border-border rounded p-2">
                {settleConfirm.jobsSettled.map((j) => (
                  <li key={j.booking_id} className="flex justify-between">
                    <span className="font-mono">{j.tvl_ref ?? "—"}</span>
                    <span>{fmtMoney(j.tvl_commission ?? 0)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={() => setSettleConfirm(null)} className="w-full sm:w-auto">
              Close
            </Button>
            {settleConfirm && (() => {
              const url = buildSettlementWaUrl(settleConfirm);
              if (!url) {
                return (
                  <Button disabled variant="outline" className="w-full sm:w-auto">
                    <MessageSquare className="w-4 h-4 mr-2" /> No WhatsApp on file
                  </Button>
                );
              }
              return (
                <Button
                  onClick={() => window.open(url, "_blank")}
                  className="w-full sm:w-auto bg-green-700 hover:bg-green-600 text-white"
                  data-testid="button-send-settlement-wa"
                >
                  <MessageSquare className="w-4 h-4 mr-2" />
                  Send WhatsApp to driver
                </Button>
              );
            })()}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

type DriverMonthAggregate = {
  driver_id: string;
  driver_name: string;
  tvl_number: string | null;
  total: number;
  entries: SettlementHistoryEntry[];
};

function SettlementHistoryView({
  entries,
  isLoading,
  isError,
  isSuperAdmin,
}: {
  entries: SettlementHistoryEntry[];
  isLoading: boolean;
  isError: boolean;
  isSuperAdmin: boolean;
}) {
  // Build the list of months that have at least one entry (newest first).
  const monthOptions = useMemo(() => {
    const set = new Set<string>();
    for (const e of entries) {
      const key = e.month ?? (e.settled_at ? e.settled_at.slice(0, 7) : null);
      if (key) set.add(key);
    }
    return Array.from(set).sort((a, b) => (a < b ? 1 : -1));
  }, [entries]);

  // Default the dropdown to the most recent month with entries; falls back to
  // current calendar month when there are no entries at all.
  const [selectedMonth, setSelectedMonth] = useState<string>("");
  useEffect(() => {
    if (monthOptions.length === 0) {
      setSelectedMonth(format(new Date(), "yyyy-MM"));
    } else if (!selectedMonth || !monthOptions.includes(selectedMonth)) {
      setSelectedMonth(monthOptions[0]);
    }
  }, [monthOptions, selectedMonth]);

  // Drill-in dialog: when a driver card is clicked we show every settlement
  // and payout for that driver in the selected month.
  const [drillDriver, setDrillDriver] = useState<DriverMonthAggregate | null>(null);

  // Filter to selected month, then aggregate by driver.
  const monthEntries = useMemo(() => {
    if (!selectedMonth) return [];
    return entries.filter((e) => {
      const key = e.month ?? (e.settled_at ? e.settled_at.slice(0, 7) : null);
      return key === selectedMonth;
    });
  }, [entries, selectedMonth]);

  const driverAggregates = useMemo<DriverMonthAggregate[]>(() => {
    const map = new Map<string, DriverMonthAggregate>();
    for (const e of monthEntries) {
      // Group by driver_id when available, else by name as fallback.
      const key = e.driver_id ?? e.driver_name ?? "unknown";
      const existing = map.get(key);
      if (existing) {
        existing.total += e.total_amount ?? 0;
        existing.entries.push(e);
      } else {
        map.set(key, {
          driver_id: e.driver_id ?? key,
          driver_name: e.driver_name ?? "Unknown driver",
          tvl_number: e.tvl_number ?? null,
          total: e.total_amount ?? 0,
          entries: [e],
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [monthEntries]);

  const monthTotal = useMemo(
    () => driverAggregates.reduce((s, d) => s + d.total, 0),
    [driverAggregates],
  );

  const monthLabel = (key: string) =>
    key && /^\d{4}-\d{2}$/.test(key) ? format(parseISO(`${key}-01`), "MMMM yyyy") : key;

  const exportCsv = () => {
    const rows = monthEntries.map((e) => ({
      Driver: e.driver_name,
      "TVL Number": e.tvl_number ?? "",
      Type: e.kind === "payout" ? "Payout" : "Settlement",
      "Date": e.settled_at ? format(parseISO(e.settled_at), "yyyy-MM-dd") : "",
      Month: e.month ?? "",
      "Total Amount": e.total_amount ?? 0,
      "Booking Refs": (e.booking_refs ?? []).join(", "),
      Operator: e.operator_name ?? "",
      Notes: e.notes ?? "",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Settlements");
    const stamp = format(new Date(), "yyyyMMdd_HHmm");
    XLSX.writeFile(wb, `traveluxe_settlements_${selectedMonth || stamp}.xlsx`);
  };

  if (isLoading) {
    return <Skeleton className="h-48 w-full" />;
  }
  if (isError) {
    return (
      <div className="py-8 text-center text-sm text-destructive border border-destructive/30 rounded-lg">
        Failed to load settlement history.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Month selector + month total + export. */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <FilterDropdown
            label="Month:"
            value={selectedMonth}
            onChange={setSelectedMonth}
            options={
              monthOptions.length > 0
                ? monthOptions.map((m) => ({ value: m, label: monthLabel(m) }))
                : [{ value: selectedMonth, label: monthLabel(selectedMonth) }]
            }
            widthClass="w-48"
            testId="filter-history-month"
          />
          <div className="text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">{driverAggregates.length}</span>
            {" "}
            driver{driverAggregates.length === 1 ? "" : "s"} · total{" "}
            <span className="font-bold text-emerald-400">
              {isSuperAdmin ? fmtMoney(monthTotal) : "—"}
            </span>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={exportCsv}
          disabled={monthEntries.length === 0}
          data-testid="button-export-settlements-csv"
        >
          <Download className="w-3.5 h-3.5 mr-1.5" />
          Export CSV
        </Button>
      </div>

      {/* Driver list for the selected month. */}
      {driverAggregates.length === 0 ? (
        <div className="py-12 text-center text-muted-foreground border border-dashed rounded-lg">
          No settlements or payouts recorded for {monthLabel(selectedMonth)}.
        </div>
      ) : (
        <div className="space-y-2">
          {driverAggregates.map((d) => (
            <button
              key={d.driver_id}
              type="button"
              onClick={() => setDrillDriver(d)}
              className="w-full text-left"
              data-testid={`history-driver-card-${d.driver_id}`}
            >
              <Card className="border-emerald-500/20 hover:border-emerald-500/40 transition-colors">
                <CardContent className="p-4 flex items-center justify-between gap-3 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-sm">{d.driver_name}</span>
                      {d.tvl_number && (
                        <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/30 font-semibold">
                          {d.tvl_number}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {d.entries.length} entr{d.entries.length === 1 ? "y" : "ies"} · tap to see breakdown
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="text-lg font-bold text-emerald-400">
                      {isSuperAdmin ? fmtMoney(d.total) : "—"}
                    </div>
                    <ChevronRight className="w-4 h-4 text-muted-foreground" />
                  </div>
                </CardContent>
              </Card>
            </button>
          ))}
        </div>
      )}

      <DriverMonthBreakdownDialog
        driver={drillDriver}
        monthLabel={drillDriver ? monthLabel(selectedMonth) : ""}
        isSuperAdmin={isSuperAdmin}
        onClose={() => setDrillDriver(null)}
      />
    </div>
  );
}

function DriverMonthBreakdownDialog({
  driver,
  monthLabel,
  isSuperAdmin,
  onClose,
}: {
  driver: DriverMonthAggregate | null;
  monthLabel: string;
  isSuperAdmin: boolean;
  onClose: () => void;
}) {
  const open = !!driver;
  const qc = useQueryClient();
  const { toast } = useToast();
  const [unwinding, setUnwinding] = useState<string | null>(null);

  // Unwind a settlement or payout — admin only. Reverts the underlying
  // booking commission_status / payout_status back to Outstanding /
  // Pending and deletes the ledger row. Used when a row was mistakenly
  // recorded or the underlying booking has since been cancelled.
  const handleUnwind = async (e: SettlementHistoryEntry) => {
    if (!e.settlement_id) return;
    const kind = e.kind === "payout" ? "payout" : "settlement";
    const url = kind === "payout"
      ? `${API_BASE}/commissions/payouts/${e.settlement_id}`
      : `${API_BASE}/commissions/settlements/${e.settlement_id}`;
    const ok = window.confirm(
      `Unwind this ${kind} of ${fmtMoney(e.total_amount ?? 0)} for ${e.driver_name}?\n\nThe ${e.booking_refs?.length ?? 0} job(s) will revert to ${kind === "payout" ? "Pending" : "Outstanding"} and the ledger row will be deleted. This cannot be undone.`
    );
    if (!ok) return;
    setUnwinding(e.settlement_id);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const r = await fetch(url, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${session?.access_token ?? ""}` },
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error ?? `Unwind failed (${r.status})`);
      }
      toast({ title: `${kind === "payout" ? "Payout" : "Settlement"} unwound`, description: `Jobs reverted for ${e.driver_name}` });
      // Broad invalidation — the bookings list, drivers detail, and
      // commissions tabs all derive from the same rows we just touched.
      qc.invalidateQueries();
      onClose();
    } catch (err: any) {
      toast({ title: "Unwind failed", description: err?.message ?? "Unknown error", variant: "destructive" });
    } finally {
      setUnwinding(null);
    }
  };

  if (!driver) return null;

  // Sort entries within the dialog newest first so the most recent
  // settlement/payout sits at the top.
  const sorted = [...driver.entries].sort(
    (a, b) => new Date(b.settled_at ?? 0).getTime() - new Date(a.settled_at ?? 0).getTime(),
  );

  // Split totals into settlement (cash → owed to TVL) vs payout (bank/card → owed to driver)
  // so the breakdown header tells the operator at a glance how the total is composed.
  const settlementTotal = sorted
    .filter((e) => e.kind !== "payout")
    .reduce((s, e) => s + (e.total_amount ?? 0), 0);
  const payoutTotal = sorted
    .filter((e) => e.kind === "payout")
    .reduce((s, e) => s + (e.total_amount ?? 0), 0);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            <span>{driver.driver_name}</span>
            {driver.tvl_number && (
              <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/30 font-semibold">
                {driver.tvl_number}
              </span>
            )}
          </DialogTitle>
          <DialogDescription>
            {monthLabel} — {sorted.length} entr{sorted.length === 1 ? "y" : "ies"} · total{" "}
            <span className="font-bold text-emerald-400">
              {isSuperAdmin ? fmtMoney(driver.total) : "—"}
            </span>
          </DialogDescription>
        </DialogHeader>

        {/* Settlement / payout split summary. */}
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Settlements (cash)
            </div>
            <div className="text-base font-bold text-emerald-400">
              {isSuperAdmin ? fmtMoney(settlementTotal) : "—"}
            </div>
          </div>
          <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-3">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Payouts (bank/card)
            </div>
            <div className="text-base font-bold text-blue-400">
              {isSuperAdmin ? fmtMoney(payoutTotal) : "—"}
            </div>
          </div>
        </div>

        {/* Per-entry breakdown. */}
        <div className="space-y-2">
          {sorted.map((e, idx) => (
            <Card
              key={e.settlement_id ?? `${e.kind}-${idx}`}
              className={
                e.kind === "payout"
                  ? "border-blue-500/20"
                  : "border-emerald-500/20"
              }
            >
              <CardContent className="p-3 space-y-2">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge
                        variant="outline"
                        className={
                          e.kind === "payout"
                            ? "text-[10px] border-blue-500/40 text-blue-400"
                            : "text-[10px] border-emerald-500/40 text-emerald-400"
                        }
                      >
                        {e.kind === "payout" ? "Payout" : "Settlement"}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {e.settled_at ? format(parseISO(e.settled_at), "dd MMM yyyy") : "—"}
                        {e.operator_name && ` · by ${e.operator_name}`}
                      </span>
                    </div>
                    {e.booking_refs && e.booking_refs.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {e.booking_refs.map((ref) => (
                          <Badge
                            key={ref}
                            variant="outline"
                            className="text-[10px] font-mono"
                          >
                            {ref}
                          </Badge>
                        ))}
                      </div>
                    )}
                    {e.notes && (
                      <div className="text-xs italic text-muted-foreground border-l-2 border-border pl-2 mt-2">
                        {e.notes}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <div
                      className={`text-base font-bold ${
                        e.kind === "payout" ? "text-blue-400" : "text-emerald-400"
                      }`}
                    >
                      {isSuperAdmin ? fmtMoney(e.total_amount ?? 0) : "—"}
                    </div>
                    {isSuperAdmin && e.settlement_id && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-[11px] border-destructive/40 text-destructive hover:bg-destructive/10"
                        disabled={unwinding === e.settlement_id}
                        onClick={() => handleUnwind(e)}
                        data-testid={`btn-unwind-${e.settlement_id}`}
                      >
                        {unwinding === e.settlement_id ? "Unwinding…" : "Unwind"}
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
            {driver.driver_id ? (
              <Link href={`/drivers/${driver.driver_id}`}>
                <span className="text-primary hover:underline cursor-pointer">{driver.driver_name}</span>
              </Link>
            ) : (
              <span>{driver.driver_name}</span>
            )}
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

// ─── Supplier receivable detail dialog ────────────────────────────────────
// Shows the breakdown of supplier-commission lines for one supplier with
// per-booking "Mark Collected" / "Reset" buttons. Mirrors the driver
// settlement dialog's pattern so operators get a consistent feel.
function SupplierReceivableDialog({
  supplier,
  isSuperAdmin,
  onClose,
  onToggle,
}: {
  supplier: SupplierReceivable | null;
  isSuperAdmin: boolean;
  onClose: () => void;
  onToggle: (bookingId: string, nextCollected: boolean, paymentRef?: string) => Promise<void> | void;
}) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [refByBooking, setRefByBooking] = useState<Record<string, string>>({});

  const handleClick = async (line: SupplierReceivableLine, nextCollected: boolean) => {
    setPendingId(line.booking_id);
    try {
      const ref = nextCollected ? (refByBooking[line.booking_id] ?? "").trim() : undefined;
      await onToggle(line.booking_id, nextCollected, ref || undefined);
    } finally {
      setPendingId(null);
    }
  };

  return (
    <Dialog open={!!supplier} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto" data-testid="dialog-supplier-receivables">
        {supplier && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Truck className="w-5 h-5 text-sky-400" />
                {supplier.supplier_name}
              </DialogTitle>
              <DialogDescription>
                {supplier.supplier_contact ?? "Markup commission owed by this supplier"}
              </DialogDescription>
            </DialogHeader>

            <div className="grid grid-cols-2 gap-3 py-2">
              <div className="rounded-lg border border-sky-500/20 bg-sky-500/5 p-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Outstanding</div>
                <div className="text-2xl font-bold text-sky-400">
                  {isSuperAdmin ? fmtMoney(supplier.outstanding_amount) : "Outstanding"}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {supplier.outstanding_jobs.length} {supplier.outstanding_jobs.length === 1 ? "job" : "jobs"}
                </div>
              </div>
              <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Collected</div>
                <div className="text-2xl font-bold text-emerald-400">
                  {isSuperAdmin ? fmtMoney(supplier.collected_amount) : "—"}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {supplier.collected_jobs.length} {supplier.collected_jobs.length === 1 ? "job" : "jobs"}
                </div>
              </div>
            </div>

            {supplier.outstanding_jobs.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Outstanding ({supplier.outstanding_jobs.length})
                </h3>
                <ul className="divide-y divide-border rounded-lg border border-border overflow-hidden">
                  {supplier.outstanding_jobs.map((line) => (
                    <li key={line.booking_id} className="p-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Link href={`/bookings/${line.booking_id}`}>
                            <a className="font-semibold text-sm text-primary hover:underline inline-flex items-center gap-1">
                              {line.tvl_ref ?? "—"}
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          </Link>
                          {line.service_type && (
                            <Badge variant="outline" className="text-[10px] px-1.5">{line.service_type}</Badge>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {fmtDate(line.date)} · {line.client_name ?? "Client"}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 sm:flex-shrink-0">
                        <div className="text-sm font-bold text-sky-400 min-w-[60px] text-right">
                          {isSuperAdmin ? fmtMoney(line.amount) : "Outstanding"}
                        </div>
                        <input
                          type="text"
                          placeholder="Ref (optional)"
                          value={refByBooking[line.booking_id] ?? ""}
                          onChange={(e) => setRefByBooking((m) => ({ ...m, [line.booking_id]: e.target.value }))}
                          className="text-xs px-2 py-1.5 rounded border border-input bg-background w-28"
                          data-testid={`input-supplier-ref-${line.booking_id}`}
                        />
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-emerald-500 hover:bg-emerald-500/10 text-xs"
                          disabled={pendingId === line.booking_id}
                          onClick={() => handleClick(line, true)}
                          data-testid={`btn-supplier-collect-${line.booking_id}`}
                        >
                          <Check className="w-3 h-3 mr-1" />
                          {pendingId === line.booking_id ? "..." : "Collected"}
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {supplier.collected_jobs.length > 0 && (
              <div className="space-y-2 pt-3">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Collected ({supplier.collected_jobs.length})
                </h3>
                <ul className="divide-y divide-border rounded-lg border border-border overflow-hidden">
                  {supplier.collected_jobs.map((line) => (
                    <li key={line.booking_id} className="p-3 flex items-center justify-between gap-2 bg-emerald-500/5">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Link href={`/bookings/${line.booking_id}`}>
                            <a className="font-semibold text-sm text-primary hover:underline inline-flex items-center gap-1">
                              {line.tvl_ref ?? "—"}
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          </Link>
                          <Badge variant="outline" className="text-[10px] px-1.5 text-emerald-500 border-emerald-500/30">
                            Collected
                          </Badge>
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {fmtDate(line.date)} · {line.client_name ?? "Client"}
                          {line.payment_ref ? ` · Ref: ${line.payment_ref}` : ""}
                          {line.collected_at ? ` · Marked ${fmtDate(line.collected_at)}` : ""}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <div className="text-sm font-bold text-emerald-400">
                          {isSuperAdmin ? fmtMoney(line.amount) : "—"}
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-muted-foreground hover:text-foreground text-xs"
                          disabled={pendingId === line.booking_id}
                          onClick={() => handleClick(line, false)}
                          data-testid={`btn-supplier-undo-${line.booking_id}`}
                        >
                          <Undo2 className="w-3 h-3 mr-1" />
                          {pendingId === line.booking_id ? "..." : "Undo"}
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={onClose}>Close</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
