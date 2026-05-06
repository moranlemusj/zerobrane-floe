/**
 * Floe protocol contract addresses on Base mainnet.
 *
 * The matcher is the orchestrator — it delegatecalls into LogicsManager,
 * so events from BOTH surfaces fire at the matcher's address (per EVM
 * rules for delegatecall). The HookExecutor is plain-called.
 *
 * Verified via Sourcify + EIP-1967 storage walk on 2026-05-06; see
 * discovery-report.md.
 */

import { getAddress } from "viem";

export const CONTRACTS = {
  /** Lending Intent Matcher (proxy). All events live or surface here. */
  matcher: getAddress("0x17946cD3e180f82e632805e5549EC913330Bb175"),

  /** lendingViews — read-only helpers (isLoanUnderwater, getLiquidationQuote). */
  lendingViews: getAddress("0x9101027166bE205105a9E0c68d6F14f21f6c5003"),

  /** LogicsManager — delegatecalled by the matcher. We don't subscribe to
   *  events at this address (events fire via delegatecall at matcher),
   *  but we fetch its ABI to decode said events. */
  logicsManager: getAddress("0x6b6f7D0741E723beAA4777829B34d19849ED00dB"),

  /** HookExecutor (proxy). Subscribed for HookExecuted/HookExecutionFailed. */
  hookExecutor: getAddress("0x71f0A88DfBFe1E0e2a7F74FBF85ed269eC25C3fA"),

  /** Multicall3 — canonical on Base. Used to batch view reads. */
  multicall3: getAddress("0xcA11bde05977b3631167028862bE2a173976CA11"),
} as const;

/** Chainlink price-feed addresses on Base mainnet. */
export const ORACLES = {
  ethUsd: getAddress("0x71041dDdaD3595F9CEd3DcCFBe3D1F4b0a16Bb70"),
  btcUsd: getAddress("0x64c911996D3c6aC71f9b455B1E8E7266BcbD848F"),
} as const;

/** Map collateral token address → oracle feed address. cbBTC priced via BTC. */
export const COLLATERAL_TO_ORACLE: Record<string, `0x${string}`> = {
  "0x4200000000000000000000000000000000000006": ORACLES.ethUsd, // WETH
  "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf": ORACLES.btcUsd, // cbBTC ≈ BTC peg
};

export const BASE_CHAIN_ID = 8453 as const;
