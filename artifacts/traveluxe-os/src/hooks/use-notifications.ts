import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";

// All notification types the app understands. Server-emitted types come
// from artifacts/api-server/src/services/notify.ts. Local-only types are
// produced by client-side flight polling (slice 1 transitional).
export type NotifType =
  // Server
  | "booking_new"
  | "booking_status"
  | "booking_amended"
  | "booking_cancelled"
  | "job_assigned"
  | "no_driver_3h"
  | "no_driver_24h"
  | "follow_up_due"
  | "task_assigned"
  | "task_overdue"
  | "weekly_commission"
  | "unpaid_invoice"
  | "direct_message"
  | "announcement"
  // Local-only (flight tracker, not yet server-side)
  | "flight_delay"
  | "flight_landed"
  | "flight_early"
  | "flight_ontime"
  // Legacy aliases used by older bell UI
  | "booking_update"
  | "booking_started"
  | "booking_reminder"
  | "driver_assigned";

export type NotifSeverity = "info" | "success" | "warning" | "urgent";

export interface AppNotification {
  id: string;
  type: NotifType;
  title: string;
  message: string;
  timestamp: Date;
  read: boolean;
  link?: string;
  severity?: NotifSeverity;
  /** True for in-memory only (e.g. legacy flight-poll). Skip API calls. */
  local?: boolean;
}

const FLIGHT_CACHE_KEY = "tvl_flight_status_cache";
const MAX_KEEP = 50;

function getFlightCache(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(FLIGHT_CACHE_KEY) ?? "{}"); }
  catch { return {}; }
}
function setFlightCache(cache: Record<string, string>) {
  try { localStorage.setItem(FLIGHT_CACHE_KEY, JSON.stringify(cache)); } catch {}
}

// ── Service worker for browser notifications when tab is backgrounded ──
let swReg: ServiceWorkerRegistration | null = null;
if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
  const swUrl = (import.meta.env.BASE_URL || "/") + "sw.js";
  navigator.serviceWorker
    .register(swUrl, { scope: import.meta.env.BASE_URL || "/" })
    .then(reg => { swReg = reg; })
    .catch(() => {});
}

function browserNotify(title: string, body: string, link?: string) {
  if (typeof Notification === "undefined") return;
  if (Notification.permission !== "granted") return;
  try {
    if (swReg && swReg.showNotification) {
      swReg.showNotification(title, {
        body,
        icon: "/favicon.ico",
        badge: "/favicon.ico",
        data: { link },
        tag: title,
        renotify: true,
      } as any);
      return;
    }
    new Notification(title, { body, icon: "/favicon.ico" });
  } catch {}
}

// Sonner toast styling per severity
function showToast(n: AppNotification, onClick: () => void) {
  const sev = n.severity ?? "info";
  const opts = {
    description: n.message,
    duration: 8000,
    onClick,
    className: sev === "urgent"
      ? "tvl-toast-urgent"
      : sev === "warning"
      ? "tvl-toast-warning"
      : sev === "success"
      ? "tvl-toast-success"
      : "tvl-toast-info",
  };
  if (sev === "urgent") toast.error(n.title, opts);
  else if (sev === "warning") toast.warning(n.title, opts);
  else if (sev === "success") toast.success(n.title, opts);
  else toast(n.title, opts);
}

function rowToNotif(r: any): AppNotification {
  return {
    id: r.id,
    type: r.type,
    title: r.title,
    message: r.message,
    timestamp: new Date(r.created_at),
    read: !!r.read,
    link: r.link ?? undefined,
    severity: (r.severity ?? "info") as NotifSeverity,
  };
}

async function authedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  return fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
}

