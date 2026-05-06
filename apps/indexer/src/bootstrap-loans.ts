/**
 * One-shot loan bootstrap — enumerates `getLoan(id)` for sequential IDs
 * to find every loan that exists, regardless of when its creation event
 * was emitted (including loans older than our event-backfill window).
 *
 * Probes IDs in batches via multicall. Stops when we hit `consecutiveEmpty`
 * IDs in a row that return the zero sentinel — heuristic for "we're past
 * the highest active ID."
 */

import type { Abi } from "viem";
import type { IndexerClients } from "./clients";
import { CONTRACTS } from "./contracts";

const ZERO_ADDR = "0x0000000000000000000000000000000000000000" as const;

export interface BootstrapResult {
  found: bigint[];
  highestProbed: bigint;
}

export async function discoverLoanIds(
  clients: IndexerClients,
  matcherViewsAbi: Abi,
  opts: { startId?: bigint; batch?: bigint; consecutiveEmpty?: bigint; maxId?: bigint } = {},
): Promise<BootstrapResult> {
  const startId = opts.startId ?? 1n;
  const batch = opts.batch ?? 50n;
  const consecutiveEmpty = opts.consecutiveEmpty ?? 25n;
  const maxId = opts.maxId ?? 1000n;

  const found: bigint[] = [];
  let emptyStreak = 0n;
  let nextId = startId;

  while (nextId <= maxId && emptyStreak < consecutiveEmpty) {
    const ids: bigint[] = [];
    for (let i = 0n; i < batch && nextId + i <= maxId; i++) ids.push(nextId + i);

    const contracts = ids.map(
      (id) =>
        ({
          address: CONTRACTS.matcher,
          abi: matcherViewsAbi,
          functionName: "getLoan",
          args: [id],
        }) as const,
    );

    const results = (await clients.httpClient.multicall({
      contracts,
      multicallAddress: CONTRACTS.multicall3,
      allowFailure: true,
    })) as Array<{ status: "success"; result: unknown } | { status: "failure" }>;

    for (let i = 0; i < ids.length; i++) {
      const id = ids[i]!;
      const r = results[i];
      const isReal =
        r?.status === "success" &&
        r.result &&
        typeof r.result === "object" &&
        (r.result as { borrower: `0x${string}` }).borrower !== ZERO_ADDR;
      if (isReal) {
        found.push(id);
        emptyStreak = 0n;
      } else {
        emptyStreak++;
        if (emptyStreak >= consecutiveEmpty) break;
      }
    }

    nextId += BigInt(ids.length);
  }

  return { found, highestProbed: nextId - 1n };
}
