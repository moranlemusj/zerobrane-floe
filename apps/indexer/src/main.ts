/**
 * Floe dashboard indexer — entry point.
 *
 * Boot sequence:
 *   1. clients + db
 *   2. resolve ABIs from Sourcify (cached)
 *   3. sync markets from /v1/markets
 *   4. seed lastBlock if first run (head − 100k)
 *   5. discover loans by enumerating getLoan(1..N) via multicall
 *   6. event backfill from state.lastBlock to head
 *   7. hydrate every loan touched by step 5 ∪ step 6
 *   8. initial oracle snapshot
 *   9. live subscriptions (matcher + oracles) over WSS or HTTP polling
 *  10. periodic 10-min reconciliation pass
 *
 * Crashes? Restart and the same boot sequence re-runs. State is in
 * Neon (`indexer_state.lastBlock`) so we resume cleanly.
 *
 * One-shot mode (`INDEXER_ONE_SHOT=1`): skip steps 9–10 and exit
 * after step 8. Useful for cron-like deploys and CI smoke tests.
 */

import { sql } from "drizzle-orm";
import pino from "pino";
import { getResolvedAbis } from "./abis";
import { backfillEvents } from "./backfill";
import { backfillCloseTimestamps, backfillInitialConditions } from "./backfill-initial";
import { discoverLoanIds } from "./bootstrap-loans";
import { buildClientsWithFallback } from "./clients";
import { enrichUnknownMarkets } from "./enrich-markets";
import { hydrateLoans } from "./hydrate";
import { syncMarkets } from "./markets";
import { allActiveLoanIds, initialOracleSync } from "./oracle";
import { getLastBlock, setLastBlock } from "./state";
import { type SubscriptionHandles, subscribeAll } from "./subscribe";

const log = pino({ level: process.env.LOG_LEVEL ?? "info" }).child({ service: "indexer" });

// Defense-in-depth: a stray rejection inside a viem watcher or a transient
// Neon `fetch failed` should not kill the process. Local handlers already
// cover the known paths; this is the safety net for anything that slips
// past them.
process.on("unhandledRejection", (reason) => {
  const err = reason instanceof Error ? reason.message : String(reason);
  log.error({ err }, "unhandledRejection — keeping process alive");
});
process.on("uncaughtException", (err) => {
  log.error({ err: err.message, stack: err.stack }, "uncaughtException — keeping process alive");
});

const ONE_SHOT = process.env.INDEXER_ONE_SHOT === "1";
const RECONCILE_INTERVAL_MS = Number(process.env.RECONCILE_INTERVAL_MS ?? 10 * 60_000);

