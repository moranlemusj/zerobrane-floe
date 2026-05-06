/**
 * Event backfill — pulls all logs at the matcher proxy from
 * `state.lastBlock` to the current chain head, in chunks.
 *
 * Per EVM rules, both matcher-native events AND LogicsManager events
 * (delegatecalled by matcher) AND HookExecutor events (when invoked
 * via matcher) all surface at the matcher's address. We subscribe to
 * a single address.
 */

import type { AbiEvent, Log } from "viem";
import { applyEvent } from "./events";
import type { IndexerClients } from "./clients";
import { CONTRACTS } from "./contracts";

/**
 * getLogs chunk size in blocks. Limits vary by RPC provider:
 *   - Alchemy free tier: 10 (hard cap, returns -32600)
 *   - llamarpc / public:  ~9_500
 *   - Alchemy PAYG / paid: 2000+
 *
 * Default 10 → safe for Alchemy free. Bump via env if you have a paid
 * plan or are using llamarpc. First-time backfill scales linearly:
 * (head - lastBlock) / chunkSize requests, ~100ms each.
 */
const BACKFILL_CHUNK_BLOCKS = BigInt(process.env.BACKFILL_CHUNK_BLOCKS ?? 10);

export interface BackfillResult {
  totalLogs: number;
  decodedLogs: number;
  loanIdsTouched: bigint[];
  scannedFrom: bigint;
  scannedTo: bigint;
}

export async function backfillEvents(
  clients: IndexerClients,
  decoderAbi: AbiEvent[],
  fromBlock: bigint,
  toBlock: bigint,
): Promise<BackfillResult> {
  const loanIds = new Set<string>();
  let totalLogs = 0;
  let decodedLogs = 0;

  // Process chunk-by-chunk to stay under public-RPC limits.
  for (let from = fromBlock; from <= toBlock; from += BACKFILL_CHUNK_BLOCKS + 1n) {
    const to = from + BACKFILL_CHUNK_BLOCKS > toBlock ? toBlock : from + BACKFILL_CHUNK_BLOCKS;
    let logs: Log[] = [];
    try {
      logs = await clients.httpClient.getLogs({
        address: CONTRACTS.matcher,
        fromBlock: from,
        toBlock: to,
      });
    } catch (err) {
      // Single chunk failed; continue with the next. Reconciliation will
      // catch up later from state.lastBlock.
      console.warn(`[backfill] getLogs ${from}..${to} failed:`, (err as Error).message.split("\n")[0]);
      continue;
    }

    for (const log of logs) {
      totalLogs++;
      const blockTimestamp = await getBlockTimestamp(clients, log.blockNumber ?? 0n);
      const result = await applyEvent(clients.db, decoderAbi, log, blockTimestamp);
      if (result.decoded) decodedLogs++;
      for (const id of result.loanIds) loanIds.add(id.toString());
    }
  }

  return {
    totalLogs,
    decodedLogs,
    loanIdsTouched: Array.from(loanIds).map((s) => BigInt(s)),
    scannedFrom: fromBlock,
    scannedTo: toBlock,
  };
}

const blockTimestampCache = new Map<string, bigint>();
async function getBlockTimestamp(clients: IndexerClients, blockNumber: bigint): Promise<bigint> {
  const key = blockNumber.toString();
  const cached = blockTimestampCache.get(key);
  if (cached !== undefined) return cached;
  try {
    const block = await clients.httpClient.getBlock({ blockNumber, includeTransactions: false });
    const ts = block.timestamp;
    blockTimestampCache.set(key, ts);
    return ts;
  } catch {
    return 0n;
  }
}
