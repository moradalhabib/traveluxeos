import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let _client: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (_client) return _client;

  const supabaseUrl = (
    process.env.SUPABASE_URL ||
    process.env.VITE_SUPABASE_URL ||
    ""
  ).trim();

  const supabaseAnonKey = (
    process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    ""
  ).trim();

  if (!supabaseUrl || !supabaseUrl.startsWith("http")) {
    throw new Error(
      "Missing or invalid SUPABASE_URL environment variable. Must be a valid https:// URL."
    );
  }

  if (!supabaseAnonKey) {
    throw new Error(
      "Missing SUPABASE_ANON_KEY environment variable."
    );
  }

  _client = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return _client;
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

export async function getUserFromToken(authHeader: string | undefined) {
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
  return userData;
}
