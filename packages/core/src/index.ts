export type {
  UsdcAmount,
  LoanStateName,
  LoanState,
  CreditRemaining,
  SpendLimit,
  X402Reflection,
  X402CostEstimate,
  UnsignedTx,
  InstantBorrowParams,
  InstantBorrowResult,
  ProxyCheckResult,
  ProxyFetchResult,
  CreditThreshold,
  AgentBalance,
  PreRegisterResult,
  RegisterResult,
  BorrowEvent,
} from "./types.js";

export {
  USDC_DECIMALS,
  USDC_UNIT,
  toUsdc,
  fromUsdc,
  formatUsdc,
  parseRaw,
  toRaw,
} from "./types.js";

export type { AuthContext, AuthMode } from "./auth.js";
