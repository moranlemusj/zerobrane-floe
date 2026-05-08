/**
 * Live subscriptions: matcher proxy events + Chainlink AnswerUpdated.
 *
 * Uses viem `watchContractEvent` over WebSocket when available, polling
 * over HTTP otherwise. On every relevant event we apply + hydrate
 * the affected loans.
 */

import type { Abi, AbiEvent, Log } from "viem";
import type pino from "pino";
import {
  activeLoanIdsForCollaterals,
  collateralsForOracle,
  readOracle,
  resolveUnderlyingAggregator,
  snapshotOracle,
} from "./oracle";
import { applyEvent } from "./events";
import { hydrateLoans } from "./hydrate";
import { setLastBlock } from "./state";
import { preferWss, type IndexerClients } from "./clients";
import { CHAINLINK_AGGREGATOR_ABI } from "./abis";
import { CONTRACTS, ORACLES } from "./contracts";

export interface SubscriptionHandles {
  unwatchMatcher: () => void;
  unwatchOracles: Array<() => void>;
}

export async function subscribeAll(opts: {
  clients: IndexerClients;
  decoderAbi: AbiEvent[];
  matcherViewsAbi: Abi;
  lendingViewsAbi: Abi;
  log: pino.Logger;
}): Promise<SubscriptionHandles> {
  const { clients, decoderAbi, matcherViewsAbi, lendingViewsAbi, log } = opts;
  const subClient = preferWss(clients);

  log.info(
    { matcher: CONTRACTS.matcher, oracleCount: Object.keys(ORACLES).length },
    `subscribing — matcher=${CONTRACTS.matcher} oracles=${Object.keys(ORACLES).length}`,
  );

  const unwatchMatcher = subClient.watchContractEvent({
    address: CONTRACTS.matcher,
    abi: decoderAbi,
    onError: (err: Error) =>
      log.error({ err: err.message, source: "matcher-sub" }, "matcher subscription error"),
    onLogs: async (logs: Log[]) => {
      try {
        const loanIds = new Set<string>();
        let lastBlock = 0n;
        for (const entry of logs) {
          const blockNumber = entry.blockNumber ?? 0n;
          if (blockNumber > lastBlock) lastBlock = blockNumber;
          const ts = await fetchBlockTimestamp(clients, blockNumber);
          const result = await applyEvent(clients.db, decoderAbi, entry, ts);
          log.info(
            { event: result.eventName, decoded: result.decoded, loanIds: result.loanIds.map(String) },
            "matcher event",
          );
          for (const id of result.loanIds) loanIds.add(id.toString());
        }
        if (loanIds.size > 0) {
          const ids = Array.from(loanIds).map(BigInt);
          const hr = await hydrateLoans(clients, matcherViewsAbi, lendingViewsAbi, ids, lastBlock);
          log.info({ ...hr, loanIds: ids.map(String) }, "rehydrated after matcher event(s)");
        }
        if (lastBlock > 0n) await setLastBlock(clients.db, lastBlock);
      } catch (err) {
        log.error({ err: (err as Error).message }, "matcher onLogs failed — next reconcile will catch up");
      }
    },
  });

  const unwatchOracles: Array<() => void> = [];
  for (const [name, feedAddress] of Object.entries(ORACLES)) {
    // The proxy doesn't emit events — the underlying aggregator does.
    // Resolve once at subscribe-time. View reads stay against the proxy.
    let underlying: `0x${string}`;
    try {
      underlying = await resolveUnderlyingAggregator(clients, feedAddress);
    } catch (err) {
      log.error(
        { err: (err as Error).message, feed: name, proxy: feedAddress },
        `failed to resolve underlying aggregator for ${name} — skipping subscription`,
      );
      continue;
    }
    log.info(
      { feed: name, proxy: feedAddress, underlying },
      `oracle ${name}: subscribing to underlying ${underlying} (proxy ${feedAddress})`,
    );

    const unwatch = subClient.watchContractEvent({
      address: underlying,
      abi: CHAINLINK_AGGREGATOR_ABI,
      eventName: "AnswerUpdated",
      onError: (err: Error) =>
        log.error(
          { err: err.message, feed: name, source: "oracle-sub" },
          `oracle subscription error (${name})`,
        ),
      onLogs: async (logs: Log[]) => {
        try {
          const lastBlock = logs.at(-1)?.blockNumber ?? 0n;
          log.info(
            { feed: name, underlying, count: logs.length, lastBlock: lastBlock.toString() },
            "oracle tick",
          );
          try {
            // Read via the proxy — that's the canonical read path; it forwards
            // to whatever the current underlying is, so we stay correct across
            // hypothetical phase changes between subscribe-time and read-time.
            const snapshot = await readOracle(clients, feedAddress);
            await snapshotOracle(clients.db, snapshot, lastBlock);
          } catch (err) {
            log.warn({ err: (err as Error).message }, "oracle snapshot failed");
          }
          const collaterals = collateralsForOracle(feedAddress);
          const loanIds = await activeLoanIdsForCollaterals(clients.db, collaterals);
          if (loanIds.length > 0) {
            const hr = await hydrateLoans(
              clients,
              matcherViewsAbi,
              lendingViewsAbi,
              loanIds,
              lastBlock,
            );
            log.info(
              { ...hr, oracle: name, refreshedLoans: loanIds.length },
              "rehydrated active loans after oracle tick",
            );
          }
        } catch (err) {
          log.error(
            { err: (err as Error).message, feed: name },
            "oracle onLogs failed — next tick / reconcile will catch up",
          );
        }
      },
    });
    unwatchOracles.push(unwatch);
  }

  return { unwatchMatcher, unwatchOracles };
}

const blockTimestampCache = new Map<string, bigint>();
async function fetchBlockTimestamp(clients: IndexerClients, blockNumber: bigint): Promise<bigint> {
  const key = blockNumber.toString();
  const cached = blockTimestampCache.get(key);
  if (cached !== undefined) return cached;
  try {
    const block = await clients.httpClient.getBlock({ blockNumber, includeTransactions: false });
    blockTimestampCache.set(key, block.timestamp);
    return block.timestamp;
  } catch {
    return 0n;
  }
}
