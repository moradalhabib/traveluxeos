import { cn } from "@/lib/utils";
import type { SlaState, SlaTone } from "@/lib/sla";

const TONE_STYLES: Record<SlaTone, string> = {
  // Calm three-tone palette — matches the neutral/amber/red tones
  // already used elsewhere in the app (status badges, follow-up
  // banners) so the SLA pill feels native, not bolted-on.
  neutral: "bg-muted/40 text-muted-foreground border-border/60",
  amber:   "bg-amber-500/15 text-amber-300 border-amber-500/40",
  red:     "bg-red-500/15 text-red-300 border-red-500/40",
};

export function SlaPill({
  state,
  className,
  testId,
}: {
  state: SlaState;
  className?: string;
  testId?: string;
}) {
  if (!state.tone || !state.label) return null;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium leading-none whitespace-nowrap",
        TONE_STYLES[state.tone],
        className,
      )}
      data-testid={testId}
      data-sla-tone={state.tone}
      title="Time since this row entered the queue (SLA)"
    >
      {state.label}
    </span>
  );
}

/**
 * Three-dot legend shown under the page header on the Requests and
 * Follow-ups pages so the colour code is self-explanatory on first
 * sight. Same calm palette as the pill itself.
 */
export function SlaLegend({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground",
        className,
      )}
      data-testid="sla-legend"
    >
      <span className="font-medium text-foreground/80">SLA:</span>
      <LegendDot tone="neutral" label="Within SLA" />
      <LegendDot tone="amber"   label="Approaching" />
      <LegendDot tone="red"     label="Breached" />
    </div>
  );
}

function LegendDot({ tone, label }: { tone: SlaTone; label: string }) {
  const dotCls =
    tone === "red" ? "bg-red-400"
    : tone === "amber" ? "bg-amber-400"
    : "bg-muted-foreground/60";
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("inline-block w-2 h-2 rounded-full", dotCls)} aria-hidden />
      <span>{label}</span>
    </span>
  );
}
