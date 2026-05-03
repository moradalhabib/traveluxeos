/**
 * One-shot migration: add cancellation columns to the `requests` table.
 *
 * The API route PUT /api/requests/:id already writes these three columns when
 * cancelling a request, but they were never added to the schema — causing the
 * "Could not find the 'cancellation_reason' column" error from Supabase.
 *
 * Run:
 *   pnpm --filter @workspace/scripts run migrate:requests-cancellation
 *
 * Safe to run multiple times (IF NOT EXISTS guards every statement).
 */

import pg from "pg";

const { Client } = pg;

async function main() {
  const supabaseUrl = process.env.VITE_SUPABASE_URL ?? "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

  if (!supabaseUrl || !serviceRoleKey) {
    console.error("❌  VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set");
    process.exit(1);
  }

  // Extract project ref from https://<ref>.supabase.co
  const ref = new URL(supabaseUrl).hostname.split(".")[0];
  const host = `db.${ref}.supabase.co`;

  console.log(`🔌  Connecting to ${host}:5432 as postgres…`);

  const client = new Client({
    host,
    port: 5432,
    database: "postgres",
    user: "postgres",
    password: serviceRoleKey,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10_000,
  });

  try {
    await client.connect();
    console.log("✅  Connected");
  } catch (err: any) {
    console.error("❌  Connection failed:", err.message);
    console.log("\n⚠️  Direct-connection attempt failed (service role key ≠ DB password).");
    console.log("    Please run the following SQL in the Supabase SQL Editor:");
    console.log(`    https://supabase.com/dashboard/project/${ref}/sql/new\n`);
    printSql();
    process.exit(1);
  }

  try {
    const migration = `
      ALTER TABLE requests
        ADD COLUMN IF NOT EXISTS cancellation_reason text,
        ADD COLUMN IF NOT EXISTS cancelled_at        timestamptz,
        ADD COLUMN IF NOT EXISTS cancelled_by        uuid;
    `;

    await client.query(migration);
    console.log("✅  Migration applied — three columns added to requests table:");
    console.log("      cancellation_reason  text");
    console.log("      cancelled_at         timestamptz");
    console.log("      cancelled_by         uuid");
  } catch (err: any) {
    console.error("❌  Migration query failed:", err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

function printSql() {
  console.log("-- ── Run this in Supabase SQL Editor ──────────────────────────");
  console.log("ALTER TABLE requests");
  console.log("  ADD COLUMN IF NOT EXISTS cancellation_reason text,");
  console.log("  ADD COLUMN IF NOT EXISTS cancelled_at        timestamptz,");
  console.log("  ADD COLUMN IF NOT EXISTS cancelled_by        uuid;");
  console.log("-- ────────────────────────────────────────────────────────────\n");
}

main().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
