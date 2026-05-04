import { Router } from "express";
import { supabase, auditLog, getUserFromToken, getServiceRoleClient } from "../lib/supabase";

const router = Router();

const ALLOWED_ROLES = ["super_admin", "admin", "operator"] as const;
type Role = (typeof ALLOWED_ROLES)[number];

// Helper: always use service-role for admin user lookups — the JWT-scoped
// client is blocked by RLS from reading other users' rows.
function adminDb() {
  return getServiceRoleClient() ?? supabase;
}

// ─── POST /users/invite ──────────────────────────────────────────────────────
router.post("/invite", async (req, res) => {
  const actor = await getUserFromToken(req.headers.authorization);
  if (!actor) return res.status(401).json({ error: "Unauthorized" });
  if (actor.active === false) {
    return res.status(403).json({ error: "Your account is suspended" });
  }
  if (actor.role !== "super_admin" && actor.role !== "admin") {
    return res.status(403).json({ error: "Only Admins or Super Admins can invite members" });
  }

  const email = String(req.body?.email ?? "").trim().toLowerCase();
  const name  = String(req.body?.name  ?? "").trim();
  const role  = String(req.body?.role  ?? "operator") as Role;

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "A valid email is required" });
  }
  if (!name) return res.status(400).json({ error: "Name is required" });
  if (!ALLOWED_ROLES.includes(role)) {
    return res.status(400).json({ error: `Invalid role. Must be one of: ${ALLOWED_ROLES.join(", ")}` });
  }
  if (role === "super_admin" && actor.role !== "super_admin") {
    return res.status(403).json({ error: "Only Super Admins can invite Super Admins" });
  }

  const admin = getServiceRoleClient();
  if (!admin) {
    return res.status(500).json({ error: "Service role key not configured on the server" });
  }

  const { data: existing } = await admin
    .from("users")
    .select("id, email, active")
    .eq("email", email)
    .maybeSingle();
  if (existing) {
    return res.status(409).json({
      error: existing.active === false
        ? "This email belongs to a suspended account. Reactivate them instead."
        : "A member with this email already exists.",
    });
  }

  const { data: invited, error: inviteErr } = await (admin.auth.admin as any)
    .inviteUserByEmail(email, { data: { name } });
  if (inviteErr || !invited?.user) {
    return res.status(400).json({
      error: inviteErr?.message ?? "Could not send invite email — check your Supabase SMTP settings.",
    });
  }

  const { data: created, error: insErr } = await admin
    .from("users")
    .insert({ id: invited.user.id, email, name, role, active: false })
    .select()
    .single();
  if (insErr) {
    await (admin.auth.admin as any).deleteUser(invited.user.id).catch(() => {});
    return res.status(400).json({ error: insErr.message });
  }

  await auditLog(
    "invite_user", "user", created.id, actor.id ?? null,
    `${actor.email} invited ${email} as ${role}`,
  );

  return res.json(created);
});

// ─── GET /users ───────────────────────────────────────────────────────────────
router.get("/", async (req, res) => {
  const actor = await getUserFromToken(req.headers.authorization);
  if (!actor) return res.status(401).json({ error: "Unauthorized" });
  if (!["super_admin", "admin", "operator"].includes(actor.role)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const { data, error } = await adminDb()
    .from("users")
    .select("*")
    .order("name");

  if (error) return res.status(500).json({ error: error.message });
  return res.json(data ?? []);
});

// ─── PUT /users/:id/active ────────────────────────────────────────────────────
// Suspend (active=false) or reactivate (active=true) a member.
// Admin or Super Admin only. Super Admin accounts must be demoted first.
router.put("/:id/active", async (req, res) => {
  const actor = await getUserFromToken(req.headers.authorization);
  if (!actor) return res.status(401).json({ error: "Unauthorized" });
  if (actor.active === false) {
    return res.status(403).json({ error: "Your account is suspended" });
  }
  if (actor.role !== "super_admin" && actor.role !== "admin") {
    return res.status(403).json({ error: "Only Admins or Super Admins can suspend/reactivate accounts" });
  }
  if (actor.id === req.params.id) {
    return res.status(400).json({ error: "You cannot change your own account status" });
  }

  const newActive = req.body?.active === true || req.body?.active === "true";

  // Prevent suspending Super Admins directly — they must be demoted first.
  if (!newActive) {
    const { data: target } = await adminDb()
      .from("users")
      .select("role")
      .eq("id", req.params.id)
      .single();
    if (target?.role === "super_admin") {
      return res.status(400).json({ error: "Demote this Super Admin to Admin first, then suspend them." });
    }
  }

  const { data, error } = await adminDb()
    .from("users")
    .update({ active: newActive })
    .eq("id", req.params.id)
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });

  await auditLog(
    newActive ? "activate_user" : "deactivate_user",
    "user", req.params.id, actor.id ?? null,
    `${actor.email} ${newActive ? "reactivated" : "suspended"} ${data.email}`,
  );

  return res.json(data);
});

