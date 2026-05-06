/**
 * Sanity-check the Neon connection + Drizzle setup.
 *
 *   pnpm --filter @floe-dashboard/data db:ping
 *
 * Reads NEON_DATABASE_URL from the env (load via `--env-file` or shell export),
 * runs `SELECT 1`, lists current tables.
 */

import { sql } from "drizzle-orm";
import { createDb } from "../src/client.js";

async function main() {
  const db = createDb();
  const ping = await db.execute(sql`SELECT 1 AS ok, now() AS now, current_database() AS db`);
  console.log("[ping] connection OK:", ping.rows[0]);

  const tables = await db.execute(
    sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`,
  );
  console.log(`[ping] tables in public schema (${tables.rows.length}):`);
  for (const row of tables.rows) {
    console.log(`  - ${(row as { table_name: string }).table_name}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
