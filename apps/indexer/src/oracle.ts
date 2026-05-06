/**
 * Chainlink oracle handling.
 *
 *   - At boot: fetch latestRoundData() for each oracle, persist to
 *     `oracles` table.
 *   - Live: subscribe to AnswerUpdated and re-hydrate every active loan
 *     whose collateral asset uses that oracle.
 *
 * No fixed-interval polling — we wait for the chain to tell us when an
 * LTV-affecting price tick happens.
 */

import { eq, sql } from "drizzle-orm";
import type { IndexerClients } from "./clients";
import { CHAINLINK_AGGREGATOR_ABI } from "./abis";
import { ORACLES, COLLATERAL_TO_ORACLE } from "./contracts";
import { oracles, loans, type Db } from "@floe-dashboard/data";

export interface OracleSnapshot {
  feedAddress: `0x${string}`;
  description: string;
  decimals: number;
  latestRoundId: string;
  latestAnswer: bigint;
  updatedAt: bigint;
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      // Exponential-ish backoff: 250ms, 500ms, 1000ms
      await new Promise((r) => setTimeout(r, 250 * (i + 1) ** 2));
    }
  }
  throw lastErr;
}

export async function readOracle(
  clients: IndexerClients,
  feedAddress: `0x${string}`,
): Promise<OracleSnapshot> {
  // Serial reads (no Promise.all) — bursting parallel calls trips
  // free-RPC rate limits. With retries, this still finishes in <1s.
  const description = await withRetry(
    () =>
      clients.httpClient.readContract({
        address: feedAddress,
        abi: CHAINLINK_AGGREGATOR_ABI,
        functionName: "description",
      }) as Promise<string>,
  );
  const decimals = await withRetry(
    () =>
      clients.httpClient.readContract({
        address: feedAddress,
        abi: CHAINLINK_AGGREGATOR_ABI,
        functionName: "decimals",
      }) as Promise<number>,
  );
  const round = await withRetry(
    () =>
      clients.httpClient.readContract({
        address: feedAddress,
        abi: CHAINLINK_AGGREGATOR_ABI,
        functionName: "latestRoundData",
      }) as Promise<readonly [bigint, bigint, bigint, bigint, bigint]>,
  );
  return {
    feedAddress,
    description,
    decimals,
    latestRoundId: round[0].toString(),
    latestAnswer: round[1],
    updatedAt: round[3],
  };
}

export async function snapshotOracle(
  db: Db,
  snapshot: OracleSnapshot,
  observedAtBlock: bigint,
): Promise<void> {
  await db
    .insert(oracles)
    .values({
      feedAddress: snapshot.feedAddress.toLowerCase(),
      description: snapshot.description,
      decimals: snapshot.decimals,
      latestRoundId: snapshot.latestRoundId,
      latestAnswer: snapshot.latestAnswer.toString(),
      observedAtBlock,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: oracles.feedAddress,
      set: {
        latestRoundId: snapshot.latestRoundId,
        latestAnswer: snapshot.latestAnswer.toString(),
        observedAtBlock,
        updatedAt: new Date(),
      },
    });
}

/** Initial oracle sweep at boot. */
export async function initialOracleSync(
  clients: IndexerClients,
  observedAtBlock: bigint,
): Promise<void> {
  for (const [name, feedAddress] of Object.entries(ORACLES)) {
    try {
      const snapshot = await readOracle(clients, feedAddress);
      await snapshotOracle(clients.db, snapshot, observedAtBlock);
    } catch (err) {
      console.warn(
        `[oracle] initial sync failed for ${name} (${feedAddress}):`,
        (err as Error).message.split("\n")[0],
      );
    }
    // Small breather between feeds.
    await new Promise((r) => setTimeout(r, 250));
  }
}

/** Look up which collateral tokens map to a given oracle feed. */
export function collateralsForOracle(feedAddress: `0x${string}`): `0x${string}`[] {
  const result: `0x${string}`[] = [];
  for (const [collateral, oracle] of Object.entries(COLLATERAL_TO_ORACLE)) {
    if (oracle.toLowerCase() === feedAddress.toLowerCase()) {
      result.push(collateral as `0x${string}`);
    }
  }
  return result;
}

/** Fetch active-loan IDs whose collateral matches the given asset(s). */
export async function activeLoanIdsForCollaterals(
  db: Db,
  collateralTokens: `0x${string}`[],
): Promise<bigint[]> {
  if (collateralTokens.length === 0) return [];
  const lowered = collateralTokens.map((a) => a.toLowerCase());
  const rows = await db
    .select({ loanId: loans.loanId })
    .from(loans)
    .where(sql`${loans.collateralToken} = ANY(${lowered}) AND ${loans.state} = 'active'`);
  return rows.map((r) => BigInt(r.loanId));
}
