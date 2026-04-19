import { Router } from "express";
import { supabase, getUserFromToken } from "../lib/supabase";

const router = Router();

router.get("/", async (_req, res) => {
  const { data, error } = await supabase
    .from("service_types")
    .select("*")
    .order("sort_order", { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data ?? []);
});

router.get("/:id", async (req, res) => {
  const { data, error } = await supabase
    .from("service_types")
    .select("*")
    .eq("id", req.params.id)
    .single();
  if (error) return res.status(404).json({ error: "Not found" });
  return res.json(data);
});

router.post("/", async (req, res) => {
  const user = await getUserFromToken(req.headers.authorization);
  if (!user || (user.role !== "super_admin" && user.role !== "admin")) {
    return res.status(403).json({ error: "Forbidden" });
  }
  const { name, description, base_price_guidance, add_ons, active, sort_order } = req.body;
  const { data, error } = await supabase
    .from("service_types")
    .insert({ name, description, base_price_guidance, add_ons: add_ons ?? [], active: active ?? true, sort_order: sort_order ?? 0 })
    .select()
    .single();
  if (error) return res.status(400).json({ error: error.message });
  return res.status(201).json(data);
});

router.put("/:id", async (req, res) => {
  const user = await getUserFromToken(req.headers.authorization);
  if (!user || (user.role !== "super_admin" && user.role !== "admin")) {
    return res.status(403).json({ error: "Forbidden" });
  }
  const { name, description, base_price_guidance, add_ons, active, sort_order } = req.body;
  const { data, error } = await supabase
    .from("service_types")
    .update({ name, description, base_price_guidance, add_ons, active, sort_order, updated_at: new Date().toISOString() })
    .eq("id", req.params.id)
    .select()
    .single();
  if (error) return res.status(400).json({ error: error.message });
  return res.json(data);
});

router.delete("/:id", async (req, res) => {
  const user = await getUserFromToken(req.headers.authorization);
  if (!user || user.role !== "super_admin") {
    return res.status(403).json({ error: "Only super_admin can delete service types" });
  }
  const { error } = await supabase.from("service_types").delete().eq("id", req.params.id);
  if (error) return res.status(400).json({ error: error.message });
  return res.json({ ok: true });
});

export default router;
