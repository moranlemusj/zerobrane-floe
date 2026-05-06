/**
 * USDC value type. Bigint at 6 decimals, matches on-chain representation.
 * Floats are unsafe at large values; bigint is the only correct choice for USDC math.
 */
export type UsdcAmount = bigint;

export const USDC_DECIMALS = 6 as const;
export const USDC_UNIT: UsdcAmount = 1_000_000n;

/**
 * Convert a human-readable USDC amount ("1.5", "0.000001", or 1.5) to raw bigint units.
 * Truncates beyond 6 decimals (does not round). Throws on malformed input.
 */
export function toUsdc(human: number | string): UsdcAmount {
  if (typeof human === "number") {
    if (!Number.isFinite(human)) throw new Error(`toUsdc: non-finite number ${human}`);
    return toUsdc(human.toString());
  }
  const s = human.trim();
  if (!s) throw new Error("toUsdc: empty string");
  const negative = s.startsWith("-");
  const body = negative ? s.slice(1) : s;
  if (!/^\d+(\.\d+)?$/.test(body)) throw new Error(`toUsdc: invalid number "${human}"`);
  const [whole, frac = ""] = body.split(".");
  const fracPadded = (frac + "0".repeat(USDC_DECIMALS)).slice(0, USDC_DECIMALS);
  const raw = BigInt((whole ?? "0") + fracPadded);
  return negative ? -raw : raw;
}

/** Convert raw USDC bigint back to a human-readable decimal string. */
export function fromUsdc(amount: UsdcAmount): string {
  const negative = amount < 0n;
  const abs = negative ? -amount : amount;
  const whole = abs / USDC_UNIT;
  const frac = abs % USDC_UNIT;
  const fracStr = frac.toString().padStart(USDC_DECIMALS, "0").replace(/0+$/, "");
  const out = fracStr ? `${whole}.${fracStr}` : `${whole}`;
  return negative ? `-${out}` : out;
}

/** Pretty-print USDC. `formatUsdc(1_500_000n)` → "1.5 USDC". */
export function formatUsdc(amount: UsdcAmount, opts?: { symbol?: boolean }): string {
  const human = fromUsdc(amount);
  return opts?.symbol === false ? human : `${human} USDC`;
}

/** Parse a raw decimal-string amount (as Floe wires them) to bigint. */
export function parseRaw(raw: string): UsdcAmount {
  if (!/^-?\d+$/.test(raw)) throw new Error(`parseRaw: invalid raw "${raw}"`);
  return BigInt(raw);
}

/** Emit a raw decimal-string amount for the wire. */
export function toRaw(amount: UsdcAmount): string {
  return amount.toString();
}

// -----------------------------------------------------------------------------
// Domain types — mirror live Floe `credit-api` shapes (decimal strings → bigint).
// -----------------------------------------------------------------------------

export type LoanStateName =
  | "idle"
  | "borrowing"
  | "at_limit"
  | "repaying"
  | "delegation_inactive";

export interface LoanState {
  state: LoanStateName;
  reason?: string;
  details?: {
    source?: "facility" | "delegation" | string;
    status?: string;
    available?: UsdcAmount;
    creditLimit?: UsdcAmount;
  };
}

export interface CreditRemaining {
  available: UsdcAmount;
  creditIn: UsdcAmount;
  creditOut: UsdcAmount;
  creditLimit: UsdcAmount;
  headroomToAutoBorrow: UsdcAmount;
  utilizationBps: number;
  sessionSpendLimit: UsdcAmount | null;
  sessionSpent: UsdcAmount;
  sessionSpendRemaining: UsdcAmount | null;
  asOf: string;
}

export interface SpendLimit {
  active: boolean;
  limit: UsdcAmount;
  sessionSpent: UsdcAmount;
  sessionRemaining: UsdcAmount;
}

export interface X402Reflection {
  available: UsdcAmount;
  headroomToAutoBorrow: UsdcAmount;
  sessionSpendRemaining: UsdcAmount | null;
  willExceedAvailable: boolean;
  willExceedHeadroom: boolean;
  willExceedSpendLimit: boolean;
}

