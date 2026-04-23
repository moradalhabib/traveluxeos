import { useEffect, useMemo, useState } from "react";
import { useRoute, Link, useLocation } from "wouter";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ArrowLeft, Building2, Phone, Mail, MessageCircle, Save, Trash2,
  MapPin, Globe, Star, Briefcase, Package, Plus, Pencil, Check, X,
  PoundSterling, Receipt, Undo2,
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

const CATEGORIES = [
  "Airport Transfer", "Car Rental", "Hotel", "Apartment", "Tour Operator",
  "Restaurant", "Concierge", "Yacht", "Helicopter", "Other",
];

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
    setSaving(true);
    try {
      const res = await authedFetch(`/api/suppliers/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: edit.name,
          category: edit.category,
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

  const handleDeactivate = async () => {
    if (!confirm("Deactivate this supplier? They will be hidden from new-booking pickers but existing bookings remain linked.")) return;
    try {
      const res = await authedFetch(`/api/suppliers/${id}`, { method: "DELETE" });
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
          <Button onClick={handleSave} disabled={saving}>
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
                <select
                  value={edit.category ?? "Other"}
                  onChange={e => setEdit({ ...edit, category: e.target.value })}
                  className="text-xs bg-primary/5 border border-primary/30 text-primary rounded px-2 py-0.5"
                >
                  {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
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

      {/* Danger zone */}
      <div className="flex justify-end">
        <Button variant="outline" onClick={handleDeactivate} className="text-destructive border-destructive/30 hover:bg-destructive/10">
          <Trash2 className="w-4 h-4 mr-2" /> Deactivate supplier
        </Button>
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
  // No supplier_cost = nothing to pay = nothing to track.
  const billable = useMemo(
    () => (bookings ?? []).filter((b: any) => Number(b.supplier_cost ?? 0) > 0),
    [bookings],
  );

  const filtered = useMemo(() => {
    return billable.filter((b: any) => {
      if (from && b.date_time && new Date(b.date_time) < new Date(from)) return false;
      if (to && b.date_time && new Date(b.date_time) > new Date(to + "T23:59:59")) return false;
      if (statusFilter === "paid"        && !b.supplier_paid_at) return false;
      if (statusFilter === "outstanding" && b.supplier_paid_at)  return false;
      return true;
    });
  }, [billable, from, to, statusFilter]);

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

        {/* Filters */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 items-end">
          <div>
            <Label className="text-[10px] uppercase text-muted-foreground">From</Label>
            <Input type="date" value={from} onChange={e => setFrom(e.target.value)} />
          </div>
          <div>
            <Label className="text-[10px] uppercase text-muted-foreground">To</Label>
            <Input type="date" value={to} onChange={e => setTo(e.target.value)} />
          </div>
          <div className="sm:col-span-2 flex gap-1">
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
  kind: "Car" | "Driver" | "Other";
  daily_rate: number | null;
  hourly_rate: number | null;
  plate: string | null;
  notes: string | null;
  is_active: boolean;
};

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
          Cars, drivers and any other items this supplier provides. These appear in the supplier-product picker on Car Rental and As Directed bookings.
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
                  <option value="Car">Car</option>
                  <option value="Driver">Driver</option>
                  <option value="Other">Other</option>
                </select>
              </div>
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
                        <option value="Car">Car</option>
                        <option value="Driver">Driver</option>
                        <option value="Other">Other</option>
                      </select>
                    </div>
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
                      {p.daily_rate != null && <span>£{Number(p.daily_rate).toLocaleString()}/day</span>}
                      {p.hourly_rate != null && <span>£{Number(p.hourly_rate).toLocaleString()}/hr</span>}
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
