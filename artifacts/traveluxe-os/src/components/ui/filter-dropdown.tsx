import * as React from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

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
