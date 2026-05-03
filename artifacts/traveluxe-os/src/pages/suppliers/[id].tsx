import { useEffect, useMemo, useState } from "react";
import { useRoute, Link, useLocation } from "wouter";
import { supabase } from "@/lib/supabase";
import { ActivityPanel } from "@/components/activity/ActivityPanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  ArrowLeft, Building2, Phone, Mail, MessageCircle, Save, Trash2,
  MapPin, Globe, Star, Briefcase, Package, Plus, Pencil, Check, X,
  PoundSterling, Receipt, Undo2,
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { ServiceTypeMultiSelect, deriveServiceTypes } from "@/components/SupplierServiceTypes";

async function authedFetch(path: string, init: RequestInit = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  return fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
      ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
    },
  });
}

function whatsappLink(num?: string) {
  if (!num) return null;
  const clean = num.replace(/[^\d+]/g, "");
  return `https://wa.me/${clean.replace(/^\+/, "")}`;
}

export default function SupplierDetail() {
  const [, params] = useRoute("/suppliers/:id");
  const [, setLocation] = useLocation();
  const id = params?.id;

  const [supplier, setSupplier] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [edit, setEdit] = useState<any>({});
  // Service-type state lives outside `edit` so the multi-select component
  // can drive both array + primary in one update without spreading a stale
  // version on every change.
  const [serviceTypes, setServiceTypes] = useState<string[]>([]);
  const [primaryType, setPrimaryType] = useState<string>("");

  useEffect(() => {
    if (!id) return;
    (async () => {
      setLoading(true);
      try {
        const res = await authedFetch(`/api/suppliers/${id}`);
        if (!res.ok) {
          toast.error("Supplier not found");
          setLocation("/suppliers");
          return;
        }
        const data = await res.json();
        setSupplier(data);
        setEdit(data);
        // Pre-load multi-select with currently saved types + primary star.
        const derived = deriveServiceTypes(data);
        setServiceTypes(derived.types);
        setPrimaryType(derived.primary);
      } finally {
        setLoading(false);
      }
    })();
  }, [id, setLocation]);

  const handleSave = async () => {
    if (!edit.name?.trim()) {
      toast.error("Supplier name is required");
      return;
    }
    if (serviceTypes.length === 0) {
      toast.error("Select at least one service type before saving");
      return;
    }
    setSaving(true);
    try {
      const res = await authedFetch(`/api/suppliers/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: edit.name,
          // Send both new fields. Backend mirrors primary → category for
          // legacy compatibility and validates the array is non-empty.
          service_types: serviceTypes,
          primary_service_type: primaryType,
          contact_name: edit.contact_name,
          whatsapp: edit.whatsapp,
          phone: edit.phone,
          email: edit.email,
          address: edit.address,
          city: edit.city,
          country: edit.country,
          website: edit.website,
          notes: edit.notes,
          rating: edit.rating ? Number(edit.rating) : null,
          is_active: edit.is_active,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? "Failed to save");
      }
      const updated = await res.json();
      setSupplier({ ...supplier, ...updated });
      toast.success("Supplier updated");
    } catch (e: any) {
      toast.error(e.message ?? "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const [deactivateOpen, setDeactivateOpen] = useState(false);
  const performDeactivate = async () => {
    setDeactivateOpen(false);
    try {
      const res = await authedFetch(`/api/suppliers/${id}?soft=1`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed");
      toast.success("Supplier deactivated");
      setLocation("/suppliers");
    } catch {
      toast.error("Failed to deactivate");
    }
  };

  if (loading || !supplier) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-60 w-full" />
      </div>
    );
  }

  const wa = whatsappLink(edit.whatsapp);

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between gap-3">
        <Link href="/suppliers">
          <Button variant="ghost" size="sm" className="-ml-2">
            <ArrowLeft className="w-4 h-4 mr-1.5" /> Back
          </Button>
        </Link>
        <div className="flex gap-2">
          {wa && (
            <a href={wa} target="_blank" rel="noopener noreferrer">
              <Button variant="outline" className="text-green-400 border-green-500/30 hover:bg-green-500/10">
                <MessageCircle className="w-4 h-4 mr-2" /> WhatsApp
              </Button>
            </a>
          )}
          <Button
            onClick={handleSave}
            disabled={saving || serviceTypes.length === 0}
            data-testid="btn-save-supplier"
          >
            <Save className="w-4 h-4 mr-2" />
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>

      {/* Header card */}
      <Card className="bg-card border-border">
        <CardContent className="p-6 space-y-4">
          <div className="flex items-start gap-3 flex-wrap">
            <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
              <Building2 className="w-6 h-6 text-primary" />
            </div>
            <div className="flex-1 min-w-[200px]">
              <Input
                value={edit.name ?? ""}
                onChange={e => setEdit({ ...edit, name: e.target.value })}
                className="text-xl font-bold border-0 px-0 h-auto bg-transparent focus-visible:ring-0"
              />
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={!!edit.is_active}
                    onChange={e => setEdit({ ...edit, is_active: e.target.checked })}
                  />
                  Active
                </label>
              </div>
            </div>
          </div>

          {/* Service Types — multi-select with Primary star. Replaces the
              previous single-category dropdown. The backend validates ≥1
              and mirrors Primary into the legacy `category` column. */}
          <div className="pt-3 border-t border-border space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Service Types
              </Label>
              <span className="text-[11px] text-muted-foreground">
                Tick every service this supplier provides. Star one as Primary.
              </span>
            </div>
            <ServiceTypeMultiSelect
              value={serviceTypes}
              primary={primaryType}
              onChange={({ types, primary }) => {
                setServiceTypes(types);
                setPrimaryType(primary);
              }}
            />
          </div>

          {/* KPI strip */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 pt-2 border-t border-border">
            <div>
              <div className="text-[10px] uppercase text-muted-foreground tracking-wider">Bookings</div>
              <div className="text-xl font-bold text-foreground">{supplier.total_bookings ?? 0}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase text-muted-foreground tracking-wider">Revenue</div>
              <div className="text-xl font-bold text-foreground">£{(supplier.total_revenue ?? 0).toLocaleString()}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase text-muted-foreground tracking-wider">Supplier cost</div>
              <div className="text-xl font-bold text-foreground">£{(supplier.total_supplier_cost ?? 0).toLocaleString()}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase text-muted-foreground tracking-wider">Commission</div>
              <div className="text-xl font-bold text-primary">
                £{(supplier.total_commission ?? 0).toLocaleString()}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase text-muted-foreground tracking-wider">Margin</div>
              <div className={`text-xl font-bold ${(supplier.total_margin ?? 0) >= 0 ? "text-green-400" : "text-destructive"}`}>
                £{(supplier.total_margin ?? 0).toLocaleString()}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Contact + location */}
      <Card className="bg-card border-border">
        <CardContent className="p-6 space-y-4">
          <h3 className="text-sm font-bold text-foreground uppercase tracking-wider">Contact</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <Label>Contact name</Label>
              <Input value={edit.contact_name ?? ""} onChange={e => setEdit({ ...edit, contact_name: e.target.value })} />
            </div>
            <div>
              <Label>WhatsApp</Label>
              <Input value={edit.whatsapp ?? ""} onChange={e => setEdit({ ...edit, whatsapp: e.target.value })} placeholder="+44…" />
            </div>
            <div>
              <Label>Phone</Label>
              <Input value={edit.phone ?? ""} onChange={e => setEdit({ ...edit, phone: e.target.value })} />
            </div>
            <div>
              <Label>Email</Label>
              <Input value={edit.email ?? ""} onChange={e => setEdit({ ...edit, email: e.target.value })} />
            </div>
            <div className="md:col-span-2">
              <Label>Address</Label>
              <Input value={edit.address ?? ""} onChange={e => setEdit({ ...edit, address: e.target.value })} />
            </div>
            <div>
              <Label>City</Label>
              <Input value={edit.city ?? ""} onChange={e => setEdit({ ...edit, city: e.target.value })} />
            </div>
            <div>
              <Label>Country</Label>
              <Input value={edit.country ?? ""} onChange={e => setEdit({ ...edit, country: e.target.value })} />
            </div>
            <div>
              <Label>Website</Label>
              <Input value={edit.website ?? ""} onChange={e => setEdit({ ...edit, website: e.target.value })} placeholder="https://…" />
            </div>
            <div>
              <Label>Rating (0-5)</Label>
              <Input type="number" min={0} max={5} step={0.5} value={edit.rating ?? ""} onChange={e => setEdit({ ...edit, rating: e.target.value })} />
            </div>
          </div>
          <div>
            <Label>Notes</Label>
            <Textarea
              value={edit.notes ?? ""}
              onChange={e => setEdit({ ...edit, notes: e.target.value })}
              rows={3}
              placeholder="Rate card, payment terms, preferred vehicles, special instructions…"
            />
          </div>
        </CardContent>
      </Card>

      {/* Products (cars / drivers / other services) */}
      <SupplierProductsSection
        supplierId={id!}
        products={supplier.products ?? []}
        onChange={(next) => setSupplier({ ...supplier, products: next })}
      />

      {/* Feature 5 — Supplier Balance Tracker */}
      <SupplierBalanceTracker
        supplierId={id!}
        bookings={supplier.bookings ?? []}
        onChanged={async () => {
          const res = await authedFetch(`/api/suppliers/${id}`);
          if (res.ok) setSupplier(await res.json());
        }}
      />

      {id && (
        <ActivityPanel
          entityType="supplier"
          entityId={id}
          description="Recent audit entries for this supplier."
        />
      )}

      {/* Danger zone */}
      <div className="flex justify-end">
        <AlertDialog open={deactivateOpen} onOpenChange={setDeactivateOpen}>
          <AlertDialogTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive hover:bg-destructive/10"
              data-testid="button-deactivate-supplier"
            >
              <Trash2 className="w-4 h-4 mr-1.5" /> Deactivate supplier
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Deactivate this supplier?</AlertDialogTitle>
              <AlertDialogDescription>
                They will be hidden from new-booking pickers but existing bookings
                remain linked. This cannot be undone from the app.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel data-testid="button-keep-supplier">Keep supplier</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={performDeactivate}
                data-testid="button-confirm-deactivate-supplier"
              >
                Yes, Deactivate
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}

// ─── Supplier Balance Tracker ─────────────────────────────────────────────
// Lists every booking linked to this supplier with supplier_cost > 0 so the
// operator can see who they owe (or have already paid). Supports:
//   - Date range filter (date_time)
//   - Status filter (all / outstanding / paid)
//   - Per-row mark paid / unmark paid
//   - Bulk mark paid with optional payment reference
//   - Running totals: invoiced (£), paid (£), outstanding (£)
function SupplierBalanceTracker({
  supplierId,
  bookings,
  onChanged,
}: {
  supplierId: string;
  bookings: any[];
  onChanged: () => Promise<void> | void;
}) {
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<"all" | "outstanding" | "paid">("outstanding");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [paymentRef, setPaymentRef] = useState("");
  const [busy, setBusy] = useState(false);

  // Only bookings that actually represent a supplier liability appear here.
  // No supplier_cost = nothing to pay = nothing to track. Cancelled jobs
  // are excluded so they don't inflate the Invoiced/Outstanding totals.
  const billable = useMemo(
    () => (bookings ?? []).filter(
      (b: any) => Number(b.supplier_cost ?? 0) > 0 && b.status !== "Cancelled",
    ),
    [bookings],
  );

  // Months that have at least one billable booking — feeds the From/To
  // dropdowns so operators only see options that actually contain data.
  // Sorted oldest → newest. Each option value is `yyyy-MM` (e.g. "2026-04").
  const monthOptions = useMemo(() => {
    const set = new Set<string>();
    for (const b of billable) {
      if (!b.date_time) continue;
      const d = new Date(b.date_time);
      if (Number.isNaN(d.getTime())) continue;
      const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      set.add(ym);
    }
    return Array.from(set)
      .sort()
      .map(ym => {
        const [y, m] = ym.split("-").map(Number);
        const label = new Date(y, m - 1, 1).toLocaleDateString("en-GB", { month: "short", year: "numeric" });
        return { value: ym, label };
      });
  }, [billable]);

  // Convert "yyyy-MM" → first day / last day strings used by the existing
  // date-range filter logic below so the rest of the component is unchanged.
  const fromDate = useMemo(() => from ? `${from}-01` : "", [from]);
  const toDate = useMemo(() => {
    if (!to) return "";
    const [y, m] = to.split("-").map(Number);
    const last = new Date(y, m, 0).getDate();
    return `${to}-${String(last).padStart(2, "0")}`;
  }, [to]);

  const filtered = useMemo(() => {
    return billable.filter((b: any) => {
      if (fromDate && b.date_time && new Date(b.date_time) < new Date(fromDate)) return false;
      if (toDate && b.date_time && new Date(b.date_time) > new Date(toDate + "T23:59:59")) return false;
      if (statusFilter === "paid"        && !b.supplier_paid_at) return false;
      if (statusFilter === "outstanding" && b.supplier_paid_at)  return false;
      return true;
    });
  }, [billable, fromDate, toDate, statusFilter]);

  const totals = useMemo(() => {
    let invoiced = 0, paid = 0, outstanding = 0;
    for (const b of filtered) {
      const c = Number(b.supplier_cost || 0);
      invoiced += c;
      if (b.supplier_paid_at) paid += c; else outstanding += c;
    }
    return { invoiced, paid, outstanding };
  }, [filtered]);

  // Reset any selections that aren't present in the current view (e.g. after
  // toggling status filter to "paid" — the previously-selected outstanding
  // rows should drop out so a bulk action only ever hits visible rows).
  useEffect(() => {
    const visible = new Set(filtered.map((b: any) => b.id));
    setSelected(prev => {
      const next = new Set<string>();
      for (const id of prev) if (visible.has(id)) next.add(id);
      return next;
    });
  }, [filtered]);

  const toggleAll = (on: boolean) => {
    if (!on) { setSelected(new Set()); return; }
    setSelected(new Set(filtered.filter((b: any) => !b.supplier_paid_at).map((b: any) => b.id)));
  };

  const markPaid = async (ids: string[]) => {
    if (ids.length === 0) { toast.error("Select at least one booking"); return; }
    setBusy(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`/api/suppliers/${supplierId}/balance/mark-paid`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ booking_ids: ids, payment_ref: paymentRef.trim() || null }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      const j = await res.json();
      toast.success(`Marked ${j.updated} booking${j.updated === 1 ? "" : "s"} paid`);
      setSelected(new Set());
      setPaymentRef("");
      await onChanged();
    } catch (e: any) {
      toast.error(e.message || "Failed to mark paid");
    } finally {
      setBusy(false);
    }
  };

  const unmarkPaid = async (id: string) => {
    if (!confirm("Revert this booking to unpaid?")) return;
    setBusy(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`/api/suppliers/${supplierId}/balance/unmark-paid`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ booking_ids: [id] }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || `HTTP ${res.status}`);
      toast.success("Reverted to unpaid");
      await onChanged();
    } catch (e: any) {
      toast.error(e.message || "Failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="bg-card border-border">
      <CardContent className="p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-foreground uppercase tracking-wider flex items-center gap-2">
            <Receipt className="w-4 h-4" /> Supplier balance
          </h3>
          <div className="text-[11px] text-muted-foreground">{filtered.length} of {billable.length} bookings</div>
        </div>

        {/* Totals strip */}
        <div className="grid grid-cols-3 gap-2">
          <div className="p-3 rounded-lg border border-border bg-secondary/10">
            <div className="text-[10px] uppercase text-muted-foreground tracking-wider">Invoiced</div>
            <div className="text-lg font-bold text-foreground">£{totals.invoiced.toLocaleString()}</div>
          </div>
          <div className="p-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5">
            <div className="text-[10px] uppercase text-emerald-300 tracking-wider">Paid</div>
            <div className="text-lg font-bold text-emerald-400">£{totals.paid.toLocaleString()}</div>
          </div>
          <div className={`p-3 rounded-lg border ${totals.outstanding > 0 ? "border-amber-500/40 bg-amber-500/5" : "border-border bg-secondary/10"}`}>
            <div className={`text-[10px] uppercase tracking-wider ${totals.outstanding > 0 ? "text-amber-300" : "text-muted-foreground"}`}>Outstanding</div>
            <div className={`text-lg font-bold ${totals.outstanding > 0 ? "text-amber-400" : "text-foreground"}`}>£{totals.outstanding.toLocaleString()}</div>
          </div>
        </div>

        {/* Filters — From/To are now month dropdowns populated from the
            supplier's actual billable bookings so operators can't pick a
            month that has no data. "Any" clears the bound on that side. */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 items-end">
          <div>
            <Label className="text-[10px] uppercase text-muted-foreground">From month</Label>
            <Select value={from || "__any__"} onValueChange={v => setFrom(v === "__any__" ? "" : v)}>
              <SelectTrigger data-testid="select-balance-from-month">
                <SelectValue placeholder="Any" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__any__">Any (earliest)</SelectItem>
                {monthOptions.map(o => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[10px] uppercase text-muted-foreground">To month</Label>
            <Select value={to || "__any__"} onValueChange={v => setTo(v === "__any__" ? "" : v)}>
              <SelectTrigger data-testid="select-balance-to-month">
                <SelectValue placeholder="Any" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__any__">Any (latest)</SelectItem>
                {monthOptions.map(o => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2 sm:col-span-2 flex gap-1">
            {(["outstanding","paid","all"] as const).map(s => (
              <Button key={s} type="button" size="sm"
                variant={statusFilter === s ? "default" : "outline"}
                onClick={() => setStatusFilter(s)}
                className="flex-1 capitalize"
                data-testid={`btn-balance-filter-${s}`}>
                {s}
              </Button>
            ))}
          </div>
        </div>

        {/* Bulk actions bar */}
        {selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 p-2 rounded-md border border-primary/30 bg-primary/5">
            <span className="text-xs font-medium">{selected.size} selected</span>
            <Input
              placeholder="Payment ref (optional)"
              value={paymentRef}
              onChange={e => setPaymentRef(e.target.value)}
              className="h-8 max-w-[200px]"
              data-testid="input-supplier-payment-ref"
            />
            <Button size="sm" disabled={busy}
              onClick={() => markPaid(Array.from(selected))}
              data-testid="btn-bulk-mark-paid">
              <PoundSterling className="w-3.5 h-3.5 mr-1" />
              Mark {selected.size} paid
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
          </div>
        )}

        {/* Booking rows */}
        {filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            {billable.length === 0
              ? "No supplier-billable bookings yet."
              : "No bookings match the current filters."}
          </p>
        ) : (
          <div className="space-y-1.5">
            {/* Select-all header */}
            <div className="flex items-center gap-2 px-2 py-1 text-[11px] text-muted-foreground">
              <Checkbox
                checked={selected.size > 0 && selected.size === filtered.filter((b: any) => !b.supplier_paid_at).length}
                onCheckedChange={(v) => toggleAll(!!v)}
                data-testid="checkbox-select-all"
              />
              <span>Select all unpaid</span>
            </div>
            {filtered.map((b: any) => {
              const isPaid = !!b.supplier_paid_at;
              const isSelected = selected.has(b.id);
              return (
                <div key={b.id}
                  className={`flex items-center gap-3 p-3 rounded-lg border transition-all
                    ${isPaid ? "border-emerald-500/20 bg-emerald-500/5"
                            : "border-border hover:border-primary/40 hover:bg-secondary/10"}`}>
                  <Checkbox
                    checked={isSelected}
                    disabled={isPaid}
                    onCheckedChange={(v) => {
                      const next = new Set(selected);
                      if (v) next.add(b.id); else next.delete(b.id);
                      setSelected(next);
                    }}
                    data-testid={`checkbox-balance-${b.id}`}
                  />
                  <Link href={`/bookings/${b.id}`} className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs text-muted-foreground">{b.tvl_ref}</span>
                      <Badge variant="outline" className="text-[10px] py-0 px-1.5">{b.service_type}</Badge>
                      {isPaid && <Badge className="text-[10px] py-0 px-1.5 bg-emerald-500/20 text-emerald-300 border-emerald-500/40">Paid</Badge>}
                    </div>
                    <div className="text-sm font-medium text-foreground mt-0.5 truncate">{b.client_name ?? "—"}</div>
                    {b.date_time && (
                      <div className="text-[11px] text-muted-foreground">
                        {format(new Date(b.date_time), "EEE d MMM yyyy")}
                        {isPaid && b.supplier_paid_at && (
                          <> · paid {format(new Date(b.supplier_paid_at), "d MMM")}{b.supplier_payment_ref ? ` · ref ${b.supplier_payment_ref}` : ""}</>
                        )}
                      </div>
                    )}
                  </Link>
                  <div className="text-right shrink-0">
                    <div className="text-sm font-bold text-foreground">£{Number(b.supplier_cost ?? 0).toLocaleString()}</div>
                    {isPaid ? (
                      <Button type="button" size="sm" variant="ghost" className="h-6 px-2 text-[11px]"
                        onClick={() => unmarkPaid(b.id)} disabled={busy}
                        data-testid={`btn-unmark-${b.id}`}>
                        <Undo2 className="w-3 h-3 mr-1" /> Unmark
                      </Button>
                    ) : (
                      <Button type="button" size="sm" variant="outline" className="h-6 px-2 text-[11px]"
                        onClick={() => markPaid([b.id])} disabled={busy}
                        data-testid={`btn-mark-${b.id}`}>
                        Mark paid
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Products section (inline) ───────────────────────────────────────────
type Product = {
  id: string;
  name: string;
  kind: "Car" | "Driver" | "Meet & Greet" | "Fast-Track" | "Lounge" | "Porter" | "Other";
  daily_rate: number | null;
  hourly_rate: number | null;
  plate: string | null;
  notes: string | null;
  is_active: boolean;
};

// All product kinds in display order. Cars/Drivers cover Car Rental;
// Meet & Greet / Fast-Track / Lounge / Porter cover airport-internal
// services for Airport Transfer suppliers (e.g. LHR VIP Services).
const PRODUCT_KINDS: Array<Product["kind"]> = [
  "Car", "Driver", "Meet & Greet", "Fast-Track", "Lounge", "Porter", "Other",
];

function emptyDraft(): Partial<Product> {
  return { name: "", kind: "Car", daily_rate: null, hourly_rate: null, plate: "", notes: "", is_active: true };
}

function SupplierProductsSection({
  supplierId,
  products,
  onChange,
}: {
  supplierId: string;
  products: Product[];
  onChange: (next: Product[]) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Partial<Product>>(emptyDraft());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Partial<Product>>({});
  const [busy, setBusy] = useState(false);

  const startEdit = (p: Product) => {
    setEditingId(p.id);
    setEditDraft({ ...p });
  };

  const handleAdd = async () => {
    if (!draft.name?.trim()) {
      toast.error("Name is required");
      return;
    }
    setBusy(true);
    try {
      const res = await authedFetch(`/api/suppliers/${supplierId}/products`, {
        method: "POST",
        body: JSON.stringify(draft),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? "Failed to add");
      }
      const created = await res.json();
      onChange([created, ...products]);
      setDraft(emptyDraft());
      setAdding(false);
      toast.success("Product added");
    } catch (e: any) {
      toast.error(e.message ?? "Failed to add");
    } finally {
      setBusy(false);
    }
  };

  const handleSaveEdit = async () => {
    if (!editingId) return;
    if (!editDraft.name?.trim()) {
      toast.error("Name is required");
      return;
    }
    setBusy(true);
    try {
      const res = await authedFetch(`/api/suppliers/${supplierId}/products/${editingId}`, {
        method: "PATCH",
        body: JSON.stringify(editDraft),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? "Failed to save");
      }
      const updated = await res.json();
      onChange(products.map(p => (p.id === editingId ? updated : p)));
      setEditingId(null);
      setEditDraft({});
      toast.success("Product updated");
    } catch (e: any) {
      toast.error(e.message ?? "Failed to save");
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Remove "${name}" from this supplier?`)) return;
    setBusy(true);
    try {
      const res = await authedFetch(`/api/suppliers/${supplierId}/products/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed");
      onChange(products.filter(p => p.id !== id));
      toast.success("Removed");
    } catch {
      toast.error("Failed to remove");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="bg-card border-border">
      <CardContent className="p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-foreground uppercase tracking-wider flex items-center gap-2">
            <Package className="w-4 h-4" /> Products ({products.length})
          </h3>
          {!adding && (
            <Button size="sm" onClick={() => setAdding(true)}>
              <Plus className="w-4 h-4 mr-1.5" /> Add product
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Cars, drivers, Meet &amp; Greet, Fast-Track, Lounge, Porter and any other items this supplier provides. These appear in the supplier-product picker on Car Rental, As Directed, and Airport Transfer bookings.
        </p>

        {adding && (
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-2">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div>
                <Label className="text-xs">Name</Label>
                <Input value={draft.name ?? ""} onChange={e => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Range Rover Vogue" />
              </div>
              <div>
                <Label className="text-xs">Kind</Label>
                <select
                  value={draft.kind ?? "Car"}
                  onChange={e => setDraft({ ...draft, kind: e.target.value as any })}
                  className="w-full h-9 rounded-md border border-border bg-background px-2 text-sm"
                >
                  {PRODUCT_KINDS.map(k => <option key={k} value={k}>{k}</option>)}
                </select>
              </div>
              {(draft.kind === "Car" || draft.kind === "Driver") ? (
                <>
                  <div>
                    <Label className="text-xs">Daily rate £</Label>
                    <Input type="number" step="0.01" min="0" value={draft.daily_rate ?? ""} onChange={e => setDraft({ ...draft, daily_rate: e.target.value === "" ? null : Number(e.target.value) })} />
                  </div>
                  <div>
                    <Label className="text-xs">Hourly rate £</Label>
                    <Input type="number" step="0.01" min="0" value={draft.hourly_rate ?? ""} onChange={e => setDraft({ ...draft, hourly_rate: e.target.value === "" ? null : Number(e.target.value) })} />
                  </div>
                  <div className="sm:col-span-2">
                    <Label className="text-xs">Plate / ref (optional)</Label>
                    <Input value={draft.plate ?? ""} onChange={e => setDraft({ ...draft, plate: e.target.value })} />
                  </div>
                </>
              ) : (
                <div className="sm:col-span-2">
                  <Label className="text-xs">Price £</Label>
                  <Input type="number" step="0.01" min="0" placeholder="e.g. 250" value={draft.daily_rate ?? ""} onChange={e => setDraft({ ...draft, daily_rate: e.target.value === "" ? null : Number(e.target.value), hourly_rate: null, plate: "" })} />
                </div>
              )}
              <div className="sm:col-span-2">
                <Label className="text-xs">Notes (optional)</Label>
                <Input value={draft.notes ?? ""} onChange={e => setDraft({ ...draft, notes: e.target.value })} />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" size="sm" onClick={() => { setAdding(false); setDraft(emptyDraft()); }}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleAdd} disabled={busy}>
                <Check className="w-4 h-4 mr-1.5" /> Save
              </Button>
            </div>
          </div>
        )}

        {products.length === 0 && !adding && (
          <p className="text-sm text-muted-foreground py-4 text-center">No products yet.</p>
        )}

        <div className="space-y-2">
          {products.map((p) => (
            <div key={p.id} className={`rounded-lg border p-3 ${p.is_active ? "border-border bg-secondary/10" : "border-border/40 bg-secondary/5 opacity-60"}`}>
              {editingId === p.id ? (
                <div className="space-y-2">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <div>
                      <Label className="text-xs">Name</Label>
                      <Input value={editDraft.name ?? ""} onChange={e => setEditDraft({ ...editDraft, name: e.target.value })} />
                    </div>
                    <div>
                      <Label className="text-xs">Kind</Label>
                      <select
                        value={editDraft.kind ?? "Car"}
                        onChange={e => setEditDraft({ ...editDraft, kind: e.target.value as any })}
                        className="w-full h-9 rounded-md border border-border bg-background px-2 text-sm"
                      >
                        {PRODUCT_KINDS.map(k => <option key={k} value={k}>{k}</option>)}
                      </select>
                    </div>
                    {(editDraft.kind === "Car" || editDraft.kind === "Driver") ? (
                      <>
                        <div>
                          <Label className="text-xs">Daily £</Label>
                          <Input type="number" step="0.01" min="0" value={editDraft.daily_rate ?? ""} onChange={e => setEditDraft({ ...editDraft, daily_rate: e.target.value === "" ? null : Number(e.target.value) })} />
                        </div>
                        <div>
                          <Label className="text-xs">Hourly £</Label>
                          <Input type="number" step="0.01" min="0" value={editDraft.hourly_rate ?? ""} onChange={e => setEditDraft({ ...editDraft, hourly_rate: e.target.value === "" ? null : Number(e.target.value) })} />
                        </div>
                        <div className="sm:col-span-2">
                          <Label className="text-xs">Plate</Label>
                          <Input value={editDraft.plate ?? ""} onChange={e => setEditDraft({ ...editDraft, plate: e.target.value })} />
                        </div>
                      </>
                    ) : (
                      <div className="sm:col-span-2">
                        <Label className="text-xs">Price £</Label>
                        <Input type="number" step="0.01" min="0" placeholder="e.g. 250" value={editDraft.daily_rate ?? ""} onChange={e => setEditDraft({ ...editDraft, daily_rate: e.target.value === "" ? null : Number(e.target.value), hourly_rate: null, plate: "" })} />
                      </div>
                    )}
                    <div className="sm:col-span-2">
                      <Label className="text-xs">Notes</Label>
                      <Input value={editDraft.notes ?? ""} onChange={e => setEditDraft({ ...editDraft, notes: e.target.value })} />
                    </div>
                  </div>
                  <div className="flex items-center justify-between pt-1">
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={!!editDraft.is_active}
                        onChange={e => setEditDraft({ ...editDraft, is_active: e.target.checked })}
                      />
                      Active
                    </label>
                    <div className="flex gap-2">
                      <Button variant="ghost" size="sm" onClick={() => { setEditingId(null); setEditDraft({}); }}>
                        <X className="w-4 h-4 mr-1" /> Cancel
                      </Button>
                      <Button size="sm" onClick={handleSaveEdit} disabled={busy}>
                        <Check className="w-4 h-4 mr-1" /> Save
                      </Button>
                    </div>
                  </div>
                  {/* Per-product activity feed — surfaces add/edit/remove
                      audit rows for this specific supplier_product so the
                      operator doesn't have to leave the supplier page to
                      see who last touched it. */}
                  <ActivityPanel
                    entityType="supplier_product"
                    entityId={p.id}
                    title="Product activity"
                    description="Recent changes to this product."
                    limit={10}
                  />
                </div>
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="outline" className="text-[10px] py-0 px-1.5">{p.kind}</Badge>
                      <span className="font-semibold text-foreground">{p.name}</span>
                      {p.plate && <span className="text-xs text-muted-foreground font-mono">{p.plate}</span>}
                      {!p.is_active && <Badge variant="outline" className="text-[10px] py-0 px-1.5 border-amber-500/40 text-amber-400">Inactive</Badge>}
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-3">
                      {(p.kind === "Car" || p.kind === "Driver") ? (
                        <>
                          {p.daily_rate != null && <span>£{Number(p.daily_rate).toLocaleString()}/day</span>}
                          {p.hourly_rate != null && <span>£{Number(p.hourly_rate).toLocaleString()}/hr</span>}
                        </>
                      ) : (
                        p.daily_rate != null && <span>£{Number(p.daily_rate).toLocaleString()}</span>
                      )}
                      {p.notes && <span className="truncate">{p.notes}</span>}
                    </div>
                  </div>
                  <div className="flex gap-1 flex-shrink-0">
                    <Button variant="ghost" size="sm" onClick={() => startEdit(p)} className="h-8 w-8 p-0">
                      <Pencil className="w-4 h-4" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => handleDelete(p.id, p.name)} className="h-8 w-8 p-0 text-destructive hover:text-destructive">
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
