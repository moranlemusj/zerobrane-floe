/**
 * One-shot operational tool: run backfillInitialConditions once and exit.
 *
 * Use when a newly-matched loan was indexed but is showing `—` for
 * BORROWED / COLLATERAL POSTED because the live handler hasn't backfilled
 * yet (or this binary predates the live-handler wiring).
 *
 *   pnpm --filter @floe-dashboard/indexer exec tsx --env-file=../../.env scripts/backfill-initial-once.ts
 */

import pino from "pino";
import { buildClientsWithFallback } from "../src/clients";
import { backfillInitialConditions } from "../src/backfill-initial";

async function main() {
  const log = pino({ level: process.env.LOG_LEVEL ?? "info" }).child({
    service: "backfill-initial-once",
  });
  const clients = await buildClientsWithFallback();
  for (const w of clients.warnings) log.warn({}, w);
  const result = await backfillInitialConditions(clients, log);
  log.info(result, "done");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
