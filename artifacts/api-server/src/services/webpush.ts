import webpush from "web-push";
import { getServiceRoleClient } from "../lib/supabase";

let _configured = false;

function ensureConfigured() {
  if (_configured) return;
  const pub  = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subj = process.env.VAPID_SUBJECT || "mailto:info@traveluxelondon.com";
  if (pub && priv) {
    webpush.setVapidDetails(subj, pub, priv);
    _configured = true;
  }
}

export interface PushPayload {
  title: string;
  body:  string;
  link?: string;
  tag?:  string;
  requireInteraction?: boolean;
}

async function sendToSubscriptions(
  subs: Array<{ endpoint: string; p256dh: string; auth: string }>,
  payload: PushPayload,
  svc: ReturnType<typeof getServiceRoleClient>,
): Promise<void> {
  const message = JSON.stringify({
    title: payload.title,
    body:  payload.body,
    link:  payload.link ?? "/",
    tag:   payload.tag ?? "tvl-push",
    requireInteraction: payload.requireInteraction ?? false,
  });

  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        message,
        { TTL: 3600 },
      );
    } catch (e: any) {
      if (e?.statusCode === 410 || e?.statusCode === 404) {
        svc?.from("push_subscriptions").delete().eq("endpoint", sub.endpoint).catch(() => {});
      }
    }
  }
}

/**
 * Sends a Web Push notification to all active subscriptions for a specific user.
 * Silently removes expired endpoints (410 Gone). Never throws — push is best-effort.
 */
export async function sendWebPushToUser(userId: string, payload: PushPayload): Promise<void> {
  ensureConfigured();
  if (!_configured) return;

  const svc = getServiceRoleClient();
  if (!svc) return;

  const { data: subs } = await svc
    .from("push_subscriptions")
    .select("endpoint, p256dh, auth")
    .eq("user_id", userId)
    .limit(20);

  if (!subs || subs.length === 0) return;
  await sendToSubscriptions(subs, payload, svc);
}

/**
 * Sends a Web Push notification to ALL active subscriptions stored in the
 * push_subscriptions table. Silently removes expired endpoints (410 Gone).
 * Never throws — push is best-effort.
 */
export async function sendWebPushToAll(payload: PushPayload): Promise<void> {
  ensureConfigured();
  if (!_configured) return;

  const svc = getServiceRoleClient();
  if (!svc) return;

  const { data: subs } = await svc
    .from("push_subscriptions")
    .select("endpoint, p256dh, auth")
    .limit(500);

  if (!subs || subs.length === 0) return;
  await sendToSubscriptions(subs, payload, svc);
}
