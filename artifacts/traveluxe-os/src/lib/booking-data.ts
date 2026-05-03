import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useListDrivers, getListDriversQueryKey } from "@workspace/api-client-react";
import { supabase } from "@/lib/supabase";

/**
 * Shared data hook for the JobCard contexts (Jobs / Upcoming / Bookings).
 * Pulls drivers + suppliers + booking_vehicles for a set of bookings so each
 * view can render the unified card without duplicating data plumbing.
 */
export function useJobCardContext(bookingIds: string[]) {
  const { data: drivers } = useListDrivers({}, { query: { queryKey: getListDriversQueryKey({}) } });
  const driversById = useMemo(() => {
    const m = new Map<string, any>();
    (drivers as any[] | undefined)?.forEach((d) => m.set(d.id, d));
    return m;
  }, [drivers]);

  const { data: suppliers } = useQuery<any[]>({
    queryKey: ["jobcard-suppliers"],
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/suppliers", {
        headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
      });
      if (!res.ok) return [];
      return res.json();
    },
  });
  const suppliersById = useMemo(() => {
    const m = new Map<string, any>();
    (suppliers as any[] | undefined)?.forEach((s) => m.set(s.id, s));
    return m;
  }, [suppliers]);

  const idsKey = bookingIds.join(",");
  const { data: allVehicles } = useQuery<any[]>({
    queryKey: ["jobcard:booking-vehicles", idsKey],
    enabled: bookingIds.length > 0,
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token ?? "";
      const r = await fetch(
        `/api/booking-vehicles?booking_ids=${encodeURIComponent(idsKey)}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!r.ok) return [];
      return r.json();
    },
  });
  const vehiclesByBooking = useMemo(() => {
    const m = new Map<string, any[]>();
    (allVehicles ?? []).forEach((v: any) => {
      if (!v.booking_id) return;
      if (!m.has(v.booking_id)) m.set(v.booking_id, []);
      m.get(v.booking_id)!.push(v);
    });
    return m;
  }, [allVehicles]);

  return { driversById, suppliersById, vehiclesByBooking };
}
