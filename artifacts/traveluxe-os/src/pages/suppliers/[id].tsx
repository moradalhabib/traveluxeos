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
  MapPin, Globe, Star, Briefcase,
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
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 border-t border-border">
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
