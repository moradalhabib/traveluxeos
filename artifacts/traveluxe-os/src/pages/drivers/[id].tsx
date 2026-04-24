import { useParams, useLocation, Link } from "wouter";
import { useState, useEffect, useMemo } from "react";
import { useGetDriver, useUpdateDriver, getGetDriverQueryKey } from "@workspace/api-client-react";
import { ActivityPanel } from "@/components/activity/ActivityPanel";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";
import { MessageSquare, Edit, ArrowLeft, Calculator, Car, Save, X, Loader2, BarChart3, AlertTriangle, Plane } from "lucide-react";
import { format } from "date-fns";
import { fmtLondon } from "@/lib/datetime";

const API_BASE = `${import.meta.env.VITE_API_URL ?? ""}/api`;

async function authFetch(url: string, init: RequestInit = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  const headers: Record<string, string> = {
    ...(init.headers as Record<string, string> | undefined),
  };
  if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
  if (init.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
  const res = await fetch(url, { ...init, headers });
  if (!res.ok) throw new Error(await res.text().catch(() => res.statusText));
  return res.json();
}

interface FinancialSummary {
  total_gross_revenue: number;
  total_commission_generated: number;
  total_commission_settled: number;
  total_commission_pending: number;
  settlement_count: number;
  avg_commission_per_job: number;
  job_count: number;
  completed_count: number;
}

interface Performance {
  total_jobs_completed: number;
  jobs_this_month: number;
  most_frequent_service_type: string | null;
  most_frequent_client: string | null;
  busiest_day_of_week: string | null;
  avg_jobs_per_month: number;
}

interface Issue {
  id: string;
  description: string;
  status: "Open" | "Ongoing" | "Resolved";
  logged_at: string;
  resolved_at: string | null;
  tvl_ref: string | null;
}

const formatGBP = (n: number) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(n || 0);

export default function DriverDetail() {
  const params = useParams();
  const [, setLocation] = useLocation();
  const id = params.id as string;
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: driver, isLoading } = useGetDriver(id, {
    query: { enabled: !!id, queryKey: getGetDriverQueryKey(id) },
  });

  const updateDriver = useUpdateDriver();

  const { data: financial } = useQuery<FinancialSummary>({
    queryKey: ["driver-financial-summary", id],
    queryFn: () => authFetch(`${API_BASE}/drivers/${id}/financial-summary`),
    enabled: !!id,
  });

  const { data: performance } = useQuery<Performance>({
    queryKey: ["driver-performance", id],
    queryFn: () => authFetch(`${API_BASE}/drivers/${id}/performance`),
    enabled: !!id,
  });

  const { data: issues } = useQuery<Issue[]>({
    queryKey: ["driver-issues", id],
    queryFn: () => authFetch(`${API_BASE}/issues?driver_id=${id}`),
    enabled: !!id,
  });

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    name: "",
    staff_no: "",
    whatsapp: "",
    own_vehicle: true,
    vehicle_model: "",
    vehicle_year: "" as string | number,
    plate: "",
    status: "Active",
    notes: "",
  });

  useEffect(() => {
    if (!driver) return;
    const d = driver as any;
    setForm({
      name: d.name ?? "",
      staff_no: d.staff_no ?? "",
      whatsapp: d.whatsapp ?? "",
      own_vehicle: d.own_vehicle === false ? false : true,
      vehicle_model: d.vehicle_model ?? "",
      vehicle_year: d.vehicle_year ?? "",
      plate: d.plate ?? "",
      status: d.status ?? "Active",
      notes: d.notes ?? "",
    });
  }, [driver, editing]);

  const handleSave = () => {
    if (!form.name.trim() || !form.whatsapp.trim()) {
      toast({ title: "Driver name and WhatsApp number are required", variant: "destructive" });
      return;
    }
    if (form.own_vehicle) {
      if (!form.vehicle_model.trim() || !form.plate.trim() || !form.vehicle_year) {
        toast({
          title: "Vehicle make/model, year and plate are required when Own Vehicle = Yes",
          variant: "destructive",
        });
        return;
      }
    }

    const currentStaffNo = ((driver as any)?.staff_no ?? "").trim();
    const newStaffNo = form.staff_no.trim();

    const payload: any = {
      name: form.name.trim(),
      whatsapp: form.whatsapp.trim(),
      own_vehicle: form.own_vehicle,
      status: form.status,
      notes: form.notes.trim() || null,
    };

    // Only include staff_no if it actually changed, so a no-op save never
    // trips the unique constraint with the driver's own existing value.
    if (newStaffNo !== currentStaffNo) {
      payload.staff_no = newStaffNo || null;
    }

    if (form.own_vehicle) {
      const yr = form.vehicle_year === "" ? null : Number(form.vehicle_year);
      if (yr && (yr < 1990 || yr > 2030)) {
        toast({ title: "Vehicle year must be between 1990 and 2030", variant: "destructive" });
        return;
      }
      payload.vehicle_model = form.vehicle_model.trim() || null;
      payload.vehicle_year = yr;
      payload.plate = form.plate.trim() || null;
    } else {
      payload.vehicle_model = null;
      payload.vehicle_year = null;
      payload.plate = null;
    }

    updateDriver.mutate(
      { id, data: payload },
      {
        onSuccess: () => {
          toast({ title: "Driver profile updated" });
          qc.invalidateQueries({ queryKey: getGetDriverQueryKey(id) });
          qc.invalidateQueries({ queryKey: ["/drivers"] });
          setEditing(false);
        },
        onError: (err: any) => {
          const raw = err?.response?.data?.error ?? err?.message ?? "Try again";
          const isStaffNoDup =
            typeof raw === "string" &&
            raw.toLowerCase().includes("drivers_staff_no_unique");
          toast({
            title: isStaffNoDup
              ? `TVL number "${form.staff_no.trim()}" is already used by another driver`
              : "Failed to update driver",
            description: isStaffNoDup
              ? "Pick a different TVL Staff Number — each driver must have a unique one."
              : raw,
            variant: "destructive",
          });
        },
      }
    );
  };

  // Group commission ledger entries by yyyy-MM, most recent first.
  const monthlyLedger = useMemo(() => {
    const ledger = ((driver as any)?.commission_ledger ?? []) as any[];
    const groups = new Map<string, { label: string; entries: any[]; total: number; settled: number; pending: number }>();
    for (const entry of ledger) {
      if (!entry.date) continue;
      const dt = new Date(entry.date);
      const key = format(dt, "yyyy-MM");
      const label = format(dt, "MMMM yyyy");
      if (!groups.has(key)) {
        groups.set(key, { label, entries: [], total: 0, settled: 0, pending: 0 });
      }
      const grp = groups.get(key)!;
      grp.entries.push(entry);
      const amount = Number(entry.tvl_commission || 0);
      grp.total += amount;
      const isSettled =
        entry.commission_status === "Settled" || entry.payout_status === "Paid";
      if (isSettled) grp.settled += amount;
      else grp.pending += amount;
    }
    return Array.from(groups.entries())
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([key, v]) => ({ key, ...v }));
  }, [driver]);

  const ledgerTotals = useMemo(() => {
    return monthlyLedger.reduce(
      (acc, m) => {
        acc.generated += m.total;
        acc.settled += m.settled;
        acc.pending += m.pending;
        return acc;
      },
      { generated: 0, settled: 0, pending: 0 }
    );
  }, [monthlyLedger]);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-[300px] w-full" />
      </div>
    );
  }

  if (!driver) {
    return <div>Driver not found</div>;
  }

  const d: any = driver;
  const isSuspended = d.status === "Suspended";
  const ownVehicle = d.own_vehicle !== false;
  const vehicleLine = ownVehicle ? [d.vehicle_year, d.vehicle_model].filter(Boolean).join(" ") : "";

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <Button variant="ghost" onClick={() => setLocation("/drivers")} className="mb-4" data-testid="button-back">
        <ArrowLeft className="w-4 h-4 mr-2" /> Back to Drivers
      </Button>

      {isSuspended && (
        <div
          className="rounded-lg border border-red-600/60 bg-red-600/15 px-4 py-3 flex items-center gap-3"
          data-testid="banner-suspended"
        >
          <AlertTriangle className="w-5 h-5 text-red-500" />
          <span className="font-semibold text-red-500 text-lg">⛔ SUSPENDED</span>
          <span className="text-sm text-red-400/80">
            This driver is suspended and should not be assigned to new jobs.
          </span>
        </div>
      )}

      <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 mb-1 flex-wrap">
            <h1 className="text-3xl font-bold tracking-tight text-foreground">{d.name}</h1>
            {d.staff_no && (
              <span className="font-mono text-sm px-2.5 py-1 rounded bg-primary/10 text-primary border border-primary/30 font-semibold">
                {d.staff_no}
              </span>
            )}
            <Badge
              variant="outline"
              className={
                d.status === "Active"
                  ? "bg-green-500/20 text-green-500 border-green-500/50"
                  : d.status === "Suspended"
                  ? "bg-red-600/20 text-red-500 border-red-600/60"
                  : "bg-secondary text-secondary-foreground border-border"
              }
              data-testid="badge-driver-status"
            >
              {d.status}
            </Badge>
          </div>
          {ownVehicle && vehicleLine && (
            <div className="flex items-center gap-2 mt-1 mb-1">
              <Car className="w-4 h-4 text-primary" />
              <span className="text-primary font-semibold text-lg">{vehicleLine}</span>
              {d.plate && (
                <span className="font-mono text-sm text-muted-foreground bg-secondary px-2 py-0.5 rounded">
                  {d.plate}
                </span>
              )}
            </div>
          )}
          {!ownVehicle && (
            <div className="mt-2">
              <span
                className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/40 text-sm font-medium"
                data-testid="pill-no-own-vehicle"
              >
                <Car className="w-3.5 h-3.5" />
                No Own Vehicle — Uses Supplier or Client Vehicle
              </span>
            </div>
          )}
          <p className="text-muted-foreground mt-1">{d.whatsapp}</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {d.whatsapp && !editing && (
            <a href={`https://wa.me/${d.whatsapp.replace(/\D/g, "")}`} target="_blank" rel="noopener noreferrer">
              <Button className="bg-green-900/20 text-green-500 hover:bg-green-900/40 border border-green-900/50">
                <MessageSquare className="w-4 h-4 mr-2" />
                WhatsApp
              </Button>
            </a>
          )}
          {!editing && (
            <Button variant="outline" onClick={() => setEditing(true)} data-testid="button-edit-driver">
              <Edit className="w-4 h-4 mr-2" /> Edit
            </Button>
          )}
        </div>
      </div>

      <Card className="border-primary/10 bg-card">
        <CardHeader>
          <CardTitle>Driver Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {editing ? (
            <div className="space-y-4">
              <div>
                <Label htmlFor="name">Driver Name *</Label>
                <Input
                  id="name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  data-testid="input-name"
                />
              </div>
              <div>
                <Label htmlFor="staff_no">
                  TVL Staff Number
                  <span className="text-xs text-muted-foreground font-normal ml-2">e.g. TVL 02</span>
                </Label>
                <Input
                  id="staff_no"
                  placeholder="TVL 02"
                  value={form.staff_no}
                  onChange={(e) => setForm({ ...form, staff_no: e.target.value })}
                  className="font-mono uppercase"
                  data-testid="input-staff-no"
                />
              </div>
              <div>
                <Label htmlFor="whatsapp">Phone / WhatsApp Number *</Label>
                <Input
                  id="whatsapp"
                  type="tel"
                  placeholder="+44 7700 000000"
                  value={form.whatsapp}
                  onChange={(e) => setForm({ ...form, whatsapp: e.target.value })}
                  data-testid="input-whatsapp"
                />
              </div>

              <div>
                <Label>Own Vehicle</Label>
                <RadioGroup
                  value={form.own_vehicle ? "yes" : "no"}
                  onValueChange={(v) => setForm({ ...form, own_vehicle: v === "yes" })}
                  className="flex gap-6 mt-2"
                  data-testid="radio-own-vehicle"
                >
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="yes" id="own-yes" data-testid="radio-own-vehicle-yes" />
                    <Label htmlFor="own-yes" className="cursor-pointer">Yes</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="no" id="own-no" data-testid="radio-own-vehicle-no" />
                    <Label htmlFor="own-no" className="cursor-pointer">No — uses supplier or client vehicle</Label>
                  </div>
                </RadioGroup>
              </div>

              {form.own_vehicle && (
                <div className="space-y-4 rounded-lg border border-primary/15 bg-primary/5 p-4">
                  <div>
                    <Label htmlFor="vehicle_model">Vehicle Make &amp; Model *</Label>
                    <Input
                      id="vehicle_model"
                      placeholder="e.g. Range Rover Vogue, Mercedes E Class"
                      value={form.vehicle_model}
                      onChange={(e) => setForm({ ...form, vehicle_model: e.target.value })}
                      data-testid="input-vehicle-model"
                    />
                  </div>
                  <div>
                    <Label htmlFor="vehicle_year">Vehicle Year *</Label>
                    <Input
                      id="vehicle_year"
                      type="number"
                      inputMode="numeric"
                      min={1990}
                      max={2030}
                      placeholder="e.g. 2024"
                      value={form.vehicle_year}
                      onChange={(e) => setForm({ ...form, vehicle_year: e.target.value })}
                      data-testid="input-vehicle-year"
                    />
                  </div>
                  <div>
                    <Label htmlFor="plate">License Plate / Registration *</Label>
                    <Input
                      id="plate"
                      placeholder="e.g. CX73 KTP"
                      value={form.plate}
                      onChange={(e) => setForm({ ...form, plate: e.target.value })}
                      className="font-mono uppercase"
                      data-testid="input-plate"
                    />
                  </div>
                </div>
              )}

              <div>
                <Label htmlFor="status">Status</Label>
                <Select
                  value={form.status}
                  onValueChange={(v) => setForm({ ...form, status: v })}
                >
                  <SelectTrigger id="status" data-testid="select-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Active">Active</SelectItem>
                    <SelectItem value="Inactive">Inactive</SelectItem>
                    <SelectItem value="Suspended" data-testid="select-status-suspended">Suspended</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="notes">Notes</Label>
                <Textarea
                  id="notes"
                  rows={3}
                  placeholder="Internal notes — preferences, availability, etc."
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  data-testid="input-notes"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <Button
                  onClick={handleSave}
                  disabled={updateDriver.isPending}
                  className="flex-1"
                  data-testid="button-save-driver"
                >
                  {updateDriver.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  <Save className="w-4 h-4 mr-2" /> Save Changes
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setEditing(false)}
                  disabled={updateDriver.isPending}
                  data-testid="button-cancel-edit"
                >
                  <X className="w-4 h-4 mr-2" /> Cancel
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4 text-sm">
                {ownVehicle ? (
                  <>
                    <div>
                      <span className="text-muted-foreground block mb-1">Vehicle Make &amp; Model</span>
                      <span className="font-medium">{d.vehicle_model || "N/A"}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground block mb-1">Vehicle Year</span>
                      <span className="font-medium">{d.vehicle_year || "N/A"}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground block mb-1">License Plate</span>
                      <span className="font-medium">{d.plate || "N/A"}</span>
                    </div>
                  </>
                ) : (
                  <div className="col-span-2">
                    <span className="text-muted-foreground block mb-1">Vehicle</span>
                    <span className="font-medium text-amber-400">
                      No own vehicle — uses supplier or client vehicle
                    </span>
                  </div>
                )}
                <div>
                  <span className="text-muted-foreground block mb-1">Total Jobs</span>
                  <span className="font-medium">{d.total_jobs || 0}</span>
                </div>
              </div>
              {d.notes && (
                <div className="pt-4 border-t border-border mt-4">
                  <span className="text-muted-foreground block mb-1 text-sm">Notes</span>
                  <p className="text-sm whitespace-pre-wrap">{d.notes}</p>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* ── Financial Summary ─────────────────────────────────────── */}
      <Card className="border-primary/10 bg-card" data-testid="card-financial-summary">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calculator className="w-5 h-5 text-primary" /> Financial Summary
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <Stat label="Gross Revenue" value={formatGBP(financial?.total_gross_revenue ?? 0)} />
            <Stat label="Commission Generated" value={formatGBP(financial?.total_commission_generated ?? 0)} />
            <Stat
              label="Settled"
              value={formatGBP(financial?.total_commission_settled ?? 0)}
              hint={`${financial?.settlement_count ?? 0} settlements`}
              tone="green"
            />
            <Stat
              label="Pending"
              value={formatGBP(financial?.total_commission_pending ?? 0)}
              tone="amber"
            />
            <Stat
              label="Avg / Job"
              value={formatGBP(financial?.avg_commission_per_job ?? 0)}
              hint={`${financial?.job_count ?? 0} jobs`}
            />
          </div>
        </CardContent>
      </Card>

      {/* ── Performance ───────────────────────────────────────────── */}
      <Card className="border-primary/10 bg-card" data-testid="card-performance">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-primary" /> Performance
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <Stat label="Jobs Completed (All Time)" value={String(performance?.total_jobs_completed ?? 0)} />
            <Stat label="Jobs This Month" value={String(performance?.jobs_this_month ?? 0)} />
            <Stat label="Avg Jobs / Month" value={String(performance?.avg_jobs_per_month ?? 0)} />
            <Stat label="Most Frequent Service" value={performance?.most_frequent_service_type ?? "—"} />
            <Stat label="Most Frequent Client" value={performance?.most_frequent_client ?? "—"} />
            <Stat label="Busiest Day" value={performance?.busiest_day_of_week ?? "—"} />
          </div>
        </CardContent>
      </Card>

      {/* ── Monthly Commission Ledger ─────────────────────────────── */}
      <Card className="border-primary/10 bg-card" data-testid="card-monthly-ledger">
        <CardHeader>
          <CardTitle className="flex justify-between items-center">
            <span className="flex items-center gap-2">
              <Calculator className="w-5 h-5 text-primary" /> Monthly Commission Ledger
            </span>
          </CardTitle>
          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground mt-2">
            <span>All-time generated: <span className="font-semibold text-foreground">{formatGBP(ledgerTotals.generated)}</span></span>
            <span>Settled: <span className="font-semibold text-green-500">{formatGBP(ledgerTotals.settled)}</span></span>
            <span>Pending: <span className="font-semibold text-amber-500">{formatGBP(ledgerTotals.pending)}</span></span>
          </div>
        </CardHeader>
        <CardContent>
          {monthlyLedger.length > 0 ? (
            <div className="space-y-6">
              {monthlyLedger.map((month) => {
                const allSettled = month.pending === 0 && month.total > 0;
                return (
                  <div key={month.key} data-testid={`month-${month.key}`}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span
                          className={`w-2.5 h-2.5 rounded-full ${
                            allSettled ? "bg-green-500" : "bg-amber-500"
                          }`}
                        />
                        <h3 className="font-semibold">{month.label}</h3>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Owed: <span className="text-foreground font-semibold">{formatGBP(month.total)}</span>
                        {" · "}
                        Settled: <span className="text-green-500 font-semibold">{formatGBP(month.settled)}</span>
                        {" · "}
                        Pending: <span className="text-amber-500 font-semibold">{formatGBP(month.pending)}</span>
                      </div>
                    </div>
                    <div className="space-y-2">
                      {month.entries.map((entry: any, idx: number) => {
                        const isExtra = entry.role === "extra";
                        // When the operator set a per-leg date_time on the
                        // extra car, surface it (and flag the offset from
                        // the parent booking's pickup) so the driver knows
                        // their actual roster time, not car #1's time.
                        const legTime = entry.leg_date_time
                          ? new Date(entry.leg_date_time)
                          : null;
                        const parentTime = entry.parent_date_time
                          ? new Date(entry.parent_date_time)
                          : null;
                        const offsetMin =
                          isExtra && legTime && parentTime
                            ? Math.round(
                                (legTime.getTime() - parentTime.getTime()) / 60000
                              )
                            : 0;
                        return (
                        <Link
                          key={idx}
                          href={entry.booking_id ? `/bookings/${entry.booking_id}` : "#"}
                        >
                          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center p-3 rounded-lg border border-border bg-background/50 gap-2 hover:border-primary/40 hover:bg-secondary/10 transition-colors cursor-pointer">
                            <div>
                              <div className="font-medium font-mono text-xs text-primary hover:underline flex items-center gap-2 flex-wrap">
                                {entry.tvl_ref}
                                {isExtra && (
                                  <Badge
                                    variant="outline"
                                    className="text-[9px] py-0 px-1.5 bg-primary/10 text-primary border-primary/30 uppercase tracking-wide"
                                    data-testid={`badge-extra-car-${entry.booking_vehicle_id ?? idx}`}
                                  >
                                    Extra car
                                  </Badge>
                                )}
                                {entry.vehicle_type && (
                                  <span className="text-[10px] text-muted-foreground font-sans normal-case">
                                    {entry.vehicle_type}
                                  </span>
                                )}
                              </div>
                              <div className="text-sm">{entry.client_name || "Booking"}</div>
                              <div className="text-xs text-muted-foreground flex items-center gap-1.5 flex-wrap">
                                {entry.date ? (
                                  <span>
                                    {fmtLondon(entry.date, "dd MMM yyyy")}
                                    {" · "}
                                    <span className="font-medium text-foreground">
                                      {fmtLondon(entry.date, "HH:mm")}
                                    </span>
                                  </span>
                                ) : null}
                                {entry.flight_number && (
                                  <Badge variant="outline" className="text-[9px] py-0 px-1.5 text-sky-400 border-sky-400/30 flex items-center gap-0.5">
                                    <Plane className="w-2.5 h-2.5" />
                                    {entry.direction === "Arrival" ? "▼" : entry.direction === "Departure" ? "▲" : ""} {entry.flight_number}
                                  </Badge>
                                )}
                                {isExtra && offsetMin !== 0 && (
                                  <span
                                    className="text-[10px] text-amber-500"
                                    title={`Parent booking pickup ${entry.parent_date_time ? fmtLondon(entry.parent_date_time, "HH:mm") : ""}`}
                                  >
                                    ({offsetMin > 0 ? `+${offsetMin}` : offsetMin} min vs Car 1)
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="text-right flex flex-row sm:flex-col justify-between sm:justify-start items-center sm:items-end gap-2">
                              <div className="text-sm">
                                <span className="text-muted-foreground">TVL: </span>
                                <span className="font-bold text-primary">£{entry.tvl_commission}</span>
                              </div>
                              <Badge
                                variant="outline"
                                className={
                                  entry.commission_status === "Settled" || entry.payout_status === "Paid"
                                    ? "text-green-500"
                                    : "text-amber-500"
                                }
                              >
                                {entry.payment_method === "Cash" ? entry.commission_status : entry.payout_status}
                              </Badge>
                            </div>
                          </div>
                        </Link>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground text-sm border border-dashed rounded-lg">
              No commission history
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Issues ────────────────────────────────────────────────── */}
      <Card className="border-primary/10 bg-card" data-testid="card-issues">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-primary" /> Issues
          </CardTitle>
        </CardHeader>
        <CardContent>
          {issues && issues.length > 0 ? (
            <div className="space-y-3">
              {issues
                .filter((i) => i.status !== "Resolved")
                .concat(issues.filter((i) => i.status === "Resolved"))
                .map((issue) => (
                  <div
                    key={issue.id}
                    className="p-3 rounded-lg border border-border bg-background/50"
                    data-testid={`issue-${issue.id}`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <Badge
                        variant="outline"
                        className={
                          issue.status === "Open"
                            ? "bg-amber-500/15 text-amber-500 border-amber-500/40"
                            : issue.status === "Ongoing"
                            ? "bg-orange-500/15 text-orange-500 border-orange-500/40"
                            : "bg-green-500/15 text-green-500 border-green-500/40"
                        }
                      >
                        {issue.status}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {format(new Date(issue.logged_at), "PPp")}
                      </span>
                    </div>
                    {issue.tvl_ref && (
                      <div className="text-xs text-primary font-mono mb-1">{issue.tvl_ref}</div>
                    )}
                    <p className="text-sm whitespace-pre-wrap">{issue.description}</p>
                  </div>
                ))}
            </div>
          ) : (
            <div className="text-center py-6 text-muted-foreground text-sm border border-dashed rounded-lg">
              No issues logged for this driver
            </div>
          )}
        </CardContent>
      </Card>

      {id && (
        <ActivityPanel
          entityType="driver"
          entityId={id}
          description="Recent audit entries for this driver."
        />
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "green" | "amber";
}) {
  const toneClass =
    tone === "green" ? "text-green-500" : tone === "amber" ? "text-amber-500" : "text-foreground";
  return (
    <div className="rounded-lg border border-border bg-background/40 p-3">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-xl font-semibold mt-1 ${toneClass}`}>{value}</div>
      {hint && <div className="text-[10px] text-muted-foreground mt-1">{hint}</div>}
    </div>
  );
}
