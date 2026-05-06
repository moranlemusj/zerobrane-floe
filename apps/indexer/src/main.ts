/**
 * Floe dashboard indexer — entry point.
 *
 * Phase 2 status: skeleton. Verifies env, creates the Neon client,
 * pings the DB, and exits cleanly. Phase 3 fills in the actual chain
 * subscriptions, multicall hydration, and oracle handling.
 */

import { sql } from "drizzle-orm";
import pino from "pino";
import { createDb, indexerState } from "@floe-dashboard/data";

const log = pino({ level: process.env.LOG_LEVEL ?? "info" }).child({ service: "indexer" });

interface RequiredEnv {
  NEON_DATABASE_URL: string;
  BASE_RPC_URL: string;
  BASE_WSS_URL: string;
}

function readEnv(): RequiredEnv {
  const missing: string[] = [];
  const env: Partial<RequiredEnv> = {
    NEON_DATABASE_URL: process.env.NEON_DATABASE_URL,
    BASE_RPC_URL: process.env.BASE_RPC_URL,
    BASE_WSS_URL: process.env.BASE_WSS_URL,
  };
  for (const k of Object.keys(env) as (keyof RequiredEnv)[]) {
    if (!env[k]) missing.push(k);
  }
  if (missing.length > 0) {
    log.warn({ missing }, "missing env vars (Phase 2 skeleton tolerates BASE_*; Phase 3 requires)");
  }
  return env as RequiredEnv;
}

async function main() {
  log.info({ phase: "startup" }, "indexer booting");
  readEnv();

  const db = createDb();
  log.info({}, "drizzle client created");

  const ping = await db.execute(sql`SELECT 1 AS ok, now() AS now, current_database() AS db`);
  log.info({ ping: ping.rows[0] }, "neon ping ok");

  // Read or seed `lastBlock`. Phase 3 backfills from here.
  const existing = await db
    .select()
    .from(indexerState)
    .where(sql`${indexerState.key} = 'lastBlock'`);
  if (existing.length === 0) {
    await db.insert(indexerState).values({ key: "lastBlock", value: "0" });
    log.info({}, "seeded indexer_state.lastBlock = 0");
  } else {
    log.info({ lastBlock: existing[0]?.value }, "resuming from indexer_state.lastBlock");
  }

  log.info({ phase: "exit" }, "Phase 2 skeleton OK — ready for Phase 3 to add subscriptions");
}

main().catch((err) => {
  log.error({ err }, "indexer crashed");
  process.exit(1);
});
