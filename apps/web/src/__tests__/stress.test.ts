import { describe, expect, it } from "vitest";
import { stressAll, stressLoan, type StressLoanInput, type StressInputs } from "@/lib/stress";

const WETH = "0x4200000000000000000000000000000000000006";
const CBBTC = "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

/**
 * Realistic shape: a WETH-collateralized USDC loan at ~70% LTV with
 * liquidationLtvBps = 9000 (90%). A 30% WETH drop should push it over.
 */
const wethLoan: StressLoanInput = {
  loanId: "34",
  loanToken: USDC,
  collateralToken: WETH,
  debtRawTotal: (5_000_000n + 50_000n).toString(), // 5.05 USDC (6 decimals)
  collateralRaw: (3_000_000_000_000_000n).toString(), // 0.003 WETH (18 decimals)
  liquidationLtvBps: 9000,
  currentLtvBps: 7079,
};

const baseInputs: StressInputs = {
  wethDropPct: 0,
  btcDropPct: 0,
  oraclePrices: { WETH: 2400, cbBTC: 95000 },
};

describe("stressLoan", () => {
  it("returns debtUsd derived from principal raw + loan-token decimals (≈ $5.05)", () => {
    const r = stressLoan(wethLoan, baseInputs);
    expect(r.debtUsd).toBeCloseTo(5.05, 2);
  });

  it("marks loan as liquidatable when the stressed price pushes LTV above the threshold", () => {
    // baseline collateral USD = 0.003 * 2400 = 7.20 → LTV ≈ 70%
    // -30% stress: collateral USD = 0.003 * 1680 = 5.04 → LTV ≈ 100% > 90% liq threshold
    const r = stressLoan(wethLoan, { ...baseInputs, wethDropPct: 30 });
    expect(r.liquidatable).toBe(true);
    expect(r.stressedLtvBps).not.toBeNull();
    expect(r.stressedLtvBps!).toBeGreaterThan(9000);
  });

  it("keeps loan safe when the stressed price stays above the threshold", () => {
    // -5% stress: collateral USD ≈ 6.84 → LTV ≈ 74% < 90%
    const r = stressLoan(wethLoan, { ...baseInputs, wethDropPct: 5 });
    expect(r.liquidatable).toBe(false);
  });

  it("ignores BTC drop slider for WETH-collateralized loans", () => {
    const a = stressLoan(wethLoan, { ...baseInputs, btcDropPct: 0 });
    const b = stressLoan(wethLoan, { ...baseInputs, btcDropPct: 50 });
    // Same stressed LTV — BTC slider must not influence a WETH loan.
    expect(b.stressedLtvBps).toBe(a.stressedLtvBps);
    expect(b.liquidatable).toBe(false);
  });

  it("falls back to baseline when oracle price is missing", () => {
    const r = stressLoan(wethLoan, {
      wethDropPct: 30,
      btcDropPct: 0,
      oraclePrices: {}, // no prices
    });
    expect(r.liquidatable).toBe(false);
    expect(r.stressedLtvBps).toBe(wethLoan.currentLtvBps);
  });
});

describe("stressAll", () => {
  it("totals debt across all loans and counts liquidatables", () => {
    const safeLoan: StressLoanInput = {
      ...wethLoan,
      loanId: "80",
      // bigger collateral cushion → stays safe at -30%
      collateralRaw: (10_000_000_000_000_000n).toString(), // 0.01 WETH
    };
    const out = stressAll([wethLoan, safeLoan], { ...baseInputs, wethDropPct: 30 });
    expect(out.totalPrincipalUsd).toBeCloseTo(10.1, 1); // 5.05 + 5.05
    expect(out.liquidatableCount).toBe(1);
    expect(out.liquidatablePrincipalUsd).toBeCloseTo(5.05, 2);
  });
});
