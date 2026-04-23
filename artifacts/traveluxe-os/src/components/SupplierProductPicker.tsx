import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Link } from "wouter";
import { Package } from "lucide-react";

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

// Display order for grouped sections in the picker. Anything with a kind
// not listed here falls into "Other" at the bottom.
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
  value: string;
  onChange: (productId: string, product: SupplierProduct | null) => void;
};

/**
 * Picker for the specific car / driver / service the supplier is providing
 * for this booking. Pulls the active products under the chosen supplier and
 * surfaces a fast jump-to-supplier link so operators can add a missing item
 * without leaving the page.
 */
export function SupplierProductPicker({ supplierId, value, onChange }: Props) {
  const [products, setProducts] = useState<SupplierProduct[]>([]);
  const [loading, setLoading] = useState(false);

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

  // Group products by kind, preserving the canonical display order.
  const grouped = KIND_ORDER
    .map(k => ({ kind: k, items: products.filter(p => p.kind === k) }))
    .filter(g => g.items.length > 0);

  return (
    <div className="rounded-md border border-border bg-secondary/20 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Label className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <Package className="w-3.5 h-3.5" /> Supplier product
        </Label>
        <Link href={`/suppliers/${supplierId}`}>
          <span className="text-[11px] text-primary hover:underline cursor-pointer">
            Manage products →
          </span>
        </Link>
      </div>
      <Select
        value={value || "none"}
        onValueChange={(v) => {
          if (v === "none") {
            onChange("", null);
            return;
          }
          const p = products.find(p => p.id === v) || null;
          onChange(v, p);
        }}
      >
        <SelectTrigger>
          <SelectValue placeholder={loading ? "Loading…" : "Select product / service…"} />
        </SelectTrigger>
        <SelectContent className="max-h-[55vh] overflow-y-auto">
          <SelectItem value="none">None</SelectItem>
          {grouped.map(({ kind, items }) => (
            <div key={kind}>
              <div className="px-2 py-1 text-[10px] uppercase text-muted-foreground tracking-wider">
                {KIND_LABEL[kind]}
              </div>
              {items.map(p => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                  {p.plate ? ` · ${p.plate}` : ""}
                  {p.daily_rate ? ` · £${p.daily_rate}/day` : ""}
                  {!p.daily_rate && p.hourly_rate ? ` · £${p.hourly_rate}/hr` : ""}
                </SelectItem>
              ))}
            </div>
          ))}
        </SelectContent>
      </Select>
      {!loading && products.length === 0 && (
        <p className="text-[11px] text-amber-400">
          No products yet for this supplier.{" "}
          <Link href={`/suppliers/${supplierId}`}>
            <span className="underline cursor-pointer">Add a car or driver →</span>
          </Link>
        </p>
      )}
      {value && products.find(p => p.id === value) && (
        <p className="text-[11px] text-muted-foreground">
          Daily rate auto-filled into Cost Breakdown below — adjust if needed.
        </p>
      )}
    </div>
  );
}
