import { Router } from "express";
import { getDbClient } from "../lib/supabase";

const router = Router();

router.get("/", async (req, res) => {
  const { booking_id } = req.query;
  if (!booking_id) return res.status(400).json({ error: "booking_id required" });
  const db = getDbClient(req.headers.authorization);
  const { data, error } = await db
    .from("booking_amendments")
    .select("*, users(name)")
    .eq("booking_id", String(booking_id))
    .order("changed_at", { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  const enriched = (data ?? []).map((a: any) => ({
    ...a,
    changed_by_name: a.changed_by_name ?? a.users?.name ?? null,
    users: undefined,
  }));
  return res.json(enriched);
});

export default router;
