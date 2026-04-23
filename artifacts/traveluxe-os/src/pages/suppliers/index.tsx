import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Building2, Plus, Phone, Mail, MessageCircle, Search as SearchIcon, MapPin, Star, CheckSquare, X as XIcon } from "lucide-react";
import { FilterDropdown, useFilterState } from "@/components/ui/filter-dropdown";
import { ActiveFilterChips, type ActiveFilter } from "@/components/ui/active-filter-chips";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { useBulkSelect } from "@/hooks/use-bulk-select";
import { BulkActionBar } from "@/components/bulk-action-bar";

const CATEGORIES = [
  "Airport Transfer", "Car Rental", "Hotel", "Apartment", "Tour Operator",
  "Restaurant", "Concierge", "Yacht", "Helicopter", "Other",
];

interface Supplier {
  id: string;
  name: string;
  category: string;
  contact_name?: string;
  whatsapp?: string;
  phone?: string;
  email?: string;
  city?: string;
  country?: string;
  rating?: number;
  is_active: boolean;
  bookings_count?: number;
}

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

export default function SuppliersList() {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const canBulkDelete = user?.role === "admin" || user?.role === "super_admin";
  const bulk = useBulkSelect();
  const queryClient = useQueryClient();
  const [items, setItems] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  // URL-backed filters so a refresh / shared link restores the same view.
  const [search, setSearch] = useFilterState("q", "");
  const [category, setCategory] = useFilterState("category", "all");
  const [inactiveFlag, setInactiveFlag] = useFilterState<"0" | "1">("inactive", "0");
  const showInactive = inactiveFlag === "1";
  const setShowInactive = (v: boolean) => setInactiveFlag(v ? "1" : "0");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>({ name: "", category: "Car Rental" });
  const [saving, setSaving] = useState(false);

  const handleBulkDelete = async () => {
    const ids = bulk.ids;
    const results = await Promise.allSettled(
      ids.map(async (id) => {
        const r = await authedFetch(`/api/suppliers/${id}`, { method: "DELETE" });
        if (!r.ok) throw new Error(String(r.status));
        const body = await r.json().catch(() => ({}));
        return body as { deleted?: boolean; deactivated?: boolean; reason?: string };
      })
    );
    let deleted = 0, deactivated = 0, failed = 0;
    for (const r of results) {
      if (r.status !== "fulfilled") { failed++; continue; }
      if (r.value.deleted) deleted++;
      else if (r.value.deactivated) deactivated++;
      else deleted++; // legacy/unknown success → assume deleted
    }
    let msg: string;
    if (deactivated > 0 && deleted === 0 && failed === 0) {
      msg = `Deactivated — ${deactivated} supplier${deactivated === 1 ? "" : "s"} had bookings`;
    } else {
      const parts: string[] = [];
      if (deleted) parts.push(`${deleted} deleted`);
      if (deactivated) parts.push(`${deactivated} deactivated (linked to bookings)`);
      if (failed) parts.push(`${failed} failed`);
      msg = parts.join(", ") || "No changes";
    }
    if (failed > 0) toast.error(msg);
    else if (deactivated > 0 && deleted === 0) toast.warning(msg);
    else toast.success(msg);
    bulk.exitSelectMode();
    load();
    queryClient.invalidateQueries();
  };

  const load = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (category !== "all") params.set("category", category);
      if (search) params.set("search", search);
      if (showInactive) params.set("include_inactive", "1");
      const res = await authedFetch(`/api/suppliers?${params.toString()}`);
      const data = await res.json();
      setItems(Array.isArray(data) ? data : []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [category, showInactive]);
  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line
  }, [search]);

  const handleCreate = async () => {
    if (!form.name?.trim()) {
      toast.error("Supplier name is required");
      return;
    }
    setSaving(true);
    try {
      const res = await authedFetch("/api/suppliers", {
        method: "POST",
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? "Failed to create supplier");
      }
      const created = await res.json();
      toast.success(`Supplier "${created.name}" created`);
      setOpen(false);
      setForm({ name: "", category: "Car Rental" });
      setLocation(`/suppliers/${created.id}`);
    } catch (e: any) {
      toast.error(e.message ?? "Failed to create supplier");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <Building2 className="w-6 h-6 text-primary" />
            Suppliers
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Car rental partners, hotels, apartments, tour operators and concierge contacts.
          </p>
        </div>
        <div className="flex gap-2">
          {canBulkDelete && (
            bulk.selectMode ? (
              <Button variant="outline" onClick={bulk.exitSelectMode} data-testid="button-cancel-select">
                <XIcon className="w-4 h-4 mr-2" /> Cancel
              </Button>
            ) : (
              <Button variant="outline" onClick={bulk.enterSelectMode} data-testid="button-select-mode">
                <CheckSquare className="w-4 h-4 mr-2" /> Select
              </Button>
            )
          )}
          {!bulk.selectMode && (
            <Button onClick={() => setOpen(true)} className="shadow-[0_0_15px_rgba(201,168,76,0.25)]">
              <Plus className="w-4 h-4 mr-2" />
              New Supplier
            </Button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <SearchIcon className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name, contact, city, phone…"
            className="pl-9"
          />
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          <FilterDropdown
            label="Category:"
            value={category}
            onChange={setCategory}
            options={[
              { value: "all", label: "All categories" },
              ...CATEGORIES.map((c) => ({ value: c, label: c })),
            ]}
            widthClass="w-48"
            testId="filter-suppliers-category"
          />
          <FilterDropdown
            label="Show:"
            value={showInactive ? "all" : "active"}
            onChange={(v) => setShowInactive(v === "all")}
            options={[
              { value: "active", label: "Active only" },
              { value: "all", label: "Including inactive" },
            ]}
            widthClass="w-44"
            testId="filter-suppliers-active"
          />
        </div>
      </div>

      {(() => {
        const chips: ActiveFilter[] = [];
        if (category !== "all") chips.push({ key: "category", label: "Category", value: category, onClear: () => setCategory("all") });
        if (showInactive) chips.push({ key: "show", label: "Show", value: "Including inactive", onClear: () => setShowInactive(false) });
        return <ActiveFilterChips filters={chips} onClearAll={() => { setCategory("all"); setShowInactive(false); }} />;
      })()}

      {/* Grid */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-44 rounded-xl" />)}
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center py-16 text-center border border-dashed border-border rounded-2xl">
          <Building2 className="w-10 h-10 text-muted-foreground/30 mb-3" />
          <p className="text-sm font-medium text-foreground">No suppliers yet</p>
          <p className="text-xs text-muted-foreground mt-1">
            Add your first supplier to start linking them to bookings.
          </p>
          <Button onClick={() => setOpen(true)} className="mt-5">
            <Plus className="w-4 h-4 mr-2" />
            New Supplier
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {items.map(s => {
            const wa = whatsappLink(s.whatsapp);
            const selected = bulk.isSelected(s.id);
            return (
              <Card
                key={s.id}
                className={`border-border transition-all bg-card cursor-pointer ${!s.is_active ? "opacity-60" : ""} ${
                  bulk.selectMode
                    ? (selected ? "ring-2 ring-primary border-primary" : "hover:border-primary/40")
                    : "hover:border-primary/40 hover:bg-secondary/10"
                }`}
                onClick={() => bulk.selectMode ? bulk.toggle(s.id) : setLocation(`/suppliers/${s.id}`)}
                data-testid={bulk.selectMode ? `select-supplier-${s.id}` : undefined}
              >
                <CardContent className="p-5 space-y-3">
                  <div className="flex justify-between items-start gap-2">
                    <div className="min-w-0 flex items-start gap-3">
                      {bulk.selectMode && (
                        <div className={`mt-1 flex-shrink-0 w-5 h-5 rounded border-2 flex items-center justify-center ${selected ? "bg-primary border-primary" : "border-muted-foreground/40"}`}>
                          {selected && <CheckSquare className="w-3 h-3 text-primary-foreground" />}
                        </div>
                      )}
                      <div className="min-w-0">
                      <div className="font-bold text-lg text-foreground truncate">{s.name}</div>
                      {s.contact_name && (
                        <div className="text-xs text-muted-foreground truncate">{s.contact_name}</div>
                      )}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <Badge variant="outline" className="text-[10px] py-0 px-1.5 border-primary/30 text-primary bg-primary/5">
                        {s.category}
                      </Badge>
                      {!s.is_active && (
                        <Badge variant="outline" className="text-[9px] py-0 px-1.5 border-destructive/30 text-destructive bg-destructive/10">
                          Inactive
                        </Badge>
                      )}
                    </div>
                  </div>

                  {(s.city || s.country) && (
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <MapPin className="w-3 h-3" />
                      <span>{[s.city, s.country].filter(Boolean).join(", ")}</span>
                    </div>
                  )}

                  <div className="flex items-center justify-between pt-2 border-t border-border/50">
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      {s.bookings_count ? (
                        <span className="font-medium text-foreground">
                          {s.bookings_count} booking{s.bookings_count !== 1 ? "s" : ""}
                        </span>
                      ) : (
                        <span>No bookings yet</span>
                      )}
                      {s.rating && (
                        <span className="flex items-center gap-0.5 text-amber-400 font-medium">
                          <Star className="w-3 h-3 fill-current" />
                          {s.rating.toFixed(1)}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
                      {wa && (
                        <a
                          href={wa}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="w-8 h-8 rounded-full bg-green-500/10 hover:bg-green-500/20 text-green-400 flex items-center justify-center transition-colors"
                          title="WhatsApp"
                        >
                          <MessageCircle className="w-4 h-4" />
                        </a>
                      )}
                      {s.phone && (
                        <a
                          href={`tel:${s.phone}`}
                          className="w-8 h-8 rounded-full bg-secondary/40 hover:bg-secondary/60 text-foreground flex items-center justify-center transition-colors"
                          title="Call"
                        >
                          <Phone className="w-4 h-4" />
                        </a>
                      )}
                      {s.email && (
                        <a
                          href={`mailto:${s.email}`}
                          className="w-8 h-8 rounded-full bg-secondary/40 hover:bg-secondary/60 text-foreground flex items-center justify-center transition-colors"
                          title="Email"
                        >
                          <Mail className="w-4 h-4" />
                        </a>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Create dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New Supplier</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label>Name *</Label>
              <Input value={form.name ?? ""} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. London Chauffeurs Ltd" />
            </div>
            <div>
              <Label>Category</Label>
              <select
                value={form.category}
                onChange={e => setForm({ ...form, category: e.target.value })}
                className="w-full h-10 px-3 rounded-md bg-background border border-input text-sm"
              >
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Contact name</Label>
                <Input value={form.contact_name ?? ""} onChange={e => setForm({ ...form, contact_name: e.target.value })} />
              </div>
              <div>
                <Label>WhatsApp</Label>
                <Input value={form.whatsapp ?? ""} onChange={e => setForm({ ...form, whatsapp: e.target.value })} placeholder="+44…" />
              </div>
              <div>
                <Label>Phone</Label>
                <Input value={form.phone ?? ""} onChange={e => setForm({ ...form, phone: e.target.value })} />
              </div>
              <div>
                <Label>Email</Label>
                <Input value={form.email ?? ""} onChange={e => setForm({ ...form, email: e.target.value })} />
              </div>
              <div>
                <Label>City</Label>
                <Input value={form.city ?? ""} onChange={e => setForm({ ...form, city: e.target.value })} />
              </div>
              <div>
                <Label>Country</Label>
                <Input value={form.country ?? ""} onChange={e => setForm({ ...form, country: e.target.value })} />
              </div>
            </div>
            <div>
              <Label>Notes</Label>
              <Input value={form.notes ?? ""} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Rate card, terms, special instructions…" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={handleCreate} disabled={saving}>
              {saving ? "Saving…" : "Create supplier"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <BulkActionBar
        count={bulk.count}
        noun="supplier"
        onClear={bulk.clear}
        onDelete={handleBulkDelete}
      />
    </div>
  );
}
