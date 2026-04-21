import { useEffect, useState } from "react";
import { useRoute, Link, useLocation } from "wouter";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  ArrowLeft, Building2, Phone, Mail, MessageCircle, Save, Trash2,
  MapPin, Globe, Star, Briefcase, Package, Plus, Pencil, Check, X,
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

const CATEGORIES = [
  "Car Rental", "Hotel", "Apartment", "Tour Operator",
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

      {/* Recent bookings */}
      <Card className="bg-card border-border">
        <CardContent className="p-6 space-y-3">
          <h3 className="text-sm font-bold text-foreground uppercase tracking-wider flex items-center gap-2">
            <Briefcase className="w-4 h-4" /> Recent bookings
          </h3>
          {(supplier.bookings ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No bookings linked to this supplier yet.</p>
          ) : (
            <div className="space-y-2">
              {supplier.bookings.map((b: any) => (
                <Link key={b.id} href={`/bookings/${b.id}`}>
                  <div className="flex items-center justify-between p-3 rounded-lg border border-border hover:border-primary/40 hover:bg-secondary/10 cursor-pointer transition-all">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-muted-foreground">{b.tvl_ref}</span>
                        <Badge variant="outline" className="text-[10px] py-0 px-1.5">{b.service_type}</Badge>
                        <Badge variant="outline" className="text-[10px] py-0 px-1.5">{b.status}</Badge>
                      </div>
                      <div className="text-sm font-medium text-foreground mt-0.5">{b.client_name ?? "—"}</div>
                      {b.date_time && (
                        <div className="text-[11px] text-muted-foreground">
                          {format(new Date(b.date_time), "EEE d MMM yyyy HH:mm")}
                        </div>
                      )}
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-semibold text-primary">£{(b.price ?? 0).toLocaleString()}</div>
                      {b.supplier_cost ? (
                        <div className="text-[11px] text-muted-foreground">cost £{b.supplier_cost.toLocaleString()}</div>
                      ) : null}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Danger zone */}
      <div className="flex justify-end">
        <Button variant="outline" onClick={handleDeactivate} className="text-destructive border-destructive/30 hover:bg-destructive/10">
          <Trash2 className="w-4 h-4 mr-2" /> Deactivate supplier
        </Button>
      </div>
    </div>
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
