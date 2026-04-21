import { Router } from "express";
import { supabase } from "../lib/supabase";

const router = Router();

router.get("/", async (req, res) => {
  const { operator_id, action_type, action, date_from, date_to } = req.query;

  let query = supabase
    .from("audit_log")
    .select("*, users(name)")
    .order("created_at", { ascending: false })
    .limit(500);

  if (operator_id) query = query.eq("operator_id", String(operator_id));

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
    operator_name: a.users?.name ?? null,
    users: undefined,
  }));

  return res.json(result);
});

export default router;
