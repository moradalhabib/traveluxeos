import { cn } from "@/lib/utils";

interface TimePickerProps {
  value: string;
  onChange: (next: string) => void;
  className?: string;
  /** Quick-pick times shown as chips above the dropdowns. Empty array = no chips. */
  presets?: string[];
  disabled?: boolean;
  "data-testid"?: string;
}

const DEFAULT_PRESETS = ["06:00", "09:00", "12:00", "15:00", "18:00", "21:00"];

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
const MINUTES = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, "0"));

function splitTime(v: string): { h: string; m: string } {
  const m = /^(\d{2}):(\d{2})$/.exec(v ?? "");
  if (!m) return { h: "", m: "" };
  return { h: m[1], m: m[2] };
}

function snapMinute(min: string): string {
  const n = parseInt(min, 10);
  if (Number.isNaN(n)) return "00";
  const snapped = Math.round(n / 5) * 5;
  return String(Math.min(55, snapped)).padStart(2, "0");
}

export function TimePicker({
  value,
  onChange,
  className,
  presets = DEFAULT_PRESETS,
  disabled,
  ...rest
}: TimePickerProps) {
  const { h, m } = splitTime(value);
  const minSnapped = m ? snapMinute(m) : "";

  const setHour = (next: string) => onChange(`${next}:${minSnapped || "00"}`);
  const setMin = (next: string) => onChange(`${h || "09"}:${next}`);

  return (
    <div className={cn("space-y-2", className)} data-testid={rest["data-testid"]}>
      {presets.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {presets.map((p) => {
            const active = value === p;
            return (
              <button
                key={p}
                type="button"
                onClick={() => onChange(p)}
                disabled={disabled}
                className={cn(
                  "px-2.5 py-1 rounded-full text-xs font-medium border transition-colors",
                  active
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background text-foreground border-border hover:bg-muted",
                )}
                data-testid={`time-preset-${p}`}
              >
                {p}
              </button>
            );
          })}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <select
          aria-label="Hour"
          value={h}
          onChange={(e) => setHour(e.target.value)}
          disabled={disabled}
          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 disabled:opacity-50"
          data-testid="time-hour"
        >
          <option value="" disabled>HH</option>
          {HOURS.map(hh => <option key={hh} value={hh}>{hh}</option>)}
        </select>
        <select
          aria-label="Minute"
          value={minSnapped}
          onChange={(e) => setMin(e.target.value)}
          disabled={disabled}
          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 disabled:opacity-50"
          data-testid="time-minute"
        >
          <option value="" disabled>MM</option>
          {MINUTES.map(mm => <option key={mm} value={mm}>{mm}</option>)}
        </select>
      </div>
    </div>
  );
}
