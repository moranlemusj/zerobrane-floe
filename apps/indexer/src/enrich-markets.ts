/**
 * Enrich the markets table from chain for any marketIds referenced by
 * loans but not present in our markets table.
 *
 * Floe's /v1/markets only returns markets they've curated for the
 * frontend; chain has more (e.g. USDT/cbBTC). The dashboard's
 * /markets page is much friendlier when every market has its
 * loan/collateral token symbols populated.
 */

import { sql } from "drizzle-orm";
import type { Abi } from "viem";
import { type Db, markets } from "@floe-dashboard/data";
import type { IndexerClients } from "./clients";
import { CONTRACTS } from "./contracts";

interface OnchainMarket {
  marketId: `0x${string}`;
  loanToken: `0x${string}`;
  collateralToken: `0x${string}`;
}

const ERC20_ABI = [
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
] as const satisfies Abi;

const ZERO_ADDR = "0x0000000000000000000000000000000000000000";

export async function enrichUnknownMarkets(
  clients: IndexerClients,
  matcherViewsAbi: Abi,
): Promise<{ enriched: number; skipped: number }> {
  // Find marketIds in loans we don't have markets rows for.
  const unknown = await clients.db.execute(
    sql`SELECT DISTINCT loans.market_id FROM loans LEFT JOIN markets ON markets.market_id = loans.market_id WHERE markets.market_id IS NULL`,
  );
  let enriched = 0;
  let skipped = 0;
  for (const row of unknown.rows) {
    const marketId = (row as { market_id: string }).market_id;
    try {
      const m = (await clients.httpClient.readContract({
        address: CONTRACTS.matcher,
        abi: matcherViewsAbi,
        functionName: "getMarket",
        args: [marketId],
      })) as OnchainMarket;
      if (m.loanToken === ZERO_ADDR || m.collateralToken === ZERO_ADDR) {
        skipped++;
        continue;
      }
      const [loanSym, loanDec, colSym, colDec] = await Promise.all([
        readSymbol(clients, m.loanToken),
        readDecimals(clients, m.loanToken),
        readSymbol(clients, m.collateralToken),
        readDecimals(clients, m.collateralToken),
      ]);
      await upsertMarket(clients.db, {
        marketId,
        loanToken: m.loanToken,
        loanSymbol: loanSym,
        loanDecimals: loanDec,
        collateralToken: m.collateralToken,
        collateralSymbol: colSym,
        collateralDecimals: colDec,
      });
      enriched++;
    } catch {
      skipped++;
    }
  }
  return { enriched, skipped };
}

async function readSymbol(clients: IndexerClients, addr: `0x${string}`): Promise<string> {
  try {
    return (await clients.httpClient.readContract({
      address: addr,
      abi: ERC20_ABI,
      functionName: "symbol",
    })) as string;
  } catch {
    return "?";
  }
}

async function readDecimals(clients: IndexerClients, addr: `0x${string}`): Promise<number> {
  try {
    return (await clients.httpClient.readContract({
      address: addr,
      abi: ERC20_ABI,
      functionName: "decimals",
    })) as number;
  } catch {
    return 18;
  }
}

async function upsertMarket(
  db: Db,
  m: {
    marketId: string;
    loanToken: string;
    loanSymbol: string;
    loanDecimals: number;
    collateralToken: string;
    collateralSymbol: string;
    collateralDecimals: number;
  },
): Promise<void> {
  await db
    .insert(markets)
    .values({
      marketId: m.marketId,
      loanTokenAddress: m.loanToken,
      loanTokenSymbol: m.loanSymbol,
      loanTokenDecimals: m.loanDecimals,
      collateralTokenAddress: m.collateralToken,
      collateralTokenSymbol: m.collateralSymbol,
      collateralTokenDecimals: m.collateralDecimals,
      isActive: true,
      lastSyncedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: markets.marketId,
      set: {
        loanTokenSymbol: m.loanSymbol,
        loanTokenDecimals: m.loanDecimals,
        collateralTokenSymbol: m.collateralSymbol,
        collateralTokenDecimals: m.collateralDecimals,
        lastSyncedAt: new Date(),
      },
    });
}
