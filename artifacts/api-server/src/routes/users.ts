import { Router } from "express";
import { supabase, auditLog, getUserFromToken } from "../lib/supabase";

const router = Router();

router.get("/", async (_req, res) => {
  const { data, error } = await supabase
    .from("users")
    .select("*")
    .order("name");

  if (error) return res.status(500).json({ error: error.message });
  return res.json(data ?? []);
});

router.put("/:id/deactivate", async (req, res) => {
  const user = await getUserFromToken(req.headers.authorization);
  const { data, error } = await supabase
    .from("users")
    .update({ active: false })
    .eq("id", req.params.id)
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });

  await auditLog("deactivate_user", "user", req.params.id, user?.id ?? null,
    `User ${data.email} deactivated`);

  return res.json(data);
});

export default router;