// Keep the old /deactivate route for backwards compatibility.
router.put("/:id/deactivate", async (req, res) => {
  const actor = await getUserFromToken(req.headers.authorization);
  if (!actor) return res.status(401).json({ error: "Unauthorized" });
  if (actor.active === false) {
    return res.status(403).json({ error: "Your account is suspended" });
  }
  if (actor.role !== "super_admin" && actor.role !== "admin") {
    return res.status(403).json({ error: "Only Admins or Super Admins can deactivate accounts" });
  }

  const { data: target } = await adminDb()
    .from("users")
    .select("role")
    .eq("id", req.params.id)
    .single();
  if (target?.role === "super_admin") {
    return res.status(400).json({ error: "Demote this Super Admin to Admin first, then suspend them." });
  }

  const { data, error } = await adminDb()
    .from("users")
    .update({ active: false })
    .eq("id", req.params.id)
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });

  await auditLog("deactivate_user", "user", req.params.id, actor.id ?? null,
    `${actor.email} suspended ${data.email}`);

  return res.json(data);
});

// ─── PUT /users/:id/role ──────────────────────────────────────────────────────
router.put("/:id/role", async (req, res) => {
  const actor = await getUserFromToken(req.headers.authorization);
  if (!actor) return res.status(401).json({ error: "Unauthorized" });
  if (actor.active === false) {
    return res.status(403).json({ error: "Your account is suspended" });
  }
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

  const { data: target, error: targetErr } = await adminDb()
    .from("users")
    .select("id, email, role, name")
    .eq("id", req.params.id)
    .single();
  if (targetErr || !target) {
    return res.status(404).json({ error: "User not found" });
  }
  if (target.role === newRole) {
    return res.json(target);
  }

  // Safety: don't let the last super_admin be demoted — that would lock the org out.
  if (target.role === "super_admin" && newRole !== "super_admin") {
    const { count, error: countErr } = await adminDb()
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

  const { data, error } = await adminDb()
    .from("users")
    .update({ role: newRole })
    .eq("id", req.params.id)
    .select()
    .single();
  if (error) return res.status(400).json({ error: error.message });

  await auditLog(
    "change_user_role", "user", req.params.id, actor.id ?? null,
    `${actor.email} changed ${target.email}'s role: ${target.role} → ${newRole}`,
  );

  return res.json(data);
});

// ─── DELETE /users/:id ───────────────────────────────────────────────────────
router.delete("/:id", async (req, res) => {
  const actor = await getUserFromToken(req.headers.authorization);
  if (!actor) return res.status(401).json({ error: "Unauthorized" });
  if (actor.active === false) {
    return res.status(403).json({ error: "Your account is suspended" });
  }
  if (actor.role !== "super_admin") {
    return res.status(403).json({ error: "Only Super Admins can remove members" });
  }
  if (actor.id === req.params.id) {
    return res.status(400).json({ error: "You cannot remove your own account" });
  }

  const admin = getServiceRoleClient();
  if (!admin) {
    return res.status(500).json({ error: "Service role key not configured on the server" });
  }

  const { data: target, error: tErr } = await admin
    .from("users")
    .select("id, email, role, name")
    .eq("id", req.params.id)
    .single();
  if (tErr || !target) return res.status(404).json({ error: "User not found" });

  if (target.role === "super_admin") {
    const { count } = await admin
      .from("users")
      .select("id", { count: "exact", head: true })
      .eq("role", "super_admin")
      .eq("active", true);
    if ((count ?? 0) <= 1) {
      return res.status(400).json({
        error: "Cannot remove the last active Super Admin. Promote another user first.",
      });
    }
  }

  const { error: authErr } = await (admin.auth.admin as any).deleteUser(target.id);
  if (authErr && !String(authErr.message ?? "").toLowerCase().includes("not found")) {
    return res.status(400).json({ error: `Failed to revoke auth identity: ${authErr.message}` });
  }

  const safeEmail = `removed+${target.id.slice(0, 8)}@traveluxe.local`;
  const { error: updErr } = await admin
    .from("users")
    .update({ active: false, email: safeEmail, name: "[removed]" })
    .eq("id", target.id);
  if (updErr) return res.status(400).json({ error: updErr.message });

  await auditLog(
    "remove_user", "user", target.id, actor.id ?? null,
    `${actor.email} removed ${target.email} (${target.role})`,
  );

  return res.json({ ok: true });
});

export default router;
