import { useEffect, useState } from "react";
import { Map, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";

type ExtraVehicle = {
  id: string;
  pickup: string | null;
  dropoff: string | null;
  date_time: string | null;
};

interface Props {
  bookingId: string;
}

/**
 * Inline hint shown on the booking detail header / Journey card whenever any
 * extra car on this booking has its own pickup, drop-off, or pickup time set.
 *
 * The Vehicle Roster card already shows the full per-leg detail; this is a
 * "don't miss it" cue for operators glancing at the parent route.
 *
 * Renders nothing while loading, on fetch failure, or when no overrides exist
 * — silence by default keeps single-route bookings clean.
 */
export function BookingRouteOverridesHint({ bookingId }: Props) {
  const [rows, setRows] = useState<ExtraVehicle[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token ?? "";
        const r = await fetch(
          `/api/booking-vehicles?booking_id=${encodeURIComponent(bookingId)}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (!r.ok) throw new Error(await r.text());
        const data = (await r.json()) as ExtraVehicle[];
        if (!cancelled) setRows(data ?? []);
      } catch {
        if (!cancelled) setRows([]);
      }
    })();
    return () => { cancelled = true; };
  }, [bookingId]);

  if (!rows || rows.length === 0) return null;

  const overrides = rows.filter(r => r.pickup || r.dropoff || r.date_time).length;
  if (overrides === 0) return null;

  const totalCars = rows.length + 1;

  const scrollToRoster = () => {
    const el = document.getElementById("vehicle-roster");
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      el.classList.add("ring-2", "ring-primary/60");
      setTimeout(() => el.classList.remove("ring-2", "ring-primary/60"), 1600);
    }
  };

  return (
    <div
      className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2.5 flex items-center gap-2 text-xs"
      data-testid="route-override-hint"
    >
      <Map className="w-4 h-4 text-amber-400 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <span className="font-semibold text-amber-300">
          {overrides} of {totalCars} cars on different routes
        </span>
        <span className="text-amber-200/80">
          {" "}— see Vehicle Roster for per-leg pickup &amp; time.
        </span>
      </div>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-7 px-2 text-amber-300 hover:text-amber-200 hover:bg-amber-500/15"
        onClick={scrollToRoster}
        data-testid="btn-view-roster"
      >
        View roster <ChevronRight className="w-3.5 h-3.5 ml-0.5" />
      </Button>
    </div>
  );
}
