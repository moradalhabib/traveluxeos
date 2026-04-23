import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export type ActiveFilter = {
  key: string;
  label: string;
  value: string;
  onClear: () => void;
};

type Props = {
  filters: ActiveFilter[];
  onClearAll?: () => void;
  className?: string;
};

export function ActiveFilterChips({ filters, onClearAll, className }: Props) {
  if (filters.length === 0) return null;
  return (
    <div
      className={cn(
        "flex items-center flex-wrap gap-1.5 px-1 py-1 text-xs",
        className,
      )}
      data-testid="active-filter-chips"
    >
      <span className="text-muted-foreground mr-0.5">Active filters:</span>
      {filters.map((f) => (
        <button
          key={f.key}
          type="button"
          onClick={f.onClear}
          className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 hover:bg-muted px-2 py-0.5 text-foreground transition-colors"
          data-testid={`chip-${f.key}`}
          title={`Clear ${f.label} filter`}
        >
          <span className="text-muted-foreground">{f.label}:</span>
          <span className="font-medium">{f.value}</span>
          <X className="h-3 w-3 text-muted-foreground" />
        </button>
      ))}
      {onClearAll && filters.length >= 1 && (
        <button
          type="button"
          onClick={onClearAll}
          className="ml-1 text-xs text-muted-foreground underline-offset-2 hover:underline hover:text-foreground"
          data-testid="chip-clear-all"
        >
          Clear all
        </button>
      )}
    </div>
  );
}
