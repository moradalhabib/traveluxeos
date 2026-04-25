/**
 * Startup migration — runs DDL that cannot be done through PostgREST.
 * Requires SUPABASE_DB_URL (the direct PostgreSQL connection string from
 * Supabase Dashboard → Settings → Database → "URI" connection string).
 *
 * If not set, a warning is printed with instructions to run the SQL manually.
 */

import { logger } from "../lib/logger";

const CREATE_PUSH_SUBSCRIPTIONS = `
  CREATE TABLE IF NOT EXISTS push_subscriptions (
    id          bigserial PRIMARY KEY,
    user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    endpoint    text NOT NULL UNIQUE,
    p256dh      text NOT NULL,
    auth        text NOT NULL,
    expires_at  timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS push_subscriptions_user_id_idx
    ON push_subscriptions(user_id);
  ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
  DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE tablename = 'push_subscriptions' AND policyname = 'service_role_all'
    ) THEN
      CREATE POLICY service_role_all ON push_subscriptions
        USING (true) WITH CHECK (true);
    END IF;
  END $$;
`;

export async function runMigrations(): Promise<void> {
  const dbUrl = (process.env.SUPABASE_DB_URL || "").trim();
  if (!dbUrl) {
    logger.warn(
      "SUPABASE_DB_URL not set — skipping startup migrations. " +
      "To enable OS push notifications run the SQL in " +
      "artifacts/api-server/migrations/push_subscriptions.sql " +
      "in the Supabase SQL Editor, then set SUPABASE_DB_URL in Secrets."
    );
    return;
  }

  try {
    const { default: pg } = await import("pg");
    const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
    await client.connect();
    try {
      await client.query(CREATE_PUSH_SUBSCRIPTIONS);
      logger.info("Startup migrations applied successfully");
    } finally {
      await client.end();
    }
  } catch (err: any) {
    logger.warn({ err: err?.message }, "Startup migration failed — push_subscriptions table may be missing. Run the SQL manually.");
  }
}
