import { useParams, useLocation, Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetBooking, getGetBookingQueryKey, getGetDashboardSummaryQueryKey,
  useUpdateBookingStatus, useCancelBooking,
  useAddWaitingTime, useGenerateInvoice, useRateDriver,
  useUpdateBooking, useListDrivers, getListDriversQueryKey,
} from "@workspace/api-client-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, MessageSquare, Clock, XCircle, FileText, Star, Plane, MapPin, Car, Users, Package, ClipboardList, Gift, Map, Building2, CalendarRange, RotateCcw, ExternalLink, AlertTriangle, CheckCircle2, History } from "lucide-react";
import { format } from "date-fns";
import { fmtLondon, isoToLondonInput, londonInputToIso } from "@/lib/datetime";
import { nationalityFlag } from "@/lib/nationalities";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useState, useEffect, useCallback } from "react";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/lib/supabase";
import { BookingVehiclesRoster } from "@/components/booking/BookingVehiclesRoster";
import { BookingRouteOverridesHint } from "@/components/booking/BookingRouteOverridesHint";
import { BookingActivityPanel } from "@/components/booking/BookingActivityPanel";
import { Phone, MessageCircle, Mail, Pencil, Plus, Trash2, FileDown } from "lucide-react";
import { getVipBadgeColor } from "@/lib/vip";
import { Label } from "@/components/ui/label";

function whatsappLink(num?: string) {
  if (!num) return null;
  const clean = num.replace(/[^\d+]/g, "");
  return `https://wa.me/${clean.replace(/^\+/, "")}`;
}

