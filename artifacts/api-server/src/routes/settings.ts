import { Router, type IRouter, type Request, type Response } from "express";
import { supabase } from "../lib/supabase";

const router: IRouter = Router();

// GET /api/settings — return all key/value settings as a flat object.
router.get("/", async (_req: Request, res: Response) => {
  const { data, error } = await supabase
    .from("app_settings")
    .select("key, value");
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  const out: Record<string, string | null> = {};
  for (const row of data ?? []) out[row.key] = row.value;
  res.json(out);
});

// Whitelisted settings + per-key validators. Rejects anything else so an
// admin can't accidentally pollute the config namespace via a typo or
// malicious client. Add new entries here as the app grows.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ALLOWED_SETTINGS: Record<string, (v: unknown) => string | { error: string }> = {
  admin_email: (v) => {
    const s = String(v ?? "").trim();
    if (s.length === 0)            return { error: "admin_email cannot be empty" };
    if (s.length > 254)            return { error: "admin_email too long" };
    if (!EMAIL_RE.test(s))         return { error: "admin_email is not a valid email" };
    return s;
  },
};

// PUT /api/settings — body = { key: value, ... }. Upserts each pair.
// RLS on app_settings additionally restricts writes to admin / super_admin.
router.put("/", async (req: Request, res: Response) => {
  const body = req.body ?? {};
  const entries = Object.entries(body).filter(([k]) => typeof k === "string" && k.length > 0);
  if (entries.length === 0) {
    res.status(400).json({ error: "No settings provided" });
    return;
  }

  const rows: Array<{ key: string; value: string; updated_at: string }> = [];
  for (const [key, raw] of entries) {
    const validator = ALLOWED_SETTINGS[key];
    if (!validator) {
      res.status(400).json({ error: `Unknown setting key: ${key}` });
      return;
    }
    const out = validator(raw);
    if (typeof out === "object" && out && "error" in out) {
      res.status(400).json({ error: out.error });
      return;
    }
    rows.push({ key, value: out as string, updated_at: new Date().toISOString() });
  }

  const { error } = await supabase.from("app_settings").upsert(rows, { onConflict: "key" });
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json({ ok: true, updated: rows.map(r => r.key) });
});

export default router;
