/**
 * Drop everything in the public schema and recreate it empty.
 *
 *   pnpm --filter @floe-dashboard/data db:reset
 *
 * **Destroys all data.** Use only on dev/staging databases.
 * After running, follow with `pnpm --filter @floe-dashboard/data db:push`
 * to re-create the schema from drizzle/.
 */

import { sql } from "drizzle-orm";
import { createDb } from "../src/client.js";

async function main() {
  const db = createDb();
  console.log("[reset] dropping schema public CASCADE…");
  await db.execute(sql`DROP SCHEMA IF EXISTS public CASCADE`);
  await db.execute(sql`CREATE SCHEMA public`);
  await db.execute(sql`GRANT ALL ON SCHEMA public TO public`);
  console.log("[reset] done. Run `pnpm db:push` to create tables.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