function SupplierCostCard({ booking, onSaved }: { booking: any; onSaved: () => void }) {
  const isCarRental = booking.service_type === "Car Rental";
  const isAsDirected = booking.service_type === "As Directed";
  const showCosts = isCarRental || isAsDirected;
  const supplierId  = booking.supplier_id;
  const supplierProvidedDriver = !!booking.as_directed_supplier_driver;
  const [supplier, setSupplier] = useState<any>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [draft, setDraft] = useState<any>({});
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    let active = true;
    if (!supplierId) { setSupplier(null); return; }
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch(`/api/suppliers/${supplierId}`, {
          headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
        });
        if (!res.ok) return;
        const data = await res.json();
        if (active) setSupplier(data);
      } catch {}
    })();
    return () => { active = false; };
  }, [supplierId]);

  const baseDailyRate = Number(booking.base_daily_rate || 0);
  const rentalDays    = Number(booking.rental_days || 0);
  const fuelCost      = Number(booking.fuel_cost || 0);
  const driverCost    = Number(booking.driver_cost || 0);
  const extras        = Array.isArray(booking.extra_charges) ? booking.extra_charges : [];
  const extrasTotal   = extras.reduce((s: number, e: any) => s + (Number(e?.amount) || 0), 0);
  const carCost       = (baseDailyRate * rentalDays) + fuelCost + extrasTotal;
  const subtotal      = carCost + driverCost; // total TVL cost (car + driver), regardless of who pays driver
  const supplierBill  = supplierProvidedDriver ? subtotal : carCost;
  const ourDriverPay  = supplierProvidedDriver ? 0 : driverCost;
  const margin        = Number(booking.price || 0) - subtotal;

  // Parse any prior auto-generated "Overtime: X hr @ £Y/hr" extra so the
  // operator sees the current overtime in the dedicated field instead of as
  // a confusing manual extras row. We strip it from the visible extras list
  // and re-emit it on save (only if overtime_hours > 0 + base_daily_rate > 0).
  const parsePriorOvertime = (xs: any[]): { otHours: number; cleanedExtras: any[] } => {
    let otHours = 0;
    const cleaned: any[] = [];
    for (const e of xs ?? []) {
      const desc = (e?.description ?? "").trim();
      const m = desc.match(/^Overtime:\s*([\d.]+)\s*hr/i);
      if (m) otHours = Number(m[1]);
      else cleaned.push(e);
    }
    return { otHours, cleanedExtras: cleaned };
  };

  const openEdit = () => {
    const { otHours, cleanedExtras } = parsePriorOvertime(extras);
    setDraft({
      base_daily_rate: booking.base_daily_rate ?? "",
      rental_days:     booking.rental_days ?? "",
      fuel_cost:       booking.fuel_cost ?? "",
      driver_cost:     booking.driver_cost ?? "",
      hours:           booking.hours ?? "",
      overtime_hours:  otHours || "",
      extra_charges:   cleanedExtras,
      as_directed_supplier_driver: supplierProvidedDriver,
    });
    setEditOpen(true);
  };

  const saveCosts = async () => {
    setSaving(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      // Re-emit the auto "Overtime: X hr @ £Y/hr" extra from the dedicated
      // overtime_hours field. This keeps the cost-breakdown trigger / supplier
      // cost in sync without the operator having to enter a manual extras row.
      const ot = Number(draft.overtime_hours || 0);
      const dr = Number(draft.base_daily_rate || 0);
      const cleaned: any[] = (draft.extra_charges ?? []).filter(
        (e: any) => !(e?.description || "").trim().match(/^Overtime:/i),
      );
      if (ot > 0 && dr > 0) {
        cleaned.push({
          description: `Overtime: ${ot} hr @ £${(dr * 0.10).toFixed(2)}/hr`,
          amount: Math.round(ot * dr * 0.10),
        });
      }
      const payload: any = {
        base_daily_rate: draft.base_daily_rate === "" ? null : Number(draft.base_daily_rate),
        rental_days:     draft.rental_days === "" ? null : Number(draft.rental_days),
        fuel_cost:       draft.fuel_cost === "" ? null : Number(draft.fuel_cost),
        driver_cost:     draft.driver_cost === "" ? null : Number(draft.driver_cost),
        hours:           draft.hours === "" ? null : Number(draft.hours),
        extra_charges:   cleaned,
        as_directed_supplier_driver: !!draft.as_directed_supplier_driver,
      };
      const res = await fetch(`/api/bookings/${booking.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? "Failed to update costs");
      }
      toast({ title: "Cost breakdown updated" });
      setEditOpen(false);
      onSaved();
    } catch (e: any) {
      toast({ title: e.message ?? "Failed to update costs", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const wa = whatsappLink(supplier?.whatsapp);

  return (
    <Card className="border-primary/20 bg-card">
      <CardHeader className="pb-2 flex-row items-center justify-between">
        <CardTitle className="text-base flex items-center gap-2">
          <Building2 className="w-4 h-4 text-primary" />
          {showCosts ? "Supplier & Cost" : "Supplier"}
        </CardTitle>
        {showCosts && (
          <Button size="sm" variant="ghost" onClick={openEdit} className="h-7 px-2 text-xs">
            <Pencil className="w-3 h-3 mr-1" /> Edit
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {supplier ? (
          <div className="flex items-start justify-between gap-3 p-3 rounded-lg bg-secondary/20 border border-border">
            <div className="min-w-0">
              <Link href={`/suppliers/${supplier.id}`}>
                <div className="font-semibold text-foreground hover:text-primary cursor-pointer truncate">
                  {supplier.name}
                </div>
              </Link>
              {supplier.contact_name && (
                <div className="text-xs text-muted-foreground">{supplier.contact_name}</div>
              )}
              <Badge variant="outline" className="mt-1 text-[10px] py-0 px-1.5 border-primary/30 text-primary bg-primary/5">
                {supplier.category}
              </Badge>
            </div>
            <div className="flex gap-1.5 shrink-0">
              {wa && (
                <a href={wa} target="_blank" rel="noopener noreferrer"
                   className="w-8 h-8 rounded-full bg-green-500/10 hover:bg-green-500/20 text-green-400 flex items-center justify-center" title="WhatsApp">
                  <MessageCircle className="w-4 h-4" />
                </a>
              )}
              {supplier.phone && (
                <a href={`tel:${supplier.phone}`}
                   className="w-8 h-8 rounded-full bg-secondary/40 hover:bg-secondary/60 flex items-center justify-center" title="Call">
                  <Phone className="w-4 h-4" />
                </a>
              )}
              {supplier.email && (
                <a href={`mailto:${supplier.email}`}
                   className="w-8 h-8 rounded-full bg-secondary/40 hover:bg-secondary/60 flex items-center justify-center" title="Email">
                  <Mail className="w-4 h-4" />
                </a>
              )}
            </div>
          </div>
        ) : showCosts ? (
          <p className="text-xs text-muted-foreground italic">No supplier linked. Pick one when editing the booking.</p>
        ) : null}

        {showCosts && (
          <div className="space-y-1.5 text-sm">
            {supplierId && (
              <div className="flex items-center justify-between text-xs px-2 py-1 rounded bg-secondary/30 mb-2">
                <span className="text-muted-foreground">Driver source</span>
                <span className={`font-semibold ${supplierProvidedDriver ? "text-primary" : "text-foreground"}`}>
                  {supplierProvidedDriver ? "Supplier's driver" : "Our driver"}
                </span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-muted-foreground">Base × Days ({baseDailyRate} × {rentalDays})</span>
              <span className="font-medium">£{(baseDailyRate * rentalDays).toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Fuel</span>
              <span className="font-medium">£{fuelCost.toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">
                Driver{supplierProvidedDriver ? " (paid to supplier)" : " (paid to TVL driver)"}
              </span>
              <span className="font-medium">£{driverCost.toLocaleString()}</span>
            </div>
            {extras.length > 0 && (
              <div className="space-y-0.5 pl-3 border-l-2 border-border">
                {extras.map((x: any, i: number) => (
                  <div key={i} className="flex justify-between text-xs">
                    <span className="text-muted-foreground">{x.description || "(extra)"}</span>
                    <span>£{Number(x.amount || 0).toLocaleString()}</span>
                  </div>
                ))}
              </div>
            )}
            {supplierId && (
              <div className="flex justify-between pt-2 border-t border-border text-xs">
                <span className="text-muted-foreground">→ to supplier</span>
                <span className="font-medium">£{supplierBill.toLocaleString()}</span>
              </div>
            )}
            {ourDriverPay > 0 && (
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">→ to TVL driver</span>
                <span className="font-medium">£{ourDriverPay.toLocaleString()}</span>
              </div>
            )}
            <div className="flex justify-between pt-2 border-t border-border">
              <span className="font-semibold">Cost subtotal</span>
              <span className="font-bold">£{subtotal.toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span className="font-semibold">Client price</span>
              <span className="font-bold text-primary">£{Number(booking.price || 0).toLocaleString()}</span>
            </div>
            <div className="flex justify-between pt-1 border-t border-border">
              <span className="font-semibold">Margin</span>
              <span className={`font-bold ${margin >= 0 ? "text-green-400" : "text-destructive"}`}>
                £{margin.toLocaleString()}
              </span>
            </div>
            {/* Feature 4 — Referral Split sub-line. Hidden unless this booking
                actually has a referral_partner_name set. Does NOT change the
                Margin row above; it's purely informational so the operator can
                see what they net after paying the referral. */}
            {booking.referral_partner_name && (() => {
              const ctype = booking.referral_commission_type === "amount" ? "amount" : "percent";
              const cval = Number(booking.referral_commission_value || 0);
              const referralCut = ctype === "percent"
                ? Math.max(0, (margin * cval) / 100)
                : Math.max(0, cval);
              const tvlNetAfter = margin - referralCut;
              return (
                <div className="rounded-md bg-blue-500/5 border border-blue-500/20 p-2 mt-1 text-xs space-y-1">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">
                      Referral — <span className="font-medium text-foreground">{booking.referral_partner_name}</span>
                      {" "}({ctype === "percent" ? `${cval}% of margin` : `£${cval.toLocaleString()}`})
                    </span>
                    <span className="font-medium text-foreground">−£{referralCut.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                  </div>
                  <div className="flex justify-between pt-1 border-t border-blue-500/20">
                    <span className="font-semibold">TVL Net after referral</span>
                    <span className={`font-bold ${tvlNetAfter >= 0 ? "text-green-400" : "text-destructive"}`}>
                      £{tvlNetAfter.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </span>
                  </div>
                </div>
              );
            })()}
          </div>
        )}
      </CardContent>

      {/* Edit dialog (extras editable post-completion) */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Cost Breakdown</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {supplierId && (
              <div className="rounded-md border border-border bg-secondary/20 p-3 space-y-2">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Driver source</Label>
                <div className="grid grid-cols-2 gap-2">
                  <button type="button"
                    onClick={() => setDraft({ ...draft, as_directed_supplier_driver: false })}
                    className={`px-3 py-2 rounded-md text-sm font-medium border transition-colors ${
                      !draft.as_directed_supplier_driver
                        ? "bg-primary/10 border-primary/50 text-primary"
                        : "bg-background border-border text-muted-foreground hover:text-foreground"
                    }`}>Our driver</button>
                  <button type="button"
                    onClick={() => setDraft({ ...draft, as_directed_supplier_driver: true })}
                    className={`px-3 py-2 rounded-md text-sm font-medium border transition-colors ${
                      draft.as_directed_supplier_driver
                        ? "bg-primary/10 border-primary/50 text-primary"
                        : "bg-background border-border text-muted-foreground hover:text-foreground"
                    }`}>Supplier's driver</button>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {draft.as_directed_supplier_driver
                    ? "Driver cost rolls into the supplier KPI."
                    : "Driver cost is paid to your TVL driver."}
                </p>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Base daily rate (£)</Label>
                <Input type="number" step="0.01" value={draft.base_daily_rate ?? ""}
                  onChange={e => setDraft({ ...draft, base_daily_rate: e.target.value })} />
              </div>
              <div>
                <Label>Rental days</Label>
                <Input type="number" step="1" value={draft.rental_days ?? ""}
                  onChange={e => setDraft({ ...draft, rental_days: e.target.value })} />
              </div>
              <div>
                <Label>Fuel cost (£)</Label>
                <Input type="number" step="0.01" value={draft.fuel_cost ?? ""}
                  onChange={e => setDraft({ ...draft, fuel_cost: e.target.value })} />
              </div>
              <div>
                <Label>Driver cost (£)</Label>
                <Input type="number" step="0.01" value={draft.driver_cost ?? ""}
                  onChange={e => setDraft({ ...draft, driver_cost: e.target.value })} />
              </div>
            </div>
            {isAsDirected && (
              <div className="space-y-2 p-3 rounded-md border border-amber-500/20 bg-amber-500/5">
                <Label className="text-xs uppercase tracking-wider text-amber-400">Chauffeuring hours</Label>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs text-muted-foreground">Hours / day <span className="text-[10px]">(max 10)</span></Label>
                    <Input type="number" step="1" min="1" max="10" placeholder="10" value={draft.hours ?? ""}
                      onChange={e => setDraft({ ...draft, hours: e.target.value })} />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Overtime hrs <span className="text-[10px]">(+10% / hr)</span></Label>
                    <Input type="number" step="0.5" min="0" placeholder="0" value={draft.overtime_hours ?? ""}
                      onChange={e => setDraft({ ...draft, overtime_hours: e.target.value })} />
                  </div>
                </div>
                {Number(draft.overtime_hours || 0) > 0 && Number(draft.base_daily_rate || 0) > 0 && (
                  <p className="text-[11px] text-muted-foreground">
                    Auto-adds extra: <span className="font-medium text-foreground">£{(Number(draft.overtime_hours) * Number(draft.base_daily_rate) * 0.10).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                    {" "}— recalculates total cost &amp; TVL margin on save.
                  </p>
                )}
              </div>
            )}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Extra charges</Label>
                <Button type="button" variant="outline" size="sm"
                  onClick={() => setDraft({ ...draft, extra_charges: [...(draft.extra_charges || []), { description: "", amount: 0 }] })}>
                  <Plus className="w-3 h-3 mr-1" /> Add
                </Button>
              </div>
              {(draft.extra_charges ?? []).map((extra: any, idx: number) => (
                <div key={idx} className="flex gap-2 items-start">
                  <Input placeholder="Description" value={extra?.description ?? ""}
                    onChange={e => {
                      const next = [...draft.extra_charges];
                      next[idx] = { ...next[idx], description: e.target.value };
                      setDraft({ ...draft, extra_charges: next });
                    }} className="flex-1" />
                  <Input type="number" step="0.01" placeholder="£" value={extra?.amount ?? ""}
                    onChange={e => {
                      const next = [...draft.extra_charges];
                      next[idx] = { ...next[idx], amount: e.target.value === "" ? 0 : Number(e.target.value) };
                      setDraft({ ...draft, extra_charges: next });
                    }} className="w-28" />
                  <Button type="button" variant="ghost" size="sm" className="text-destructive"
                    onClick={() => {
                      const next = draft.extra_charges.filter((_: any, i: number) => i !== idx);
                      setDraft({ ...draft, extra_charges: next });
                    }}>
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={saveCosts} disabled={saving}>{saving ? "Saving…" : "Save costs"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export default function BookingDetail() {
  const params = useParams();
  const [, setLocation] = useLocation();
  const id = params.id as string;
  const { toast } = useToast();
  const { user } = useAuth();
  const qc = useQueryClient();
  const isResidenceManager = user?.role === "residence_manager";

  // Targeted invalidation for inline payment-field edits — only the booking
  // detail + dashboard summary change, no need to sweep every query on the
  // page. Bigger state changes (status, driver assignment, invoice gen) keep
  // their broader sweep.
  const invalidateBookingDetail = useCallback(() => {
    qc.invalidateQueries({ queryKey: getGetBookingQueryKey(id) });
    qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
  }, [qc, id]);

  const { data: booking, isLoading, refetch } = useGetBooking(id, {
    query: { enabled: !!id, queryKey: getGetBookingQueryKey(id) }
  });

  const [orderLines, setOrderLines] = useState<any[]>([]);

  useEffect(() => {
    if (!id) return;
    supabase
      .from("booking_products")
      .select("*")
      .eq("booking_id", id)
      .order("created_at")
      .then(({ data }) => setOrderLines(data ?? []));
  }, [id]);

  const updateStatus = useUpdateBookingStatus();
  const cancelBooking = useCancelBooking();
  const addWaiting = useAddWaitingTime();
  const generateInvoice = useGenerateInvoice();
  const rateDriver = useRateDriver();
  const updateBooking = useUpdateBooking();
  const { data: drivers } = useListDrivers({}, { query: { queryKey: getListDriversQueryKey({}) } });
  const [assigningDriver, setAssigningDriver] = useState(false);

  // ── Driver-conflict dialog state ────────────────────────────────────────
  // The server returns 409 with `{ driver_conflict }` when assignment would
  // double-book the driver. We surface a modal so the operator can either
  // pick someone else or explicitly override (re-call with ?force=true).
  const [conflictDialog, setConflictDialog] = useState<{
    open: boolean;
    driverId: string | null;
    driverName: string | null;
    conflicts: any[];
    message: string;
  }>({ open: false, driverId: null, driverName: null, conflicts: [], message: "" });

  // Direct-call API helper that handles the 409 conflict response. The
  // generated react-query hook surfaces 409 as a generic error without the
  // body payload, so we use raw fetch here to capture `driver_conflict`.
  const assignDriverRaw = async (driverIdOrNull: string | null, force: boolean): Promise<{ ok: boolean; conflict?: any; error?: string }> => {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    const url = `/api/bookings/${id}${force ? "?force=true" : ""}`;
    const res = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ driver_id: driverIdOrNull, driver_acceptance_status: "Assigned" }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.status === 409 && body?.driver_conflict) return { ok: false, conflict: body.driver_conflict };
    if (!res.ok) return { ok: false, error: body?.error ?? "Failed to assign driver" };
    return { ok: true };
  };

  const assignDriver = async (driverId: string) => {
    if (!booking) return;
    setAssigningDriver(true);
    const value = driverId === "unassigned" ? null : driverId;
    const driverName = value
      ? (drivers as any[] | undefined)?.find((d) => d.id === value)?.name ?? ""
      : "";
    try {
      const result = await assignDriverRaw(value, false);
      if (result.conflict) {
        setConflictDialog({
          open: true,
          driverId: value,
          driverName,
          conflicts: result.conflict.conflicts ?? [],
          message: result.conflict.message ?? "Driver already has overlapping jobs.",
        });
        return;
      }
      if (!result.ok) {
        toast({ title: "Failed to assign driver", description: result.error, variant: "destructive" });
        return;
      }
      // Driver assignment ripples into: dashboard "no driver" alert,
      // /drivers/:id job history, /jobs roster, follow-ups (assignment
      // resets the alert), commissions ledger and audit feed. Sweep
      // everything so each page rederives from truth instead of relying
      // on a per-page refresh.
      qc.invalidateQueries();
      toast({
        title: value ? "Driver assigned" : "Driver unassigned",
        description: value
          ? `${driverName} assigned to this booking.`
          : "Driver removed from this booking.",
      });
    } finally {
      setAssigningDriver(false);
    }
  };

  const proceedConflictOverride = async () => {
    if (!conflictDialog.driverId) return;
    setAssigningDriver(true);
    try {
      const result = await assignDriverRaw(conflictDialog.driverId, true);
      if (!result.ok) {
        toast({ title: "Override failed", description: result.error, variant: "destructive" });
        return;
      }
      // Same fan-out as the regular assign — override path also touches
      // amendments, conflicts, dashboard alerts.
      qc.invalidateQueries();
      toast({
        title: "Driver assigned (override)",
        description: `${conflictDialog.driverName} assigned despite conflict — logged in amendments.`,
      });
      setConflictDialog({ open: false, driverId: null, driverName: null, conflicts: [], message: "" });
    } finally {
      setAssigningDriver(false);
    }
  };

  // ── Driver Acceptance (Assigned / Confirmed / Declined) ─────────────────
  const setDriverAcceptance = async (next: "Assigned" | "Driver Confirmed" | "Driver Declined") => {
    if (!booking) return;
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    const payload: Record<string, any> = { driver_acceptance_status: next };
    if (next === "Driver Confirmed") payload.driver_accepted_at = new Date().toISOString();
    if (next === "Driver Declined") payload.driver_declined_at = new Date().toISOString();
    const res = await fetch(`/api/bookings/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toast({ title: "Failed to update acceptance", description: j?.error, variant: "destructive" });
      return;
    }
    // Driver acceptance toggles the dashboard "awaiting confirmation"
    // counter, the driver's own dashboard, follow-ups (re-flag), and
    // intel funnel — sweep all queries.
    qc.invalidateQueries();
    if (next === "Driver Declined") {
      toast({
        title: "Driver declined",
        description: "Driver removed from booking. Admin alerted.",
        variant: "destructive",
      });
    } else if (next === "Driver Confirmed") {
      toast({ title: "Driver confirmed receipt" });
    } else {
      toast({ title: "Acceptance reset" });
    }
  };

  const [cancelReason, setCancelReason] = useState("");
  const [cancelFee, setCancelFee] = useState(0);
  const [waitingAmount, setWaitingAmount] = useState(0);
  const [rating, setRating] = useState(5);
  const [ratingNote, setRatingNote] = useState("");
  const [isCancelOpen, setIsCancelOpen] = useState(false);
  const [isWaitingOpen, setIsWaitingOpen] = useState(false);
  const [isRateOpen, setIsRateOpen] = useState(false);

  // ── Completion dialog state (Fix 12) ───────────────────────────────────
  const [isCompleteOpen, setIsCompleteOpen] = useState(false);
  const [completeClientSatisfied, setCompleteClientSatisfied] = useState<"yes" | "no" | "">("");
  const [completeDriverOnTime, setCompleteDriverOnTime] = useState<"yes" | "no" | "">("");
  const [completeNotes, setCompleteNotes] = useState("");
  const [completing, setCompleting] = useState(false);

  // ── Issues + Amendments (fetched from new APIs) ────────────────────────
  const [issues, setIssues] = useState<any[]>([]);
  const [amendments, setAmendments] = useState<any[]>([]);
  const [resolveIssueId, setResolveIssueId] = useState<string | null>(null);
  const [resolveNotes, setResolveNotes] = useState("");

  const reloadIssues = async () => {
    if (!id) return;
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    const res = await fetch(`/api/issues?booking_id=${id}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (res.ok) setIssues(await res.json());
  };
  const reloadAmendments = async () => {
    if (!id) return;
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    const res = await fetch(`/api/amendments?booking_id=${id}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (res.ok) setAmendments(await res.json());
  };

  useEffect(() => { reloadIssues(); reloadAmendments(); }, [id]);

  const openCompleteDialog = () => {
    const b: any = booking;
    setCompleteClientSatisfied(b?.client_satisfied === true ? "yes" : b?.client_satisfied === false ? "no" : "");
    setCompleteDriverOnTime(b?.driver_on_time === true ? "yes" : b?.driver_on_time === false ? "no" : "");
    setCompleteNotes(b?.completion_notes ?? "");
    setIsCompleteOpen(true);
  };

  const handleCompleteSubmit = async () => {
    if (!booking) return;
    setCompleting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const payload: Record<string, any> = {
        status: "Completed",
        client_satisfied: completeClientSatisfied === "yes" ? true : completeClientSatisfied === "no" ? false : null,
        driver_on_time: completeDriverOnTime === "yes" ? true : completeDriverOnTime === "no" ? false : null,
        completion_notes: completeNotes.trim() || null,
        completed_at: new Date().toISOString(),
      };
      const res = await fetch(`/api/bookings/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error ?? "Failed to complete booking");
      }
      // If completion notes were provided, also create an Issue so we don't
      // lose the operator's flag in the audit-only completion record.
      if (payload.completion_notes) {
        await fetch("/api/issues", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({
            booking_id: id,
            driver_id: (booking as any).driver_id ?? null,
            client_id: (booking as any).client_id ?? null,
            description: payload.completion_notes,
            status: "Open",
          }),
        }).catch(() => {});
      }
      toast({ title: "Booking completed" });
      setIsCompleteOpen(false);
      // Completion ripples into: dashboard completion counter, finance
      // (revenue moves from forecast → realised), profit, intel funnel,
      // commissions ledger (commission becomes payable), drivers
      // dashboard (job marked done), follow-ups (closes the chase). Sweep
      // every query so each page rederives.
      qc.invalidateQueries();
      reloadIssues();
      reloadAmendments();
      refetch();
    } catch (e: any) {
      toast({ title: "Failed to complete", description: e?.message, variant: "destructive" });
    } finally {
      setCompleting(false);
    }
  };

  const handleResolveIssue = async () => {
    if (!resolveIssueId) return;
    if (!resolveNotes.trim()) {
      toast({ title: "Resolution notes required", variant: "destructive" });
      return;
    }
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    const res = await fetch(`/api/issues/${resolveIssueId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ status: "Resolved", resolution_notes: resolveNotes.trim() }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toast({ title: "Failed", description: j?.error, variant: "destructive" });
      return;
    }
    toast({ title: "Issue resolved" });
    setResolveIssueId(null);
    setResolveNotes("");
    reloadIssues();
  };

  // Edit Booking dialog — works for ALL service types.
  // Clients change flight dates, swap vehicles, extend stays, adjust tour
  // itineraries — every one of those needs to be amendable from the job
  // sheet without recreating the booking. Fields shown are conditional on
  // the booking's service_type (see the dialog body below).
  // State is hydrated lazily from the booking when the dialog opens so we
  // never overwrite the operator's input mid-typing.
  const [isEditOpen, setIsEditOpen] = useState(false);
  // Accommodation fields
  const [editCheckIn, setEditCheckIn] = useState("");
  const [editCheckOut, setEditCheckOut] = useState("");
  const [editNights, setEditNights] = useState<number>(0);
  const [editCommission, setEditCommission] = useState<number>(0);
  const [editHotelName, setEditHotelName] = useState("");
  const [editRoomType, setEditRoomType] = useState("");
  const [editHotelBookingRef, setEditHotelBookingRef] = useState("");
  const [editNumGuests, setEditNumGuests] = useState<number>(0);
  // Transport / tour fields
  const [editDateTime, setEditDateTime] = useState("");
  const [editPickup, setEditPickup] = useState("");
  const [editDropoff, setEditDropoff] = useState("");
  const [editVehicle, setEditVehicle] = useState("");
  const [editFlight, setEditFlight] = useState("");
  const [editDirection, setEditDirection] = useState<"Arrival" | "Departure" | "">("");
  const [editAirportCode, setEditAirportCode] = useState<string>("");
  const [editPax, setEditPax] = useState<number>(0);
  const [editLuggage, setEditLuggage] = useState<number>(0);
  const [editDuration, setEditDuration] = useState<number>(0);
  const [editTourName, setEditTourName] = useState("");
  const [editMeetingPoint, setEditMeetingPoint] = useState("");
  const [editTourProductId, setEditTourProductId] = useState<string>("");
  const [editTourBasePrice, setEditTourBasePrice] = useState<number>(0);
  const [editTourAltLabel, setEditTourAltLabel] = useState<string>("");
  const [editTourAltUplift, setEditTourAltUplift] = useState<number>(0);
  const [tourCatalogue, setTourCatalogue] = useState<Array<{ id: string; name: string; unit_price: number | null; tour_alt_vehicles: Array<{ label: string; uplift: number }> | null }>>([]);
  useEffect(() => {
    if (booking?.service_type !== "Tour") return;
    let active = true;
    (async () => {
      const { data } = await supabase
        .from("products")
        .select("id, name, unit_price, tour_alt_vehicles")
        .eq("category", "Tour")
        .eq("active", true)
        .order("name");
      if (active) setTourCatalogue((data ?? []) as any);
    })();
    return () => { active = false; };
  }, [booking?.service_type]);
  // Common
  const [editPrice, setEditPrice] = useState<number>(0);
  const [editTvlCommission, setEditTvlCommission] = useState<number>(0);

  const openEdit = () => {
    if (!booking) return;
    const b = booking as any;
    // Hotel/Apartment
    setEditCheckIn(b.check_in_date ? String(b.check_in_date).slice(0, 10) : "");
    setEditCheckOut(b.check_out_date ? String(b.check_out_date).slice(0, 10) : "");
    setEditNights(Number(b.nights || b.num_nights || 0));
    setEditCommission(Number(b.commission_amount || 0));
    setEditHotelName(b.hotel_name || "");
    setEditRoomType(b.room_type || "");
    setEditHotelBookingRef(b.hotel_booking_ref || "");
    setEditNumGuests(Number(b.num_guests || 0));
    // Transport — datetime-local needs YYYY-MM-DDTHH:mm
    setEditDateTime(b.date_time ? isoToLondonInput(b.date_time) : "");
    setEditPickup(b.pickup || "");
    setEditDropoff(b.dropoff || b.destination || "");
    setEditVehicle(b.vehicle_type || "");
    setEditFlight(b.flight_number || "");
    setEditDirection((b.direction as any) || "");
    setEditAirportCode(b.airport_code || "");
    setEditPax(Number(b.passengers || 0));
    setEditLuggage(Number(b.luggage || 0));
    setEditDuration(Number(b.duration || 0));
    setEditTourName(b.tour_name || "");
    setEditMeetingPoint(b.meeting_point || "");
    // Re-derive tour selection from notes if present
    const noteStr = String(b.notes || "");
    const altMatch = noteStr.match(/Vehicle:\s*([^|]+?)\s*\(\+£([\d.]+)\)/);
    if (altMatch) {
      setEditTourAltLabel(altMatch[1].trim());
      setEditTourAltUplift(Number(altMatch[2]) || 0);
    } else {
      setEditTourAltLabel("");
      setEditTourAltUplift(0);
    }
    // Best-effort match by tour_name
    const matchedTour = tourCatalogue.find(t => t.name === (b.tour_name || ""));
    setEditTourProductId(matchedTour?.id || "");
    setEditTourBasePrice(matchedTour ? Number(matchedTour.unit_price ?? 0) : Number(b.price || 0) - (altMatch ? Number(altMatch[2]) || 0 : 0));
    // Common
    setEditPrice(Number(b.price || 0));
    setEditTvlCommission(Number(b.tvl_commission || 0));
    setIsEditOpen(true);
  };

  // Recompute nights for accommodation when dates change
  useEffect(() => {
    if (editCheckIn && editCheckOut) {
      const a = new Date(editCheckIn);
      const c = new Date(editCheckOut);
      const diff = Math.max(0, Math.ceil((c.getTime() - a.getTime()) / 86400000));
      setEditNights(diff);
    }
  }, [editCheckIn, editCheckOut]);

  const handleEditSave = () => {
    if (!booking) return;
    const svcType = booking.service_type;
    const isHotel = svcType === "Hotel";
    const isApt = svcType === "Apartment";
    const isAccommodationEdit = isHotel || isApt;

    const payload: Record<string, any> = {
      price: Number.isFinite(editPrice) ? editPrice : undefined,
      is_amended: true,
    };

    if (isAccommodationEdit) {
      // Hotel/Apartment: dates + commission. NO transport fields.
      payload.check_in_date = editCheckIn || undefined;
      payload.check_out_date = editCheckOut || undefined;
      payload.commission_amount = Number.isFinite(editCommission) ? editCommission : undefined;
      if (isHotel) payload.num_nights = editNights || undefined;
      else payload.nights = editNights || undefined;
      // Keep date_time aligned with check-in for sorting
      payload.date_time = editCheckIn ? londonInputToIso(`${editCheckIn}T12:00`) : undefined;
      // Hotel-specific details
      if (isHotel) {
        payload.hotel_name = editHotelName || undefined;
        payload.room_type = editRoomType || undefined;
        payload.hotel_booking_ref = editHotelBookingRef || undefined;
        payload.num_guests = editNumGuests || undefined;
      }
    } else {
      // Transport / Tour / As Directed.
      payload.date_time = editDateTime ? londonInputToIso(editDateTime) : undefined;
      payload.pickup = editPickup || undefined;
      payload.dropoff = editDropoff || undefined;
      payload.vehicle_type = editVehicle || undefined;
      payload.passengers = Number.isFinite(editPax) ? editPax : undefined;
      payload.luggage = Number.isFinite(editLuggage) ? editLuggage : undefined;
      payload.tvl_commission = Number.isFinite(editTvlCommission) ? editTvlCommission : undefined;
      if (svcType === "Airport Transfer") {
        payload.flight_number = editFlight ? editFlight.toUpperCase() : undefined;
        payload.direction = editDirection || undefined;
        // Persist airport_code on amendments — without this the pricing
        // table lookup uses the stale airport and never re-prices.
        payload.airport_code = editAirportCode || undefined;
      }
      if (svcType === "Tour") {
        payload.tour_name = editTourName || undefined;
        payload.meeting_point = editMeetingPoint || undefined;
        payload.duration = editDuration || undefined;
        // Re-stamp the alt vehicle line in notes so the marker survives edits
        const noteStr = String((booking as any).notes || "");
        const stripped = noteStr
          .split("|")
          .map(s => s.trim())
          .filter(s => !/^Vehicle:\s*/i.test(s))
          .join(" | ");
        const vehicleLine = editTourAltLabel
          ? `Vehicle: ${editTourAltLabel} (+£${Number(editTourAltUplift)})`
          : (editTourProductId ? `Vehicle: V Class (standard)` : "");
        payload.notes = vehicleLine
          ? (stripped ? `${stripped} | ${vehicleLine}` : vehicleLine)
          : (stripped || undefined);
        // Recompute price from base + uplift if a catalogue tour is picked
        if (editTourProductId) {
          payload.price = Number(editTourBasePrice) + Number(editTourAltUplift || 0);
        }
      }
      if (svcType === "As Directed") {
        payload.duration = editDuration || undefined;
      }
    }

    updateBooking.mutate({ id, data: payload as any }, {
      onSuccess: () => {
        toast({ title: "Booking updated" });
        setIsEditOpen(false);
        refetch();
      },
      onError: (e: any) =>
        toast({ title: "Update failed", description: e?.message, variant: "destructive" }),
    });
  };

  if (isLoading) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-[300px] w-full" />
      </div>
    );
  }

  if (!booking) return <div className="p-6 text-muted-foreground">Booking not found</div>;

  const getStatusColor = (s: string) => {
    switch (s) {
      case 'Pending':   return 'bg-amber-500/20 text-amber-400 border-amber-500/50';
      case 'Confirmed': return 'bg-blue-500/20 text-blue-400 border-blue-500/50';
      case 'Active':    return 'bg-green-500/20 text-green-400 border-green-500/50';
      case 'Completed': return 'bg-gray-500/20 text-gray-400 border-gray-500/50';
      case 'Cancelled': return 'bg-destructive/20 text-destructive border-destructive/50';
      default:          return 'bg-secondary text-secondary-foreground border-border';
    }
  };

  // VIP badge styling delegated to shared helper so Platinum etc. stays in sync.

  const handleUpdateStatus = (status: string) => {
    const wasArrival =
      (booking as any)?.service_type === "Airport Transfer" &&
      (booking as any)?.direction === "Arrival" &&
      (booking as any)?.status !== "Completed";

    updateStatus.mutate({ id, data: { status } }, {
      onSuccess: () => {
        toast({ title: `Booking marked as ${status}` });
        refetch();
        // Status changes are the single biggest cascade in the system:
        //   Pending → Confirmed   = invoice auto-generated, dashboard "Confirmed"
        //                           counter ticks, finance forecast updates,
        //                           driver dashboard pings.
        //   Confirmed → Active    = job sheet flips to live, intel funnel,
        //                           drivers active count, follow-ups close.
        //   Active → Completed    = revenue moves forecast → realised in
        //                           finance + profit, commissions become
        //                           payable, dashboard completion counter,
        //                           intel conversion %.
        // Sweep every cached query so every page rederives instead of
        // showing stale numbers.
        qc.invalidateQueries();
        // Auto-generate invoice when booking is confirmed or completed
        if ((status === "Confirmed" || status === "Completed") && !booking?.invoice) {
          generateInvoice.mutate({ data: { booking_id: id } }, {
            onSuccess: (inv) => {
              toast({ title: `Invoice ${(inv as any).invoice_number} auto-generated` });
              // Invoice creation is its own cascade — finance receivables,
              // dashboard cash-in counter, client outstanding balance etc.
              qc.invalidateQueries();
            },
          });
        }
        // Auto return-journey prompt: arrival just completed and no return
        // booking exists yet → surface a one-tap shortcut to spin one up.
        if (
          status === "Completed" &&
          wasArrival &&
          !(booking as any)?.return_booking_id
        ) {
          toast({
            title: "Arrival completed — book the return?",
            description: `${(booking as any)?.client_name ?? "Client"} may need a Departure transfer back.`,
            action: (
              <ToastAction
                altText="Create return trip"
                onClick={() => setLocation(`/bookings/new?return_of=${id}`)}
              >
                Create return
              </ToastAction>
            ) as any,
          });
        }
      }
    });
  };

  const handleCancel = () => {
    cancelBooking.mutate({ id, data: { reason: cancelReason, cancellation_fee: cancelFee } }, {
      onSuccess: () => {
        toast({ title: "Booking cancelled" });
        setIsCancelOpen(false);
        refetch();
        // Cancelling a booking removes it from headline KPIs across Intel,
        // Finance, Profit, Drivers, Follow-ups and the Dashboard. Sweep
        // every cached query so every page re-derives from the new truth
        // instead of showing stale revenue/booking counts.
        qc.invalidateQueries();
      }
    });
  };

  const handleAddWaiting = () => {
    addWaiting.mutate({ id, data: { amount: waitingAmount } }, {
      onSuccess: () => {
        toast({ title: "Waiting time added" });
        setIsWaitingOpen(false);
        refetch();
        // Waiting charges add to the booking total → invoice line, finance
        // receivables, dashboard revenue counter, profit. Sweep all queries.
        qc.invalidateQueries();
      }
    });
  };

  const handleRate = () => {
    if (!booking.driver_id) return;
    rateDriver.mutate({ id: booking.driver_id, data: { booking_id: id, rating, note: ratingNote } }, {
      onSuccess: () => { toast({ title: "Driver rated" }); setIsRateOpen(false); }
    });
  };

  const handleInvoice = () => {
    generateInvoice.mutate({ data: { booking_id: id } }, {
      onSuccess: () => { toast({ title: "Invoice generated" }); refetch(); }
    });
  };

  const handleAddReturnJourney = () => {
    if (!booking) return;
    const b: any = booking;
    const params = new URLSearchParams();
    if (b.client_id) params.set("client_id", b.client_id);
    if (booking.service_type) params.set("service_type", booking.service_type);
    // Reverse route — fall back to `destination` if `dropoff` not present.
    const origPickup  = b.pickup;
    const origDropoff = b.dropoff || b.destination;
    if (origDropoff) params.set("pickup",  origDropoff);
    if (origPickup)  params.set("dropoff", origPickup);
    // Invert direction for Airport Transfers (Arrival ↔ Departure)
    if (booking.service_type === "Airport Transfer" && b.direction) {
      const inverted = b.direction === "Arrival" ? "Departure" : "Arrival";
      params.set("direction", inverted);
    }
    params.set("return_from", booking.tvl_ref || "previous booking");
    setLocation(`/bookings/new?${params.toString()}`);
  };

  const flightStatusColor = (status?: string) => {
    switch (status?.toLowerCase()) {
      case 'landed': return 'text-blue-400';
      case 'delayed': return 'text-amber-400';
      case 'cancelled': return 'text-destructive';
      case 'on time': return 'text-green-400';
      default: return 'text-muted-foreground';
    }
  };

  // Header date strings.
  // For Hotel/Apartment we prefer the check-in date — Date & Time isn't
  // captured for accommodation bookings (only check-in / check-out).
  const headerDateSrc =
    (booking.service_type === "Hotel" || booking.service_type === "Apartment")
      ? ((booking as any).check_in_date || booking.date_time)
      : booking.date_time;
  const dateStr = headerDateSrc ? fmtLondon(headerDateSrc, "EEEE d MMMM yyyy") : "TBC";
  const timeStr =
    (booking.service_type === "Hotel" || booking.service_type === "Apartment")
      ? ((booking as any).check_out_date
          ? `→ ${fmtLondon((booking as any).check_out_date, "d MMM yyyy")}`
          : "")
      : (booking.date_time ? fmtLondon(booking.date_time, "HH:mm") : "TBC");
  const extras = (booking as any).extras;

  // Service-type-specific message templates.
  // CRITICAL: each booking is for ONE service type only. Hotel/Apartment
  // bookings have NO driver, NO vehicle, NO name board. If the client also
  // wants an airport transfer it is created as a SEPARATE Airport Transfer
  // booking — never mix transport fields into accommodation messages.
  const svc = booking.service_type;
  const isTransport = svc === "Airport Transfer" || svc === "Tour" || svc === "As Directed";
  const isAccommodation = svc === "Hotel" || svc === "Apartment";
  // Use Europe/London for client/driver message dates so admins in any
  // timezone (e.g. Egypt) always send UK-local times to recipients.
  const fmtDT = (s: string | null | undefined) =>
    s ? fmtLondon(s, "EEE d MMM yyyy 'at' HH:mm") : "";

  const buildClientMessage = () => {
    const lines: string[] = [
      `*TRAVELUXE LONDON*`,
      `_Booking Confirmation_`,
      ``,
      `Dear ${booking.client_name},`,
      ``,
      `Your booking is confirmed. The full details are below for your records.`,
      ``,
      `Ref: *${booking.tvl_ref}*`,
      `Service: ${svc}`,
    ];

    if (svc === "Airport Transfer") {
      lines.push(`Date: ${dateStr}`, `Time: ${timeStr}`);
      if ((booking as any).direction) lines.push(`Direction: ${(booking as any).direction}`);
      if (booking.flight_number) lines.push(`Flight: ${booking.flight_number}`);
      if (booking.pickup) lines.push(`Pickup: ${booking.pickup}`);
      if (booking.dropoff || (booking as any).destination) lines.push(`Drop-off: ${booking.dropoff || (booking as any).destination}`);
      if (booking.passengers) lines.push(`Passengers: ${booking.passengers}`);
      if (booking.luggage) lines.push(`Luggage: ${booking.luggage}`);
      if (booking.vehicle_type) lines.push(`Vehicle: ${booking.vehicle_type}`);
      if (booking.nameboard) lines.push(``, `Your driver will be waiting with a name board: *"${booking.nameboard}"*`);
      if (booking.driver_name) {
        lines.push(`Your driver: *${booking.driver_name}*${(booking as any).driver_staff_no ? ` (Staff ${(booking as any).driver_staff_no})` : ''}`);
      } else {
        lines.push(`Driver: _will be confirmed shortly_`);
      }
    } else if (svc === "Tour") {
      lines.push(`Date: ${dateStr}`, `Time: ${timeStr}`);
      if ((booking as any).tour_name) lines.push(`Tour: ${(booking as any).tour_name}`);
      if ((booking as any).meeting_point) lines.push(`Meeting point: ${(booking as any).meeting_point}`);
      if (booking.pickup) lines.push(`Pickup: ${booking.pickup}`);
      if ((booking as any).destination) lines.push(`Destination: ${(booking as any).destination}`);
      if ((booking as any).itinerary) lines.push(``, `Itinerary:`, `${(booking as any).itinerary}`);
      if (booking.passengers) lines.push(`Passengers: ${booking.passengers}`);
      if (booking.vehicle_type) lines.push(`Vehicle: ${booking.vehicle_type}`);
      if (booking.driver_name) {
        lines.push(`Your driver: *${booking.driver_name}*${(booking as any).driver_staff_no ? ` (Staff ${(booking as any).driver_staff_no})` : ""}`);
      } else {
        lines.push(`Driver: _will be confirmed shortly_`);
      }
    } else if (svc === "As Directed") {
      lines.push(`Date: ${dateStr}`, `Start time: ${timeStr}`);
      if (booking.pickup) lines.push(`Pickup: ${booking.pickup}`);
      if ((booking as any).duration) lines.push(`Duration: ${(booking as any).duration}`);
      if (booking.passengers) lines.push(`Passengers: ${booking.passengers}`);
      if (booking.vehicle_type) lines.push(`Vehicle: ${booking.vehicle_type}`);
      if (booking.driver_name) {
        lines.push(`Your chauffeur: *${booking.driver_name}*${(booking as any).driver_staff_no ? ` (Staff ${(booking as any).driver_staff_no})` : ""}`);
      } else {
        lines.push(`Chauffeur: _will be confirmed shortly_`);
      }
    } else if (svc === "Hotel") {
      // NO driver, NO vehicle, NO name board for hotel bookings.
      if ((booking as any).hotel_name) lines.push(`Hotel: ${(booking as any).hotel_name}`);
      // Hotel booking reference is critical — show it prominently right after the hotel name.
      if ((booking as any).hotel_booking_ref) lines.push(`*Hotel Booking Reference: ${(booking as any).hotel_booking_ref}*`);
      if ((booking as any).room_type) lines.push(`Room: ${(booking as any).room_type}`);
      if ((booking as any).check_in_date) lines.push(`Check-in: ${fmtDT((booking as any).check_in_date)}`);
      if ((booking as any).check_out_date) lines.push(`Check-out: ${fmtDT((booking as any).check_out_date)}`);
      if ((booking as any).num_nights) lines.push(`Nights: ${(booking as any).num_nights}`);
      if ((booking as any).num_guests) lines.push(`Guests: ${(booking as any).num_guests}`);
      if ((booking as any).breakfast_included) lines.push(`Breakfast: Included`);
      lines.push(``, `Please present this booking reference at the hotel front desk on arrival.`);
    } else if (svc === "Apartment") {
      // NO driver, NO vehicle, NO name board for apartment bookings.
      if ((booking as any).property_name) lines.push(`Property: ${(booking as any).property_name}`);
      if ((booking as any).property_address) lines.push(`Address: ${(booking as any).property_address}`);
      if ((booking as any).check_in_date) lines.push(`Check-in: ${fmtDT((booking as any).check_in_date)}`);
      if ((booking as any).check_out_date) lines.push(`Check-out: ${fmtDT((booking as any).check_out_date)}`);
      if ((booking as any).nights) lines.push(`Nights: ${(booking as any).nights}`);
      if ((booking as any).property_contact) lines.push(`Contact: ${(booking as any).property_contact}`);
    } else {
      // Fallback for unknown types — keep it minimal and safe.
      lines.push(`Date: ${dateStr}`, `Time: ${timeStr}`);
    }

    if (extras) lines.push(``, `Extras: ${extras}`);

    // Payment status — included for client peace of mind.
    const ps = (booking as any).payment_status;
    if (ps) lines.push(``, `Payment: *${ps}*`);

    lines.push(
      ``,
      `It is our privilege to look after you. Should you require anything at all, our team is on hand around the clock.`,
      ``,
      `With our warmest regards,`,
      `*Traveluxe London* — Mayfair`,
    );
    return lines.join('\n');
  };

  const buildDriverMessage = () => {
    // Driver messages only make sense for transport service types.
    // For Hotel/Apartment we still produce a brief notice in case a driver
    // was somehow assigned, but no transport fields will be invented.
    const driverStaffNo = (booking as any).driver_staff_no;
    const driverGreeting = booking.driver_name
      ? `Hi ${booking.driver_name}${driverStaffNo ? ` (${driverStaffNo})` : ''},`
      : `Hi Driver,`;
    const lines: string[] = [
      driverGreeting,
      ``,
      `Please confirm receipt of your upcoming job:`,
      ``,
      `Ref: *${booking.tvl_ref}*`,
      `Service: ${svc}`,
    ];
    if (driverStaffNo) lines.push(`Assigned to: *${driverStaffNo}*`);

    // Client identity — name only. Per Traveluxe policy the driver brief
    // must NOT include the client phone number: the operator handles all
    // direct comms with the client over WhatsApp. The driver only needs the
    // client's name (for the name board / meet & greet) and the job details.
    if (booking.client_name) lines.push(`Client: ${booking.client_name}`);

    if (svc === "Airport Transfer") {
      lines.push(`Date: ${dateStr}`, `Time: ${timeStr}`);
      if ((booking as any).direction) lines.push(`Direction: ${(booking as any).direction}`);
      if (booking.flight_number) lines.push(`Flight: ${booking.flight_number}`);
      if (booking.pickup) lines.push(`Pickup: ${booking.pickup}`);
      if (booking.dropoff || (booking as any).destination) lines.push(`Drop-off: ${booking.dropoff || (booking as any).destination}`);
      if (booking.passengers) lines.push(`Passengers: ${booking.passengers}`);
      if (booking.luggage) lines.push(`Luggage: ${booking.luggage}`);
      if (booking.vehicle_type) lines.push(`Vehicle: ${booking.vehicle_type}`);
      if (booking.nameboard) lines.push(`Name Board: *"${booking.nameboard}"*`);
    } else if (svc === "Tour") {
      lines.push(`Date: ${dateStr}`, `Time: ${timeStr}`);
      if ((booking as any).tour_name) lines.push(`Tour: ${(booking as any).tour_name}`);
      if ((booking as any).meeting_point) lines.push(`Meeting point: ${(booking as any).meeting_point}`);
      if (booking.pickup) lines.push(`Pickup: ${booking.pickup}`);
      if ((booking as any).destination) lines.push(`Destination: ${(booking as any).destination}`);
      if ((booking as any).itinerary) lines.push(`Itinerary:\n${(booking as any).itinerary}`);
      if (booking.passengers) lines.push(`Passengers: ${booking.passengers}`);
      if (booking.vehicle_type) lines.push(`Vehicle: ${booking.vehicle_type}`);
    } else if (svc === "As Directed") {
      lines.push(`Date: ${dateStr}`, `Start time: ${timeStr}`);
      if (booking.pickup) lines.push(`Pickup: ${booking.pickup}`);
      if ((booking as any).duration) lines.push(`Duration: ${(booking as any).duration}`);
      if (booking.passengers) lines.push(`Passengers: ${booking.passengers}`);
      if (booking.vehicle_type) lines.push(`Vehicle: ${booking.vehicle_type}`);
    } else {
      lines.push(`Date: ${dateStr}`);
    }

    if (extras) lines.push(`Extras: ${extras}`);
    if ((booking as any).special_requests) lines.push(`Notes: ${(booking as any).special_requests}`);
    lines.push(``, `Please confirm. Thank you.`, `Traveluxe London`);
    // Privacy: NEVER include client whatsapp
    return lines.join('\n');
  };
  // suppress unused-var warning for helper flags
  void isTransport; void isAccommodation;

  const clientWa = (booking as any).client_whatsapp?.replace(/\D/g, '') || '';
  const driverWa = (booking as any).driver_whatsapp?.replace(/\D/g, '') || '';

  const clientMsgUrl = `https://wa.me/${clientWa}?text=${encodeURIComponent(buildClientMessage())}`;
  const driverMsgUrl = driverWa
    ? `https://wa.me/${driverWa}?text=${encodeURIComponent(buildDriverMessage())}`
    : null;

  return (
    <div className="space-y-5 max-w-3xl mx-auto pb-10">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => {
            if (window.history.length > 1) window.history.back();
            else setLocation("/jobs");
          }}
          className="-ml-2"
        >
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-bold tracking-tight font-mono">{booking.tvl_ref}</h1>
            <Badge variant="outline" className={getStatusColor(booking.status)}>{booking.status}</Badge>
            {booking.is_amended && (
              <Badge variant="outline" className="bg-amber-500/20 text-amber-400 border-amber-500/50">Amended</Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">{booking.service_type} · {dateStr} · {timeStr}</p>
        </div>
        {/* Feature 6 — Driver Job Sheet shortcut. Lives in the page header so
            the operator can grab it on any device without scrolling. The
            sheet itself has a WhatsApp share button. */}
        <Link href={`/bookings/${id}/job-sheet`}>
          <Button variant="outline" size="sm" className="gap-1.5 shrink-0" data-testid="btn-view-job-sheet">
            <ClipboardList className="w-4 h-4" />
            <span className="hidden sm:inline">Job Sheet</span>
          </Button>
        </Link>
      </div>

      {/* WHATSAPP BUTTONS — Large and prominent.
          Hidden until the booking is officially Confirmed.
          Quote = awaiting confirmation (request, not booking) — no client/driver
          message should ever be sent in that state. Cancelled also blocks. */}
      {(() => {
        const blockedStatuses = ['Quote', 'Pending', 'Cancelled'];
        const isAwaitingConfirmation = blockedStatuses.includes(booking.status);
        if (isAwaitingConfirmation) {
          return (
            <div className="rounded-2xl border border-amber-700/40 bg-amber-900/10 p-4 flex items-start gap-3">
              <Clock className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-semibold text-amber-400 text-sm">
                  {booking.status === 'Cancelled' ? 'Booking cancelled' : 'Awaiting client confirmation'}
                </p>
                <p className="text-xs text-amber-600/80 mt-0.5">
                  {booking.status === 'Cancelled'
                    ? 'No messages can be sent for a cancelled booking.'
                    : 'Confirm the booking once the client has agreed — WhatsApp messages will unlock.'}
                </p>
                {(booking.status === 'Pending' || booking.status === 'Quote') && (
                  <Button
                    size="sm"
                    onClick={() => handleUpdateStatus('Confirmed')}
                    className="mt-3 bg-amber-500 hover:bg-amber-600 text-black font-semibold"
                  >
                    Confirm Booking
                  </Button>
                )}
              </div>
            </div>
          );
        }
        return null;
      })()}

      {/* Download branded confirmation PDF — always available, even before
          confirmation, since it doubles as a quote/proforma the operator can
          send to the client. */}
      <Button
        variant="outline"
        className="w-full border-amber-500/40 text-amber-400 hover:bg-amber-500/10"
        onClick={async () => {
          try {
            const { data: { session } } = await supabase.auth.getSession();
            const token = session?.access_token;
            const res = await fetch(`/api/bookings/${booking.id}/confirmation.pdf`, {
              headers: token ? { Authorization: `Bearer ${token}` } : {},
            });
            if (!res.ok) throw new Error(await res.text());
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `traveluxe-${booking.tvl_ref ?? booking.id}.pdf`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          } catch (e: any) {
            toast({ title: "PDF failed", description: e?.message ?? "Could not generate PDF", variant: "destructive" });
          }
        }}
      >
        <FileDown className="w-4 h-4 mr-2" />
        Download Booking Confirmation (PDF)
      </Button>

      <div className={`grid grid-cols-1 gap-3 ${['Quote','Pending','Cancelled'].includes(booking.status) ? 'hidden' : ''}`}>
        {clientWa ? (
          <a href={clientMsgUrl} target="_blank" rel="noopener noreferrer">
            <div className="flex items-center gap-4 p-4 rounded-2xl bg-green-900/20 border border-green-700/40 hover:bg-green-900/30 hover:border-green-600/60 transition-all cursor-pointer">
              <div className="w-12 h-12 rounded-xl bg-green-500/20 flex items-center justify-center flex-shrink-0">
                <MessageSquare className="w-6 h-6 text-green-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-green-400 text-base">Message Client</p>
                <p className="text-xs text-green-600 truncate">{booking.client_name} — booking confirmation pre-filled</p>
              </div>
            </div>
          </a>
        ) : (
          <div className="flex items-center gap-4 p-4 rounded-2xl bg-muted/20 border border-border opacity-50">
            <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center flex-shrink-0">
              <MessageSquare className="w-6 h-6 text-muted-foreground" />
            </div>
            <div>
              <p className="font-semibold text-muted-foreground">Message Client</p>
              <p className="text-xs text-muted-foreground">No WhatsApp number on file</p>
            </div>
          </div>
        )}

        {driverMsgUrl ? (
          <a href={driverMsgUrl} target="_blank" rel="noopener noreferrer">
            <div className="flex items-center gap-4 p-4 rounded-2xl bg-blue-900/20 border border-blue-700/40 hover:bg-blue-900/30 hover:border-blue-600/60 transition-all cursor-pointer">
              <div className="w-12 h-12 rounded-xl bg-blue-500/20 flex items-center justify-center flex-shrink-0">
                <Car className="w-6 h-6 text-blue-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-blue-400 text-base">Message Driver</p>
                <p className="text-xs text-blue-600 truncate">{booking.driver_name} — job sheet pre-filled (no client number)</p>
              </div>
            </div>
          </a>
        ) : (
          <div className="flex items-center gap-4 p-4 rounded-2xl bg-muted/20 border border-border opacity-50">
            <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center flex-shrink-0">
              <Car className="w-6 h-6 text-muted-foreground" />
            </div>
            <div>
              <p className="font-semibold text-muted-foreground">Message Driver</p>
              <p className="text-xs text-muted-foreground">{booking.driver_name ? "No driver WhatsApp on file" : "No driver assigned yet"}</p>
            </div>
          </div>
        )}
      </div>

      {/* Status actions */}
      {booking.status !== 'Completed' && booking.status !== 'Cancelled' && (
        <div className="flex flex-col gap-2">
          {booking.status === 'Confirmed' && (
            <p className="text-xs text-muted-foreground italic">
              💡 The system auto-activates this booking at its scheduled start time. Use <em>Mark Active</em> only to override.
            </p>
          )}
        <div className="flex gap-2 flex-wrap">
          {(booking.status === 'Pending' || booking.status === 'Quote') && (
            <Button variant="outline" size="sm" onClick={() => handleUpdateStatus('Confirmed')} className="text-blue-400 hover:bg-blue-500/10 border-blue-500/30">
              Mark Confirmed
            </Button>
          )}
          {booking.status === 'Confirmed' && (
            <Button variant="outline" size="sm" onClick={() => handleUpdateStatus('Active')} className="text-green-400 hover:bg-green-500/10 border-green-500/30">
              Mark Active
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={openCompleteDialog} className="text-gray-400 hover:bg-gray-500/10" data-testid="button-mark-completed">
            <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" /> Mark Completed
          </Button>
          {/* Rebook — clone this booking into a new draft with a fresh TVL
              ref. The operator only needs to set the new date/time. */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setLocation(`/bookings/new?clone_of=${id}`)}
            className="text-emerald-400 hover:bg-emerald-500/10 border-emerald-500/30"
            data-testid="button-rebook"
          >
            <CalendarRange className="w-3.5 h-3.5 mr-1.5" /> Rebook
          </Button>
          {/* Edit available for every service type — clients change flight
              dates, swap vehicles, extend stays, and tweak tour itineraries. */}
          <Button variant="outline" size="sm" onClick={openEdit} className="text-primary hover:bg-primary/10 border-primary/30">
            <CalendarRange className="w-3.5 h-3.5 mr-1.5" />
            {svc === "Apartment" ? "Extend / Edit" : "Edit Booking"}
          </Button>
          <Dialog open={isWaitingOpen} onOpenChange={setIsWaitingOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" className="text-amber-400 hover:bg-amber-500/10 border-amber-500/30">
                <Clock className="w-3.5 h-3.5 mr-1.5" /> Add Waiting
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Add Waiting Time Charge</DialogTitle></DialogHeader>
              <div className="py-4">
                <Input type="number" placeholder="Amount in GBP" value={waitingAmount || ''} onChange={e => setWaitingAmount(Number(e.target.value))} />
              </div>
              <DialogFooter><Button onClick={handleAddWaiting}>Save Charge</Button></DialogFooter>
            </DialogContent>
          </Dialog>
          <Dialog open={isCancelOpen} onOpenChange={setIsCancelOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" className="text-destructive hover:bg-destructive/10 border-destructive/30">
                <XCircle className="w-3.5 h-3.5 mr-1.5" /> Cancel
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Cancel Booking</DialogTitle></DialogHeader>
              <div className="space-y-4 py-4">
                <Textarea placeholder="Reason for cancellation" value={cancelReason} onChange={e => setCancelReason(e.target.value)} />
                <Input type="number" placeholder="Cancellation fee (if applicable)" value={cancelFee || ''} onChange={e => setCancelFee(Number(e.target.value))} />
              </div>
              <DialogFooter><Button variant="destructive" onClick={handleCancel}>Confirm Cancellation</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
        </div>
      )}

      {/* Edit Booking dialog — works for every service type.
          Mounted outside the conditional status-actions block so it can be
          opened from either Confirmed or Active states without being torn
          down between renders. The fields shown are conditional on the
          booking's service_type so each amendment matches its service. */}
      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {svc === "Apartment" ? "Extend / Edit Booking" : `Edit ${svc} Booking`}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {/* VIP banner — Platinum / VVIP only (Feature 1) */}
            {(booking.client_vip_tier === "Platinum" || booking.client_vip_tier === "VVIP") && (
              <div
                className="rounded-md p-3 bg-gradient-to-r from-amber-500/30 to-yellow-300/30 border border-amber-400/70 text-amber-100"
                data-testid="vip-banner-edit"
              >
                <p className="text-xs font-semibold tracking-wide">
                  ⭐ VIP CLIENT — Verify premium vehicle, name-board spelling
                  and special preferences before saving any changes.
                </p>
              </div>
            )}
            {/* Hotel + Apartment: dates + hotel-specific details */}
            {(svc === "Hotel" || svc === "Apartment") && (
              <>
                {svc === "Hotel" && (
                  <>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Hotel Name</p>
                      <Input value={editHotelName} onChange={e => setEditHotelName(e.target.value)} placeholder="e.g. The Lanesborough" />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Hotel Booking Reference</p>
                      <Input value={editHotelBookingRef} onChange={e => setEditHotelBookingRef(e.target.value)} placeholder="External booking ref" />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">Room Type</p>
                        <Input value={editRoomType} onChange={e => setEditRoomType(e.target.value)} placeholder="e.g. Deluxe Suite" />
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">Number of Guests</p>
                        <Input type="number" min={1} value={editNumGuests || ""} onChange={e => setEditNumGuests(Number(e.target.value))} />
                      </div>
                    </div>
                  </>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Check-in</p>
                    <Input type="date" value={editCheckIn} onChange={e => setEditCheckIn(e.target.value)} />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Check-out</p>
                    <Input type="date" value={editCheckOut} onChange={e => setEditCheckOut(e.target.value)} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Nights (auto)</p>
                    <Input type="number" value={editNights || ""} onChange={e => setEditNights(Number(e.target.value))} />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Total Charged (£)</p>
                    <Input type="number" value={editPrice || ""} onChange={e => setEditPrice(Number(e.target.value))} />
                  </div>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Commission Earned (£)</p>
                  <Input type="number" value={editCommission || ""} onChange={e => setEditCommission(Number(e.target.value))} />
                </div>
              </>
            )}

            {/* Transport, Tour, As Directed: full operational fields */}
            {(svc === "Airport Transfer" || svc === "Tour" || svc === "As Directed") && (
              <>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Date &amp; Time</p>
                  <Input type="datetime-local" value={editDateTime} onChange={e => setEditDateTime(e.target.value)} />
                </div>

                {svc === "Airport Transfer" && (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">Direction</p>
                        <select
                          value={editDirection}
                          onChange={e => setEditDirection(e.target.value as any)}
                          className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                        >
                          <option value="">—</option>
                          <option value="Arrival">Arrival</option>
                          <option value="Departure">Departure</option>
                        </select>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">Flight No.</p>
                        <Input value={editFlight} onChange={e => setEditFlight(e.target.value.toUpperCase())} placeholder="BA123" />
                      </div>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">
                        Airport <span className="text-muted-foreground/70">(re-prices vehicle if changed)</span>
                      </p>
                      <select
                        value={editAirportCode}
                        onChange={e => setEditAirportCode(e.target.value)}
                        className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                      >
                        <option value="">—</option>
                        <option value="LHR">Heathrow (LHR)</option>
                        <option value="LGW">Gatwick (LGW)</option>
                        <option value="STN">Stansted (STN)</option>
                        <option value="LTN">Luton (LTN)</option>
                        <option value="LCY">London City (LCY)</option>
                        <option value="OTHER">Other</option>
                      </select>
                    </div>
                  </>
                )}

                <div>
                  <p className="text-xs text-muted-foreground mb-1">Pickup</p>
                  <Input value={editPickup} onChange={e => setEditPickup(e.target.value)} placeholder="Pickup address" />
                </div>
                {svc !== "As Directed" && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">
                      {svc === "Tour" ? "Drop-off / End point" : "Drop-off"}
                    </p>
                    <Input value={editDropoff} onChange={e => setEditDropoff(e.target.value)} placeholder="Drop-off address" />
                  </div>
                )}

                {svc === "Tour" && (() => {
                  const selTour = tourCatalogue.find(t => t.id === editTourProductId);
                  const altOpts = selTour?.tour_alt_vehicles ?? [];
                  return (
                  <>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Tour</p>
                      <Select
                        value={editTourProductId || "__custom__"}
                        onValueChange={(v) => {
                          if (v === "__custom__") {
                            setEditTourProductId("");
                            setEditTourAltLabel("");
                            setEditTourAltUplift(0);
                            setEditTourBasePrice(0);
                            return;
                          }
                          const t = tourCatalogue.find(x => x.id === v);
                          if (!t) return;
                          setEditTourProductId(t.id);
                          setEditTourName(t.name);
                          setEditTourBasePrice(Number(t.unit_price ?? 0));
                          setEditTourAltLabel("");
                          setEditTourAltUplift(0);
                          setEditPrice(Number(t.unit_price ?? 0));
                        }}
                      >
                        <SelectTrigger data-testid="select-edit-tour"><SelectValue placeholder="Select tour…" /></SelectTrigger>
                        <SelectContent>
                          {tourCatalogue.map(t => (
                            <SelectItem key={t.id} value={t.id}>{t.name}{t.unit_price ? ` — £${Number(t.unit_price).toLocaleString()}` : ""}</SelectItem>
                          ))}
                          <SelectItem value="__custom__">— Custom (not in catalogue) —</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {altOpts.length > 0 && (
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">Vehicle for this tour</p>
                        <Select
                          value={editTourAltLabel || "__std__"}
                          onValueChange={(v) => {
                            if (v === "__std__") {
                              setEditTourAltLabel("");
                              setEditTourAltUplift(0);
                              setEditPrice(Number(editTourBasePrice));
                              return;
                            }
                            const opt = altOpts.find(o => o.label === v);
                            if (!opt) return;
                            setEditTourAltLabel(opt.label);
                            setEditTourAltUplift(Number(opt.uplift) || 0);
                            setEditPrice(Number(editTourBasePrice) + (Number(opt.uplift) || 0));
                          }}
                        >
                          <SelectTrigger data-testid="select-edit-tour-alt"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__std__">V Class (standard) — £{Number(editTourBasePrice).toLocaleString()}</SelectItem>
                            {altOpts.map((o, i) => (
                              <SelectItem key={i} value={o.label}>{o.label} — +£{Number(o.uplift).toLocaleString()} (total £{(Number(editTourBasePrice) + Number(o.uplift)).toLocaleString()})</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}

                    {!editTourProductId && (
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">Tour Name (custom)</p>
                        <Input value={editTourName} onChange={e => setEditTourName(e.target.value)} />
                      </div>
                    )}
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Meeting Point</p>
                      <Input value={editMeetingPoint} onChange={e => setEditMeetingPoint(e.target.value)} />
                    </div>
                  </>
                  );
                })()}

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Vehicle</p>
                    <Input value={editVehicle} onChange={e => setEditVehicle(e.target.value)} placeholder="Mercedes E-Class" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">
                      {svc === "Tour" || svc === "As Directed" ? "Duration (hrs)" : "Pax"}
                    </p>
                    {svc === "Tour" || svc === "As Directed" ? (
                      <Input type="number" value={editDuration || ""} onChange={e => setEditDuration(Number(e.target.value))} />
                    ) : (
                      <Input type="number" value={editPax || ""} onChange={e => setEditPax(Number(e.target.value))} />
                    )}
                  </div>
                </div>

                {svc === "Airport Transfer" && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Luggage</p>
                    <Input type="number" value={editLuggage || ""} onChange={e => setEditLuggage(Number(e.target.value))} />
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3 pt-2 border-t border-border">
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Total Fare (£)</p>
                    <Input type="number" value={editPrice || ""} onChange={e => setEditPrice(Number(e.target.value))} />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">TVL Commission (£)</p>
                    <Input type="number" value={editTvlCommission || ""} onChange={e => setEditTvlCommission(Number(e.target.value))} />
                  </div>
                </div>
              </>
            )}

            <p className="text-xs text-muted-foreground pt-1">
              The booking will be marked <strong>Amended</strong> and the audit log
              will record the change.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditOpen(false)}>Cancel</Button>
            <Button onClick={handleEditSave} disabled={updateBooking.isPending}>
              {updateBooking.isPending ? "Saving…" : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Return Journey — only for completed transfer/tour bookings */}
      {booking.status === 'Completed'
       && ['Airport Transfer','As Directed','Tour'].includes(booking.service_type)
       && (booking as any).client_id && (
        <Button
          variant="outline"
          size="sm"
          onClick={handleAddReturnJourney}
          className="border-primary/30 text-primary hover:bg-primary/10"
        >
          <RotateCcw className="w-3.5 h-3.5 mr-1.5" /> Add Return Journey
        </Button>
      )}

      {booking.status === 'Completed' && (
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={handleInvoice}>
            <FileText className="w-3.5 h-3.5 mr-1.5" /> Generate Invoice
          </Button>
          <Dialog open={isRateOpen} onOpenChange={setIsRateOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" className="text-primary hover:bg-primary/10 border-primary/30">
                <Star className="w-3.5 h-3.5 mr-1.5" /> Rate Driver
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Rate Driver</DialogTitle></DialogHeader>
              <div className="space-y-4 py-4">
                <Input type="number" min="1" max="5" placeholder="Rating (1-5)" value={rating} onChange={e => setRating(Number(e.target.value))} />
                <Textarea placeholder="Notes" value={ratingNote} onChange={e => setRatingNote(e.target.value)} />
              </div>
              <DialogFooter><Button onClick={handleRate}>Submit Rating</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      )}

      {/* Flight live status */}
      {booking.flight_status && (
        <Card className="border-blue-500/30 bg-blue-500/5">
          <CardContent className="p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Plane className="w-5 h-5 text-blue-400" />
              <div>
                <div className="font-bold">{booking.flight_number}</div>
                <div className="text-sm text-muted-foreground">{booking.flight_status.origin} → {booking.flight_status.destination}</div>
              </div>
            </div>
            <div className="text-right space-y-1">
              <div className={`font-bold ${flightStatusColor(booking.flight_status.status)}`}>{booking.flight_status.status}</div>
              {booking.flight_status.delay_minutes ? (
                <div className="text-sm text-amber-400">Delayed {booking.flight_status.delay_minutes} mins</div>
              ) : null}
              {booking.flight_number && (
                <a
                  href={`https://www.flightradar24.com/${encodeURIComponent(booking.flight_number.replace(/\s+/g, ""))}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-blue-400 hover:underline inline-flex items-center gap-1"
                >
                  Live tracker <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Flight number link (when no live status yet, e.g. before flight tracking begins).
          Shown for any service type with a flight number on file — Airport
          Transfers, Tours, As Directed bookings where the client is flying in. */}
      {!booking.flight_status && booking.flight_number && (
        <a
          href={`https://www.flightradar24.com/${encodeURIComponent(booking.flight_number.replace(/\s+/g, ""))}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs text-blue-400 hover:underline"
        >
          <Plane className="w-3.5 h-3.5" />
          Track flight {booking.flight_number} on Flightradar24
          <ExternalLink className="w-3 h-3" />
        </a>
      )}

      {/* Missing-email warning — automated emails (confirmation, receipt,
          invoice) cannot fire without a client_email on file. The banner is
          non-blocking and links straight to the client profile to fix it. */}
      {!((booking as any).client_email ?? "").trim() && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3.5 flex items-start gap-3">
          <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
          <div className="flex-1 text-sm text-amber-200">
            <span className="font-semibold">No email on file for this client.</span>
            {" "}Booking confirmation, payment receipt, and invoice emails will be skipped.
            {(booking as any).client_id && (
              <Link href={`/clients/${(booking as any).client_id}`}>
                <span className="ml-2 underline cursor-pointer text-amber-100 font-medium">Add email →</span>
              </Link>
            )}
          </div>
        </div>
      )}

      {/* Client + Driver */}
      <Card className="border-primary/10 bg-card">
        <CardContent className="p-4 grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-muted-foreground uppercase mb-2 font-medium">Client</p>
            <div className="flex items-center gap-2 flex-wrap">
              {(booking as any).client_id ? (
                <Link href={`/clients/${(booking as any).client_id}`}>
                  <span className="font-bold text-primary hover:underline cursor-pointer">{booking.client_name}</span>
                </Link>
              ) : (
                <span className="font-bold">{booking.client_name}</span>
              )}
              {booking.client_vip_tier && booking.client_vip_tier !== 'Standard' && (
                <Badge variant="outline" className={getVipBadgeColor(booking.client_vip_tier)}>{booking.client_vip_tier}</Badge>
              )}
              {(booking as any).client_nationality && (
                <span
                  className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded border border-border bg-secondary"
                  title={(booking as any).client_nationality}
                  data-testid="badge-client-nationality"
                >
                  <span className="text-base leading-none">{nationalityFlag((booking as any).client_nationality)}</span>
                  <span className="text-muted-foreground">{(booking as any).client_nationality}</span>
                </span>
              )}
            </div>
            {(booking as any).client_email && (
              <p className="text-[11px] text-muted-foreground mt-1 truncate">{(booking as any).client_email}</p>
            )}
          </div>
          <div>
            <p className="text-xs text-muted-foreground uppercase mb-2 font-medium">Driver</p>
            {!isResidenceManager ? (
              <Select
                value={(booking as any).driver_id ?? "unassigned"}
                onValueChange={assignDriver}
                disabled={assigningDriver}
              >
                <SelectTrigger
                  className={`h-9 ${
                    (booking as any).driver_id
                      ? ""
                      : "text-destructive border-2 border-destructive bg-destructive/10 animate-pulse shadow-md shadow-destructive/30"
                  }`}
                  data-testid={(booking as any).driver_id ? "driver-assigned" : "driver-needs-assignment"}
                >
                  <SelectValue placeholder="Tap to assign…">
                    {booking.driver_name ? (
                      <span className="flex flex-col items-start leading-tight">
                        <span className="font-semibold text-foreground">{booking.driver_name}</span>
                        {booking.driver_vehicle && <span className="text-[11px] text-muted-foreground">{booking.driver_vehicle}</span>}
                      </span>
                    ) : (
                      <span className="font-bold uppercase tracking-wider text-xs">⚠ Driver required — tap to assign</span>
                    )}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent className="max-h-[55vh] overflow-y-auto">
                  <SelectItem value="unassigned">Unassigned</SelectItem>
                  {(drivers as any[] | undefined)?.map((d: any) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.staff_no ? `${d.staff_no} · ` : ""}{d.name}
                      {(d.vehicle_model || d.vehicle_type) ? ` · ${d.vehicle_model || d.vehicle_type}` : ""}
                      {d.plate ? ` (${d.plate})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : booking.driver_name ? (
              <>
                {(booking as any).driver_id ? (
                  <Link href={`/drivers/${(booking as any).driver_id}`}>
                    <span className="font-bold block text-primary hover:underline cursor-pointer">{booking.driver_name}</span>
                  </Link>
                ) : (
                  <span className="font-bold block">{booking.driver_name}</span>
                )}
                <span className="text-xs text-muted-foreground">{booking.driver_vehicle}</span>
              </>
            ) : (
              <span className="text-destructive font-medium text-sm">Unassigned</span>
            )}

            {/* Driver WhatsApp + Acceptance status — Fixes 13 & 15.
                The WA button uses the assigned driver's phone (from the
                drivers list lookup) and pre-fills a polite job-sent message.
                The acceptance select lets ops record explicit confirmation
                from the driver and triggers the admin-alert flow on decline. */}
            {(booking as any).driver_id && (() => {
              const drv = (drivers as any[] | undefined)?.find((d) => d.id === (booking as any).driver_id);
              const phone = (drv?.whatsapp || drv?.phone || "").replace(/[^0-9+]/g, "");
              const acceptance = (booking as any).driver_acceptance_status ?? "Assigned";
              const msg = `Hi ${drv?.name ?? booking.driver_name ?? ""}, I've just sent you booking ${booking.tvl_ref}. Please confirm receipt. Thanks.`;
              return (
                <div className="mt-2 space-y-2">
                  {phone ? (
                    <a
                      href={`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      data-testid="link-whatsapp-driver"
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-green-500 hover:text-green-400 underline"
                    >
                      <MessageSquare className="w-3.5 h-3.5" /> WhatsApp Driver
                    </a>
                  ) : (
                    <p className="text-xs text-muted-foreground">No driver WhatsApp on file</p>
                  )}
                  <div>
                    <p className="text-[10px] uppercase text-muted-foreground tracking-wide mb-1">Driver Acceptance</p>
                    <Select
                      value={acceptance}
                      onValueChange={(v) => setDriverAcceptance(v as any)}
                    >
                      <SelectTrigger className="h-8 text-xs" data-testid="select-driver-acceptance">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Assigned">Assigned (Awaiting)</SelectItem>
                        <SelectItem value="Driver Confirmed">Driver Confirmed</SelectItem>
                        <SelectItem value="Driver Declined">Driver Declined</SelectItem>
                      </SelectContent>
                    </Select>
                    {acceptance === "Driver Confirmed" && (booking as any).driver_accepted_at && (
                      <p className="text-[10px] text-green-500 mt-1">Confirmed {format(new Date((booking as any).driver_accepted_at), "dd MMM HH:mm")}</p>
                    )}
                    {acceptance === "Driver Declined" && (
                      <p className="text-[10px] text-destructive mt-1">Declined — driver removed; admin alerted</p>
                    )}
                  </div>
                </div>
              );
            })()}
          </div>
        </CardContent>
      </Card>

      {/* MV5 — Multi-vehicle roster. Renders nothing if booking has no extra vehicles. */}
      {id && <BookingVehiclesRoster bookingId={id} />}
      {id && <BookingActivityPanel bookingId={id} />}

      {/* Journey / Property card.
          For Hotel and Apartment bookings the title becomes "Property Details"
          and the transport-only rows (Pickup, Drop-off, Vehicle, Pax/Luggage,
          Flight, Meet & Greet Board) are hidden — those fields do not apply
          to accommodation and would otherwise leak placeholder data into the
          job sheet. */}
      {(() => {
        const accommodation = svc === "Hotel" || svc === "Apartment";
        return (
      <Card className="border-primary/10 bg-card">
        <CardHeader className="pb-2"><CardTitle className="text-base">{accommodation ? "Property Details" : "Journey"}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {!accommodation && id && (
            <BookingRouteOverridesHint bookingId={id} />
          )}
          {!accommodation && (
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><MapPin className="w-3 h-3" /> Pickup</p>
                <p className="font-medium">{booking.pickup || '—'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><MapPin className="w-3 h-3" /> Drop-off</p>
                <p className="font-medium">{booking.dropoff || (booking as any).destination || '—'}</p>
              </div>
              {booking.vehicle_type && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><Car className="w-3 h-3" /> Vehicle</p>
                  <p className="font-medium">{booking.vehicle_type}</p>
                </div>
              )}
              {(booking as any).vehicle_preference && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><Car className="w-3 h-3" /> Client Preference</p>
                  <p className="font-medium text-amber-300" data-testid="text-vehicle-preference">{(booking as any).vehicle_preference}</p>
                </div>
              )}
              <div>
                <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><Users className="w-3 h-3" /> Pax / Luggage</p>
                <p className="font-medium">{booking.passengers || 0} pax · {booking.luggage || 0} bags</p>
              </div>
              {booking.flight_number && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><Plane className="w-3 h-3" /> Flight</p>
                  <p className="font-medium">{booking.flight_number} · {(booking as any).direction}</p>
                </div>
              )}
              {booking.nameboard && (
                <div className="col-span-2">
                  <p className="text-xs text-muted-foreground mb-1">Meet &amp; Greet Board</p>
                  <p className="font-bold text-primary text-lg">"{booking.nameboard}"</p>
                </div>
              )}
            </div>
          )}

          {extras && (
            <div className="pt-3 border-t border-border">
              <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><Gift className="w-3 h-3" /> Extras</p>
              <p className="font-medium">{extras}</p>
            </div>
          )}

          {(booking as any).special_requests && (
            <div className="pt-3 border-t border-border">
              <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><ClipboardList className="w-3 h-3" /> Special Requests</p>
              <p className="font-medium">{(booking as any).special_requests}</p>
            </div>
          )}

          {/* Tour details */}
          {(booking as any).tour_name && (
            <div className="pt-3 border-t border-border space-y-2">
              <p className="text-xs text-muted-foreground uppercase font-semibold flex items-center gap-1"><Map className="w-3 h-3" /> Tour</p>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="col-span-2">
                  <p className="text-xs text-muted-foreground mb-1">Tour Name</p>
                  <p className="font-semibold text-foreground">{(booking as any).tour_name}</p>
                </div>
                {(booking as any).meeting_point && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Meeting Point</p>
                    <p className="font-medium">{(booking as any).meeting_point}</p>
                  </div>
                )}
                {(booking as any).duration && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Duration</p>
                    <p className="font-medium">{(booking as any).duration} hrs</p>
                  </div>
                )}
                {(booking as any).guide_included && (
                  <div>
                    <Badge variant="outline" className="text-primary border-primary/30 text-xs">Guide Included</Badge>
                  </div>
                )}
                {(booking as any).itinerary && (
                  <div className="col-span-2">
                    <p className="text-xs text-muted-foreground mb-1">Itinerary</p>
                    <p className="text-sm whitespace-pre-line">{(booking as any).itinerary}</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Hotel details */}
          {svc === "Hotel" && (
            <div className="pt-3 border-t border-border space-y-2">
              <p className="text-xs text-muted-foreground uppercase font-semibold flex items-center gap-1"><Building2 className="w-3 h-3" /> Hotel</p>
              <div className="grid grid-cols-2 gap-3 text-sm">
                {(booking as any).hotel_name && (
                  <div className="col-span-2">
                    <p className="text-xs text-muted-foreground mb-1">Hotel Name</p>
                    <p className="font-semibold text-foreground">{(booking as any).hotel_name}</p>
                  </div>
                )}
                {(booking as any).hotel_booking_ref && (
                  <div className="col-span-2">
                    <p className="text-xs text-muted-foreground mb-1">Hotel Booking Reference</p>
                    <p className="font-bold text-primary">{(booking as any).hotel_booking_ref}</p>
                  </div>
                )}
                {(booking as any).room_type && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Room Type</p>
                    <p className="font-medium">{(booking as any).room_type}</p>
                  </div>
                )}
                {(booking as any).num_guests && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><Users className="w-3 h-3" /> Guests</p>
                    <p className="font-medium">{(booking as any).num_guests} guest{(booking as any).num_guests !== 1 ? "s" : ""}</p>
                  </div>
                )}
                {(booking as any).check_in_date && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><CalendarRange className="w-3 h-3" /> Check-in</p>
                    <p className="font-medium">{format(new Date((booking as any).check_in_date), "dd MMM yyyy")}</p>
                  </div>
                )}
                {(booking as any).check_out_date && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><CalendarRange className="w-3 h-3" /> Check-out</p>
                    <p className="font-medium">{format(new Date((booking as any).check_out_date), "dd MMM yyyy")}</p>
                  </div>
                )}
                {(booking as any).num_nights && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Nights</p>
                    <p className="font-medium">{(booking as any).num_nights} night{(booking as any).num_nights !== 1 ? "s" : ""}</p>
                  </div>
                )}
                {(booking as any).breakfast_included && (
                  <div>
                    <Badge variant="outline" className="text-primary border-primary/30 text-xs">Breakfast Included</Badge>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Accommodation details (Apartment) */}
          {(booking as any).property_name && (
            <div className="pt-3 border-t border-border space-y-2">
              <p className="text-xs text-muted-foreground uppercase font-semibold flex items-center gap-1"><Building2 className="w-3 h-3" /> Accommodation</p>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="col-span-2">
                  <p className="text-xs text-muted-foreground mb-1">Property</p>
                  <p className="font-semibold text-foreground">{(booking as any).property_name}</p>
                  {(booking as any).property_address && <p className="text-xs text-muted-foreground mt-0.5">{(booking as any).property_address}</p>}
                </div>
                {(booking as any).check_in_date && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><CalendarRange className="w-3 h-3" /> Check-in</p>
                    <p className="font-medium">{format(new Date((booking as any).check_in_date), "dd MMM yyyy HH:mm")}</p>
                  </div>
                )}
                {(booking as any).check_out_date && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><CalendarRange className="w-3 h-3" /> Check-out</p>
                    <p className="font-medium">{format(new Date((booking as any).check_out_date), "dd MMM yyyy HH:mm")}</p>
                  </div>
                )}
                {(booking as any).nights && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Nights</p>
                    <p className="font-medium">{(booking as any).nights} night{(booking as any).nights !== 1 ? "s" : ""}</p>
                  </div>
                )}
                {(booking as any).property_contact && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Property Contact</p>
                    <p className="font-medium">{(booking as any).property_contact}</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
        );
      })()}

      {/* Order Lines */}
      {orderLines.length > 0 && (
        <Card className="border-primary/10 bg-card">
          <CardHeader className="pb-2"><CardTitle className="text-base">Order Lines</CardTitle></CardHeader>
          <CardContent className="pt-0">
            <div className="divide-y divide-border">
              {orderLines.map((line: any) => (
                <div key={line.id} className="flex items-center justify-between py-2.5">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-foreground">{line.name}</div>
                    <div className="text-xs text-muted-foreground">
                      £{(line.unit_price ?? 0).toLocaleString()} × {line.quantity}
                    </div>
                  </div>
                  <span className="text-sm font-semibold text-foreground ml-4">
                    £{(line.total ?? (line.unit_price ?? 0) * (line.quantity ?? 0)).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
            <div className="flex justify-between items-center pt-3 border-t border-border mt-1">
              <span className="text-sm text-muted-foreground">Products Subtotal</span>
              <span className="font-bold text-primary">
                £{orderLines.reduce((s: number, l: any) => s + (l.total ?? (l.unit_price ?? 0) * (l.quantity ?? 0)), 0).toLocaleString()}
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ─── Supplier + Car Rental cost breakdown ─────────────────────────
          Shows supplier name (with WhatsApp/phone shortcuts) and the live
          margin for Car Rental bookings. Extras remain editable even after
          the booking is completed (operators frequently add tolls / damage
          charges later). */}
      {!isResidenceManager && ((booking as any).supplier_id || svc === "Car Rental" || svc === "As Directed") && (
        <SupplierCostCard
          booking={booking}
          onSaved={() => {
            // Targeted invalidation — supplier cost changes affect the
            // current booking detail, the bookings list, finance/invoice
            // totals, commission summaries, and the dashboard KPIs.
            // Use the orval-generated query-key helpers so we match the
            // exact keys react-query uses (string-prefix matches don't
            // work; tanstack matches array elements by deep-equal).
            qc.invalidateQueries({ queryKey: getGetBookingQueryKey(id) });
            qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
            // List/summary endpoints take params, so invalidate every
            // variation by matching on the URL prefix (first key element).
            const prefixes = [
              "/api/bookings",
              "/api/invoices",
              "/api/commissions",
              "/api/audit-log",
              "/api/finance/summary",
            ];
            qc.invalidateQueries({
              predicate: (q) =>
                typeof q.queryKey[0] === "string" &&
                prefixes.some((p) => (q.queryKey[0] as string).startsWith(p)),
            });
          }}
        />
      )}

      {/* Financials — hidden from Residence Managers.
          Accommodation bookings (Hotel/Apartment) have NO driver, so the
          "Driver Receives" line is suppressed. Hotel commission is shown
          as "Commission Earned" (positive — money in) instead of the
          transport-style "TVL Commission". */}
      {!isResidenceManager && (
        <Card className="border-primary/10 bg-card">
          <CardHeader className="pb-2"><CardTitle className="text-base">Financials</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between items-center pb-2 border-b border-border">
              <span className="text-muted-foreground">
                {svc === "Hotel" || svc === "Apartment" ? "Total Charged to Client" : "Total Fare"}
              </span>
              <span className="font-bold text-xl text-primary">£{(booking.price || 0).toLocaleString()}</span>
            </div>
            {(booking.additional_charges || 0) > 0 && (
              <div className="flex justify-between items-center text-sm">
                <span className="text-muted-foreground">Additional Charges</span>
                <span className="font-medium">£{(booking.additional_charges || 0).toLocaleString()}</span>
              </div>
            )}
            {svc === "Hotel" || svc === "Apartment" ? (
              <div className="flex justify-between items-center text-sm">
                <span className="text-muted-foreground">Commission Earned</span>
                <span className="font-medium text-green-400">
                  £{((booking as any).commission_amount || 0).toLocaleString()}
                </span>
              </div>
            ) : svc === "Airport Transfer" ? (
              // Airport Transfer uses a SPLIT commission model:
              //   Driver Commission (tvl_commission)  — driver owes TVL
              //   Supplier Commission (supplier_commission) — TVL markup on
              //     third-party supplier services (e.g. Heathrow M&G agents)
              //   Total TVL Profit = Driver + Supplier
              <>
                <div className="flex justify-between items-center text-sm">
                  <span className="text-muted-foreground">Driver Commission</span>
                  <span className="font-medium">£{(booking.tvl_commission || 0).toLocaleString()}</span>
                </div>
                {((booking as any).supplier_commission != null && Number((booking as any).supplier_commission) !== 0) && (
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-muted-foreground">
                      Supplier Commission
                      {(booking as any).supplier_id ? <span className="text-[10px] text-muted-foreground/70 ml-1">(markup)</span> : null}
                    </span>
                    <span className="font-medium">£{Number((booking as any).supplier_commission || 0).toLocaleString()}</span>
                  </div>
                )}
                <div className="flex justify-between items-center text-sm pt-1 border-t border-border/40">
                  <span className="text-muted-foreground font-medium">Total TVL Profit</span>
                  <span className="font-semibold text-green-400">
                    £{(Number(booking.tvl_commission || 0) + Number((booking as any).supplier_commission || 0)).toLocaleString()}
                  </span>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span className="text-muted-foreground">Driver Receives</span>
                  <span className="font-medium text-blue-400">£{(booking.driver_receives || 0).toLocaleString()}</span>
                </div>
              </>
            ) : (
              <>
                <div className="flex justify-between items-center text-sm">
                  <span className="text-muted-foreground">TVL Commission</span>
                  <span className="font-medium">£{(booking.tvl_commission || 0).toLocaleString()}</span>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span className="text-muted-foreground">Driver Receives</span>
                  <span className="font-medium text-blue-400">£{(booking.driver_receives || 0).toLocaleString()}</span>
                </div>
              </>
            )}
            <div className="flex items-center gap-3 pt-2 border-t border-border">
              <div className="flex-1">
                <p className="text-xs text-muted-foreground mb-1">Payment Status</p>
                <select
                  value={booking.payment_status || "Unpaid"}
                  onChange={e => {
                    const next = e.target.value;
                    // When flipping to Paid, auto-stamp today's Date Paid if
                    // it's still empty. Operator can still override the date
                    // manually using the date input below.
                    const patch: any = { payment_status: next };
                    if (next === "Paid" && !((booking as any).payment_date)) {
                      patch.payment_date = new Date().toISOString().slice(0, 10);
                    }
                    updateBooking.mutate({ id, data: patch }, {
                      onSuccess: invalidateBookingDetail,
                    });
                  }}
                  className={`h-9 rounded-md border px-3 text-sm bg-background w-full ${
                    booking.payment_status === 'Paid'
                      ? 'text-green-400 border-green-500/40'
                      : booking.payment_status === 'Partial'
                        ? 'text-blue-400 border-blue-500/40'
                        : 'text-amber-400 border-amber-500/40'
                  }`}
                >
                  <option value="Unpaid">Unpaid</option>
                  <option value="Partial">Partial</option>
                  <option value="Paid">Paid</option>
                </select>
              </div>
              {booking.payment_method && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Method</p>
                  <Badge variant="outline" className="h-9 px-3 flex items-center">{booking.payment_method}</Badge>
                </div>
              )}
            </div>

            {/* Payment details — date, amount, method, notes (Migration B). */}
            <div className="grid grid-cols-2 gap-3 pt-3 border-t border-border">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Date Paid</p>
                <Input
                  // The `key` forces React to remount this uncontrolled input
                  // whenever the server-side payment_date changes (e.g. when
                  // F1 autofill stamps today's date after flipping to Paid).
                  // Without it, the stale defaultValue persists and the
                  // operator's next blur could overwrite the autofill with "".
                  key={(booking as any).payment_date ?? "empty"}
                  type="date"
                  defaultValue={(booking as any).payment_date?.slice(0,10) || ""}
                  onBlur={e => {
                    const next = e.target.value || null;
                    const cur = (booking as any).payment_date?.slice(0,10) || null;
                    if (next === cur) return; // no-op blur shouldn't clobber autofill
                    updateBooking.mutate({ id, data: { payment_date: next } as any }, {
                      onSuccess: invalidateBookingDetail,
                    });
                  }}
                  className="h-9"
                  data-testid="input-payment-date"
                />
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Amount Paid (£)</p>
                <Input
                  type="number" step="0.01" min="0"
                  defaultValue={(booking as any).paid_amount ?? ""}
                  onBlur={e => updateBooking.mutate({ id, data: { paid_amount: e.target.value === "" ? null : Number(e.target.value) } as any }, {
                    onSuccess: invalidateBookingDetail,
                  })}
                  className="h-9"
                  data-testid="input-paid-amount"
                />
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Method</p>
                <select
                  value={booking.payment_method || ""}
                  onChange={e => updateBooking.mutate({ id, data: { payment_method: e.target.value || null } as any }, {
                    onSuccess: invalidateBookingDetail,
                  })}
                  className="h-9 w-full rounded-md border border-border px-3 text-sm bg-background"
                  data-testid="select-payment-method"
                >
                  <option value="">—</option>
                  <option value="Cash">Cash</option>
                  <option value="Card">Card</option>
                  <option value="Bank Transfer">Bank Transfer</option>
                  <option value="Stripe">Stripe</option>
                  <option value="Wise">Wise</option>
                  <option value="Other">Other</option>
                </select>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Outstanding</p>
                <div className="h-9 flex items-center px-3 rounded-md border border-border bg-muted/30 font-bold">
                  £{Math.max(0, Number(booking.price ?? 0) - Number((booking as any).paid_amount ?? (booking.payment_status === "Paid" ? booking.price ?? 0 : 0))).toLocaleString()}
                </div>
              </div>
              <div className="col-span-2">
                <p className="text-xs text-muted-foreground mb-1">Payment Notes</p>
                <Textarea
                  defaultValue={(booking as any).payment_notes || ""}
                  onBlur={e => updateBooking.mutate({ id, data: { payment_notes: e.target.value || null } as any }, {
                    onSuccess: invalidateBookingDetail,
                  })}
                  placeholder="e.g. Wise transfer ref TX12345 · settled by Mr Khalifa"
                  rows={2}
                  data-testid="textarea-payment-notes"
                />
              </div>
            </div>

            {/* Receipt download — appears once any payment has been recorded. */}
            {(booking.payment_status === "Paid" || booking.payment_status === "Partial" || (booking as any).paid_amount) && (
              <Button
                variant="outline"
                size="sm"
                className="w-full mt-3 border-green-500/40 text-green-400 hover:bg-green-500/10"
                onClick={async () => {
                  try {
                    const { data: { session } } = await supabase.auth.getSession();
                    const token = session?.access_token;
                    const res = await fetch(`/api/bookings/${booking.id}/receipt.pdf`, {
                      headers: token ? { Authorization: `Bearer ${token}` } : {},
                    });
                    if (!res.ok) throw new Error(await res.text());
                    const blob = await res.blob();
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `traveluxe-receipt-${booking.tvl_ref ?? booking.id}.pdf`;
                    document.body.appendChild(a); a.click(); a.remove();
                    setTimeout(() => URL.revokeObjectURL(url), 1000);
                  } catch (e: any) {
                    toast({ title: "Receipt failed", description: e?.message ?? "Could not generate receipt", variant: "destructive" });
                  }
                }}
                data-testid="button-download-receipt"
              >
                <FileDown className="w-4 h-4 mr-2" />
                Download Payment Receipt (PDF)
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* Invoice — hidden from Residence Managers */}
      {!isResidenceManager && (
        booking.invoice ? (
          <Card className="border-purple-500/30 bg-purple-500/5">
            <CardContent className="p-4 flex justify-between items-center">
              <div>
                <div className="font-bold text-purple-400">Invoice {booking.invoice.invoice_number}</div>
                <div className="text-xs text-muted-foreground">{booking.invoice.status}</div>
              </div>
              <Link href={`/invoices/${booking.invoice.id}`}>
                <Button variant="ghost" size="icon" className="text-purple-400">
                  <FileText className="w-5 h-5" />
                </Button>
              </Link>
            </CardContent>
          </Card>
        ) : booking.status !== 'Cancelled' ? (
          <Card className="border-border bg-card">
            <CardContent className="p-4 flex justify-between items-center">
              <div>
                <div className="font-semibold text-sm text-foreground">No Invoice Yet</div>
                <div className="text-xs text-muted-foreground">Generate an invoice for this booking</div>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="text-purple-400 border-purple-500/30 hover:bg-purple-500/10"
                disabled={generateInvoice.isPending}
                onClick={() => generateInvoice.mutate({ data: { booking_id: id } }, {
                  onSuccess: () => qc.invalidateQueries(),
                })}
              >
                <FileText className="w-4 h-4 mr-2" />
                {generateInvoice.isPending ? "Generating…" : "Generate Invoice"}
              </Button>
            </CardContent>
          </Card>
        ) : null
      )}

      {/* Internal notes */}
      {booking.notes && (
        <Card className="border-border bg-card">
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Internal Notes</CardTitle></CardHeader>
          <CardContent><p className="text-sm whitespace-pre-wrap break-words">{booking.notes}</p></CardContent>
        </Card>
      )}

      {/* Issues card — Fix 12.
          Shows any issues raised against this booking (including those
          captured via the Mark Completed dialog). Operators can resolve an
          issue by recording a resolution note. Read-only for residence mgrs. */}
      <Card className="border-border bg-card" data-testid="card-issues">
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" /> Issues
            {issues.length > 0 && (
              <Badge variant="outline" className="ml-1 text-[10px]">{issues.length}</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {issues.length === 0 ? (
            <p className="text-xs text-muted-foreground">No issues raised for this booking.</p>
          ) : (
            issues.map((iss: any) => (
              <div key={iss.id} className="text-xs border-b border-border pb-2 last:border-0" data-testid={`issue-${iss.id}`}>
                <div className="flex items-center justify-between">
                  <Badge variant="outline" className={iss.status === "Resolved" ? "border-green-500/40 text-green-400" : "border-amber-500/40 text-amber-400"}>
                    {iss.status}
                  </Badge>
                  <span className="text-muted-foreground">{iss.created_at ? format(new Date(iss.created_at), "PPp") : ""}</span>
                </div>
                <p className="mt-1 text-foreground">{iss.description}</p>
                {iss.resolution_notes && (
                  <p className="mt-1 text-muted-foreground italic">Resolution: {iss.resolution_notes}</p>
                )}
                {iss.status !== "Resolved" && !isResidenceManager && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-2 h-7 text-[11px]"
                    onClick={() => { setResolveIssueId(iss.id); setResolveNotes(""); }}
                    data-testid={`button-resolve-${iss.id}`}
                  >
                    Resolve
                  </Button>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* Amendments History — Fix 16.
          Auto-populated server-side on every PUT. Each row shows the field,
          before/after values, who changed it, when and why. */}
      <Card className="border-border bg-card" data-testid="card-amendments">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
            <History className="w-4 h-4" /> Amendments History
            {amendments.length > 0 && (
              <Badge variant="outline" className="ml-1 text-[10px]">{amendments.length}</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {amendments.length === 0 ? (
            <p className="text-xs text-muted-foreground">No amendments recorded.</p>
          ) : (
            amendments.map((am: any) => (
              <div key={am.id} className="text-xs border-b border-border pb-2 last:border-0" data-testid={`amendment-${am.id}`}>
                <div className="flex items-center justify-between">
                  <span className="font-medium text-foreground">{am.field_name}</span>
                  <span className="text-muted-foreground">{am.created_at ? format(new Date(am.created_at), "PPp") : ""}</span>
                </div>
                <p className="mt-0.5 text-muted-foreground">
                  <span className="line-through">{am.old_value ?? "—"}</span>
                  {" → "}
                  <span className="text-foreground">{am.new_value ?? "—"}</span>
                </p>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  by {am.changed_by_name || "System"} · {am.change_type}
                  {am.reason ? ` · ${am.reason}` : ""}
                </p>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* Driver-conflict dialog — Fix 11 */}
      <Dialog open={conflictDialog.open} onOpenChange={(o) => !o && setConflictDialog((s) => ({ ...s, open: false }))}>
        <DialogContent data-testid="dialog-driver-conflict">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="w-5 h-5" /> Driver Schedule Conflict
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2 text-sm">
            <p>{conflictDialog.message}</p>
            {conflictDialog.driverName && (
              <p className="text-muted-foreground">Driver: <span className="font-semibold text-foreground">{conflictDialog.driverName}</span></p>
            )}
            {conflictDialog.conflicts.length > 0 && (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 space-y-2">
                <p className="text-xs uppercase text-muted-foreground tracking-wide">Overlapping bookings</p>
                {conflictDialog.conflicts.map((c: any) => (
                  <div key={c.id} className="text-xs">
                    <span className="font-mono font-semibold">{c.tvl_ref}</span>
                    {c.client_name ? <span className="text-muted-foreground"> · {c.client_name}</span> : null}
                    {c.date_time ? <span className="text-muted-foreground"> · {fmtLondon(c.date_time, "d MMM yyyy, HH:mm")}</span> : null}
                  </div>
                ))}
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Choose another driver, or override and proceed anyway. Overrides are logged in Amendments History.
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConflictDialog({ open: false, driverId: null, driverName: null, conflicts: [], message: "" })}
              data-testid="button-conflict-cancel"
            >
              Pick Another Driver
            </Button>
            <Button
              variant="destructive"
              onClick={proceedConflictOverride}
              disabled={assigningDriver}
              data-testid="button-conflict-override"
            >
              Override &amp; Assign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Completion dialog — Fix 12 */}
      <Dialog open={isCompleteOpen} onOpenChange={setIsCompleteOpen}>
        <DialogContent data-testid="dialog-complete-booking">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><CheckCircle2 className="w-5 h-5 text-green-500" /> Complete Booking</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2 text-sm">
            <div>
              <p className="text-xs text-muted-foreground mb-1">Client satisfied?</p>
              <Select value={completeClientSatisfied} onValueChange={(v) => setCompleteClientSatisfied(v as any)}>
                <SelectTrigger data-testid="select-client-satisfied"><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="yes">Yes</SelectItem>
                  <SelectItem value="no">No</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Driver on time?</p>
              <Select value={completeDriverOnTime} onValueChange={(v) => setCompleteDriverOnTime(v as any)}>
                <SelectTrigger data-testid="select-driver-on-time"><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="yes">Yes</SelectItem>
                  <SelectItem value="no">No</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Notes / Issues (optional)</p>
              <Textarea
                value={completeNotes}
                onChange={(e) => setCompleteNotes(e.target.value)}
                placeholder="Any issues to flag — these will create an Issue record."
                rows={3}
                data-testid="input-completion-notes"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCompleteOpen(false)}>Cancel</Button>
            <Button onClick={handleCompleteSubmit} disabled={completing} data-testid="button-confirm-complete">
              {completing ? "Saving…" : "Mark Completed"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Resolve issue dialog */}
      <Dialog open={!!resolveIssueId} onOpenChange={(o) => !o && setResolveIssueId(null)}>
        <DialogContent data-testid="dialog-resolve-issue">
          <DialogHeader><DialogTitle>Resolve Issue</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <Textarea
              value={resolveNotes}
              onChange={(e) => setResolveNotes(e.target.value)}
              placeholder="How was this resolved?"
              rows={3}
              data-testid="input-resolve-notes"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResolveIssueId(null)}>Cancel</Button>
            <Button onClick={handleResolveIssue} data-testid="button-confirm-resolve">Mark Resolved</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Audit log */}
      {booking.audit_log && booking.audit_log.length > 0 && (
        <Card className="border-border bg-card">
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Audit Log</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {booking.audit_log.map((log: any) => (
              <div key={log.id} className="text-xs border-b border-border pb-2 last:border-0">
                <span className="font-medium text-foreground">{log.operator_name || 'System'}</span>
                <span className="text-muted-foreground mx-2">{log.action}</span>
                <span className="text-muted-foreground block mt-0.5">{format(new Date(log.created_at), 'PPp')}</span>
                {log.detail && <span className="text-muted-foreground mt-0.5 block">{log.detail}</span>}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
