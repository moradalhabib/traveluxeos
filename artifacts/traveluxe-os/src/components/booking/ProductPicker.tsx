import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Minus, X, Check, ChevronDown, ChevronUp, Car, Sparkles, Map, Package, Building2, PenLine, Pencil } from "lucide-react";

export interface OrderLine {
  key: string;
  product_id: string | null;
  name: string;
  unit_price: number;
  quantity: number;
  notes?: string;
  category?: string;
}

interface Product {
  id: string;
  name: string;
  category: string;
  description: string | null;
  unit_price: number;
  active: boolean;
  service_types?: string[] | null;
}

const SERVICE_CATEGORY_MAP: Record<string, string[]> = {
  "Airport Transfer": ["Vehicle", "Meet & Greet", "Add-on"],
  "As Directed":      ["Vehicle", "Add-on"],
  "Tour":             ["Tour", "Vehicle", "Add-on"],
  "Apartment":        ["Accommodation", "Add-on"],
  "Hotel":            ["Add-on"],
};
const DEFAULT_CATEGORIES = ["Vehicle", "Meet & Greet", "Tour", "Add-on", "Accommodation"];

const RADIO_CATEGORIES = new Set(["Vehicle", "Meet & Greet", "Tour"]);

const CATEGORY_META: Record<string, { icon: React.ReactNode; label: string; hint: string }> = {
  "Vehicle": {
    icon: <Car className="w-4 h-4" />,
    label: "Vehicle",
    hint: "Choose one vehicle — prices are per booking",
  },
  "Meet & Greet": {
    icon: <Sparkles className="w-4 h-4" />,
    label: "Meet & Greet",
    hint: "Choose a tier — Silver, Gold or Diamond",
  },
  "Tour": {
    icon: <Map className="w-4 h-4" />,
    label: "Tour",
    hint: "Choose a tour — customise price after selection",
  },
  "Add-on": {
    icon: <Plus className="w-4 h-4" />,
    label: "Extras & Add-ons",
    hint: "Select any extras — adjust quantities and prices",
  },
  "Accommodation": {
    icon: <Building2 className="w-4 h-4" />,
    label: "Accommodation",
    hint: "Select accommodation — customise price after selection",
  },
};

interface Props {
  orderLines: OrderLine[];
  onChange: (lines: OrderLine[]) => void;
  serviceType?: string;
}

const OTHER_VEHICLE_KEY = "__other_vehicle__";