export function useNotifications() {
  const [items, setItems] = useState<AppNotification[]>([]);
  const itemsRef = useRef<AppNotification[]>([]);
  itemsRef.current = items;
  const channelRef = useRef<any>(null);
  const flightTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const unreadCount = items.filter(n => !n.read).length;

  // Local-only push (used by flight poll). Adds to state + toast + browser notif.
  const push = useCallback((type: NotifType, title: string, message: string, link?: string, severity: NotifSeverity = "info") => {
    const n: AppNotification = {
      id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type, title, message, link, severity,
      timestamp: new Date(),
      read: false,
      local: true,
    };
    setItems(prev => [n, ...prev].slice(0, MAX_KEEP));
    showToast(n, () => {
      if (link && typeof window !== "undefined") window.location.assign(link);
    });
    browserNotify(title, message, link);
  }, []);

  // ── Initial fetch ───────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await authedFetch("/api/notifications?limit=50");
        if (!res.ok) return;
        const json = await res.json();
        if (cancelled) return;
        const list = (json.items ?? []).map(rowToNotif) as AppNotification[];
        setItems(list);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Browser-notification permission ──────────────────────────────────
  useEffect(() => {
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
  }, []);

  // ── Real-time subscription to current user's notifications ──────────
  useEffect(() => {
    let mounted = true;
    let channel: any = null;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id;
      if (!uid || !mounted) return;

      channel = supabase
        .channel(`notif:${uid}`)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${uid}` },
          (payload: any) => {
            const n = rowToNotif(payload.new);
            // Avoid showing dismissed rows (server may insert dismissed=false always
            // but be defensive)
            if (payload.new?.dismissed) return;
            setItems(prev => {
              if (prev.some(x => x.id === n.id)) return prev;
              return [n, ...prev].slice(0, MAX_KEEP);
            });
            showToast(n, () => {
              if (n.link && typeof window !== "undefined") window.location.assign(n.link);
            });
            browserNotify(n.title, n.message, n.link);
          }
        )
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "notifications", filter: `user_id=eq.${uid}` },
          (payload: any) => {
            const id = payload.new?.id;
            if (!id) return;
            if (payload.new?.dismissed) {
              setItems(prev => prev.filter(x => x.id !== id));
              return;
            }
            setItems(prev => prev.map(x => x.id === id ? { ...x, read: !!payload.new.read } : x));
          }
        )
        .subscribe();
      channelRef.current = channel;
    })();

    return () => {
      mounted = false;
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, []);

  // ── Mutations (server-backed) ────────────────────────────────────────
  const markAllRead = useCallback(async () => {
    setItems(prev => prev.map(n => ({ ...n, read: true })));
    await authedFetch("/api/notifications/mark-all-read", { method: "POST" }).catch(() => {});
  }, []);

  const dismiss = useCallback(async (id: string) => {
    const n = itemsRef.current.find(x => x.id === id);
    setItems(prev => prev.filter(x => x.id !== id));
    if (n && !n.local) {
      await authedFetch(`/api/notifications/${id}/dismiss`, { method: "POST" }).catch(() => {});
    }
  }, []);

  const clearAll = useCallback(async () => {
    setItems([]);
    await authedFetch("/api/notifications/clear-all", { method: "POST" }).catch(() => {});
  }, []);

  // ── Flight status polling (transitional client-side) ─────────────────
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

        await Promise.allSettled(bookings.map(async (bk: any) => {
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
              push("flight_landed", "Flight Landed", `${label} has landed`, link, "success");
            } else if (newStatus === "Delayed" && prevStatus !== "Delayed") {
              const delay = data.delay_minutes ? `+${data.delay_minutes}min delay` : "delayed";
              push("flight_delay", "✈️ Flight Delayed", `${label} is ${delay}`, link, "warning");
            } else if (newStatus === "On Time" && prevStatus === "Delayed") {
              push("flight_ontime", "Flight Now On Time", `${label} delay resolved`, link, "info");
            }
          } catch {}
        }));

        setFlightCache(cache);
      } catch {}
    };

    pollFlights();
    flightTimerRef.current = setInterval(pollFlights, 4 * 60 * 1000);
    return () => { if (flightTimerRef.current) clearInterval(flightTimerRef.current); };
  }, [push]);

  return { items, unreadCount, push, markAllRead, dismiss, clearAll };
}
