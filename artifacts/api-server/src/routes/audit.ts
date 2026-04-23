import { Router } from "express";
import { supabase, getServiceRoleClient } from "../lib/supabase";

const router = Router();

router.get("/", async (req, res) => {
  const { operator_id, action_type, action, date_from, date_to, entity_type, entity_id, limit } = req.query;

  // Use the service-role client so the join to `users(name)` always resolves.
  // The user-scoped JWT client is subject to RLS on `users` and would return
  // null for `users.name`, which surfaced as every audit row showing "System".
  const client = getServiceRoleClient() ?? supabase;

  // Cap the limit to keep responses bounded. Default to 500 (legacy behaviour)
  // but small panels (e.g. booking Activity) can request fewer.
  const parsedLimit = Math.max(1, Math.min(500, Number(limit) || 500));

  let query = client
    .from("audit_log")
    .select("*, users:operator_id(name, email)")
    .order("created_at", { ascending: false })
    .limit(parsedLimit);

  if (operator_id) query = query.eq("operator_id", String(operator_id));
  if (entity_type) query = query.eq("entity_type", String(entity_type));
  if (entity_id) query = query.eq("entity_id", String(entity_id));

  // Accept either `action_type` (legacy) or `action` (new). Both support
  // comma-separated lists which we translate into an `IN (...)` filter.
  const rawActions = String(action ?? action_type ?? "").trim();
  if (rawActions) {
    const list = rawActions.split(",").map((s) => s.trim()).filter(Boolean);
    if (list.length === 1) query = query.eq("action", list[0]);
    else if (list.length > 1) query = query.in("action", list);
  }

  if (date_from) query = query.gte("created_at", String(date_from));
  if (date_to) query = query.lte("created_at", String(date_to));

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  const result = (data ?? []).map((a: any) => ({
    ...a,
    operator_name: a.users?.name ?? a.users?.email ?? null,
    users: undefined,
  }));

  return res.json(result);
});

export default router;
