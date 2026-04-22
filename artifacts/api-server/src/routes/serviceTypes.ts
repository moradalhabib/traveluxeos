import { Router } from "express";
import { supabase, getUserFromToken, auditLog } from "../lib/supabase";

const router = Router();

// Same compact diff used in products.ts — kept inline to avoid a shared
// util import for one helper function.
function diffSummary(before: Record<string, any> | null, after: Record<string, any>): string {
  if (!before) return "";
  const parts: string[] = [];
  for (const k of Object.keys(after)) {
    const a = before[k];
    const b = (after as any)[k];
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      parts.push(`${k}: ${JSON.stringify(a)} → ${JSON.stringify(b)}`);
    }
  }
  return parts.join(", ");
}

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

  auditLog(
    "service_type_created",
    "service_type",
    data.id,
    user.id,
    `Created service type "${data.name}". after=${JSON.stringify(data)}`
  ).catch(() => {});

  return res.status(201).json(data);
});

router.put("/:id", async (req, res) => {
  const user = await getUserFromToken(req.headers.authorization);
  if (!user || (user.role !== "super_admin" && user.role !== "admin")) {
    return res.status(403).json({ error: "Forbidden" });
  }
  const { data: prev } = await supabase.from("service_types").select("*").eq("id", req.params.id).maybeSingle();

  const { name, description, base_price_guidance, add_ons, active, sort_order } = req.body;
  const { data, error } = await supabase
    .from("service_types")
    .update({ name, description, base_price_guidance, add_ons, active, sort_order, updated_at: new Date().toISOString() })
    .eq("id", req.params.id)
    .select()
    .single();
  if (error) return res.status(400).json({ error: error.message });

  const summary = diffSummary(prev, data);
  auditLog(
    "service_type_updated",
    "service_type",
    data.id,
    user.id,
    `Updated service type "${data.name}"${summary ? `. ${summary}` : " (no field changes)"}. before=${JSON.stringify(prev ?? null)} after=${JSON.stringify(data)}`
  ).catch(() => {});

  return res.json(data);
});

router.delete("/:id", async (req, res) => {
  const user = await getUserFromToken(req.headers.authorization);
  // Loosened from super_admin → admin to match products.ts. The Airport
  // Pricing page lets admins manage the full catalogue (vehicles + tiers
  // + service types); restricting only DELETE here would 403 the same UI.
  if (!user || (user.role !== "super_admin" && user.role !== "admin")) {
    return res.status(403).json({ error: "Only admin or super_admin can delete service types" });
  }
  const { data: prev } = await supabase.from("service_types").select("*").eq("id", req.params.id).maybeSingle();

  const { error } = await supabase.from("service_types").delete().eq("id", req.params.id);
  if (error) return res.status(400).json({ error: error.message });

  auditLog(
    "service_type_deleted",
    "service_type",
    req.params.id,
    user.id,
    `Deleted service type "${prev?.name ?? "(unknown)"}". before=${JSON.stringify(prev ?? null)}`
  ).catch(() => {});

  return res.json({ ok: true });
});

export default router;
