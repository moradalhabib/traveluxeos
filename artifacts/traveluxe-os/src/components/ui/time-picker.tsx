import { useEffect, useRef, useState } from "react";
import { Clock } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface TimePickerProps {
  value: string;
  onChange: (next: string) => void;
  className?: string;
  disabled?: boolean;
  placeholder?: string;
  /** Minute step in the picker. Default 5. Use 15 or 30 for shorter lists. */
  minuteStep?: 5 | 10 | 15 | 30;
  "data-testid"?: string;
}

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));

function splitTime(v: string): { h: string; m: string } {
  const m = /^(\d{2}):(\d{2})$/.exec(v ?? "");
  if (!m) return { h: "", m: "" };
  return { h: m[1], m: m[2] };
}

function snapMinute(min: string, step: number): string {
  const n = parseInt(min, 10);
  if (Number.isNaN(n)) return "00";
  const snapped = Math.round(n / step) * step;
  return String(Math.min(60 - step, snapped)).padStart(2, "0");
}

export function TimePicker({
  value,
  onChange,
  className,
  disabled,
  placeholder = "--:--",
  minuteStep = 5,
  ...rest
}: TimePickerProps) {
  const [open, setOpen] = useState(false);
  const { h, m } = splitTime(value);
  const minSnapped = m ? snapMinute(m, minuteStep) : "";
  const display = h && minSnapped ? `${h}:${minSnapped}` : placeholder;

  const minutes = Array.from({ length: 60 / minuteStep }, (_, i) =>
    String(i * minuteStep).padStart(2, "0"),
  );

  const hourColRef = useRef<HTMLDivElement>(null);
  const minColRef = useRef<HTMLDivElement>(null);

  // Scroll selected items into view when the popover opens.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      hourColRef.current?.querySelector<HTMLElement>("[data-selected=true]")?.scrollIntoView({ block: "center" });
      minColRef.current?.querySelector<HTMLElement>("[data-selected=true]")?.scrollIntoView({ block: "center" });
    }, 10);
    return () => clearTimeout(t);
  }, [open]);

  const setHour = (next: string) => onChange(`${next}:${minSnapped || "00"}`);
  const setMin = (next: string) => {
    onChange(`${h || "09"}:${next}`);
    // Close after picking minute — both halves selected = done.
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            "flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 text-sm font-medium text-foreground hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed",
            !value && "text-muted-foreground font-normal",
            className,
          )}
          data-testid={rest["data-testid"] ?? "time-picker-trigger"}
        >
          <span className="tabular-nums">{display}</span>
          <Clock className="h-4 w-4 opacity-60 shrink-0 ml-2" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={4}
        className="w-44 p-0 overflow-hidden"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="grid grid-cols-2 divide-x">
          <Column
            ref={hourColRef}
            label="Hour"
            options={HOURS}
            selected={h}
            onSelect={setHour}
            testidPrefix="time-h"
          />
          <Column
            ref={minColRef}
            label="Min"
            options={minutes}
            selected={minSnapped}
            onSelect={setMin}
            testidPrefix="time-m"
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

interface ColumnProps {
  label: string;
  options: string[];
  selected: string;
  onSelect: (v: string) => void;
  testidPrefix: string;
  ref?: React.Ref<HTMLDivElement>;
}

function Column({ label, options, selected, onSelect, testidPrefix, ref }: ColumnProps) {
  return (
    <div className="flex flex-col">
      <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground border-b text-center">
        {label}
      </div>
      <div ref={ref} className="h-48 overflow-y-auto py-1">
        {options.map((opt) => {
          const isSel = opt === selected;
          return (
            <button
              key={opt}
              type="button"
              data-selected={isSel}
              onClick={() => onSelect(opt)}
              className={cn(
                "w-full px-3 py-1.5 text-sm text-center tabular-nums transition-colors",
                isSel
                  ? "bg-primary text-primary-foreground font-semibold"
                  : "hover:bg-muted text-foreground",
              )}
              data-testid={`${testidPrefix}-${opt}`}
            >
              {opt}
            </button>
          );
        })}
      </div>
    </div>
  );
}
