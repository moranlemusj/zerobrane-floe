/**
 * Loan hydration via Multicall3.
 *
 * For each loan ID, batches four reads:
 *   - matcher.getLoan(loanId)            → struct (19 fields)
 *   - matcher.getCurrentLtvBps(loanId)   → uint256 (current LTV in bps)
 *   - matcher.getAccruedInterest(loanId) → (uint256, uint256)
 *   - lendingViews.isLoanUnderwater(loanId) → bool
 *
 * Across N loans, a SINGLE `multicall` RPC call delivers all 4N reads.
 * Failed sub-calls are tolerated (allowFailure: true) — common when a
 * loan ID doesn't exist (zero sentinel) or a view function reverts.
 */

import type { Abi } from "viem";
import type { Db, NewLoan } from "@floe-dashboard/data";
import { loans } from "@floe-dashboard/data";
import type { IndexerClients } from "./clients";
import { CONTRACTS } from "./contracts";

interface LoanStruct {
  marketId: `0x${string}`;
  loanId: bigint;
  lender: `0x${string}`;
  borrower: `0x${string}`;
  loanToken: `0x${string}`;
  collateralToken: `0x${string}`;
  principal: bigint;
  interestRateBps: bigint;
  ltvBps: bigint;
  liquidationLtvBps: bigint;
  marketFeeBps: bigint;
  matcherCommissionBps: bigint;
  startTime: bigint;
  duration: bigint;
  collateralAmount: bigint;
  repaid: boolean;
  gracePeriod: bigint;
  minInterestBps: bigint;
  operator: `0x${string}`;
}

const ZERO_ADDR = "0x0000000000000000000000000000000000000000" as const;

export interface HydrateResult {
  hydrated: number;
  skipped: number;
  notFound: number;
}

/** Loans per multicall round-trip. The public Base RPC silently fails
 *  multicall payloads above ~80 sub-calls; 5 loans × 4 calls = 20 sub-
 *  calls is well within budget for both public and Alchemy/QuickNode. */
const HYDRATE_CHUNK = 5;

export async function hydrateLoans(
  clients: IndexerClients,
  matcherViewsAbi: Abi,
  lendingViewsAbi: Abi,
  loanIds: bigint[],
  triggeredAtBlock: bigint,
): Promise<HydrateResult> {
  if (loanIds.length === 0) return { hydrated: 0, skipped: 0, notFound: 0 };

  let hydrated = 0;
  let skipped = 0;
  let notFound = 0;

  for (let chunkStart = 0; chunkStart < loanIds.length; chunkStart += HYDRATE_CHUNK) {
    const chunk = loanIds.slice(chunkStart, chunkStart + HYDRATE_CHUNK);
    const contracts = chunk.flatMap(
      (id) =>
        [
          {
            address: CONTRACTS.matcher,
            abi: matcherViewsAbi,
            functionName: "getLoan",
            args: [id],
          },
          {
            address: CONTRACTS.matcher,
            abi: matcherViewsAbi,
            functionName: "getCurrentLtvBps",
            args: [id],
          },
          {
            address: CONTRACTS.matcher,
            abi: matcherViewsAbi,
            functionName: "getAccruedInterest",
            args: [id],
          },
          {
            address: CONTRACTS.lendingViews,
            abi: lendingViewsAbi,
            functionName: "isLoanUnderwater",
            args: [id],
          },
        ] as const,
    );

    const results = await retryMulticall(async () =>
      clients.httpClient.multicall({
        contracts,
        multicallAddress: CONTRACTS.multicall3,
        allowFailure: true,
      }),
    );

    const subResult = await processMulticallChunk(
      clients,
      chunk,
      results,
      triggeredAtBlock,
    );
    hydrated += subResult.hydrated;
    skipped += subResult.skipped;
    notFound += subResult.notFound;

    // Throttle between chunks to keep free-tier RPC providers happy.
    if (chunkStart + HYDRATE_CHUNK < loanIds.length) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  return { hydrated, skipped, notFound };
}

/** Retry a multicall on transient RPC failures. The public Base RPC
 *  intermittently 502s; one retry usually fixes it. */
async function retryMulticall<T>(fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
    }
  }
  throw lastErr;
}

async function processMulticallChunk(
  clients: IndexerClients,
  chunk: bigint[],
  results: Array<{ status: "success"; result: unknown } | { status: "failure"; error?: unknown }>,
  triggeredAtBlock: bigint,
): Promise<HydrateResult> {
  let hydrated = 0;
  let skipped = 0;
  let notFound = 0;

  for (let i = 0; i < chunk.length; i++) {
    const id = chunk[i]!;
    const slice = results.slice(i * 4, i * 4 + 4);
    const [loanRes, ltvRes, interestRes, underwaterRes] = slice;

    if (!loanRes || loanRes.status !== "success") {
      skipped++;
      continue;
    }
    const loan = loanRes.result as LoanStruct;
    if (!loan || loan.borrower === ZERO_ADDR) {
      notFound++;
      continue;
    }

    const currentLtvBps =
      ltvRes?.status === "success" && typeof ltvRes.result === "bigint"
        ? Number(ltvRes.result)
        : null;

    const accruedInterestRaw =
      interestRes?.status === "success"
        ? Array.isArray(interestRes.result) && typeof interestRes.result[0] === "bigint"
          ? interestRes.result[0].toString()
          : null
        : null;

    const isUnderwater =
      underwaterRes?.status === "success" && typeof underwaterRes.result === "boolean"
        ? underwaterRes.result
        : null;

    const state: NewLoan["state"] = loan.repaid ? "repaid" : "active";
    const row: NewLoan = {
      loanId: id.toString(),
      marketId: loan.marketId,
      borrower: loan.borrower.toLowerCase(),
      lender: loan.lender.toLowerCase(),
      loanToken: loan.loanToken.toLowerCase(),
      collateralToken: loan.collateralToken.toLowerCase(),
      principalRaw: loan.principal.toString(),
      collateralAmountRaw: loan.collateralAmount.toString(),
      accruedInterestRaw,
      interestRateBps: Number(loan.interestRateBps),
      ltvBps: Number(loan.ltvBps),
      liquidationLtvBps: Number(loan.liquidationLtvBps),
      currentLtvBps,
      marketFeeBps: Number(loan.marketFeeBps),
      matcherCommissionBps: Number(loan.matcherCommissionBps),
      minInterestBps: Number(loan.minInterestBps),
      gracePeriod: Number(loan.gracePeriod),
      startTime: loan.startTime,
      duration: loan.duration,
      state,
      operator: loan.operator === ZERO_ADDR ? null : loan.operator.toLowerCase(),
      isUnderwater,
      createdAtBlock: triggeredAtBlock,
      lastEventBlock: triggeredAtBlock,
      lastHydratedAt: new Date(),
    };

    await clients.db
      .insert(loans)
      .values(row)
      .onConflictDoUpdate({
        target: loans.loanId,
        set: {
          principalRaw: row.principalRaw,
          collateralAmountRaw: row.collateralAmountRaw,
          accruedInterestRaw: row.accruedInterestRaw,
          currentLtvBps: row.currentLtvBps,
          isUnderwater: row.isUnderwater,
          state: row.state,
          operator: row.operator,
          lastEventBlock: row.lastEventBlock,
          lastHydratedAt: row.lastHydratedAt,
          updatedAt: new Date(),
        },
      });

    hydrated++;
  }

  return { hydrated, skipped, notFound };
}
