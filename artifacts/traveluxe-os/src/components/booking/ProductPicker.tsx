import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, Minus, X, ShoppingCart, ChevronDown, ChevronUp } from "lucide-react";

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

const CATEGORY_ORDER = ["Vehicle", "Meet & Greet", "Tour", "Add-on", "Accommodation"];
const CATEGORY_ICONS: Record<string, string> = {
  "Vehicle": "🚘",
  "Meet & Greet": "✨",
  "Tour": "🗺",
  "Add-on": "➕",
  "Accommodation": "🏠",
};

interface Props {
  orderLines: OrderLine[];
  onChange: (lines: OrderLine[]) => void;
}

export default function ProductPicker({ orderLines, onChange }: Props) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState("Vehicle");
  const [showPicker, setShowPicker] = useState(false);

  useEffect(() => {
    supabase
      .from("products")
      .select("*")
      .eq("active", true)
      .order("category")
      .order("sort_order")
      .then(({ data }) => {
        setProducts(data ?? []);
        setLoading(false);
      });
  }, []);

  const categories = CATEGORY_ORDER.filter(c => products.some(p => p.category === c));

  const addProduct = (product: Product) => {
    const existing = orderLines.find(l => l.product_id === product.id);
    if (existing) {
      onChange(orderLines.map(l =>
        l.product_id === product.id ? { ...l, quantity: l.quantity + 1 } : l
      ));
    } else {
      onChange([...orderLines, {
        key: `${product.id}-${Date.now()}`,
        product_id: product.id,
        name: product.name,
        unit_price: product.unit_price,
        quantity: 1,
      }]);
    }
  };

  const removeProduct = (key: string) => {
    onChange(orderLines.filter(l => l.key !== key));
  };

  const updateQty = (key: string, delta: number) => {
    onChange(orderLines.map(l => {
      if (l.key !== key) return l;
      const newQty = l.quantity + delta;
      return newQty <= 0 ? null : { ...l, quantity: newQty };
    }).filter(Boolean) as OrderLine[]);
  };

  const total = orderLines.reduce((s, l) => s + l.unit_price * l.quantity, 0);

  const inOrder = (productId: string) => orderLines.find(l => l.product_id === productId);

  return (
    <div className="space-y-3">
      {/* Order lines */}
      {orderLines.length > 0 && (
        <div className="rounded-xl border border-primary/20 bg-primary/5 overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-primary/10">
            <div className="flex items-center gap-2">
              <ShoppingCart className="w-4 h-4 text-primary" />
              <span className="text-xs font-semibold text-foreground">Order Lines</span>
              <Badge variant="outline" className="text-[10px] text-primary border-primary/30">{orderLines.length}</Badge>
            </div>
            <span className="text-sm font-bold text-primary">£{total.toLocaleString()}</span>
          </div>
          <div className="divide-y divide-primary/10">
            {orderLines.map(line => (
              <div key={line.key} className="flex items-center gap-2 px-3 py-2">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-foreground truncate">{line.name}</div>
                  <div className="text-xs text-muted-foreground">£{line.unit_price.toLocaleString()} each</div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => updateQty(line.key, -1)}
                    className="w-6 h-6 rounded-md bg-background border border-border flex items-center justify-center hover:border-primary/50 transition-colors"
                  >
                    <Minus className="w-3 h-3" />
                  </button>
                  <span className="w-6 text-center text-sm font-semibold">{line.quantity}</span>
                  <button
                    type="button"
                    onClick={() => updateQty(line.key, 1)}
                    className="w-6 h-6 rounded-md bg-background border border-border flex items-center justify-center hover:border-primary/50 transition-colors"
                  >
                    <Plus className="w-3 h-3" />
                  </button>
                  <span className="w-16 text-right text-sm font-semibold text-foreground">
                    £{(line.unit_price * line.quantity).toLocaleString()}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeProduct(line.key)}
                    className="w-6 h-6 rounded-md flex items-center justify-center text-muted-foreground hover:text-destructive transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between px-3 py-2 bg-primary/10 border-t border-primary/20">
            <span className="text-xs text-muted-foreground">Total from products</span>
            <span className="text-base font-bold text-primary">£{total.toLocaleString()}</span>
          </div>
        </div>
      )}

      {/* Toggle product picker */}
      <button
        type="button"
        onClick={() => setShowPicker(!showPicker)}
        className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl border border-border bg-card hover:border-primary/40 transition-colors text-sm text-muted-foreground"
      >
        <div className="flex items-center gap-2">
          <Plus className="w-4 h-4 text-primary" />
          <span>{showPicker ? "Close product catalogue" : "Add products from catalogue"}</span>
        </div>
        {showPicker ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>

      {showPicker && (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          {loading ? (
            <div className="py-8 text-center text-xs text-muted-foreground">Loading catalogue...</div>
          ) : categories.length === 0 ? (
            <div className="py-8 text-center text-xs text-muted-foreground">
              Run migration-products.sql in Supabase to load the catalogue
            </div>
          ) : (
            <>
              {/* Category tabs */}
              <div className="flex overflow-x-auto border-b border-border">
                {categories.map(cat => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setActiveCategory(cat)}
                    className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium whitespace-nowrap border-b-2 transition-colors flex-shrink-0 ${
                      activeCategory === cat
                        ? "border-primary text-primary bg-primary/5"
                        : "border-transparent text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <span>{CATEGORY_ICONS[cat] ?? "📋"}</span>
                    {cat}
                  </button>
                ))}
              </div>

              {/* Products grid */}
              <div className="p-3 space-y-2 max-h-64 overflow-y-auto">
                {products
                  .filter(p => p.category === activeCategory)
                  .map(product => {
                    const ordered = inOrder(product.id);
                    return (
                      <button
                        key={product.id}
                        type="button"
                        onClick={() => addProduct(product)}
                        className={`w-full flex items-center justify-between p-3 rounded-xl border text-left transition-all ${
                          ordered
                            ? "border-primary/50 bg-primary/8 bg-primary/10"
                            : "border-border bg-background/50 hover:border-primary/30 hover:bg-primary/5"
                        }`}
                      >
                        <div className="flex-1 min-w-0 pr-3">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-foreground">{product.name}</span>
                            {ordered && (
                              <Badge variant="outline" className="text-[10px] text-primary border-primary/30">
                                ×{ordered.quantity}
                              </Badge>
                            )}
                          </div>
                          {product.description && (
                            <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{product.description}</div>
                          )}
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <span className="text-sm font-bold text-primary">
                            {product.unit_price > 0 ? `£${product.unit_price.toLocaleString()}` : "Incl."}
                          </span>
                          <div className={`w-7 h-7 rounded-lg flex items-center justify-center border transition-all ${
                            ordered
                              ? "bg-primary border-primary text-primary-foreground"
                              : "border-border text-muted-foreground hover:border-primary hover:text-primary"
                          }`}>
                            <Plus className="w-3.5 h-3.5" />
                          </div>
                        </div>
                      </button>
                    );
                  })}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