export default function ProductPicker({ orderLines, onChange, serviceType }: Props) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [openSections, setOpenSections] = useState<Set<string>>(new Set(["Vehicle"]));
  const [otherVehicleInput, setOtherVehicleInput] = useState("");
  const [otherVehiclePrice, setOtherVehiclePrice] = useState("");

  useEffect(() => {
    supabase
      .from("products")
      .select("*")
      .eq("active", true)
      .order("sort_order")
      .then(({ data }) => {
        const loaded = data ?? [];
        setProducts(loaded);
        setLoading(false);

        // Auto-select MB V-Class as default vehicle if none already chosen
        const hasVehicle = orderLines.some(l => l.category === "Vehicle");
        if (!hasVehicle) {
          const vClass = loaded.find(
            p => p.category === "Vehicle" && p.name.toLowerCase().includes("v-class")
          ) ?? loaded.find(p => p.category === "Vehicle");
          if (vClass) {
            onChange([...orderLines, {
              key: `${vClass.id}-default`,
              product_id: vClass.id,
              name: vClass.name,
              unit_price: vClass.unit_price,
              quantity: 1,
              category: "Vehicle",
            }]);
          }
        }
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const categories = serviceType && SERVICE_CATEGORY_MAP[serviceType]
    ? SERVICE_CATEGORY_MAP[serviceType]
    : DEFAULT_CATEGORIES;

  // Filter products: if service_types column exists, use it; otherwise fall back to category map
  const getProductsForCategory = (cat: string) => {
    return products.filter(p => {
      if (p.category !== cat) return false;
      // If the product has service_types data, use it for filtering
      if (p.service_types && p.service_types.length > 0 && serviceType) {
        return p.service_types.includes(serviceType);
      }
      return true;
    });
  };

  useEffect(() => {
    if (categories.length > 0) {
      setOpenSections(new Set([categories[0]]));
    }
  }, [serviceType]);

  const toggleSection = (cat: string) => {
    setOpenSections(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  const inOrder = (productId: string) => orderLines.find(l => l.product_id === productId);
  const otherVehicleLine = orderLines.find(l => l.key === OTHER_VEHICLE_KEY);
  const total = orderLines.reduce((s, l) => s + l.unit_price * l.quantity, 0);

  const selectProduct = (product: Product) => {
    const isRadio = RADIO_CATEGORIES.has(product.category);

    if (isRadio) {
      const withoutCategory = orderLines.filter(l => {
        if (l.key === OTHER_VEHICLE_KEY && product.category === "Vehicle") return false;
        const p = products.find(p => p.id === l.product_id);
        return !p || p.category !== product.category;
      });
      const alreadySelected = orderLines.find(l => l.product_id === product.id);
      if (alreadySelected) {
        onChange(withoutCategory);
      } else {
        // Tour destinations are labels only — no price contribution
        const linePrice = (serviceType === "Tour" && product.category === "Tour")
          ? 0
          : product.unit_price;
        onChange([...withoutCategory, {
          key: `${product.id}-${Date.now()}`,
          product_id: product.id,
          name: product.name,
          unit_price: linePrice,
          quantity: 1,
          category: product.category,
        }]);
        // Auto-open next section
        const idx = categories.indexOf(product.category);
        if (idx < categories.length - 1) {
          setOpenSections(prev => {
            const next = new Set(prev);
            next.add(categories[idx + 1]);
            return next;
          });
        }
      }
    } else {
      const existing = orderLines.find(l => l.product_id === product.id);
      if (existing) {
        onChange(orderLines.filter(l => l.product_id !== product.id));
      } else {
        onChange([...orderLines, {
          key: `${product.id}-${Date.now()}`,
          product_id: product.id,
          name: product.name,
          unit_price: product.unit_price,
          quantity: 1,
          category: product.category,
        }]);
      }
    }
  };

  const updateLinePrice = (key: string, rawValue: string) => {
    const parsed = parseFloat(rawValue);
    const price = isNaN(parsed) ? 0 : parsed;
    onChange(orderLines.map(l => l.key === key ? { ...l, unit_price: price } : l));
  };

  const toggleOtherVehicle = () => {
    if (otherVehicleLine) {
      onChange(orderLines.filter(l => l.key !== OTHER_VEHICLE_KEY));
      setOtherVehicleInput("");
      setOtherVehiclePrice("");
    } else {
      const withoutVehicle = orderLines.filter(l => {
        if (l.key === OTHER_VEHICLE_KEY) return false;
        const p = products.find(p => p.id === l.product_id);
        return !p || p.category !== "Vehicle";
      });
      const price = parseFloat(otherVehiclePrice) || 0;
      onChange([...withoutVehicle, {
        key: OTHER_VEHICLE_KEY,
        product_id: null,
        name: otherVehicleInput || "Other vehicle",
        unit_price: price,
        quantity: 1,
        category: "Vehicle",
      }]);
      const idx = categories.indexOf("Vehicle");
      if (idx < categories.length - 1) {
        setOpenSections(prev => {
          const next = new Set(prev);
          next.add(categories[idx + 1]);
          return next;
        });
      }
    }
  };

  const updateOtherVehicleName = (name: string) => {
    setOtherVehicleInput(name);
    if (otherVehicleLine) {
      onChange(orderLines.map(l =>
        l.key === OTHER_VEHICLE_KEY ? { ...l, name: name || "Other vehicle" } : l
      ));
    }
  };

  const updateOtherVehiclePrice = (rawValue: string) => {
    setOtherVehiclePrice(rawValue);
    if (otherVehicleLine) {
      const price = parseFloat(rawValue) || 0;
      onChange(orderLines.map(l =>
        l.key === OTHER_VEHICLE_KEY ? { ...l, unit_price: price } : l
      ));
    }
  };

  const updateQty = (key: string, delta: number) => {
    const updated = orderLines.map(l => {
      if (l.key !== key) return l;
      const newQty = l.quantity + delta;
      return newQty <= 0 ? null : { ...l, quantity: newQty };
    }).filter(Boolean) as OrderLine[];
    onChange(updated);
  };

  const removeItem = (key: string) => {
    if (key === OTHER_VEHICLE_KEY) { setOtherVehicleInput(""); setOtherVehiclePrice(""); }
    onChange(orderLines.filter(l => l.key !== key));
  };

  if (loading) {
    return <div className="py-6 text-center text-xs text-muted-foreground">Loading catalogue...</div>;
  }

  const availableCategories = categories.filter(c =>
    c === "Vehicle" || getProductsForCategory(c).length > 0
  );

  if (availableCategories.length === 0) {
    return (
      <div className="py-6 text-center text-xs text-muted-foreground border border-dashed border-border rounded-xl">
        Run <code className="font-mono">migration-products.sql</code> in Supabase to load the product catalogue.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {availableCategories.map((cat, catIdx) => {
        const meta = CATEGORY_META[cat] ?? { icon: <Package className="w-4 h-4" />, label: cat, hint: "" };
        const catProducts = getProductsForCategory(cat);
        const selectedInCat = orderLines.filter(l => {
          if (l.key === OTHER_VEHICLE_KEY && cat === "Vehicle") return true;
          const p = products.find(p => p.id === l.product_id);
          return p?.category === cat;
        });
        const isOpen = openSections.has(cat);
        const hasSelection = selectedInCat.length > 0;
        const isRadio = RADIO_CATEGORIES.has(cat);
        // For "As Directed" chauffeuring: vehicles are billed by unit (hours/days) × rate, so enable qty
        const vehicleQtyEnabled = cat === "Vehicle" && serviceType === "As Directed";
        const showVehicleOther = cat === "Vehicle";

        return (
          <div
            key={cat}
            className={`rounded-2xl border overflow-hidden transition-all ${
              hasSelection ? "border-primary/40 bg-primary/3" : "border-border bg-card"
            }`}
          >
            {/* Section header */}
            <button
              type="button"
              onClick={() => toggleSection(cat)}
              className="w-full flex items-center justify-between px-4 py-3 text-left"
            >
              <div className="flex items-center gap-3">
                <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${
                  hasSelection ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                }`}>
                  {hasSelection ? <Check className="w-4 h-4" /> : meta.icon}
                </div>
                <div className="text-left">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-foreground">{meta.label}</span>
                    <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">
                      Step {catIdx + 1}
                    </span>
                  </div>
                  {hasSelection ? (
                    <div className="text-xs text-primary font-medium mt-0.5">
                      {selectedInCat.map(l => l.name).join(", ")}
                      {" · "}
                      <span className="text-primary/70">
                        £{selectedInCat.reduce((s, l) => s + l.unit_price * l.quantity, 0).toLocaleString()}
                      </span>
                    </div>
                  ) : (
                    <div className="text-xs text-muted-foreground mt-0.5">{meta.hint}</div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {hasSelection && (
                  <Badge variant="outline" className="text-primary border-primary/30 text-[10px]">
                    {selectedInCat.length}
                  </Badge>
                )}
                {isOpen
                  ? <ChevronUp className="w-4 h-4 text-muted-foreground" />
                  : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
              </div>
            </button>

            {/* Products */}
            {isOpen && (
              <div className="px-3 pb-3 border-t border-border/60 pt-3 space-y-2">
                {catProducts.map(product => {
                  const ordered = inOrder(product.id);

                  return (
                    <div key={product.id} className={`rounded-xl border transition-all ${
                      ordered
                        ? "border-primary bg-primary/8 shadow-[0_0_8px_rgba(201,168,76,0.1)]"
                        : "border-border/60 bg-background"
                    }`}>
                      <button
                        type="button"
                        onClick={() => selectProduct(product)}
                        className="w-full flex items-center justify-between p-3 text-left"
                      >
                        <div className="flex items-center gap-3 flex-1 min-w-0 pr-2">
                          <div className={`flex-shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${
                            ordered ? "border-primary bg-primary" : "border-border"
                          }`}>
                            {ordered && (
                              <div className={`${isRadio ? "w-2 h-2 rounded-full bg-white" : ""}`}>
                                {!isRadio && <Check className="w-3 h-3 text-white" />}
                              </div>
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-foreground leading-tight">{product.name}</div>
                            {product.description && (
                              <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2 leading-relaxed">
                                {product.description}
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="flex-shrink-0 text-right">
                          {(serviceType === "Tour" && cat === "Tour") ? (
                            <span className="text-xs text-muted-foreground font-medium">Label only</span>
                          ) : (
                            <span className={`text-sm font-bold ${ordered ? "text-primary" : "text-foreground"}`}>
                              {product.unit_price > 0 ? `£${product.unit_price.toLocaleString()}` : "Incl."}
                            </span>
                          )}
                        </div>
                      </button>

                      {/* Inline price editor + qty controls when selected (not for Tour labels) */}
                      {ordered && !(serviceType === "Tour" && cat === "Tour") && (
                        <div className="px-3 pb-3 space-y-2 border-t border-primary/10 pt-2">
                          {vehicleQtyEnabled && (
                            <p className="text-[10px] text-amber-400 font-medium">
                              Chauffeuring billing: set the unit rate (£/hr or £/day) and quantity (units billed)
                            </p>
                          )}
                          <div className="flex items-center gap-2">
                            <div className="flex-1">
                              <Label className="text-[11px] text-muted-foreground mb-1 flex items-center gap-1">
                                <Pencil className="w-3 h-3" />
                                {vehicleQtyEnabled ? "Unit Rate (£/hr or £/day)" : "Price for this booking (£)"}
                              </Label>
                              <Input
                                type="number"
                                step="1"
                                min="0"
                                value={ordered.unit_price === 0 ? "" : ordered.unit_price}
                                placeholder={vehicleQtyEnabled ? `e.g. 16` : `Catalogue: £${product.unit_price}`}
                                onChange={e => updateLinePrice(ordered.key, e.target.value)}
                                onClick={e => e.stopPropagation()}
                                className="h-8 text-sm font-semibold"
                              />
                            </div>
                            {(!isRadio || vehicleQtyEnabled) && (
                              <div className="flex-shrink-0">
                                <Label className="text-[11px] text-muted-foreground mb-1 block">
                                  {vehicleQtyEnabled ? "Units" : "Qty"}
                                </Label>
                                <div className="flex items-center gap-1">
                                  <button
                                    type="button"
                                    onClick={e => { e.stopPropagation(); updateQty(ordered.key, -1); }}
                                    className="w-7 h-8 rounded border border-border bg-background flex items-center justify-center hover:border-primary/50"
                                  >
                                    <Minus className="w-3 h-3" />
                                  </button>
                                  <span className="text-sm font-bold w-8 text-center">{ordered.quantity}</span>
                                  <button
                                    type="button"
                                    onClick={e => { e.stopPropagation(); updateQty(ordered.key, 1); }}
                                    className="w-7 h-8 rounded border border-border bg-background flex items-center justify-center hover:border-primary/50"
                                  >
                                    <Plus className="w-3 h-3" />
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                          {vehicleQtyEnabled && ordered.unit_price > 0 && ordered.quantity > 1 && (
                            <div className="flex items-center justify-between text-xs pt-1 border-t border-primary/10">
                              <span className="text-muted-foreground">£{ordered.unit_price} × {ordered.quantity} units</span>
                              <span className="font-bold text-primary">= £{(ordered.unit_price * ordered.quantity).toLocaleString()}</span>
                            </div>
                          )}
                          {ordered.unit_price !== product.unit_price && ordered.unit_price > 0 && (
                            <p className="text-[10px] text-amber-400">
                              Catalogue price is £{product.unit_price.toLocaleString()} — you've set a custom price for this booking
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Other (manual input) — Vehicle only */}
                {showVehicleOther && (
                  <div className={`rounded-xl border transition-all ${
                    otherVehicleLine
                      ? "border-primary bg-primary/8 shadow-[0_0_8px_rgba(201,168,76,0.1)]"
                      : "border-border/60 bg-background"
                  }`}>
                    <button
                      type="button"
                      onClick={toggleOtherVehicle}
                      className="w-full flex items-center gap-3 p-3 text-left"
                    >
                      <div className={`flex-shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${
                        otherVehicleLine ? "border-primary bg-primary" : "border-border"
                      }`}>
                        {otherVehicleLine && <div className="w-2 h-2 rounded-full bg-white" />}
                      </div>
                      <PenLine className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                      <span className="text-sm font-semibold text-foreground">Other (manual input)</span>
                    </button>
                    {otherVehicleLine && (
                      <div className="px-3 pb-3 space-y-2 border-t border-primary/10 pt-2">
                        <div>
                          <Label className="text-[11px] text-muted-foreground mb-1 block">Vehicle name</Label>
                          <Input
                            placeholder="e.g. MB V-Class, Range Rover, Rolls-Royce Ghost"
                            value={otherVehicleInput}
                            onChange={e => updateOtherVehicleName(e.target.value)}
                            onClick={e => e.stopPropagation()}
                            className="text-sm"
                            autoFocus
                          />
                        </div>
                        <div>
                          <Label className="text-[11px] text-muted-foreground mb-1 block">Price for this booking (£)</Label>
                          <Input
                            type="number"
                            step="1"
                            min="0"
                            placeholder="0"
                            value={otherVehiclePrice}
                            onChange={e => updateOtherVehiclePrice(e.target.value)}
                            onClick={e => e.stopPropagation()}
                            className="text-sm font-semibold"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* Order summary */}
      {orderLines.length > 0 && (
        <div className="rounded-2xl border border-primary/20 bg-primary/5 overflow-hidden mt-4">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-primary/10">
            <span className="text-xs font-semibold text-foreground uppercase tracking-wide">Order Summary</span>
            <span className="text-base font-bold text-primary">£{total.toLocaleString()}</span>
          </div>
          <div className="divide-y divide-primary/8 px-4">
            {orderLines.map(line => (
              <div key={line.key} className="flex items-center gap-2 py-2.5">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-foreground truncate">{line.name}</div>
                  {line.quantity > 1 && (
                    <div className="text-xs text-muted-foreground">
                      £{line.unit_price.toLocaleString()} × {line.quantity}
                    </div>
                  )}
                </div>
                <span className="text-sm font-semibold text-foreground flex-shrink-0">
                  £{(line.unit_price * line.quantity).toLocaleString()}
                </span>
                <button
                  type="button"
                  onClick={() => removeItem(line.key)}
                  className="w-6 h-6 rounded flex items-center justify-center text-muted-foreground hover:text-destructive transition-colors flex-shrink-0"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
