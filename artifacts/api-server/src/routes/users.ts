import { Router } from "express";
import { supabase, auditLog, getUserFromToken, getServiceRoleClient } from "../lib/supabase";

const router = Router();

const ALLOWED_ROLES = ["super_admin", "admin", "operator"] as const;
type Role = (typeof ALLOWED_ROLES)[number];

// ─── POST /users/invite ──────────────────────────────────────────────────────
// Sends a Supabase invite email to a new member and creates their public.users
// row with the requested role + active=false (they activate on first sign-in).
// Admin or Super Admin only.
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
  // Only Super Admins can mint another Super Admin.
  if (role === "super_admin" && actor.role !== "super_admin") {
    return res.status(403).json({ error: "Only Super Admins can invite Super Admins" });
  }

  const admin = getServiceRoleClient();
  if (!admin) {
    return res.status(500).json({ error: "Service role key not configured on the server" });
  }

  // Refuse if email already exists in public.users
  const { data: existing } = await supabase
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

  // Send invite email via Supabase Auth (uses the project's configured SMTP).
  const { data: invited, error: inviteErr } = await (admin.auth.admin as any)
    .inviteUserByEmail(email, { data: { name } });
  if (inviteErr || !invited?.user) {
    return res.status(400).json({
      error: inviteErr?.message ?? "Could not send invite email — check your Supabase SMTP settings.",
    });
  }

  // Create the public.users row mirroring auth.users.id, active=false until they accept.
  const { data: created, error: insErr } = await admin
    .from("users")
    .insert({ id: invited.user.id, email, name, role, active: false })
    .select()
    .single();
  if (insErr) {
    // Roll back the auth user so the next attempt can succeed.
    await (admin.auth.admin as any).deleteUser(invited.user.id).catch(() => {});
    return res.status(400).json({ error: insErr.message });
  }

  await auditLog(
    "invite_user",
    "user",
    created.id,
    actor.id ?? null,
    `${actor.email} invited ${email} as ${role}`,
  );

  return res.json(created);
});

router.get("/", async (req, res) => {
  const actor = await getUserFromToken(req.headers.authorization);
  if (!actor) return res.status(401).json({ error: "Unauthorized" });
  if (!["super_admin", "admin", "operator"].includes(actor.role)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  // Use service role to bypass RLS so all team members are visible to admins.
  const client = getServiceRoleClient() ?? supabase;
  const { data, error } = await client
    .from("users")
    .select("*")
    .order("name");

  if (error) return res.status(500).json({ error: error.message });
  return res.json(data ?? []);
});

router.put("/:id/deactivate", async (req, res) => {
  const user = await getUserFromToken(req.headers.authorization);
  if (!user) return res.status(401).json({ error: "Unauthorized" });
  if (user.active === false) {
    return res.status(403).json({ error: "Your account is suspended" });
  }
  if (user.role !== "super_admin" && user.role !== "admin") {
    return res.status(403).json({ error: "Only Admins or Super Admins can deactivate accounts" });
  }
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

// ─── DELETE /users/:id ───────────────────────────────────────────────────────
// "Remove member": revokes their auth identity (deletes from auth.users so they
// can no longer sign in and the email is freed) and soft-deletes them in
// public.users (active=false, name="[removed]"). Existing references to them
// in bookings/jobs/audit_log are preserved for historical integrity.
// Super Admin only. Never the current user. Never the last Super Admin.
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

  const { data: target, error: tErr } = await supabase
    .from("users")
    .select("id, email, role, name")
    .eq("id", req.params.id)
    .single();
  if (tErr || !target) return res.status(404).json({ error: "User not found" });

  // Don't let the last super_admin be removed — that would lock the org out.
  if (target.role === "super_admin") {
    const { count } = await supabase
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

  // 1) Revoke auth identity. If this fails we don't proceed — we don't want a
  //    dangling soft-deleted row whose owner can still sign in.
  const { error: authErr } = await (admin.auth.admin as any).deleteUser(target.id);
  if (authErr && !String(authErr.message ?? "").toLowerCase().includes("not found")) {
    return res.status(400).json({ error: `Failed to revoke auth identity: ${authErr.message}` });
  }

  // 2) Soft-delete the public.users row. Free the email so it can be re-invited
  //    later. Keep the id stable so historical FKs still resolve.
  const safeEmail = `removed+${target.id.slice(0, 8)}@traveluxe.local`;
  const { error: updErr } = await admin
    .from("users")
    .update({ active: false, email: safeEmail, name: "[removed]" })
    .eq("id", target.id);
  if (updErr) return res.status(400).json({ error: updErr.message });

  await auditLog(
    "remove_user",
    "user",
    target.id,
    actor.id ?? null,
    `${actor.email} removed ${target.email} (${target.role})`,
  );

  return res.json({ ok: true });
});

export default router;
