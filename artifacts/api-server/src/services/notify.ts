import { supabase, getServiceRoleClient } from "../lib/supabase";

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
  | "job_assigned"
  | "no_driver_3h"
  | "no_driver_24h"
  | "flight_delay"
  | "follow_up_due"
  | "task_assigned"
  | "task_overdue"
  | "weekly_commission"
  | "unpaid_invoice"
  | "direct_message"
  | "announcement"
  | "driver_declined";

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
  no_driver_3h:       "no_driver_3h",
  no_driver_24h:      "no_driver_24h",
  flight_delay:       "flight_delay",
  follow_up_due:      "follow_up_due",
  task_overdue:       "task_overdue",
  weekly_commission:  "weekly_commission",
  unpaid_invoice:     "unpaid_invoice",
  job_assigned:       null,
  task_assigned:      null,
  direct_message:     null,
  announcement:       null,
  driver_declined:    null,
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

/** Insert one notification per user across the given roles (active users only). */
export async function notifyByRoles(roles: string[], opts: NotifyOpts): Promise<void> {
  const { data: users } = await notifClient()
    .from("users")
    .select("id")
    .in("role", roles)
    .eq("active", true);

  const ids = (users ?? []).map((u: any) => u.id).filter(Boolean);
  if (ids.length === 0) return;

  const allowed = await filterByPrefs(ids, opts.type);
  if (allowed.length === 0) return;

  await insertRows(allowed, opts);
}

async function insertRows(userIds: string[], opts: NotifyOpts): Promise<void> {
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

  // ON CONFLICT for the unique (user_id, dedupe_key) index. Supabase JS:
  // use upsert with onConflict so duplicates are silently skipped.
  const client = notifClient();
  if (opts.dedupeKey) {
    const { error } = await client
      .from("notifications")
      .upsert(rows, { onConflict: "user_id,dedupe_key", ignoreDuplicates: true });
    if (error) console.error("[notify] upsert error:", error.message);
  } else {
    const { error } = await client.from("notifications").insert(rows);
    if (error) console.error("[notify] insert error:", error.message);
  }
}

export const STAFF_ROLES = ["operator", "admin", "super_admin"];
export const ADMIN_ROLES = ["admin", "super_admin"];
