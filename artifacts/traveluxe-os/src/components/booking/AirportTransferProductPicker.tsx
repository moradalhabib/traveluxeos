import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Link } from "wouter";
import { Car, Sparkles, Plus, ChevronDown } from "lucide-react";

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
  /** When true, the picker emits vehiclePrice=0 regardless of the airport
   *  matrix. Used when the car is bundled inside a supplier package (e.g.
   *  VIP Diamond) so the auto-calc reflects the real client charge. The
   *  reason itself is captured separately in the Discount Reason field on
   *  the parent form (which already prints on the invoice). */
  vehicleIncluded?: boolean;
  /** Hide the picker's internal "Auto-calculated price" summary so the
   *  parent can render a combined quote box that also includes third-party
   *  supplier costs and markup. */
  hideAutoPrice?: boolean;
  onChange: (next: {
    vehicleProductId: string;
    vehicleName: string;
    vehiclePrice: number;
    transferExtras: TransferExtra[];
    totalPrice: number;
    vehicleIncluded: boolean;
  }) => void;
};

/**
 * Airport Transfer pricing picker.
 *
 *   1. Vehicle dropdown — shows ONLY vehicles with a price for the chosen
 *      airport, with that price displayed inline.
 *   2. Additional Services — fully data-driven. Each `category` on the
 *      products table is treated as a Service Type. Tiers within a type
 *      are mutually exclusive (radio); a type with a single tier renders
 *      as a checkbox. New service types and tiers can be added at any
 *      time via the admin page — no code changes required.
 *   3. Auto-calculated total = vehicle price + Σ(selected tier prices),
 *      pushed up to the parent so it can pre-fill Client Price.
 */
