import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/lib/supabase";

export type NotifType =
  | "booking_new"
  | "booking_update"
  | "flight_delay"
  | "flight_landed"
  | "flight_early"
  | "flight_ontime"
  | "driver_assigned";

export interface AppNotification {
  id: string;
  type: NotifType;
  title: string;
  message: string;
  timestamp: Date;
  read: boolean;
  link?: string;
}

const STORAGE_KEY = "tvl_notifications";
const FLIGHT_CACHE_KEY = "tvl_flight_status_cache";
const BOOKING_POLL_KEY = "tvl_last_booking_check";
const MAX_STORED = 50;

function loadStored(): AppNotification[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as any[];
    return parsed.map(n => ({ ...n, timestamp: new Date(n.timestamp) }));
  } catch {
    return [];
  }
}

function save(items: AppNotification[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, MAX_STORED)));
  } catch {}
}

function getFlightCache(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(FLIGHT_CACHE_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function setFlightCache(cache: Record<string, string>) {
  try {
    localStorage.setItem(FLIGHT_CACHE_KEY, JSON.stringify(cache));
  } catch {}
}

function browserNotify(title: string, body: string) {
  if (typeof Notification === "undefined") return;
  if (Notification.permission === "granted") {
    try {
      new Notification(title, { body, icon: "/favicon.ico" });
    } catch {}
  }
}

export function useNotifications() {
  const [items, setItems] = useState<AppNotification[]>(loadStored);
  const bookingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const flightTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const seenIdsRef = useRef<Set<string>>(new Set(loadStored().map(n => n.link ?? "")));
  const prevStatusRef = useRef<Record<string, string>>({});

  const unreadCount = items.filter(n => !n.read).length;

  const push = useCallback((type: NotifType, title: string, message: string, link?: string) => {
    const n: AppNotification = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      type,
      title,
      message,
      timestamp: new Date(),
      read: false,
      link,
    };
    setItems(prev => {
      const next = [n, ...prev].slice(0, MAX_STORED);
      save(next);
      return next;
    });
    browserNotify(title, message);
  }, []);

  const markAllRead = useCallback(() => {
    setItems(prev => {
      const next = prev.map(n => ({ ...n, read: true }));
      save(next);
      return next;
    });
  }, []);

  const dismiss = useCallback((id: string) => {
    setItems(prev => {
      const next = prev.filter(n => n.id !== id);
      save(next);
      return next;
    });
  }, []);

  const clearAll = useCallback(() => {
    setItems([]);
    save([]);
  }, []);

  // Request browser notification permission on mount
  useEffect(() => {
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
  }, []);

  // Poll for new bookings + status changes every 20 seconds
  useEffect(() => {
    const pollBookings = async () => {
      try {
        const lastCheck = localStorage.getItem(BOOKING_POLL_KEY) ?? new Date(Date.now() - 5 * 60000).toISOString();

        // New bookings created since last check
        const { data: newBookings } = await supabase
          .from("bookings")
          .select("id, tvl_ref, client_name, service_type, status, driver_id, created_at")
          .gt("created_at", lastCheck)
          .order("created_at", { ascending: false })
          .limit(10);

        if (newBookings && newBookings.length > 0) {
          for (const bk of newBookings) {
            const link = `/bookings/${bk.id}`;
            if (seenIdsRef.current.has(`new_${bk.id}`)) continue;
            seenIdsRef.current.add(`new_${bk.id}`);
            push(
              "booking_new",
              "New Booking Created",
              `${bk.tvl_ref ?? ""} · ${bk.client_name ?? "Client"} · ${bk.service_type ?? ""}`.trim(),
              link
            );
          }
        }

        // Check for recent status changes (bookings updated in last 60s)
        const oneMinAgo = new Date(Date.now() - 60 * 1000).toISOString();
        const { data: updatedBookings } = await supabase
          .from("bookings")
          .select("id, tvl_ref, client_name, status, driver_id, updated_at")
          .gt("updated_at", oneMinAgo)
          .order("updated_at", { ascending: false })
          .limit(10);

        if (updatedBookings && updatedBookings.length > 0) {
          for (const bk of updatedBookings) {
            const statusKey = `status_${bk.id}`;
            const driverKey = `driver_${bk.id}`;
            const prevStatus = prevStatusRef.current[statusKey];
            const prevDriver = prevStatusRef.current[driverKey];

            // Status change detected
            if (prevStatus && prevStatus !== bk.status && !seenIdsRef.current.has(`status_${bk.id}_${bk.status}`)) {
              seenIdsRef.current.add(`status_${bk.id}_${bk.status}`);
              push(
                "booking_update",
                "Booking Status Updated",
                `${bk.tvl_ref ?? ""} · ${bk.client_name ?? ""} → ${bk.status}`,
                `/bookings/${bk.id}`
              );
            }

            // Driver newly assigned
            if (!prevDriver && bk.driver_id && !seenIdsRef.current.has(`driver_${bk.id}`)) {
              seenIdsRef.current.add(`driver_${bk.id}`);
              push(
                "driver_assigned",
                "Driver Assigned",
                `${bk.tvl_ref ?? ""} · Driver assigned to ${bk.client_name ?? "client"}`,
                `/bookings/${bk.id}`
              );
            }

            prevStatusRef.current[statusKey] = bk.status;
            prevStatusRef.current[driverKey] = bk.driver_id ?? "";
          }
        }

        localStorage.setItem(BOOKING_POLL_KEY, new Date().toISOString());
      } catch {}
    };

    pollBookings();
    bookingTimerRef.current = setInterval(pollBookings, 20 * 1000);

    return () => {
      if (bookingTimerRef.current) clearInterval(bookingTimerRef.current);
    };
  }, [push]);

  // Flight status polling — every 4 minutes
  useEffect(() => {
    const pollFlights = async () => {
      try {
        const today = new Date().toISOString().split("T")[0];
        const tomorrow = new Date(Date.now() + 86400000).toISOString().split("T")[0];

        const { data: bookings } = await supabase
          .from("bookings")
          .select("id, tvl_ref, flight_number, date_time, client_name")
          .eq("service_type", "Airport Transfer")
          .not("flight_number", "is", null)
          .not("status", "in", '("Cancelled","Completed")')
          .gte("date_time", `${today}T00:00:00Z`)
          .lte("date_time", `${tomorrow}T23:59:59Z`);

        if (!bookings || bookings.length === 0) return;

        const cache = getFlightCache();

        await Promise.allSettled(
          bookings.map(async (bk: any) => {
            if (!bk.flight_number) return;
            try {
              const res = await fetch(`/api/flight-tracker/${bk.flight_number.toUpperCase()}?date=${today}`);
              if (!res.ok) return;
              const data = await res.json();
              const newStatus: string = data.status ?? "Unknown";
              const cacheKey = `${bk.flight_number.toUpperCase()}_${today}`;
              const prevStatus = cache[cacheKey];

              if (prevStatus === newStatus) return;
              cache[cacheKey] = newStatus;

              const label = `${bk.flight_number.toUpperCase()} · ${bk.client_name ?? ""}`;
              const link = `/bookings/${bk.id}`;

              if (newStatus === "Landed" && prevStatus !== "Landed") {
                push("flight_landed", "Flight Landed", `${label} has landed`, link);
              } else if (newStatus === "Delayed" && prevStatus !== "Delayed") {
                const delay = data.delay_minutes ? `+${data.delay_minutes}min delay` : "delayed";
                push("flight_delay", "Flight Delayed", `${label} is ${delay}`, link);
              } else if (newStatus === "On Time" && prevStatus === "Delayed") {
                push("flight_ontime", "Flight Now On Time", `${label} delay resolved`, link);
              }
            } catch {}
          })
        );

        setFlightCache(cache);
      } catch {}
    };

    pollFlights();
    flightTimerRef.current = setInterval(pollFlights, 4 * 60 * 1000);

    return () => {
      if (flightTimerRef.current) clearInterval(flightTimerRef.current);
    };
  }, [push]);

  return { items, unreadCount, push, markAllRead, dismiss, clearAll };
}
