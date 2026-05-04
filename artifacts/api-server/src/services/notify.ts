import { supabase, getServiceRoleClient } from "../lib/supabase";
import { sendWebPushToUser } from "./webpush";

// Notifications are server-generated side effects (booking saved, driver
// assigned, etc.) that need to be inserted into OTHER users' inboxes.
// The default `supabase` proxy is bound to the caller's JWT and is therefore
// RLS-restricted — it cannot insert rows for another user, nor read the
// `notification_prefs` of other users. We must use the service-role client
// here. If the key isn't configured we fall back to the JWT client and the
// insert will simply fail with an RLS error (logged, non-fatal).
function notifClient() {
  return getServiceRoleClient() ?? supabase;
}

export type NotifSeverity = "info" | "success" | "warning" | "urgent";
export type NotifType =
  | "booking_new"
  | "booking_status"
  | "booking_amended"
  | "booking_cancelled"
  | "payment_paid"
  | "invoice_email_failed"
  | "request_new"
  | "job_assigned"
  | "no_driver_3h"
  | "no_driver_24h"
  | "flight_delay"
  | "flight_early"
  | "flight_landed"
  | "follow_up_due"
  | "task_assigned"
  | "task_overdue"
  | "weekly_commission"
  | "unpaid_invoice"
  | "direct_message"
  | "announcement"
  | "driver_declined"
  | "sla_breach";

// Notif types users CANNOT disable
const ALWAYS_ON: NotifType[] = [
  "job_assigned",
  "direct_message",
  "announcement",
  "task_assigned",
];

// Map notif type → prefs column name (null = always on)
const PREF_COL: Record<NotifType, string | null> = {
  booking_new:        "booking_new",
  booking_status:     "booking_status",
  booking_amended:    "booking_amended",
  booking_cancelled:  "booking_cancelled",
  payment_paid:       "booking_status",
  invoice_email_failed: null,
  request_new:        "booking_new",
  no_driver_3h:       "no_driver_3h",
  no_driver_24h:      "no_driver_24h",
  flight_delay:       "flight_delay",
  flight_early:       "flight_delay",
  flight_landed:      "flight_delay",
  follow_up_due:      "follow_up_due",
  task_overdue:       "task_overdue",
  weekly_commission:  "weekly_commission",
  unpaid_invoice:     "unpaid_invoice",
  job_assigned:       null,
  task_assigned:      null,
  direct_message:     null,
  announcement:       null,
  driver_declined:    null,
  sla_breach:         null,  // critical alert — always on; cannot be disabled
};

interface NotifyOpts {
  type: NotifType;
  title: string;
  message: string;
  link?: string;
  entityType?: string;
  entityId?: string;
  severity?: NotifSeverity;
  dedupeKey?: string;  // include user_id-scoped uniqueness via this key
}

async function filterByPrefs(userIds: string[], type: NotifType): Promise<string[]> {
  const col = PREF_COL[type];
  if (col == null || ALWAYS_ON.includes(type)) return userIds;
  if (userIds.length === 0) return [];

  const { data } = await notifClient()
    .from("notification_prefs")
    .select(`user_id, ${col}`)
    .in("user_id", userIds);

  const prefMap = new Map<string, boolean>();
  for (const row of (data ?? []) as any[]) {
    prefMap.set(row.user_id, row[col] !== false);
  }
  // Default ON for any user without a prefs row
  return userIds.filter(id => prefMap.get(id) !== false);
}

/** Insert a notification row for a single user (subject to their prefs). */
export async function notifyUser(userId: string, opts: NotifyOpts): Promise<void> {
  if (!userId) return;
  const allowed = await filterByPrefs([userId], opts.type);
  if (allowed.length === 0) return;
  await insertRows([userId], opts);
}

/**
 * Insert one notification per user across the given roles (active users only).
 * Returns `true` if the DB insert succeeded (or was a harmless dedupe),
 * `false` if there was a genuine insert error — callers that need reliable
 * "did it actually land?" semantics (e.g. the SLA breach scheduler) can use
 * the return value to decide whether to write a dedup audit-log entry.
 *
 * Pass `excludeUserId` to skip a single recipient — used by broadcast
 * endpoints so the actor doesn't get pinged about their own action.
 */
export async function notifyByRoles(
  roles: string[],
  opts: NotifyOpts,
  excludeUserId?: string | null,
): Promise<boolean> {
  const { data: users } = await notifClient()
    .from("users")
    .select("id")
    .in("role", roles)
    .eq("active", true);

  let ids = (users ?? []).map((u: any) => u.id).filter(Boolean);
  if (excludeUserId) ids = ids.filter(id => id !== excludeUserId);
  if (ids.length === 0) return false; // no eligible recipients — nothing delivered

  const allowed = await filterByPrefs(ids, opts.type);
  if (allowed.length === 0) return false; // all opted out — nothing delivered

  return insertRows(allowed, opts);
}

/**
 * Returns `true` if the rows were inserted successfully (or a dedupe hit),
 * `false` on a genuine DB error so callers can decide whether to retry.
 */
async function insertRows(userIds: string[], opts: NotifyOpts): Promise<boolean> {
  const rows = userIds.map(uid => ({
    user_id: uid,
    type: opts.type,
    title: opts.title,
    message: opts.message,
    link: opts.link ?? null,
    entity_type: opts.entityType ?? null,
    entity_id: opts.entityId ?? null,
    severity: opts.severity ?? "info",
    dedupe_key: opts.dedupeKey ?? null,
  }));

  // The unique constraint on (user_id, dedupe_key) in this DB is a PARTIAL
  // index (`WHERE dedupe_key IS NOT NULL`), which Postgres can't use as an
  // ON CONFLICT arbiter via supabase-js's `upsert({ onConflict: "..." })` —
  // it surfaces "no unique or exclusion constraint matching the ON CONFLICT
  // specification" (23P01-ish). Instead, just INSERT and treat the partial
  // unique index as an after-the-fact dedupe: a 23505 means "already there,
  // skip silently". Other errors still log.
  const client = notifClient();
  const { error } = await client.from("notifications").insert(rows);
  if (error) {
    if (opts.dedupeKey && (error as any).code === "23505") {
      // duplicate against the partial unique index — already delivered; treat
      // as success so the caller doesn't retry unnecessarily.
      return true;
    }
    console.error("[notify] insert error:", error.message);
    return false;
  }

  // Fire-and-forget Web Push for background delivery (when app is closed/backgrounded).
  // sendWebPushToUser is a no-op if VAPID keys aren't configured or the user
  // has no saved subscription.
  for (const uid of userIds) {
    sendWebPushToUser(uid, {
      title: opts.title,
      body:  opts.message,
      link:  opts.link,
      tag:   `${opts.type}-${opts.entityId ?? uid}`,
      requireInteraction: opts.severity === "urgent",
    }).catch(() => {});
  }
  return true;
}

export const STAFF_ROLES = ["operator", "admin", "super_admin"];
export const ADMIN_ROLES = ["admin", "super_admin"];
