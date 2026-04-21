import { supabase } from "./supabase";

export type ActivityType =
  | "booking_created"
  | "booking_updated"
  | "booking_cancelled"
  | "booking_completed"
  | "driver_created"
  | "driver_updated"
  | "client_created"
  | "client_updated"
  | "settlement_created"
  | "payout_created"
  | "issue_created"
  | "issue_updated"
  | "auth_login"
  | "other";

export interface LogActivityInput {
  action_type: ActivityType | string;
  description: string;
  entity_type?: string | null;
  entity_id?: string | null;
  entity_label?: string | null;
  operator_id?: string | null;
  operator_name?: string | null;
}

/**
 * Best-effort append to activity_log. Never throws — failures are logged
 * to console so a missing table or RLS hiccup doesn't break the request.
 */
export async function logActivity(input: LogActivityInput): Promise<void> {
  try {
    const row = {
      action_type: input.action_type,
      description: input.description,
      entity_type: input.entity_type ?? null,
      entity_id: input.entity_id ?? null,
      entity_label: input.entity_label ?? null,
      operator_id: input.operator_id ?? null,
      operator_name: input.operator_name ?? null,
    };
    const { error } = await supabase.from("activity_log").insert(row);
    if (error && !/does not exist/i.test(error.message)) {
      console.error("[activity_log] insert failed:", error.message);
    }
  } catch (e: any) {
    console.error("[activity_log] threw:", e?.message);
  }
}
