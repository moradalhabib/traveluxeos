import { Router, type IRouter, type Request, type Response } from "express";
import { supabase, getUserFromToken, auditLog } from "../lib/supabase";

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
// RLS on app_settings additionally restricts writes to admin / super_admin,
// but we duplicate the role check at the API layer so we can audit the
// actor and surface a clean 403 instead of a Postgres error string.
router.put("/", async (req: Request, res: Response) => {
  const user = await getUserFromToken(req.headers.authorization);
  if (!user || (user.role !== "super_admin" && user.role !== "admin")) {
    res.status(403).json({ error: "Only admin or super_admin can change settings" });
    return;
  }

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

  // Snapshot the previous values so the audit log captures before/after
  // for each key being changed (not just the new value).
  const keys = rows.map(r => r.key);
  const { data: prevRows } = await supabase
    .from("app_settings")
    .select("key, value")
    .in("key", keys);
  const prevMap: Record<string, string | null> = {};
  for (const r of prevRows ?? []) prevMap[r.key] = r.value;

  const { error } = await supabase.from("app_settings").upsert(rows, { onConflict: "key" });
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  // One audit row per key so each setting change is independently filterable.
  for (const r of rows) {
    const wasNull = !(r.key in prevMap);
    auditLog(
      "setting_updated",
      "app_setting",
      r.key,
      user.id,
      wasNull
        ? `Created setting "${r.key}" = ${JSON.stringify(r.value)}.`
        : `Updated setting "${r.key}": ${JSON.stringify(prevMap[r.key])} → ${JSON.stringify(r.value)}. before=${JSON.stringify(prevMap[r.key] ?? null)} after=${JSON.stringify(r.value)}`
    ).catch(() => {});
  }

  res.json({ ok: true, updated: rows.map(r => r.key) });
});

export default router;
