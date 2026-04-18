import { Router } from "express";
import { supabase, auditLog, getUserFromToken } from "../lib/supabase";

const router = Router();

router.get("/", async (_req, res) => {
  const { data, error } = await supabase
    .from("tasks")
    .select("*, users!tasks_assigned_to_fkey(name)")
    .order("due_date", { ascending: true });

  if (error) return res.status(500).json({ error: error.message });

  const result = (data ?? []).map((t: any) => ({
    ...t,
    assigned_to_name: t.users?.name ?? null,
    users: undefined,
  }));

  return res.json(result);
});

router.post("/", async (req, res) => {
  const user = await getUserFromToken(req.headers.authorization);
  const { data, error } = await supabase
    .from("tasks")
    .insert({ ...req.body, created_by: user?.id ?? null })
    .select("*, users!tasks_assigned_to_fkey(name)")
    .single();

  if (error) return res.status(400).json({ error: error.message });

  await auditLog("create_task", "task", data.id, user?.id ?? null,
    `Task "${data.title}" assigned`);

  return res.status(201).json({ ...data, assigned_to_name: data.users?.name ?? null, users: undefined });
});

router.put("/:id/complete", async (req, res) => {
  const user = await getUserFromToken(req.headers.authorization);
  const { data, error } = await supabase
    .from("tasks")
    .update({ completed: true })
    .eq("id", req.params.id)
    .select("*, users!tasks_assigned_to_fkey(name)")
    .single();

  if (error) return res.status(400).json({ error: error.message });

  await auditLog("complete_task", "task", req.params.id, user?.id ?? null,
    `Task "${data.title}" marked complete`);

  return res.json({ ...data, assigned_to_name: data.users?.name ?? null, users: undefined });
});

export default router;
