import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Car, Sparkles, Grid3x3, Plus, Pencil, Trash2, Save, Loader2 } from "lucide-react";

type Product = {
  id: string;
  name: string;
  category: string;
  description: string | null;
  unit_price: number | null;
  active: boolean;
  service_types: string[] | null;
  sort_order: number | null;
};

type PriceRow = {
  id?: string;
  product_id: string;
  airport_code: string;
  airport_name: string | null;
  price: number | null;
  hourly_rate: number | null;
};

const AIRPORTS = [
  { code: "LHR", name: "Heathrow" },
  { code: "LGW", name: "Gatwick" },
  { code: "STN", name: "Stansted" },
  { code: "LTN", name: "Luton" },
  { code: "LCY", name: "London City" },
  { code: "OTHER", name: "Other / Custom" },
];

async function authHeader(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
}

export default function AirportPricingAdmin() {
  return (
    <div className="container mx-auto p-4 md:p-6 max-w-7xl">
      <div className="mb-4">
        <Link href="/admin">
          <Button variant="ghost" size="sm" className="mb-2" data-testid="button-back-admin">
            <ArrowLeft className="w-4 h-4 mr-2" /> Back to Admin
          </Button>
        </Link>
        <h1 className="text-2xl font-bold">Airport Transfer Pricing</h1>
        <p className="text-sm text-muted-foreground">
          Manage vehicles, per-airport prices, and Additional Services (Meet &amp; Greet, etc.) used on Airport Transfer bookings.
        </p>
      </div>

      <Tabs defaultValue="matrix" className="space-y-4">
        <TabsList>
          <TabsTrigger value="matrix" data-testid="tab-matrix"><Grid3x3 className="w-4 h-4 mr-1.5" />Price Matrix</TabsTrigger>
          <TabsTrigger value="vehicles" data-testid="tab-vehicles"><Car className="w-4 h-4 mr-1.5" />Vehicles</TabsTrigger>
          <TabsTrigger value="extras" data-testid="tab-extras"><Sparkles className="w-4 h-4 mr-1.5" />Additional Services</TabsTrigger>
        </TabsList>

        <TabsContent value="matrix"><PriceMatrixTab /></TabsContent>
        <TabsContent value="vehicles"><VehiclesTab /></TabsContent>
        <TabsContent value="extras"><ExtrasTab /></TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Price Matrix Tab ──────────────────────────────────────────────────────
function PriceMatrixTab() {
  const { toast } = useToast();
  const [vehicles, setVehicles] = useState<Product[]>([]);
  const [pricing, setPricing] = useState<Record<string, Record<string, number | null>>>({}); // [productId][code] = price
  const [drafts, setDrafts] = useState<Record<string, Record<string, string>>>({});
  const [loading, setLoading] = useState(true);
  const [savingCell, setSavingCell] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data: prods } = await supabase
      .from("products")
      .select("id, name, category, description, unit_price, active, service_types, sort_order")
      .eq("category", "Vehicle")
      .order("sort_order")
      .order("name");
    const { data: prices } = await supabase
      .from("vehicle_airport_pricing")
      .select("product_id, airport_code, price");
    const map: Record<string, Record<string, number | null>> = {};
    for (const r of (prices ?? []) as any[]) {
      (map[r.product_id] ??= {})[r.airport_code] = r.price == null ? null : Number(r.price);
    }
    setVehicles((prods ?? []) as Product[]);
    setPricing(map);
    setDrafts({});
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const setDraft = (pid: string, code: string, value: string) =>
    setDrafts(d => ({ ...d, [pid]: { ...(d[pid] ?? {}), [code]: value } }));

  const cellValue = (pid: string, code: string) => {
    const draft = drafts[pid]?.[code];
    if (draft !== undefined) return draft;
    const p = pricing[pid]?.[code];
    return p == null ? "" : String(p);
  };

  const save = async (pid: string, code: string) => {
    const raw = drafts[pid]?.[code];
    if (raw === undefined) return;
    const num = Number(raw);
    if (raw !== "" && (isNaN(num) || num < 0)) {
      toast({ title: "Invalid price", description: "Enter a non-negative number", variant: "destructive" });
      return;
    }
    setSavingCell(`${pid}:${code}`);
    const headers = { "Content-Type": "application/json", ...(await authHeader()) };
    const airport_name = AIRPORTS.find(a => a.code === code)?.name ?? code;
    const res = await fetch(`/api/products/${pid}/airport-pricing/${code}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ airport_name, price: raw === "" ? 0 : num }),
    });
    setSavingCell(null);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toast({ title: "Failed to save", description: j.error ?? `HTTP ${res.status}`, variant: "destructive" });
      return;
    }
    setPricing(prev => ({ ...prev, [pid]: { ...(prev[pid] ?? {}), [code]: raw === "" ? 0 : num } }));
    setDrafts(d => {
      const cp = { ...d };
      if (cp[pid]) {
        const inner = { ...cp[pid] };
        delete inner[code];
        cp[pid] = inner;
        if (Object.keys(inner).length === 0) delete cp[pid];
      }
      return cp;
    });
  };

  if (loading) return <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" />Loading matrix…</div>;

  if (vehicles.length === 0) {
    return (
      <Card>
        <CardContent className="p-6 text-center text-muted-foreground">
          No vehicles configured. Add vehicles in the <strong>Vehicles</strong> tab first.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Price per Airport per Vehicle (£)</CardTitle>
        <p className="text-xs text-muted-foreground">
          Set a different price for each airport. Press Enter or click Save to commit a cell. Leave blank or enter 0 to hide the vehicle for that airport.
        </p>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left p-2 font-semibold sticky left-0 bg-card">Vehicle</th>
              {AIRPORTS.map(a => (
                <th key={a.code} className="text-center p-2 font-semibold min-w-[120px]">
                  <div>{a.code}</div>
                  <div className="text-[10px] text-muted-foreground font-normal">{a.name}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {vehicles.map(v => (
              <tr key={v.id} className="border-b border-border/40 hover:bg-secondary/20">
                <td className="p-2 font-medium sticky left-0 bg-card">
                  <div className="flex items-center gap-2">
                    {v.name}
                    {!v.active && <Badge variant="outline" className="text-[10px]">Inactive</Badge>}
                  </div>
                </td>
                {AIRPORTS.map(a => {
                  const dirty = drafts[v.id]?.[a.code] !== undefined;
                  const isSaving = savingCell === `${v.id}:${a.code}`;
                  return (
                    <td key={a.code} className="p-1">
                      <div className="flex items-center gap-1">
                        <Input
                          type="number"
                          inputMode="decimal"
                          value={cellValue(v.id, a.code)}
                          onChange={e => setDraft(v.id, a.code, e.target.value)}
                          onKeyDown={e => { if (e.key === "Enter") save(v.id, a.code); }}
                          className={`h-8 text-sm ${dirty ? "border-amber-500/60" : ""}`}
                          placeholder="—"
                          data-testid={`price-${v.id}-${a.code}`}
                        />
                        {dirty && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 shrink-0"
                            onClick={() => save(v.id, a.code)}
                            disabled={isSaving}
                            data-testid={`save-${v.id}-${a.code}`}
                          >
                            {isSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                          </Button>
                        )}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

// ─── Vehicles Tab ──────────────────────────────────────────────────────────
function VehiclesTab() {
  return <ProductsCrudTab category="Vehicle" title="Vehicles" emptyHint="Add a vehicle (e.g. Mercedes V-Class)" requireAirportTransfer={true} />;
}

// ─── Extras Tab ────────────────────────────────────────────────────────────
function ExtrasTab() {
  return <ProductsCrudTab category={null} title="Additional Services" emptyHint="Add a service (e.g. Meet & Greet Diamond)" excludeCategory="Vehicle" requireAirportTransfer={true} />;
}

// ─── Generic CRUD for product rows ─────────────────────────────────────────
function ProductsCrudTab({
  category,
  title,
  emptyHint,
  excludeCategory,
  requireAirportTransfer,
}: {
  category: string | null;
  title: string;
  emptyHint: string;
  excludeCategory?: string;
  requireAirportTransfer?: boolean;
}) {
  const { toast } = useToast();
  const [items, setItems] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Product | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [deleting, setDeleting] = useState<Product | null>(null);

  const load = async () => {
    setLoading(true);
    let q = supabase
      .from("products")
      .select("id, name, category, description, unit_price, active, service_types, sort_order")
      .order("category")
      .order("sort_order")
      .order("name");
    if (category) q = q.eq("category", category);
    if (excludeCategory) q = q.neq("category", excludeCategory);
    const { data } = await q;
    let list = (data ?? []) as Product[];
    if (requireAirportTransfer) {
      list = list.filter(p =>
        !p.service_types
        || p.service_types.length === 0
        || p.service_types.includes("Airport Transfer")
      );
    }
    setItems(list);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const onSave = async (form: Partial<Product>) => {
    const headers = { "Content-Type": "application/json", ...(await authHeader()) };
    const body = {
      name: form.name,
      category: form.category ?? category ?? "Add-on",
      description: form.description ?? null,
      unit_price: form.unit_price ?? 0,
      active: form.active ?? true,
      sort_order: form.sort_order ?? 0,
    };
    const url = editing?.id ? `/api/products/${editing.id}` : "/api/products";
    const method = editing?.id ? "PUT" : "POST";
    const res = await fetch(url, { method, headers, body: JSON.stringify(body) });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toast({ title: "Save failed", description: j.error ?? `HTTP ${res.status}`, variant: "destructive" });
      return;
    }
    const saved = await res.json();
    // Ensure the saved product is tagged for Airport Transfer so it shows up
    // in the booking picker (the products POST/PUT endpoint doesn't currently
    // accept service_types, so we patch via supabase client).
    if (requireAirportTransfer) {
      const cur: string[] = saved.service_types ?? [];
      if (!cur.includes("Airport Transfer")) {
        await supabase
          .from("products")
          .update({ service_types: Array.from(new Set([...cur, "Airport Transfer"])) })
          .eq("id", saved.id);
      }
    }
    toast({ title: editing ? "Updated" : "Added", description: body.name });
    setShowForm(false);
    setEditing(null);
    await load();
  };

  const onDelete = async (p: Product) => {
    const headers = await authHeader();
    const res = await fetch(`/api/products/${p.id}`, { method: "DELETE", headers });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toast({ title: "Delete failed", description: j.error ?? `HTTP ${res.status}`, variant: "destructive" });
      return;
    }
    toast({ title: "Deleted", description: p.name });
    setDeleting(null);
    await load();
  };

  // Group rows by category for display
  const grouped = useMemo(() => {
    const map = new Map<string, Product[]>();
    for (const it of items) {
      const list = map.get(it.category) ?? [];
      list.push(it);
      map.set(it.category, list);
    }
    return Array.from(map.entries());
  }, [items]);

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="text-base">{title}</CardTitle>
        <Button size="sm" onClick={() => { setEditing(null); setShowForm(true); }} data-testid="button-add-product">
          <Plus className="w-4 h-4 mr-1.5" /> Add {category ?? "Service"}
        </Button>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" />Loading…</div>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{emptyHint}</p>
        ) : (
          <div className="space-y-4">
            {grouped.map(([cat, list]) => (
              <div key={cat}>
                {!category && <h3 className="text-xs uppercase tracking-wider text-muted-foreground mb-2">{cat}</h3>}
                <div className="rounded-md border border-border divide-y divide-border">
                  {list.map(p => (
                    <div key={p.id} className="flex items-center justify-between gap-3 p-3" data-testid={`product-row-${p.id}`}>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{p.name}</span>
                          {!p.active && <Badge variant="outline" className="text-[10px]">Inactive</Badge>}
                        </div>
                        {p.description && (
                          <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{p.description}</p>
                        )}
                      </div>
                      <div className="text-right">
                        <div className="font-semibold text-primary">£{Number(p.unit_price ?? 0).toLocaleString()}</div>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => { setEditing(p); setShowForm(true); }} data-testid={`edit-${p.id}`}>
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => setDeleting(p)} data-testid={`delete-${p.id}`}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <ProductFormDialog
        open={showForm}
        editing={editing}
        defaultCategory={category}
        canEditCategory={!category}
        onClose={() => { setShowForm(false); setEditing(null); }}
        onSave={onSave}
      />

      <Dialog open={!!deleting} onOpenChange={o => !o && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete "{deleting?.name}"?</DialogTitle>
            <DialogDescription>This permanently removes the item from the catalogue. Existing bookings keep their snapshot pricing.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleting(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => deleting && onDelete(deleting)}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function ProductFormDialog({
  open,
  editing,
  defaultCategory,
  canEditCategory,
  onClose,
  onSave,
}: {
  open: boolean;
  editing: Product | null;
  defaultCategory: string | null;
  canEditCategory: boolean;
  onClose: () => void;
  onSave: (p: Partial<Product>) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [cat, setCat] = useState("");
  const [desc, setDesc] = useState("");
  const [price, setPrice] = useState<string>("");
  const [active, setActive] = useState(true);
  const [sort, setSort] = useState<string>("0");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName(editing?.name ?? "");
      setCat(editing?.category ?? defaultCategory ?? "Meet & Greet");
      setDesc(editing?.description ?? "");
      setPrice(editing?.unit_price == null ? "" : String(editing.unit_price));
      setActive(editing?.active ?? true);
      setSort(editing?.sort_order == null ? "0" : String(editing.sort_order));
    }
  }, [open, editing, defaultCategory]);

  const submit = async () => {
    if (!name.trim()) return;
    setSaving(true);
    await onSave({
      name: name.trim(),
      category: cat,
      description: desc.trim() || null,
      unit_price: price === "" ? 0 : Number(price),
      active,
      sort_order: sort === "" ? 0 : Number(sort),
    });
    setSaving(false);
  };

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit" : "Add"} {defaultCategory ?? "Service"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Name</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder={defaultCategory === "Vehicle" ? "Mercedes V-Class" : "Meet & Greet Diamond"} data-testid="input-product-name" />
          </div>
          {canEditCategory && (
            <div>
              <Label>Category</Label>
              <Select value={cat} onValueChange={setCat}>
                <SelectTrigger data-testid="select-product-category"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Meet & Greet">Meet &amp; Greet</SelectItem>
                  <SelectItem value="Add-on">Add-on</SelectItem>
                  <SelectItem value="Concierge">Concierge</SelectItem>
                  <SelectItem value="Other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          <div>
            <Label>Description</Label>
            <Textarea rows={2} value={desc} onChange={e => setDesc(e.target.value)} placeholder="Shown to operators when picking this option." />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>{defaultCategory === "Vehicle" ? "Default Price (£)" : "Price (£)"}</Label>
              <Input type="number" inputMode="decimal" value={price} onChange={e => setPrice(e.target.value)} data-testid="input-product-price" />
              {defaultCategory === "Vehicle" && (
                <p className="text-[11px] text-muted-foreground mt-0.5">Per-airport prices are set on the Price Matrix tab.</p>
              )}
            </div>
            <div>
              <Label>Sort Order</Label>
              <Input type="number" value={sort} onChange={e => setSort(e.target.value)} />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={active} onCheckedChange={setActive} id="prod-active" />
            <Label htmlFor="prod-active" className="cursor-pointer">Active (visible on booking form)</Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={saving || !name.trim()} data-testid="button-save-product">
            {saving ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Save className="w-4 h-4 mr-1.5" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
