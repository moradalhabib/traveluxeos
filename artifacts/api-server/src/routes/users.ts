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

const ALLOWED_ROLES = ["super_admin", "admin", "operator"] as const;
type Role = (typeof ALLOWED_ROLES)[number];

router.put("/:id/role", async (req, res) => {
  const actor = await getUserFromToken(req.headers.authorization);
  if (!actor) return res.status(401).json({ error: "Unauthorized" });
  if (actor.role !== "super_admin") {
    return res.status(403).json({ error: "Only Super Admins can change user roles" });
  }
  if (actor.id === req.params.id) {
    return res.status(400).json({ error: "You cannot change your own role" });
  }

  const newRole = String(req.body?.role ?? "") as Role;
  if (!ALLOWED_ROLES.includes(newRole)) {
    return res.status(400).json({
      error: `Invalid role. Must be one of: ${ALLOWED_ROLES.join(", ")}`,
    });
  }

  // Look up the target user so we know their current role + email for the audit
  const { data: target, error: targetErr } = await supabase
    .from("users")
    .select("id, email, role, name")
    .eq("id", req.params.id)
    .single();
  if (targetErr || !target) {
    return res.status(404).json({ error: "User not found" });
  }
  if (target.role === newRole) {
    return res.json(target); // no-op
  }

  // Safety: don't let the last super_admin be demoted — that would lock the org out.
  if (target.role === "super_admin" && newRole !== "super_admin") {
    const { count, error: countErr } = await supabase
      .from("users")
      .select("id", { count: "exact", head: true })
      .eq("role", "super_admin")
      .eq("active", true);
    if (countErr) return res.status(500).json({ error: countErr.message });
    if ((count ?? 0) <= 1) {
      return res.status(400).json({
        error: "Cannot demote the last active Super Admin. Promote another user first.",
      });
    }
  }

  const { data, error } = await supabase
    .from("users")
    .update({ role: newRole })
    .eq("id", req.params.id)
    .select()
    .single();
  if (error) return res.status(400).json({ error: error.message });

  await auditLog(
    "change_user_role",
    "user",
    req.params.id,
    actor.id ?? null,
    `${actor.email} changed ${target.email}'s role: ${target.role} → ${newRole}`,
  );

  return res.json(data);
});

export default router;
