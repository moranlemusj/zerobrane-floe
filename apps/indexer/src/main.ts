/**
 * Floe dashboard indexer — entry point.
 *
 * Phase 3 status: ABI resolution + markets sync + lastBlock seed.
 * Subscriptions, backfill, hydration land in subsequent commits.
 */

import { sql } from "drizzle-orm";
import pino from "pino";
import { getResolvedAbis } from "./abis";
import { discoverLoanIds } from "./bootstrap-loans";
import { buildClients } from "./clients";
import { hydrateLoans } from "./hydrate";
import { syncMarkets } from "./markets";
import { getLastBlock, setLastBlock } from "./state";

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
    const lookback = 100_000n; // ~55 hours on Base
    const start = head > lookback ? head - lookback : 0n;
    await setLastBlock(clients.db, start);
    log.info({ head, start, lookback }, "seeded lastBlock for first run");
  } else {
    log.info({ head, lastBlock, gap: head - lastBlock }, "resuming from persisted lastBlock");
  }

  // Bootstrap: discover loans by enumerating getLoan(1..N). One-shot —
  // catches loans created before our event-backfill window starts.
  log.info({}, "discovering existing loans via getLoan() probe…");
  const { found, highestProbed } = await discoverLoanIds(clients, abis.matcherViews);
  log.info({ found: found.length, highestProbed: highestProbed.toString() }, "loan discovery done");

  if (found.length > 0) {
    log.info({}, "hydrating discovered loans via Multicall3…");
    const hydrateResult = await hydrateLoans(
      clients,
      abis.matcherViews,
      abis.lendingViewsAbi,
      found,
      head,
    );
    log.info(hydrateResult, "hydration done");
  }

  log.info({ phase: "exit" }, "Phase 3 step 2 OK — bootstrap complete");
}

main().catch((err) => {
  log.error({ err }, "indexer crashed");
  process.exit(1);
});
