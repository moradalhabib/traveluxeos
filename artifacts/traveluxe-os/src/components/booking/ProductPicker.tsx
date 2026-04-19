import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { Badge } from "@/components/ui/badge";
import { Plus, Minus, X, Check, ChevronDown, ChevronUp, Car, Sparkles, Map, Package, Building2 } from "lucide-react";

export interface OrderLine {
  key: string;
  product_id: string | null;
  name: string;
  unit_price: number;
  quantity: number;
  notes?: string;
}

interface Product {
  id: string;
  name: string;
  category: string;
  description: string | null;
  unit_price: number;
  active: boolean;
}

// Map each service type to which category sections to show, in order
const SERVICE_CATEGORY_MAP: Record<string, string[]> = {
  "Airport Transfer":       ["Vehicle", "Meet & Greet", "Add-on"],
  "Event Transfer":         ["Vehicle", "Meet & Greet", "Add-on"],
  "As Directed":            ["Vehicle", "Add-on"],
  "Tour":                   ["Tour", "Vehicle", "Add-on"],
  "City Tour":              ["Tour", "Vehicle", "Add-on"],
  "Chauffeur Tour":         ["Tour", "Vehicle", "Add-on"],
  "Apartment / Accommodation": ["Accommodation", "Add-on"],
};
const DEFAULT_CATEGORIES = ["Vehicle", "Meet & Greet", "Tour", "Add-on", "Accommodation"];

// Categories that are radio-style (one selection replaces the previous)
const RADIO_CATEGORIES = new Set(["Vehicle", "Meet & Greet", "Tour"]);

const CATEGORY_META: Record<string, { icon: React.ReactNode; label: string; hint: string; radio: boolean }> = {
  "Vehicle": {
    icon: <Car className="w-4 h-4" />,
    label: "Vehicle",
    hint: "Choose one vehicle",
    radio: true,
  },
  "Meet & Greet": {
    icon: <Sparkles className="w-4 h-4" />,
    label: "Meet & Greet",
    hint: "Choose a tier — Silver, Gold or Diamond",
    radio: true,
  },
  "Tour": {
    icon: <Map className="w-4 h-4" />,
    label: "Tour Destination",
    hint: "Choose a tour",
    radio: true,
  },
  "Add-on": {
    icon: <Plus className="w-4 h-4" />,
    label: "Extras & Add-ons",
    hint: "Select any extras",
    radio: false,
  },
  "Accommodation": {
    icon: <Building2 className="w-4 h-4" />,
    label: "Accommodation",
    hint: "Select accommodation options",
    radio: false,
  },
};

interface Props {
  orderLines: OrderLine[];
  onChange: (lines: OrderLine[]) => void;
  serviceType?: string;
}

