import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Link } from "wouter";
import { Car, Sparkles, Plus } from "lucide-react";

export type TransferExtra = { id: string; name: string; price: number };

type VehicleRow = {
  product_id: string;
  airport_code: string;
  airport_name: string | null;
  price: number | null;
  hourly_rate: number | null;
  products: {
    id: string;
    name: string;
    category: string;
    active: boolean;
    service_types: string[] | null;
    sort_order: number | null;
  } | null;
};

type ExtraProduct = {
  id: string;
  name: string;
  category: string;
  description: string | null;
  unit_price: number | null;
  active: boolean;
  service_types: string[] | null;
  sort_order: number | null;
};

type Props = {
  airportCode: string | undefined;
  vehicleProductId: string;
  transferExtras: TransferExtra[];
  onChange: (next: {
    vehicleProductId: string;
    vehicleName: string;
    vehiclePrice: number;
    transferExtras: TransferExtra[];
    totalPrice: number;
  }) => void;
};

/**
 * Airport Transfer pricing picker.
 *
 * Step 1 — Pick airport (handled by parent; we receive `airportCode`).
 * Step 2 — Vehicle dropdown shows ONLY vehicles that have a price for
 *          the selected airport, with that price displayed inline.
 * Step 3 — Selecting a vehicle reports `vehiclePrice` upward so the
 *          parent can auto-fill Client Price.
 * Step 4 — Additional Services (Meet & Greet etc.) appear as
 *          independent checkboxes; each adds its price to the total.
 * Step 5 — `totalPrice` = vehiclePrice + Σ(selected extras).
 *
 * The parent owns the actual Client Price field — this component just
 * surfaces the auto-calculated total whenever the selection changes,
 * leaving the operator free to override afterwards.
 */
