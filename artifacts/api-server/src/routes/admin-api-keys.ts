import { Router, type IRouter, type Request, type Response } from "express";
import { getServiceRoleClient, getUserFromToken, auditLog } from "../lib/supabase";
import { generateApiKey, ALL_SCOPES, type Scope } from "../lib/api-keys";

const router: IRouter = Router();

async function requireAdmin(req: Request, res: Response): Promise<{ id: string; role: string } | null> {
  const user = await getUserFromToken(req.headers.authorization);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return null; }
  if (user.role !== "super_admin") {
    res.status(403).json({ error: "Super Admins only." }); return null;
  }
  return user;
}

router.get("/", async (req, res) => {
  const user = await requireAdmin(req, res);
  if (!user) return;
  const sb = getServiceRoleClient();
  if (!sb) return res.status(503).json({ error: "SUPABASE_SERVICE_ROLE_KEY not configured." });
  const { data, error } = await sb
    .from("api_keys")
    .select("id, name, key_prefix, scopes, created_by, created_at, last_used_at, last_used_ip, revoked_at")
    .order("created_at", { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data ?? []);
});

router.get("/scopes", async (req, res) => {
  const user = await requireAdmin(req, res);
  if (!user) return;
  res.json(ALL_SCOPES);
});

router.post("/", async (req, res) => {
  const user = await requireAdmin(req, res);
  if (!user) return;
  const sb = getServiceRoleClient();
  if (!sb) return res.status(503).json({ error: "SUPABASE_SERVICE_ROLE_KEY not configured." });

  const name = String(req.body?.name ?? "").trim();
  const scopesIn: unknown = req.body?.scopes;
  if (!name) return res.status(400).json({ error: "name is required." });
  if (!Array.isArray(scopesIn) || scopesIn.length === 0) {
    return res.status(400).json({ error: "scopes must be a non-empty array." });
  }
  const scopes = scopesIn.map(String) as Scope[];
  const invalid = scopes.filter((s) => !ALL_SCOPES.includes(s));
  if (invalid.length) {
    return res.status(400).json({ error: `Unknown scopes: ${invalid.join(", ")}`, valid_scopes: ALL_SCOPES });
  }

  const { plaintext, hash, prefix } = generateApiKey();
  const { data, error } = await sb
    .from("api_keys")
    .insert({ name, key_hash: hash, key_prefix: prefix, scopes, created_by: user.id })
    .select("id, name, key_prefix, scopes, created_at")
    .single();
  if (error) return res.status(500).json({ error: error.message });

  await auditLog("create_api_key", "api_key", data.id, user.id, `Created API key "${name}" with scopes: ${scopes.join(", ")}`);

  return res.status(201).json({ ...data, key: plaintext });
});

router.delete("/:id", async (req, res) => {
  const user = await requireAdmin(req, res);
  if (!user) return;
  const sb = getServiceRoleClient();
  if (!sb) return res.status(503).json({ error: "SUPABASE_SERVICE_ROLE_KEY not configured." });

  const { data, error } = await sb
    .from("api_keys")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", req.params.id)
    .select("id, name")
    .single();
  if (error) return res.status(404).json({ error: "API key not found." });

  await auditLog("revoke_api_key", "api_key", data.id, user.id, `Revoked API key "${data.name}"`);
  return res.json({ ok: true });
});

export default router;