export default function ProductPicker({ orderLines, onChange, serviceType }: Props) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [openSections, setOpenSections] = useState<Set<string>>(new Set(["Vehicle"]));

  useEffect(() => {
    supabase
      .from("products")
      .select("*")
      .eq("active", true)
      .order("sort_order")
      .then(({ data }) => {
        setProducts(data ?? []);
        setLoading(false);
      });
  }, []);

  // Determine which categories to show based on service type
  const categories = serviceType && SERVICE_CATEGORY_MAP[serviceType]
    ? SERVICE_CATEGORY_MAP[serviceType]
    : DEFAULT_CATEGORIES;

  // When service type changes, auto-open the first relevant section
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
  const total = orderLines.reduce((s, l) => s + l.unit_price * l.quantity, 0);

  const selectProduct = (product: Product) => {
    const isRadio = RADIO_CATEGORIES.has(product.category);

    if (isRadio) {
      // Replace any existing selection in this category
      const withoutCategory = orderLines.filter(l => {
        const p = products.find(p => p.id === l.product_id);
        return !p || p.category !== product.category;
      });
      // If already selected, deselect (toggle off)
      const alreadySelected = orderLines.find(l => l.product_id === product.id);
      if (alreadySelected) {
        onChange(withoutCategory);
      } else {
        onChange([...withoutCategory, {
          key: `${product.id}-${Date.now()}`,
          product_id: product.id,
          name: product.name,
          unit_price: product.unit_price,
          quantity: 1,
        }]);
        // Auto-open next section after selection
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
      // Multi-select: toggle on/off
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
        }]);
      }
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
    onChange(orderLines.filter(l => l.key !== key));
  };

  if (loading) {
    return (
      <div className="py-6 text-center text-xs text-muted-foreground">
        Loading catalogue...
      </div>
    );
  }

  const availableCategories = categories.filter(c =>
    products.some(p => p.category === c)
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
      {/* Guided sections */}
      {availableCategories.map((cat, catIdx) => {
        const meta = CATEGORY_META[cat] ?? { icon: <Package className="w-4 h-4" />, label: cat, hint: "", radio: false };
        const catProducts = products.filter(p => p.category === cat);
        const selectedInCat = orderLines.filter(l => {
          const p = products.find(p => p.id === l.product_id);
          return p?.category === cat;
        });
        const isOpen = openSections.has(cat);
        const hasSelection = selectedInCat.length > 0;

        return (
          <div
            key={cat}
            className={`rounded-2xl border overflow-hidden transition-all ${
              hasSelection
                ? "border-primary/40 bg-primary/3"
                : "border-border bg-card"
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
                      {selectedInCat.length === 1 && selectedInCat[0].unit_price > 0 &&
                        ` · £${selectedInCat[0].unit_price.toLocaleString()}`}
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

            {/* Products grid */}
            {isOpen && (
              <div className="px-3 pb-3 border-t border-border/60 pt-3 space-y-2">
                {catProducts.map(product => {
                  const ordered = inOrder(product.id);
                  const isRadio = RADIO_CATEGORIES.has(cat);

                  return (
                    <button
                      key={product.id}
                      type="button"
                      onClick={() => selectProduct(product)}
                      className={`w-full flex items-center justify-between p-3 rounded-xl border text-left transition-all ${
                        ordered
                          ? "border-primary bg-primary/8 shadow-[0_0_8px_rgba(201,168,76,0.1)]"
                          : "border-border/60 bg-background hover:border-primary/30 hover:bg-primary/3"
                      }`}
                    >
                      <div className="flex items-center gap-3 flex-1 min-w-0 pr-2">
                        {/* Radio indicator for single-select, checkbox for multi */}
                        <div className={`flex-shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${
                          ordered
                            ? "border-primary bg-primary"
                            : "border-border"
                        }`}>
                          {ordered && <div className={`${isRadio ? "w-2 h-2 rounded-full bg-white" : ""}`}>
                            {!isRadio && <Check className="w-3 h-3 text-white" />}
                          </div>}
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
                        <span className={`text-sm font-bold ${ordered ? "text-primary" : "text-foreground"}`}>
                          {product.unit_price > 0 ? `£${product.unit_price.toLocaleString()}` : "Incl."}
                        </span>
                        {ordered && !isRadio && (
                          <div className="flex items-center gap-1 mt-1 justify-end">
                            <button
                              type="button"
                              onClick={e => { e.stopPropagation(); updateQty(ordered.key, -1); }}
                              className="w-5 h-5 rounded border border-border bg-background flex items-center justify-center hover:border-primary/50"
                            >
                              <Minus className="w-2.5 h-2.5" />
                            </button>
                            <span className="text-xs font-bold w-4 text-center">{ordered.quantity}</span>
                            <button
                              type="button"
                              onClick={e => { e.stopPropagation(); updateQty(ordered.key, 1); }}
                              className="w-5 h-5 rounded border border-border bg-background flex items-center justify-center hover:border-primary/50"
                            >
                              <Plus className="w-2.5 h-2.5" />
                            </button>
                          </div>
                        )}
                      </div>
                    </button>
                  );
                })}
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
