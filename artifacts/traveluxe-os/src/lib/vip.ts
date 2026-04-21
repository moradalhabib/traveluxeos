// Single source of truth for VIP tier badge styling so every surface in the
// app (clients, bookings, jobs, dashboard, follow-ups, marketing, invoices)
// renders the same colours for the same tier.
//
// Order, low → high: Standard < VIP < VVIP < Platinum.
// Platinum gets a gold/amber gradient with a soft glow so it visually stands
// apart from VVIP (purple) and VIP (brand primary).

export type VipTier = "Standard" | "VIP" | "VVIP" | "Platinum";

export const VIP_TIERS: VipTier[] = ["Standard", "VIP", "VVIP", "Platinum"];

export function getVipBadgeColor(tier?: string | null): string {
  switch (tier) {
    case "Platinum":
      return "bg-gradient-to-r from-amber-500/30 to-yellow-300/30 text-amber-200 border-amber-400/70 shadow-[0_0_8px_rgba(251,191,36,0.35)]";
    case "VVIP":
      return "bg-purple-500/20 text-purple-400 border-purple-500/50";
    case "VIP":
      return "bg-primary/20 text-primary border-primary/50";
    default:
      return "bg-secondary text-secondary-foreground border-border";
  }
}

// Compact pill variant used on dense surfaces (job cards, dashboard rows).
// Same colour intent as the badge above, smaller padding + uppercase tracking.
export function getVipPillClass(tier?: string | null): string {
  const base =
    "text-[9px] px-1.5 py-0.5 rounded uppercase font-semibold tracking-wider border";
  switch (tier) {
    case "Platinum":
      return `${base} bg-gradient-to-r from-amber-500/30 to-yellow-300/30 text-amber-200 border-amber-400/70`;
    case "VVIP":
      return `${base} bg-purple-500/20 text-purple-300 border-purple-500/50`;
    case "VIP":
      return `${base} bg-primary/20 text-primary border-primary/50`;
    default:
      return `${base} bg-secondary text-secondary-foreground border-border`;
  }
}
