/**
 * Pure math for the protocol-wide stress test. No React, no DB —
 * unit-testable in isolation.
 */

import { tokenInfo } from "./format";

export interface StressLoanInput {
  loanId: string;
  loanToken: string;
  collateralToken: string;
  /** Raw uint256 — what the borrower owes today (principal + accrued). */
  debtRawTotal: string;
  /** Raw uint256 — collateral currently held by the matcher. */
  collateralRaw: string;
  /** Liquidation threshold in bps (10000 = 100%). */
  liquidationLtvBps: number;
  /** Current LTV in bps from the live oracle (informational baseline). */
  currentLtvBps: number | null;
}

export interface StressInputs {
  /** Percentage drop in WETH price (0-50 typical). */
  wethDropPct: number;
  /** Percentage drop in cbBTC / BTC price. */
  btcDropPct: number;
  /** Latest oracle prices in USD per token, keyed by collateral symbol. */
  oraclePrices: { WETH?: number; cbBTC?: number };
}

export interface StressResult {
  loanId: string;
  collateralSymbol: string;
  baselineLtvBps: number | null;
  stressedLtvBps: number | null;
  liquidatable: boolean;
  /** Principal (debt) USD value at baseline — used for "$X at risk" rollup. */
  debtUsd: number;
}

const WETH_LOWER = "0x4200000000000000000000000000000000000006";
const CBBTC_LOWER = "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf";

function dropFor(symbol: string, inputs: StressInputs): number {
  if (symbol === "WETH") return inputs.wethDropPct;
  if (symbol === "cbBTC") return inputs.btcDropPct;
  return 0;
}

function priceFor(symbol: string, inputs: StressInputs): number | undefined {
  if (symbol === "WETH") return inputs.oraclePrices.WETH;
  if (symbol === "cbBTC") return inputs.oraclePrices.cbBTC;
  return undefined;
}

export function stressLoan(loan: StressLoanInput, inputs: StressInputs): StressResult {
  const collateralTok = tokenInfo(loan.collateralToken);
  const loanTok = tokenInfo(loan.loanToken);
  const collateralAmount = Number(loan.collateralRaw) / 10 ** collateralTok.decimals;
  // Loan tokens are USDC/USDT — both ≈ $1. We don't model stablecoin depeg.
  const debtUsd = Number(loan.debtRawTotal) / 10 ** loanTok.decimals;

  const basePrice = priceFor(collateralTok.symbol, inputs);
  if (basePrice === undefined || collateralAmount === 0) {
    return {
      loanId: loan.loanId,
      collateralSymbol: collateralTok.symbol,
      baselineLtvBps: loan.currentLtvBps,
      stressedLtvBps: loan.currentLtvBps,
      liquidatable: false,
      debtUsd,
    };
  }

  const drop = dropFor(collateralTok.symbol, inputs);
  const stressedPrice = basePrice * (1 - drop / 100);
  const stressedCollateralUsd = collateralAmount * stressedPrice;
  const stressedLtvBps =
    stressedCollateralUsd > 0 ? Math.round((debtUsd / stressedCollateralUsd) * 10000) : null;
  const liquidatable =
    stressedLtvBps !== null && stressedLtvBps >= loan.liquidationLtvBps;

  return {
    loanId: loan.loanId,
    collateralSymbol: collateralTok.symbol,
    baselineLtvBps: loan.currentLtvBps,
    stressedLtvBps,
    liquidatable,
    debtUsd,
  };
}

export function stressAll(loans: StressLoanInput[], inputs: StressInputs): {
  results: StressResult[];
  liquidatableCount: number;
  liquidatablePrincipalUsd: number;
  totalPrincipalUsd: number;
} {
  const results = loans.map((l) => stressLoan(l, inputs));
  let liquidatableCount = 0;
  let liquidatablePrincipalUsd = 0;
  let totalPrincipalUsd = 0;
  for (const r of results) {
    totalPrincipalUsd += r.debtUsd;
    if (r.liquidatable) {
      liquidatableCount++;
      liquidatablePrincipalUsd += r.debtUsd;
    }
  }
  return { results, liquidatableCount, liquidatablePrincipalUsd, totalPrincipalUsd };
}

// Re-export internals consumers may want to inspect in tests.
export const _internal = { WETH_LOWER, CBBTC_LOWER };