export interface X402CostEstimate {
  url: string;
  method: string;
  isX402: boolean;
  price: UsdcAmount;
  asset: string;
  network: string;
  payTo: string;
  scheme: string;
  cached: boolean;
  fetchedAt: string;
  reflection: X402Reflection;
}

export interface UnsignedTx {
  to: string;
  data: string;
  value: string;
  chainId: number;
  description?: string;
  optional?: boolean;
}

export interface InstantBorrowParams {
  marketId: string;
  borrowAmount: UsdcAmount;
  collateralAmount: bigint;
  maxInterestRateBps: number;
  duration: number;
  minLtvBps: number;
  maxLtvBps: number;
  idempotencyKey?: string;
}

export interface InstantBorrowResult {
  attemptId: string;
  status: string;
  reused: boolean;
  transactions: UnsignedTx[];
  selectedOffer?: {
    offerHash: string;
    minInterestRateBps: number;
    remainingAmount: UsdcAmount;
  };
}

export interface ProxyCheckResult {
  requiresPayment: boolean;
  price?: UsdcAmount;
  currency?: string;
  network?: string;
}

export interface ProxyFetchResult {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

export interface CreditThreshold {
  id: string;
  thresholdBps: number;
  webhookId: number;
  createdAt: string;
}

export interface AgentBalance {
  creditLimit: UsdcAmount;
  creditUsed: UsdcAmount;
  creditAvailable: UsdcAmount;
  activeLoans: { loanId: string; principal: UsdcAmount }[];
  delegationActive: boolean;
}

export interface PreRegisterResult {
  paymentWalletAddress: string;
  facilitatorAddress: string;
  status: string;
}

export interface RegisterResult {
  status: string;
  apiKey: string;
  creditLimit: UsdcAmount;
  paymentWalletAddress: string;
}

export interface BorrowEvent {
  type:
    | "borrow"
    | "repay"
    | "match"
    | "liquidate"
    | "collateral_added"
    | "collateral_withdrawn";
  toolName: string;
  details: unknown;
  timestamp: number;
}

// -----------------------------------------------------------------------------
// Public-endpoint shapes — verified live against credit-api.floelabs.xyz on Base
// mainnet (2026-05-06). Source: live probes in scripts/discover.ts.
// -----------------------------------------------------------------------------

export interface MarketTokenInfo {
  address: `0x${string}`;
  symbol: string;
  decimals: number;
}

export interface Market {
  marketId: `0x${string}`;
  loanToken: MarketTokenInfo;
  collateralToken: MarketTokenInfo;
  isActive: boolean;
}

export interface MarketsResponse {
  markets: Market[];
}

/** Open lender offer published to Floe's intent book. */
export interface CreditOffer {
  offerHash: `0x${string}`;
  lender: `0x${string}`;
  onBehalfOf: `0x${string}`;
  /** Total USDC the lender is offering (raw, decimal string on the wire). */
  amount: UsdcAmount;
  /** USDC already filled by matched borrowers. */
  filledAmount: UsdcAmount;
  /** USDC still available to fill. */
  remainingAmount: UsdcAmount;
  /** Smallest fill the lender accepts per match. */
  minFillAmount: UsdcAmount;
  minInterestRateBps: number;
  maxLtvBps: number;
  /** Seconds. */
  minDuration: number;
  /** Seconds. */
  maxDuration: number;
  allowPartialFill: boolean;
  /** Unix timestamp; offer is inactive before this. */
  validFromTimestamp: number;
  /** Unix timestamp; offer expires after this. */
  expiry: number;
  marketId: `0x${string}`;
  salt: `0x${string}`;
  /** Seconds of overdue tolerance before liquidation is permitted. */
  gracePeriod: number;
  /** Minimum interest the borrower will owe in bps, regardless of duration. */
  minInterestBps: number;
}

export interface CreditOffersResponse {
  offers: CreditOffer[];
}
