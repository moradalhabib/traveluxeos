// Traveluxe OS — Service Worker
// Handles Web Push notifications so operators receive OS-level alerts
// even when the app is in the background or screen is off.
// Also handles in-app notification clicks.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// ── Web Push ──────────────────────────────────────────────────────────────────
self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload = {};
  try { payload = event.data.json(); } catch {
    payload = { title: "Traveluxe OS", body: event.data.text() };
  }

  const title   = payload.title || "Traveluxe OS";
  const options = {
    body:    payload.body  || "",
    icon:    "/TVL_logo_192x192.png",
    badge:   "/TVL_logo_32x32.png",
    data:    { link: payload.link || "/" },
    vibrate: [200, 100, 200],
    requireInteraction: payload.requireInteraction ?? false,
    tag:     payload.tag || "tvl-push",
    renotify: true,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// ── Notification click (both push and local) ──────────────────────────────────
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const link = event.notification.data?.link || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if ("focus" in w) {
          w.focus();
          if ("navigate" in w && link) w.navigate(link).catch(() => {});
          return;
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(link);
    })
  );
});
