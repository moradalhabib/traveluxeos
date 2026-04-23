import * as React from "react";
import { useSearch } from "wouter";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

/**
 * URL-backed filter state that survives a page refresh and lets operators
 * deep-link / share a filtered view. Drop-in replacement for `useState<T>`
 * where `T` extends `string`. Values equal to `defaultValue` are stripped
 * from the query string to keep URLs clean. Updates use `replaceState` so
 * filter toggling does not pollute the browser history stack.
 */
export function useFilterState<T extends string = string>(
  key: string,
  defaultValue: NoInfer<T>,
): [T, (next: T) => void] {
  const search = useSearch();
  const raw = new URLSearchParams(search).get(key);
  const value = (raw ?? defaultValue) as T;

  const setValue = React.useCallback(
    (next: T) => {
      if (typeof window === "undefined") return;
      const params = new URLSearchParams(window.location.search);
      if (next == null || next === "" || next === defaultValue) {
        params.delete(key);
      } else {
        params.set(key, next);
      }
      const qs = params.toString();
      const newUrl = `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`;
      window.history.replaceState(null, "", newUrl);
      // wouter's `useSearch` listens for popstate; nudge it so callers re-render.
      window.dispatchEvent(new PopStateEvent("popstate"));
    },
    [key, defaultValue],
  );

  return [value, setValue];
}

export type FilterDropdownOption = {
  value: string;
  label: string;
  count?: number;
};

type Props = {
  value: string;
  onChange: (v: string) => void;
  options: FilterDropdownOption[];
  label?: string;
  placeholder?: string;
  className?: string;
  triggerClassName?: string;
  testId?: string;
  widthClass?: string;
};

export function FilterDropdown({
  value,
  onChange,
  options,
  label,
  placeholder,
  className,
  triggerClassName,
  testId,
  widthClass = "w-44",
}: Props) {
  return (
    <div className={cn("flex items-center gap-2 min-w-0", className)}>
      {label && (
        <span className="text-xs text-muted-foreground whitespace-nowrap">{label}</span>
      )}
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger
          className={cn("h-9 text-xs", widthClass, triggerClassName)}
          data-testid={testId}
        >
          <SelectValue placeholder={placeholder ?? "Select"} />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value} className="text-xs">
              <span className="flex items-center gap-2">
                <span>{o.label}</span>
                {typeof o.count === "number" && (
                  <span className="text-[10px] text-muted-foreground tabular-nums">
                    ({o.count})
                  </span>
                )}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