async function main() {
  log.info({ phase: "startup", oneShot: ONE_SHOT }, "indexer booting");

  const clients = await buildClientsWithFallback();
  for (const w of clients.warnings) log.warn({}, w);
  // Log loudly + as message text (not just JSON metadata) so it surfaces
  // through any log renderer (Railway's stripped view in particular).
  log.info(
    {
      transport: clients.hasWebSocket ? "wss" : "http (polling)",
      rpcSource: clients.rpcSource,
    },
    `clients ready — transport=${clients.hasWebSocket ? "wss" : "http (polling)"} rpcSource=${clients.rpcSource}`,
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
  let lastBlock = await getLastBlock(clients.db);
  if (lastBlock === 0n) {
    // Configurable to keep first-run backfill manageable on Alchemy free
    // (10-block chunks). Default 1000 blocks ≈ 33 min of history.
    const lookback = BigInt(process.env.INITIAL_LOOKBACK_BLOCKS ?? 1000);
    lastBlock = head > lookback ? head - lookback : 0n;
    await setLastBlock(clients.db, lastBlock);
    log.info({ head, lastBlock, lookback }, "seeded lastBlock for first run");
  } else {
    log.info({ head, lastBlock, gap: head - lastBlock }, "resuming from persisted lastBlock");
  }

  log.info({}, "discovering loans via getLoan() probe…");
  const { found, highestProbed } = await discoverLoanIds(clients, abis.matcherViews);
  log.info({ found: found.length, highestProbed: highestProbed.toString() }, "loan discovery done");

  log.info(
    { from: lastBlock.toString(), to: head.toString(), blocks: (head - lastBlock).toString() },
    "backfilling matcher events…",
  );
  const backfillResult = await backfillEvents(
    clients,
    abis.matcherDecodeAbi,
    lastBlock + 1n,
    head,
  );
  log.info(
    {
      totalLogs: backfillResult.totalLogs,
      decodedLogs: backfillResult.decodedLogs,
      loanIdsFromEvents: backfillResult.loanIdsTouched.length,
    },
    "backfill done",
  );

  const allIds = Array.from(
    new Set([
      ...found.map((b) => b.toString()),
      ...backfillResult.loanIdsTouched.map((b) => b.toString()),
    ]),
  ).map(BigInt);
  if (allIds.length > 0) {
    log.info({ total: allIds.length }, "hydrating discovered + touched loans…");
    const hr = await hydrateLoans(
      clients,
      abis.matcherViews,
      abis.lendingViewsAbi,
      allIds,
      head,
    );
    log.info(hr, "hydration done");

    // Idempotent — only touches loans missing initialPrincipalRaw / closedAtBlock.
    const ic = await backfillInitialConditions(clients, log.child({ phase: "initial" }));
    if (ic.updated + ic.skipped + ic.missing > 0) {
      log.info(ic, "initial-conditions backfill done");
    }
    const ct = await backfillCloseTimestamps(clients.db);
    if (ct.updated + ct.skipped > 0) {
      log.info(ct, "close-timestamps backfill done");
    }
  }

  await initialOracleSync(clients, head);
  log.info({}, "oracle snapshot done");

  // Backfill any market metadata for markets referenced by loans but
  // missing from our markets table (chain has more than /v1/markets exposes).
  const enrichResult = await enrichUnknownMarkets(clients, abis.matcherViews);
  log.info(enrichResult, "market enrichment done");

  await setLastBlock(clients.db, head);

  if (ONE_SHOT) {
    log.info({ phase: "exit" }, "one-shot complete");
    return;
  }

  const handles: SubscriptionHandles = await subscribeAll({
    clients,
    decoderAbi: abis.matcherDecodeAbi,
    matcherViewsAbi: abis.matcherViews,
    lendingViewsAbi: abis.lendingViewsAbi,
    log: log.child({ phase: "live" }),
  });
  log.info({}, "live subscriptions started");

  const reconcileTimer = setInterval(async () => {
    try {
      const newHead = await clients.httpClient.getBlockNumber();
      const lb = await getLastBlock(clients.db);
      if (newHead <= lb) return;
      log.info({ from: (lb + 1n).toString(), to: newHead.toString() }, "reconciliation pass…");
      const result = await backfillEvents(clients, abis.matcherDecodeAbi, lb + 1n, newHead);

      // Refresh accrued interest + LTV for every active loan. The event-driven
      // and oracle-driven hydration paths together miss loans whose collateral
      // has no Chainlink oracle (e.g. USDC/USDC markets): no oracle ticks →
      // never re-hydrated → accrued_interest stays frozen at match-time. This
      // blanket pass is cheap (single multicall) and guarantees freshness.
      const eventTouched = new Set(result.loanIdsTouched.map((b) => b.toString()));
      const active = await allActiveLoanIds(clients.db);
      const idsToHydrate = Array.from(
        new Set([...eventTouched, ...active.map((b) => b.toString())]),
      ).map(BigInt);

      if (idsToHydrate.length > 0) {
        const hr = await hydrateLoans(
          clients,
          abis.matcherViews,
          abis.lendingViewsAbi,
          idsToHydrate,
          newHead,
        );
        const ic = await backfillInitialConditions(clients, log.child({ phase: "reconcile-init" }));
        const ct = await backfillCloseTimestamps(clients.db);
        log.info(
          {
            ...hr,
            initialConditions: ic,
            closeTimestamps: ct,
            totalLogs: result.totalLogs,
            eventTouched: eventTouched.size,
            activeRefreshed: active.length,
          },
          "reconcile + hydrate done",
        );
      } else {
        log.info(
          { totalLogs: result.totalLogs, decodedLogs: result.decodedLogs },
          "reconcile done (no active loans)",
        );
      }
      await setLastBlock(clients.db, newHead);
    } catch (err) {
      log.error({ err: (err as Error).message }, "reconcile failed");
    }
  }, RECONCILE_INTERVAL_MS);

  const shutdown = (signal: string) => {
    log.info({ signal }, "shutting down");
    clearInterval(reconcileTimer);
    handles.unwatchMatcher();
    for (const u of handles.unwatchOracles) u();
    setTimeout(() => process.exit(0), 200);
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  log.error({ err }, "indexer crashed");
  process.exit(1);
});
