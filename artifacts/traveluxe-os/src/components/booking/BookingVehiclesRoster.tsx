import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Car, Users } from "lucide-react";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/lib/supabase";

type ExtraVehicle = {
  id: string;
  driver_id: string | null;
  driver_name: string | null;
  driver_staff_no: string | null;
  driver_vehicle: string | null;
  driver_plate: string | null;
  vehicle_type: string | null;
  client_share: number;
  cost_to_company: number;
  driver_receives: number;
  tvl_commission: number;
  commission_status: string;
  payout_status: string;
  notes: string | null;
};

interface Props {
  bookingId: string;
}

export function BookingVehiclesRoster({ bookingId }: Props) {
  const [rows, setRows] = useState<ExtraVehicle[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token ?? "";
        const r = await fetch(`/api/booking-vehicles?booking_id=${encodeURIComponent(bookingId)}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!r.ok) throw new Error(await r.text());
        const data = await r.json();
        if (!cancelled) setRows(data ?? []);
      } catch (e) {
        console.warn("[BookingVehiclesRoster] fetch failed", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [bookingId]);

  if (loading) return null;
  if (rows.length === 0) return null;

  return (
    <Card className="border-primary/10 bg-card">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Users className="w-4 h-4" /> Multi-Vehicle Roster
          <Badge variant="outline" className="ml-1 text-xs">{rows.length + 1} cars</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-xs text-muted-foreground">
          Primary driver above is car #1. Below are the additional cars on this booking — each with their own driver and pay.
        </p>
        {rows.map((row, idx) => (
          <div key={row.id} className="rounded-md border border-border/60 bg-background/50 p-3 space-y-1.5">
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold text-primary">Car #{idx + 2}</div>
              <div className="flex items-center gap-1.5">
                <Badge variant={row.commission_status === "Settled" ? "secondary" : "outline"} className="text-[10px]">
                  Comm: {row.commission_status}
                </Badge>
                <Badge variant={row.payout_status === "Paid" ? "secondary" : "outline"} className="text-[10px]">
                  Payout: {row.payout_status}
                </Badge>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Driver</p>
                {row.driver_id ? (
                  <Link href={`/drivers/${row.driver_id}`}>
                    <span className="font-semibold text-primary hover:underline cursor-pointer">
                      {row.driver_staff_no ? `${row.driver_staff_no} · ` : ""}{row.driver_name ?? "—"}
                    </span>
                  </Link>
                ) : (
                  <span className="font-medium text-destructive">Unassigned</span>
                )}
              </div>
              <div>
                <p className="text-xs text-muted-foreground flex items-center gap-1"><Car className="w-3 h-3" /> Vehicle</p>
                <p className="font-medium">
                  {row.vehicle_type || row.driver_vehicle || "—"}
                  {row.driver_plate ? <span className="text-xs text-muted-foreground"> · {row.driver_plate}</span> : null}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-4 gap-2 text-xs pt-1.5 border-t border-border/40">
              <div>
                <span className="text-muted-foreground block">Client £</span>
                <span className="font-semibold">£{Number(row.client_share).toFixed(2)}</span>
              </div>
              <div>
                <span className="text-muted-foreground block">Cost £</span>
                <span className="font-semibold">£{Number(row.cost_to_company).toFixed(2)}</span>
              </div>
              <div>
                <span className="text-muted-foreground block">Driver pay</span>
                <span className="font-semibold">£{Number(row.driver_receives).toFixed(2)}</span>
              </div>
              <div>
                <span className="text-muted-foreground block">TVL comm</span>
                <span className="font-semibold">£{Number(row.tvl_commission).toFixed(2)}</span>
              </div>
            </div>

            {row.notes && (
              <p className="text-xs text-muted-foreground pt-1.5 border-t border-border/40">
                {row.notes}
              </p>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
