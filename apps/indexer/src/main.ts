/**
 * Floe dashboard indexer — entry point.
 *
 * Phase 3 status: ABI resolution + markets sync + lastBlock seed.
 * Subscriptions, backfill, hydration land in subsequent commits.
 */

import pino from "pino";
import { sql } from "drizzle-orm";
import { buildClients } from "./clients";
import { getResolvedAbis } from "./abis";
import { getLastBlock, setLastBlock } from "./state";
import { syncMarkets } from "./markets";

const log = pino({ level: process.env.LOG_LEVEL ?? "info" }).child({ service: "indexer" });

async function main() {
  log.info({ phase: "startup" }, "indexer booting");

  const clients = buildClients();
  log.info(
    { transport: clients.hasWebSocket ? "wss" : "http", neonOk: !!clients.db },
    "clients ready",
  );

  const ping = await clients.db.execute(
    sql`SELECT 1 AS ok, now() AS now, current_database() AS db`,
  );
  log.info({ ping: ping.rows[0] }, "neon ping ok");

  const abis = await getResolvedAbis(clients.httpClient);
  log.info(
    {
      sources: abis.sources,
      events: abis.matcherDecodeAbi.length,
      matcherViewItems: abis.matcherViews.length,
      lendingViewsItems: abis.lendingViewsAbi.length,
    },
    "abis resolved",
  );

  const marketsCount = await syncMarkets(clients.db);
  log.info({ markets: marketsCount }, "markets synced");

  const head = await clients.httpClient.getBlockNumber();
  const lastBlock = await getLastBlock(clients.db);
  if (lastBlock === 0n) {
    // First run — set lastBlock to head minus a small lookback so we
    // backfill recent activity rather than the whole chain.
    const lookback = 100_000n; // ~55 hours on Base
    const start = head > lookback ? head - lookback : 0n;
    await setLastBlock(clients.db, start);
    log.info({ head, start, lookback }, "seeded lastBlock for first run");
  } else {
    log.info({ head, lastBlock, gap: head - lastBlock }, "resuming from persisted lastBlock");
  }

  log.info({ phase: "exit" }, "Phase 3 step 1 OK — ready for backfill + subscriptions");
}

main().catch((err) => {
  log.error({ err }, "indexer crashed");
  process.exit(1);
});
