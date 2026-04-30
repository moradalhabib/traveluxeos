// ─────────────────────────────────────────────────────────────────────────────
// SupplierServiceTypes
//
// Shared UI + helpers for the multi-select supplier service-type picker.
// Used on both the supplier directory create-dialog and the supplier
// profile/edit page so both surfaces stay in sync.
//
// Behavioural rules (mirrors the spec):
//   - Multi-select via checkbox grid.
//   - Exactly one type is the Primary (gold star). Default = the first one.
//   - Removing the current Primary auto-reassigns Primary to the first
//     remaining selected type and surfaces a toast warning.
//   - At least one type must remain selected. Returns a derived
//     `canSave` flag the caller uses to disable Save.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useRef } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Star } from "lucide-react";
import { toast } from "sonner";

export const SUPPLIER_SERVICE_TYPES = [
  "Airport Transfer", "Car Rental", "Hotel", "Apartment", "Tour Operator",
  "Restaurant", "Concierge", "Yacht", "Helicopter", "Other",
] as const;

export type SupplierServiceType = (typeof SUPPLIER_SERVICE_TYPES)[number];

// Read service_types + primary off a supplier row, falling back to the
// legacy single `category` so the UI works against pre-migration data.
export function deriveServiceTypes(supplier: {
  service_types?: string[] | null;
  primary_service_type?: string | null;
  category?: string | null;
} | null | undefined): { types: string[]; primary: string } {
  const arr = Array.isArray(supplier?.service_types) && supplier!.service_types!.length > 0
    ? supplier!.service_types!
    : (supplier?.category ? [supplier.category] : []);
  // Primary defaults to explicit primary_service_type, else legacy category,
  // else the first array entry.
  const primary = supplier?.primary_service_type
    || supplier?.category
    || arr[0]
    || "";
  return { types: arr, primary };
}

interface ServiceTypeMultiSelectProps {
  /** Currently selected service types (array order is preserved). */
  value: string[];
  /** Currently designated Primary (must be in `value`). */
  primary: string;
  /** Fired when types or primary change. Caller updates state with both. */
  onChange: (next: { types: string[]; primary: string }) => void;
  /** Optional className for the wrapper. */
  className?: string;
  /** When true, render compact (used in dialogs). */
  compact?: boolean;
}

export function ServiceTypeMultiSelect({
  value,
  primary,
  onChange,
  className,
  compact,
}: ServiceTypeMultiSelectProps) {
  const set = useMemo(() => new Set(value), [value]);

  // Track whether we already toasted the "primary auto-reassigned" message
  // so we don't double-fire when React re-renders.
  const lastWarnedFor = useRef<string | null>(null);

  // Self-heal: if the array ever ends up with no primary (or a primary not
  // in the array) AND has at least one entry, reassign and toast once.
  useEffect(() => {
    if (value.length === 0) return;
    if (!primary || !set.has(primary)) {
      const next = value[0];
      const reason = primary && !set.has(primary)
        ? `Primary type updated to ${next} as your previous primary was removed.`
        : null;
      if (reason && lastWarnedFor.current !== `${primary}->${next}`) {
        toast.warning(reason);
        lastWarnedFor.current = `${primary}->${next}`;
      }
      onChange({ types: value, primary: next });
    }
  }, [value, primary, set, onChange]);

  const toggle = (type: string, checked: boolean) => {
    let nextTypes: string[];
    let nextPrimary = primary;

    if (checked) {
      // Don't add duplicates; preserve the canonical CATEGORY order so the
      // UI stays predictable as types are toggled on and off.
      const wanted = new Set([...value, type]);
      nextTypes = SUPPLIER_SERVICE_TYPES.filter(t => wanted.has(t));
      // First-ever pick is automatically primary.
      if (!nextPrimary) nextPrimary = type;
    } else {
      nextTypes = value.filter(t => t !== type);
      // Removed the current primary → reassign to the first remaining type.
      if (type === primary) {
        const candidate = nextTypes[0] ?? "";
        nextPrimary = candidate;
        if (candidate) {
          toast.warning(`Primary type updated to ${candidate} as your previous primary was removed.`);
          lastWarnedFor.current = `${primary}->${candidate}`;
        }
      }
    }
    onChange({ types: nextTypes, primary: nextPrimary });
  };

  const setPrimary = (type: string) => {
    if (!set.has(type)) return; // Only ticked types are eligible.
    onChange({ types: value, primary: type });
  };

  const gridClass = compact
    ? "grid grid-cols-2 sm:grid-cols-3 gap-1.5"
    : "grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-1.5";

  return (
    <div className={className}>
      <div className={gridClass}>
        {SUPPLIER_SERVICE_TYPES.map(t => {
          const ticked = set.has(t);
          const isPrimary = ticked && t === primary;
          return (
            <label
              key={t}
              className={`flex items-center gap-2 px-2 py-1.5 rounded-md border cursor-pointer text-xs transition-colors ${
                ticked
                  ? "border-primary/50 bg-primary/5 text-foreground"
                  : "border-border bg-background/40 text-muted-foreground hover:border-primary/30 hover:text-foreground"
              }`}
              data-testid={`service-type-row-${t.toLowerCase().replace(/\s+/g, "-")}`}
            >
              <Checkbox
                checked={ticked}
                onCheckedChange={(v) => toggle(t, !!v)}
                data-testid={`checkbox-service-type-${t.toLowerCase().replace(/\s+/g, "-")}`}
              />
              <span className="flex-1 truncate">{t}</span>
              {ticked && (
                <button
                  type="button"
                  onClick={(e) => { e.preventDefault(); setPrimary(t); }}
                  title={isPrimary ? "Primary service type" : "Set as primary"}
                  className={`shrink-0 ${isPrimary ? "text-primary" : "text-muted-foreground/40 hover:text-primary"}`}
                  data-testid={`btn-primary-${t.toLowerCase().replace(/\s+/g, "-")}`}
                >
                  <Star className={`w-3.5 h-3.5 ${isPrimary ? "fill-current" : ""}`} />
                </button>
              )}
            </label>
          );
        })}
      </div>
      {value.length === 0 && (
        <p className="text-xs text-destructive mt-1.5" data-testid="error-no-service-types">
          Select at least one service type.
        </p>
      )}
      {value.length > 0 && (
        <p className="text-[11px] text-muted-foreground mt-1.5">
          <Star className="w-3 h-3 inline-block fill-primary text-primary mr-1 align-text-top" />
          Primary type: <span className="text-foreground font-medium">{primary}</span> — used on
          job sheets, invoices, and reporting.
        </p>
      )}
    </div>
  );
}

// Compact pills used by the supplier directory cards. Highlights the primary
// with a star and uses muted styling for secondary types.
export function ServiceTypePills({
  types,
  primary,
}: {
  types: string[];
  primary: string;
}) {
  if (!types || types.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1 justify-end max-w-[180px]">
      {types.map(t => {
        const isPrimary = t === primary;
        return (
          <span
            key={t}
            className={`text-[10px] py-0.5 px-1.5 rounded border inline-flex items-center gap-0.5 ${
              isPrimary
                ? "border-primary/50 text-primary bg-primary/10 font-semibold"
                : "border-border text-muted-foreground bg-secondary/20"
            }`}
            data-testid={`pill-service-type-${t.toLowerCase().replace(/\s+/g, "-")}`}
          >
            {isPrimary && <Star className="w-2.5 h-2.5 fill-current" />}
            {t}
          </span>
        );
      })}
    </div>
  );
}
