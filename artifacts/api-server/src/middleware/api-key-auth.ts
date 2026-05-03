import type { Request, Response, NextFunction, RequestHandler } from "express";
import { getServiceRoleClient } from "../lib/supabase";
import { hashSecret, type Scope } from "../lib/api-keys";

export type ApiKeyContext = {
  id: string;
  name: string;
  scopes: Scope[];
};

export type DriverContext = {
  sessionId: string;
  driverId: string;
  apiKeyId: string | null;
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      apiKey?: ApiKeyContext;
      driverCtx?: DriverContext;
    }
  }
}
export {};

function extractKey(req: Request): string | null {
  const header = req.headers["authorization"];
  if (typeof header === "string" && header.startsWith("Bearer ")) {
    return header.slice(7).trim() || null;
  }
  const xKey = req.headers["x-api-key"];
  if (typeof xKey === "string" && xKey.trim()) return xKey.trim();
  return null;
}

export function requireApiKey(...required: Scope[]): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const sb = getServiceRoleClient();
    if (!sb) {
      return res.status(503).json({
        error: "Public API unavailable: SUPABASE_SERVICE_ROLE_KEY is not configured on the server.",
      });
    }

    const key = extractKey(req);
    if (!key) {
      return res.status(401).json({ error: "Missing API key. Send 'Authorization: Bearer <key>'." });
    }

    const hash = hashSecret(key);
    const { data: row, error } = await sb
      .from("api_keys")
      .select("id, name, scopes, revoked_at")
      .eq("key_hash", hash)
      .maybeSingle();

    if (error || !row || row.revoked_at) {
      return res.status(401).json({ error: "Invalid or revoked API key." });
    }

    const grantedScopes: Scope[] = Array.isArray(row.scopes) ? (row.scopes as Scope[]) : [];
    const missing = required.filter((s) => !grantedScopes.includes(s));
    if (missing.length) {
      return res.status(403).json({
        error: `API key is missing required scope(s): ${missing.join(", ")}`,
      });
    }

    req.apiKey = { id: row.id, name: row.name, scopes: grantedScopes };

    sb.from("api_keys")
      .update({
        last_used_at: new Date().toISOString(),
        last_used_ip: (req.ip ?? req.socket.remoteAddress ?? null) as string | null,
      })
      .eq("id", row.id)
      .then(() => undefined, () => undefined);

    return next();
  };
}

export function requireDriverSession(): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const sb = getServiceRoleClient();
    if (!sb) return res.status(503).json({ error: "Public API unavailable." });

    const token = req.headers["x-driver-token"];
    if (typeof token !== "string" || !token.trim()) {
      return res.status(401).json({ error: "Missing X-Driver-Token header." });
    }

    const hash = hashSecret(token.trim());
    const { data: row, error } = await sb
      .from("driver_sessions")
      .select("id, driver_id, api_key_id, expires_at, revoked_at")
      .eq("token_hash", hash)
      .maybeSingle();

    if (error || !row || row.revoked_at) {
      return res.status(401).json({ error: "Invalid or revoked driver session." });
    }
    if (new Date(row.expires_at).getTime() < Date.now()) {
      return res.status(401).json({ error: "Driver session expired. Log in again." });
    }

    req.driverCtx = {
      sessionId: row.id,
      driverId: row.driver_id,
      apiKeyId: row.api_key_id,
    };

    sb.from("driver_sessions")
      .update({ last_used_at: new Date().toISOString() })
      .eq("id", row.id)
      .then(() => undefined, () => undefined);

    return next();
  };
}
