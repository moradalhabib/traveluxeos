import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { AsyncLocalStorage } from "node:async_hooks";

// Per-request storage for the user's auth header. Set by middleware in app.ts
// so every Supabase call inside a request automatically forwards the JWT.
export const authStorage = new AsyncLocalStorage<string | undefined>();

let _anonClient: SupabaseClient | null = null;
let _serviceRoleClient: SupabaseClient | null | undefined = undefined;
const _jwtClientCache = new Map<string, SupabaseClient>();

/**
 * Returns a Supabase client authenticated with the service-role key, which
 * bypasses RLS. Use ONLY for trusted server-side jobs (backups, scheduler)
 * — never for user-facing requests. Returns null if the key isn't configured.
 */
export function getServiceRoleClient(): SupabaseClient | null {
  if (_serviceRoleClient !== undefined) return _serviceRoleClient;
  const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !key) {
    _serviceRoleClient = null;
    return null;
  }
  _serviceRoleClient = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _serviceRoleClient;
}

function readEnv() {
  const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").trim();
  const key = (process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "").trim();
  if (!url || !url.startsWith("http")) {
    throw new Error("Missing or invalid SUPABASE_URL environment variable. Must be a valid https:// URL.");
  }
  if (!key) {
    throw new Error("Missing SUPABASE_ANON_KEY environment variable.");
  }
  return { url, key };
}

function getAnonClient(): SupabaseClient {
  if (_anonClient) return _anonClient;
  const { url, key } = readEnv();
  _anonClient = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _anonClient;
}

function getJwtClient(token: string): SupabaseClient {
  const cached = _jwtClientCache.get(token);
  if (cached) return cached;
  const { url, key } = readEnv();
  const client = createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  // Cap cache to avoid memory bloat across many users
  if (_jwtClientCache.size > 200) _jwtClientCache.clear();
  _jwtClientCache.set(token, client);
  return client;
}

// The default client automatically uses the per-request JWT if one was stored
// by the auth middleware; otherwise falls back to the anon client.
function getClient(): SupabaseClient {
  const authHeader = authStorage.getStore();
  if (authHeader?.startsWith("Bearer ")) {
    return getJwtClient(authHeader.substring(7));
  }
  return getAnonClient();
}

export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    const client = getClient();
    const value = (client as any)[prop];
    if (typeof value === "function") {
      return value.bind(client);
    }
    return value;
  },
});

export async function auditLog(
  action: string,
  entityType: string,
  entityId: string,
  operatorId: string | null,
  detail: string
) {
  await getClient().from("audit_log").insert({
    action,
    entity_type: entityType,
    entity_id: entityId,
    operator_id: operatorId,
    detail,
  });
}

export function createClientForJwt(token: string): SupabaseClient {
  const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").trim();
  const key = (process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "").trim();
  return createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function getDbClient(authHeader: string | undefined): SupabaseClient {
  if (authHeader?.startsWith("Bearer ")) {
    return createClientForJwt(authHeader.substring(7));
  }
  return supabase;
}

export type AppUser = {
  id: string;
  email: string;
  name: string;
  role: string;
  active: boolean;
  [key: string]: unknown;
};

export async function getUserFromToken(authHeader: string | undefined): Promise<AppUser | null> {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.substring(7);
  const client = getClient();
  const { data } = await client.auth.getUser(token);
  if (!data.user) return null;
  const { data: userData } = await client
    .from("users")
    .select("*")
    .eq("id", data.user.id)
    .single();
  if (!userData) return null;
  const u = userData as Record<string, unknown>;
  return {
    ...u,
    id: String(u.id ?? data.user.id),
    email: String(u.email ?? ""),
    name: String(u.name ?? ""),
    role: String(u.role ?? ""),
    active: Boolean(u.active ?? true),
  };
}