export function AirportTransferProductPicker({
  airportCode,
  vehicleProductId,
  transferExtras,
  onChange,
}: Props) {
  const [vehicleRows, setVehicleRows] = useState<VehicleRow[]>([]);
  const [extras, setExtras] = useState<ExtraProduct[]>([]);
  const [loadingVehicles, setLoadingVehicles] = useState(false);
  const [loadingExtras, setLoadingExtras] = useState(false);

  // ─── Load vehicles available at this airport (joined with their per-airport price) ───
  useEffect(() => {
    if (!airportCode) {
      setVehicleRows([]);
      return;
    }
    let active = true;
    setLoadingVehicles(true);
    (async () => {
      const { data } = await supabase
        .from("vehicle_airport_pricing")
        .select("product_id, airport_code, airport_name, price, hourly_rate, products(id, name, category, active, service_types, sort_order)")
        .eq("airport_code", airportCode);
      if (!active) return;
      const rows = (data ?? []) as unknown as VehicleRow[];
      // Only show rows where:
      //   - the linked product still exists and is active
      //   - the product is in the Vehicle category
      //   - service_types includes Airport Transfer (or is empty/null = legacy = show)
      //   - the price for this airport is set (> 0)
      const filtered = rows.filter(r =>
        r.products
        && r.products.active
        && r.products.category === "Vehicle"
        && (
          !r.products.service_types
          || r.products.service_types.length === 0
          || r.products.service_types.includes("Airport Transfer")
        )
        && r.price != null && Number(r.price) > 0
      );
      filtered.sort((a, b) => {
        const sa = a.products?.sort_order ?? 0;
        const sb = b.products?.sort_order ?? 0;
        if (sa !== sb) return sa - sb;
        return (a.products?.name ?? "").localeCompare(b.products?.name ?? "");
      });
      setVehicleRows(filtered);
      setLoadingVehicles(false);
    })();
    return () => { active = false; };
  }, [airportCode]);

  // ─── Load Additional Services available for Airport Transfer ─────────────
  useEffect(() => {
    let active = true;
    setLoadingExtras(true);
    (async () => {
      const { data } = await supabase
        .from("products")
        .select("id, name, category, description, unit_price, active, service_types, sort_order")
        .neq("category", "Vehicle")
        .eq("active", true)
        .order("category")
        .order("sort_order");
      if (!active) return;
      const list = (data ?? []) as unknown as ExtraProduct[];
      const filtered = list.filter(p =>
        !p.service_types
        || p.service_types.length === 0
        || p.service_types.includes("Airport Transfer")
      );
      setExtras(filtered);
      setLoadingExtras(false);
    })();
    return () => { active = false; };
  }, []);

  // ─── Derived ──────────────────────────────────────────────────────────────
  const selectedVehicleRow = useMemo(
    () => vehicleRows.find(r => r.product_id === vehicleProductId) ?? null,
    [vehicleRows, vehicleProductId],
  );
  const vehiclePrice = Number(selectedVehicleRow?.price ?? 0);
  const vehicleName = selectedVehicleRow?.products?.name ?? "";

  const extrasTotal = useMemo(
    () => transferExtras.reduce((sum, e) => sum + Number(e.price || 0), 0),
    [transferExtras],
  );
  const total = vehiclePrice + extrasTotal;

  // Group extras by category for display
  const extrasByCategory = useMemo(() => {
    const map = new Map<string, ExtraProduct[]>();
    for (const e of extras) {
      const list = map.get(e.category) ?? [];
      list.push(e);
      map.set(e.category, list);
    }
    return Array.from(map.entries());
  }, [extras]);

  // ─── Handlers ─────────────────────────────────────────────────────────────
  function emit(next: Partial<{ vehicleId: string; extras: TransferExtra[] }>) {
    const nextVehicleId = next.vehicleId !== undefined ? next.vehicleId : vehicleProductId;
    const nextExtras = next.extras !== undefined ? next.extras : transferExtras;
    const row = vehicleRows.find(r => r.product_id === nextVehicleId) ?? null;
    const vp = Number(row?.price ?? 0);
    const vn = row?.products?.name ?? "";
    const t = vp + nextExtras.reduce((s, e) => s + Number(e.price || 0), 0);
    onChange({
      vehicleProductId: nextVehicleId,
      vehicleName: vn,
      vehiclePrice: vp,
      transferExtras: nextExtras,
      totalPrice: t,
    });
  }

  function toggleExtra(p: ExtraProduct, checked: boolean) {
    const exists = transferExtras.some(e => e.id === p.id);
    let nextExtras: TransferExtra[];
    if (checked && !exists) {
      nextExtras = [...transferExtras, { id: p.id, name: p.name, price: Number(p.unit_price ?? 0) }];
    } else if (!checked && exists) {
      nextExtras = transferExtras.filter(e => e.id !== p.id);
    } else {
      return;
    }
    emit({ extras: nextExtras });
  }

  // ─── Render ───────────────────────────────────────────────────────────────
  if (!airportCode) {
    return (
      <div className="rounded-md border border-dashed border-border bg-secondary/10 p-3 text-xs text-muted-foreground">
        Pick an airport above to see available vehicles and pricing.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Vehicle picker */}
      <div className="rounded-md border border-border bg-secondary/20 p-3 space-y-2" data-testid="airport-vehicle-picker">
        <div className="flex items-center justify-between gap-2">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <Car className="w-3.5 h-3.5" /> Vehicle ({airportCode})
          </Label>
          <Link href="/admin/airport-pricing">
            <span className="text-[11px] text-primary hover:underline cursor-pointer">
              Manage prices →
            </span>
          </Link>
        </div>
        <Select
          value={vehicleProductId || "none"}
          onValueChange={(v) => emit({ vehicleId: v === "none" ? "" : v })}
        >
          <SelectTrigger data-testid="select-airport-vehicle">
            <SelectValue placeholder={loadingVehicles ? "Loading vehicles…" : "Select vehicle…"} />
          </SelectTrigger>
          <SelectContent className="max-h-[55vh] overflow-y-auto">
            <SelectItem value="none">— None —</SelectItem>
            {vehicleRows.map(r => (
              <SelectItem key={r.product_id} value={r.product_id}>
                {r.products?.name} · £{Number(r.price).toLocaleString()}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {!loadingVehicles && vehicleRows.length === 0 && (
          <p className="text-[11px] text-amber-400">
            No vehicles priced for {airportCode} yet.{" "}
            <Link href="/admin/airport-pricing">
              <span className="underline cursor-pointer">Set prices →</span>
            </Link>
          </p>
        )}
        {selectedVehicleRow && (
          <p className="text-[11px] text-muted-foreground">
            {vehicleName} at {airportCode} = <span className="text-primary font-semibold">£{vehiclePrice.toLocaleString()}</span>
          </p>
        )}
      </div>

      {/* Additional services */}
      <div className="rounded-md border border-border bg-secondary/20 p-3 space-y-3" data-testid="airport-extras-picker">
        <div className="flex items-center justify-between gap-2">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5" /> Additional Services
          </Label>
          <Link href="/admin/airport-pricing">
            <span className="text-[11px] text-primary hover:underline cursor-pointer flex items-center gap-1">
              <Plus className="w-3 h-3" /> Manage
            </span>
          </Link>
        </div>

        {loadingExtras && <p className="text-[11px] text-muted-foreground">Loading services…</p>}

        {!loadingExtras && extrasByCategory.length === 0 && (
          <p className="text-[11px] text-muted-foreground">No additional services configured.</p>
        )}

        {extrasByCategory.map(([cat, list]) => (
          <div key={cat} className="space-y-1.5">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground/80">{cat}</div>
            {list.map(p => {
              const checked = transferExtras.some(e => e.id === p.id);
              return (
                <label
                  key={p.id}
                  className="flex items-start gap-2 p-2 rounded border border-border/40 bg-background/40 hover:border-primary/30 cursor-pointer transition"
                  data-testid={`extra-row-${p.id}`}
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={(c) => toggleExtra(p, c === true)}
                    className="mt-0.5"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">{p.name}</span>
                      <span className="text-sm font-semibold text-primary">+£{Number(p.unit_price ?? 0).toLocaleString()}</span>
                    </div>
                    {p.description && (
                      <p className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5">{p.description}</p>
                    )}
                  </div>
                </label>
              );
            })}
          </div>
        ))}
      </div>

      {/* Live total */}
      {(vehiclePrice > 0 || extrasTotal > 0) && (
        <div className="rounded-md border border-primary/30 bg-primary/5 p-3">
          <div className="flex items-center justify-between text-xs uppercase tracking-wider text-muted-foreground">
            <span>Auto-calculated price</span>
            <span className="text-lg font-bold text-primary normal-case tracking-normal">
              £{total.toLocaleString()}
            </span>
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            {vehicleName ? `${vehicleName} £${vehiclePrice.toLocaleString()}` : "No vehicle"}
            {transferExtras.map(e => ` + ${e.name} £${Number(e.price).toLocaleString()}`).join("")}
            {" "}— pushed into Client Price below. Override manually if needed.
          </div>
        </div>
      )}
    </div>
  );
}
