import { Router } from "express";
import { supabase } from "../lib/supabase";
import { logActivity } from "../lib/activity";

const router = Router();

router.post("/login", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error || !data.session) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const { data: userData } = await supabase
    .from("users")
    .select("*")
    .eq("id", data.user.id)
    .single();

  await logActivity({
    action_type: "auth_login",
    description: `${userData?.name ?? data.user.email} signed in`,
    entity_type: "user",
    entity_id: data.user.id,
    entity_label: userData?.name ?? data.user.email ?? null,
    operator_id: data.user.id,
    operator_name: userData?.name ?? data.user.email ?? null,
  });

  return res.json({
    token: data.session.access_token,
    user: {
      id: data.user.id,
      email: data.user.email,
      name: userData?.name ?? data.user.email?.split("@")[0],
      role: userData?.role ?? "operator",
    },
  });
});

router.post("/logout", async (req, res) => {
  await supabase.auth.signOut();
  return res.json({ success: true });
});

router.get("/me", async (req, res) => {
  const token = req.headers.authorization?.substring(7);
  if (!token) return res.status(401).json({ error: "Unauthorized" });

  const { data } = await supabase.auth.getUser(token);
  if (!data.user) return res.status(401).json({ error: "Unauthorized" });

  const { data: userData } = await supabase
    .from("users")
    .select("*")
    .eq("id", data.user.id)
    .single();

  return res.json(userData ?? { id: data.user.id, email: data.user.email, role: "operator" });
});

export default router;
