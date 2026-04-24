import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Link } from "wouter";
import { Package, Plus, X } from "lucide-react";

export type SupplierProductKind =
  | "Car"
  | "Driver"
  | "Meet & Greet"
  | "Fast-Track"
  | "Lounge"
  | "Porter"
  | "Other";

export type SupplierProduct = {
  id: string;
  supplier_id: string;
  name: string;
  kind: SupplierProductKind;
  daily_rate: number | null;
  hourly_rate: number | null;
  plate: string | null;
  notes: string | null;
  is_active: boolean;
};

// Snapshot of a picked supplier product on the booking. Stored on
// bookings.supplier_items (jsonb) so the line stays accurate even if the
// catalogue is later edited.
export type SupplierItem = {
  product_id: string;
  qty: number;
  name: string;
  daily_rate: number | null;
  hourly_rate: number | null;
};

const KIND_ORDER: SupplierProductKind[] = [
  "Car", "Driver", "Meet & Greet", "Fast-Track", "Lounge", "Porter", "Other",
];
const KIND_LABEL: Record<SupplierProductKind, string> = {
  "Car": "Cars",
  "Driver": "Drivers",
  "Meet & Greet": "Meet & Greet",
  "Fast-Track": "Fast-Track",
  "Lounge": "Lounge",
  "Porter": "Porter",
  "Other": "Other",
};

type Props = {
  supplierId: string;
  value: SupplierItem[];
  onChange: (items: SupplierItem[]) => void;
};

/**
 * Multi-select picker for the services / products supplied by a third-party
 * for this booking. Each picked product gets its own quantity row — the
 * parent form auto-sums Cost Breakdown from these lines.
 *
 * Snapshots `name` and rates so historical bookings stay accurate even if
 * the catalogue is edited later.
 */
