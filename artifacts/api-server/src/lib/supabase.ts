import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let _client: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (_client) return _client;

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "Missing Supabase environment variables: VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set."
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
