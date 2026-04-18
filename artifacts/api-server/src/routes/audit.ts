import { Router } from "express";
import { supabase } from "../lib/supabase";

const router = Router();

router.get("/", async (req, res) => {
  const { operator_id, action_type, date_from, date_to } = req.query;

  let query = supabase
    .from("audit_log")
    .select("*, users(name)")
    .order("created_at", { ascending: false })
    .limit(500);

  if (operator_id) query = query.eq("operator_id", String(operator_id));
  if (action_type) query = query.eq("action", String(action_type));
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