export function SupplierProductPicker({ supplierId, value, onChange }: Props) {
  const [products, setProducts] = useState<SupplierProduct[]>([]);
  const [loading, setLoading] = useState(false);
  const [pendingId, setPendingId] = useState<string>("");

  useEffect(() => {
    if (!supplierId) {
      setProducts([]);
      return;
    }
    let active = true;
    setLoading(true);
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch(`/api/suppliers/${supplierId}/products`, {
          headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
        });
        if (!res.ok) return;
        const data = await res.json();
        if (active) setProducts(Array.isArray(data) ? data.filter((p: SupplierProduct) => p.is_active) : []);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [supplierId]);

  const items = Array.isArray(value) ? value : [];

  // Group catalogue products by kind for the picker dropdown.
  // Hide products already added so the operator can't double-pick.
  const pickedIds = new Set(items.map(i => i.product_id));
  const grouped = KIND_ORDER
    .map(k => ({
      kind: k,
      items: products.filter(p => p.kind === k && !pickedIds.has(p.id)),
    }))
    .filter(g => g.items.length > 0);

  const addItem = (productId: string) => {
    const p = products.find(x => x.id === productId);
    if (!p) return;
    const next: SupplierItem[] = [
      ...items,
      {
        product_id: p.id,
        qty: 1,
        name: p.name,
        daily_rate: p.daily_rate,
        hourly_rate: p.hourly_rate,
      },
    ];
    onChange(next);
    setPendingId("");
  };

  const updateQty = (productId: string, qty: number) => {
    if (qty < 1) qty = 1;
    onChange(items.map(i => i.product_id === productId ? { ...i, qty } : i));
  };

  const removeItem = (productId: string) => {
    onChange(items.filter(i => i.product_id !== productId));
  };

  const formatRate = (i: SupplierItem) => {
    if (i.daily_rate != null) return `£${Number(i.daily_rate).toLocaleString()}`;
    if (i.hourly_rate != null) return `£${Number(i.hourly_rate).toLocaleString()}/hr`;
    return "";
  };

  const lineTotal = (i: SupplierItem) => {
    const rate = i.daily_rate ?? i.hourly_rate ?? 0;
    return Number(rate) * Number(i.qty || 0);
  };

  const grandTotal = items.reduce((s, i) => s + lineTotal(i), 0);

  return (
    <div className="rounded-md border border-border bg-secondary/20 p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <Label className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <Package className="w-3.5 h-3.5" /> Supplier products
        </Label>
        <Link href={`/suppliers/${supplierId}`}>
          <span className="text-[11px] text-primary hover:underline cursor-pointer">
            Manage products →
          </span>
        </Link>
      </div>

      {/* Selected lines */}
      {items.length > 0 && (
        <div className="space-y-2">
          {items.map(it => (
            <div
              key={it.product_id}
              className="flex items-center gap-2 p-2 rounded-md bg-background/40 border border-border"
              data-testid={`row-supplier-item-${it.product_id}`}
            >
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate">{it.name}</div>
                <div className="text-[11px] text-muted-foreground">
                  {formatRate(it)}{it.qty > 1 ? ` × ${it.qty}` : ""}
                </div>
              </div>
              <Input
                type="number"
                min="1"
                value={it.qty}
                onChange={(e) => updateQty(it.product_id, Number(e.target.value) || 1)}
                className="w-16 h-8 text-center text-sm"
                data-testid={`input-qty-${it.product_id}`}
              />
              <div className="w-20 text-right text-sm font-semibold">
                £{lineTotal(it).toLocaleString()}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                onClick={() => removeItem(it.product_id)}
                data-testid={`btn-remove-${it.product_id}`}
              >
                <X className="w-3.5 h-3.5" />
              </Button>
            </div>
          ))}
          <div className="flex justify-between items-center pt-1 border-t border-border/50">
            <span className="text-xs text-muted-foreground uppercase tracking-wider">Supplier subtotal</span>
            <span className="text-sm font-semibold">£{grandTotal.toLocaleString()}</span>
          </div>
        </div>
      )}

      {/* Add another product */}
      <div className="flex items-center gap-2">
        <Select
          value={pendingId || "none"}
          onValueChange={(v) => {
            if (v === "none") return;
            addItem(v);
          }}
        >
          <SelectTrigger className="flex-1" data-testid="select-add-supplier-product">
            <SelectValue placeholder={loading ? "Loading…" : (items.length === 0 ? "Select product / service…" : "Add another product…")} />
          </SelectTrigger>
          <SelectContent className="max-h-[55vh] overflow-y-auto">
            <SelectItem value="none">— Select —</SelectItem>
            {grouped.map(({ kind, items: opts }) => (
              <div key={kind}>
                <div className="px-2 py-1 text-[10px] uppercase text-muted-foreground tracking-wider">
                  {KIND_LABEL[kind]}
                </div>
                {opts.map(p => (
                  <SelectItem key={p.id} value={p.id} data-testid={`option-supplier-product-${p.id}`}>
                    {p.name}
                    {p.plate ? ` · ${p.plate}` : ""}
                    {p.daily_rate ? ` · £${p.daily_rate}` : ""}
                    {!p.daily_rate && p.hourly_rate ? ` · £${p.hourly_rate}/hr` : ""}
                  </SelectItem>
                ))}
              </div>
            ))}
          </SelectContent>
        </Select>
        {items.length === 0 && (
          <span className="text-[11px] text-muted-foreground hidden sm:flex items-center gap-1">
            <Plus className="w-3 h-3" /> add lines
          </span>
        )}
      </div>

      {!loading && products.length === 0 && (
        <p className="text-[11px] text-amber-400">
          No products yet for this supplier.{" "}
          <Link href={`/suppliers/${supplierId}`}>
            <span className="underline cursor-pointer">Add a service →</span>
          </Link>
        </p>
      )}
      {items.length > 0 && (
        <p className="text-[11px] text-muted-foreground">
          Subtotal auto-fills Cost Breakdown below — adjust commission if needed.
        </p>
      )}
    </div>
  );
}
