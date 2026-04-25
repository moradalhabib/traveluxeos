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

// ── Service worker registration + Web Push subscription ──────────────────────
let swReg: ServiceWorkerRegistration | null = null;

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

function isAdminOrSuperAdmin(): boolean {
  try {
    const stored = localStorage.getItem("traveluxe_session");
    if (!stored) return false;
    const session = JSON.parse(stored);
    return session?.role === "admin" || session?.role === "super_admin";
  } catch {
    return false;
  }
}

async function subscribeWebPush(reg: ServiceWorkerRegistration) {
  try {
    if (!isAdminOrSuperAdmin()) return;
    const vapidKey = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;
    if (!vapidKey) return;
    if (!("PushManager" in window)) return;

    const existing = await reg.pushManager.getSubscription();
    const sub = existing ?? await reg.pushManager.subscribe({
      userVisibleOnly: true,
      // Cast to BufferSource — Uint8Array is a valid BufferSource at runtime,
      // but newer TS lib defs narrow ArrayBufferLike vs ArrayBuffer.
      applicationServerKey: urlBase64ToUint8Array(vapidKey) as BufferSource,
    });

    const { data: { session } } = await (await import("@/lib/supabase")).supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) return;

    await fetch("/api/push-subscriptions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(sub.toJSON()),
    });
  } catch {
    // Non-fatal — app works without push
  }
}

if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
  const swUrl = (import.meta.env.BASE_URL || "/") + "sw.js";
  navigator.serviceWorker
    .register(swUrl, { scope: import.meta.env.BASE_URL || "/" })
    .then(reg => {
      swReg = reg;
      // Subscribe after permission is granted (may already be granted)
      if (typeof Notification !== "undefined" && Notification.permission === "granted") {
        subscribeWebPush(reg);
      }
    })
    .catch(() => {});
}

/**
 * Called explicitly from UI (e.g. "Enable Notifications" button).
 * On mobile Safari you must call this from a user gesture.
 * Returns the final permission state ("granted" | "denied" | "default").
 */
export async function requestPushPermission(): Promise<NotificationPermission> {
  if (typeof Notification === "undefined") return "denied";
  if (!isAdminOrSuperAdmin()) return "denied";

  let perm = Notification.permission;
  if (perm === "default") {
    perm = await Notification.requestPermission().catch(() => "denied" as NotificationPermission);
  }
  if (perm === "granted" && swReg) {
    await subscribeWebPush(swReg);
  }
  return perm;
}

/** Current OS notification permission state (reactive snapshot). */
export function getPushPermission(): NotificationPermission | "unsupported" {
  if (typeof Notification === "undefined") return "unsupported";
  return Notification.permission;
}

function browserNotify(title: string, body: string, link?: string) {
  if (typeof Notification === "undefined") return;
  if (Notification.permission !== "granted") return;
  // Android Chrome does NOT support new Notification() from the page context —
  // it silently fails. We must always go through a ServiceWorkerRegistration.
  // Use navigator.serviceWorker.ready (a persistent Promise) so we never
  // race against the async registration completing.
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.ready.then(reg => {
      reg.showNotification(title, {
        body,
        icon: "/TVL_logo_192x192.png",
        badge: "/TVL_logo_32x32.png",
        data: { link: link || "/" },
        tag: title,
        renotify: true,
        vibrate: [200, 100, 200],
      } as NotificationOptions);
    }).catch(() => {});
    return;
  }
  // Desktop fallback (no service worker support)
  try { new Notification(title, { body, icon: "/TVL_logo_192x192.png" }); } catch {}
}

// Sonner toast styling per severity
function showToast(n: AppNotification, onClick: () => void) {
  const sev = n.severity ?? "info";
  const opts = {
    description: n.message,
    duration: 5000,
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
  // Dedup set for toast firing — survives StrictMode double-mount races
  // where the same realtime INSERT is delivered to two parallel channels.
  const toastedIdsRef = useRef<Set<string>>(new Set());

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

  // ── Browser-notification permission + Web Push subscription ─────────
  // Only admins and super admins receive OS-level push notifications.
  // We only AUTO-subscribe if the user has ALREADY granted permission.
  // On mobile Safari, requestPermission() requires a user gesture — the
  // NotificationBell "Enable" button handles that explicit opt-in flow.
  useEffect(() => {
    if (typeof Notification === "undefined") return;
    if (!isAdminOrSuperAdmin()) return;
    if (Notification.permission === "granted" && swReg) {
      subscribeWebPush(swReg);
    }
  }, []);

  // ── Real-time subscription to current user's notifications ──────────
  // Uses a per-mount unique channel name to avoid supabase-js deduping
  // across React strict-mode double-mounts (which would cause
  // "cannot add postgres_changes callbacks ... after subscribe()").
  useEffect(() => {
    let cancelled = false;
    let localChannel: any = null;

    const handleInsert = (payload: any) => {
      const n = rowToNotif(payload.new);
      if (payload.new?.dismissed) return;
      // Hard dedup — if we've already toasted this row id, drop the duplicate
      // event entirely (covers StrictMode/Fast-Refresh duplicate channels).
      if (toastedIdsRef.current.has(n.id)) return;
      toastedIdsRef.current.add(n.id);
      setItems(prev => {
        if (prev.some(x => x.id === n.id)) return prev;
        return [n, ...prev].slice(0, MAX_KEEP);
      });
      showToast(n, () => {
        if (n.link && typeof window !== "undefined") window.location.assign(n.link);
      });
      browserNotify(n.title, n.message, n.link);
    };

    const handleUpdate = (payload: any) => {
      const id = payload.new?.id;
      if (!id) return;
      if (payload.new?.dismissed) {
        setItems(prev => prev.filter(x => x.id !== id));
        return;
      }
      setItems(prev => prev.map(x => x.id === id ? { ...x, read: !!payload.new.read } : x));
    };

    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id;
      if (!uid || cancelled) return;

      // Unique channel name per mount survives strict-mode double-invoke
      const chanName = `notif:${uid}:${Math.random().toString(36).slice(2, 10)}`;
      const ch = supabase.channel(chanName);
      ch.on(
        "postgres_changes" as any,
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${uid}` },
        handleInsert
      );
      ch.on(
        "postgres_changes" as any,
        { event: "UPDATE", schema: "public", table: "notifications", filter: `user_id=eq.${uid}` },
        handleUpdate
      );

      if (cancelled) {
        supabase.removeChannel(ch);
        return;
      }

      ch.subscribe();
      localChannel = ch;
      channelRef.current = ch;
    })();

    return () => {
      cancelled = true;
      if (localChannel) {
        supabase.removeChannel(localChannel);
      } else if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
      }
      channelRef.current = null;
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