export function AirportTransferProductPicker({
  airportCode,
  vehicleProductId,
  transferExtras,
  vehicleIncluded = false,
  hideAutoPrice = false,
  onChange,
}: Props) {
  const [vehicleRows, setVehicleRows] = useState<VehicleRow[]>([]);
  const [extras, setExtras] = useState<ExtraProduct[]>([]);
  const [loadingVehicles, setLoadingVehicles] = useState(false);
  const [loadingExtras, setLoadingExtras] = useState(false);
  // Each Additional Service category collapses by default. Tap a header to
  // expand. Categories with a current selection auto-open so the picked tier
  // stays visible.
  const [openTypes, setOpenTypes] = useState<Set<string>>(new Set());
  const toggleType = (type: string) =>
    setOpenTypes(prev => {
      const next = new Set(prev);
      next.has(type) ? next.delete(type) : next.add(type);
      return next;
    });

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

  // ─── Load Additional Services (everything that isn't a vehicle) ──────────
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
        // Meet & Greet is being retired as a category; hide any rows that
        // still carry it so the legacy entries don't reappear in the picker
        // until a database cleanup removes them entirely.
        p.category !== "Meet & Greet"
        && (
          !p.service_types
          || p.service_types.length === 0
          || p.service_types.includes("Airport Transfer")
        )
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
  const matrixVehiclePrice = Number(selectedVehicleRow?.price ?? 0);
  const vehiclePrice = vehicleIncluded ? 0 : matrixVehiclePrice;
  const vehicleName = selectedVehicleRow?.products?.name ?? "";

  const extrasTotal = useMemo(
    () => transferExtras.reduce((sum, e) => sum + Number(e.price || 0), 0),
    [transferExtras],
  );
  const total = vehiclePrice + extrasTotal;

  // Group extras by category — each category = one "Service Type"
  const serviceTypes = useMemo(() => {
    const map = new Map<string, ExtraProduct[]>();
    for (const e of extras) {
      const list = map.get(e.category) ?? [];
      list.push(e);
      map.set(e.category, list);
    }
    return Array.from(map.entries()).map(([type, tiers]) => ({
      type,
      tiers: tiers.slice().sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)),
    }));
  }, [extras]);

  // ─── Handlers ─────────────────────────────────────────────────────────────
  function emitFromState(
    nextVehicleId: string,
    nextExtras: TransferExtra[],
    nextIncluded: boolean = vehicleIncluded,
  ) {
    const row = vehicleRows.find(r => r.product_id === nextVehicleId) ?? null;
    const matrixVp = Number(row?.price ?? 0);
    const vp = nextIncluded ? 0 : matrixVp;
    const vn = row?.products?.name ?? "";
    const t = vp + nextExtras.reduce((s, e) => s + Number(e.price || 0), 0);
    onChange({
      vehicleProductId: nextVehicleId,
      vehicleName: vn,
      vehiclePrice: vp,
      transferExtras: nextExtras,
      totalPrice: t,
      vehicleIncluded: nextIncluded,
    });
  }

  /** Replace the selection for this service type with `tier` (or clear it). */
  function selectTier(typeTiers: ExtraProduct[], tier: ExtraProduct | null) {
    const tierIdsInThisType = new Set(typeTiers.map(t => t.id));
    const without = transferExtras.filter(e => !tierIdsInThisType.has(e.id));
    const next = tier
      ? [...without, { id: tier.id, name: tier.name, price: Number(tier.unit_price ?? 0) }]
      : without;
    emitFromState(vehicleProductId, next);
  }

  function setVehicle(id: string) {
    emitFromState(id, transferExtras);
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
          onValueChange={(v) => setVehicle(v === "none" ? "" : v)}
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
            {vehicleName} at {airportCode} ={" "}
            {vehicleIncluded ? (
              <>
                <span className="line-through text-muted-foreground/60">£{matrixVehiclePrice.toLocaleString()}</span>{" "}
                <span className="text-primary font-semibold">£0 — included in package</span>
              </>
            ) : (
              <span className="text-primary font-semibold">£{vehiclePrice.toLocaleString()}</span>
            )}
          </p>
        )}
        {/* Included-in-package toggle. When the car is bundled inside a
            supplier package (e.g. VIP Diamond, Heathrow Meet & Greet), tick
            this so the AUTO-CALC drops the vehicle price to £0 and matches
            what the client is actually being charged. The reason still
            belongs in the Discount Reason field below — that's what prints
            on the invoice. */}
        {selectedVehicleRow && (
          <label className="flex items-center gap-2 mt-2 cursor-pointer p-2 rounded border border-border/50 bg-muted/20">
            <input
              type="checkbox"
              checked={vehicleIncluded}
              onChange={(e) => emitFromState(vehicleProductId, transferExtras, e.target.checked)}
              className="w-4 h-4 accent-primary"
              data-testid="checkbox-vehicle-included"
            />
            <span className="text-xs font-medium text-foreground">
              Included in package — £0
            </span>
            <span className="text-[10px] text-muted-foreground ml-auto">
              e.g. VIP Diamond
            </span>
          </label>
        )}
      </div>

      {/* Additional services — one block per Service Type */}
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

        {!loadingExtras && serviceTypes.length === 0 && (
          <p className="text-[11px] text-muted-foreground">No additional services configured.</p>
        )}

        {serviceTypes.map(({ type, tiers }) => {
          const selected = transferExtras.find(e => tiers.some(t => t.id === e.id)) ?? null;
          const sharedDescription = tiers[0]?.description && tiers.every(t => (t.description ?? "") === tiers[0].description)
            ? tiers[0].description
            : null;

          if (tiers.length === 1) {
            // Single-tier service: simple checkbox toggle
            const t = tiers[0];
            const checked = !!selected;
            return (
              <div key={type} className="rounded border border-border/40 bg-background/40 p-2" data-testid={`service-type-${type}`}>
                <label className="flex items-start gap-2 cursor-pointer">
                  <Checkbox
                    checked={checked}
                    onCheckedChange={(c) => selectTier(tiers, c === true ? t : null)}
                    className="mt-0.5"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">{type}</span>
                      <span className="text-sm font-semibold text-primary">+£{Number(t.unit_price ?? 0).toLocaleString()}</span>
                    </div>
                    {t.description && <p className="text-[11px] text-muted-foreground mt-0.5">{t.description}</p>}
                  </div>
                </label>
              </div>
            );
          }

          // Multi-tier service: collapsible — header summarises selection,
          // body shows mutually-exclusive tier radios when expanded. Auto-open
          // if a tier is currently selected so the user always sees their pick.
          const isOpen = openTypes.has(type) || !!selected;
          return (
            <div key={type} className="rounded border border-border/40 bg-background/40 overflow-hidden" data-testid={`service-type-${type}`}>
              <button
                type="button"
                onClick={() => toggleType(type)}
                className="w-full flex items-center justify-between gap-2 p-2 text-left hover:bg-muted/40 transition-colors"
                data-testid={`toggle-${type}`}
                aria-expanded={isOpen}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <ChevronDown className={`w-4 h-4 shrink-0 text-muted-foreground transition-transform ${isOpen ? "" : "-rotate-90"}`} />
                  <span className="text-sm font-medium truncate">{type}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {selected ? (
                    <>
                      <span className="text-[11px] text-muted-foreground truncate max-w-[140px]">{selected.name}</span>
                      <span className="text-sm font-semibold text-primary tabular-nums">+£{Number(selected.price ?? 0).toLocaleString()}</span>
                    </>
                  ) : (
                    <span className="text-[11px] text-muted-foreground">{tiers.length} options</span>
                  )}
                </div>
              </button>
              {isOpen && (
              <div className="px-2 pb-2 space-y-1.5">
              {selected && (
                <div className="flex justify-end -mt-1">
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); selectTier(tiers, null); }}
                    className="text-[11px] text-muted-foreground hover:text-foreground underline"
                    data-testid={`clear-${type}`}
                  >
                    Clear
                  </button>
                </div>
              )}
              {sharedDescription && (
                <p className="text-[11px] text-muted-foreground">{sharedDescription}</p>
              )}
              <div className="space-y-1">
                {tiers.map(t => {
                  const isSelected = selected?.id === t.id;
                  return (
                    <label
                      key={t.id}
                      className={`flex items-start gap-2 p-2 rounded border cursor-pointer transition ${
                        isSelected ? "border-primary/60 bg-primary/5" : "border-border/40 hover:border-primary/30"
                      }`}
                      data-testid={`tier-row-${t.id}`}
                    >
                      <input
                        type="radio"
                        name={`service-type-${type}`}
                        checked={isSelected}
                        onChange={() => selectTier(tiers, t)}
                        className="mt-1 accent-primary"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium">{t.name}</span>
                          <span className="text-sm font-semibold text-primary">+£{Number(t.unit_price ?? 0).toLocaleString()}</span>
                        </div>
                        {!sharedDescription && t.description && (
                          <p className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5">{t.description}</p>
                        )}
                      </div>
                    </label>
                  );
                })}
              </div>
              </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Live total */}
      {!hideAutoPrice && (vehiclePrice > 0 || extrasTotal > 0) && (
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
            {" "}— used to build the Client Price. Override manually if needed.
          </div>
        </div>
      )}
    </div>
  );
}
